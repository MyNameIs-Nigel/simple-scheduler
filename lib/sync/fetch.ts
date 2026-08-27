/**
 * Fetching a remote .ics subscription URL.
 *
 * Kept free of database and Next.js imports so it can be unit tested with a
 * stub `fetch` — every failure mode here (a hung server, an HTML error page
 * served as text/calendar, a redirect to somewhere private) is one we only
 * ever see in production otherwise.
 */

/** Matches the 5 MB cap the upload importer applies in app/admin/actions.ts. */
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 15_000;

export type FetchResult =
  | {
      kind: "ok";
      body: string;
      etag: string | null;
      lastModified: string | null;
    }
  | { kind: "not_modified" }
  | { kind: "error"; message: string };

export type FetchOptions = {
  etag?: string | null;
  lastModified?: string | null;
  /** Overrides SYNC_ALLOW_PRIVATE_HOSTS; used by tests. */
  allowPrivate?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Subscription links are handed out as `webcal://` far more often than `https://`
 * — it is the scheme that makes a calendar client open on click. It is not a
 * real transport: the URL is fetched over HTTPS.
 */
export function normaliseSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^webcals?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcals?:\/\//i, "https://");
  }
  return trimmed;
}

/**
 * Whether a private-network source URL is allowed.
 *
 * Off by default: the server sits inside a home network, and a typo'd or
 * pasted-in internal address would otherwise be fetched happily. Set
 * SYNC_ALLOW_PRIVATE_HOSTS=true to mirror a calendar published on the LAN —
 * a NAS, another container, a local test server.
 */
function allowPrivateHosts(): boolean {
  return process.env.SYNC_ALLOW_PRIVATE_HOSTS === "true";
}

/**
 * Rejects anything that is not a public http(s) endpoint.
 *
 * Only the admin can set a source URL, so this is a guard rail rather than a
 * security boundary — but it is a cheap one, and the failure it prevents (the
 * server fetching something on its own network because a URL was mistyped) is
 * silent otherwise.
 *
 * Hostname-based, so it catches literal addresses but not a public name that
 * resolves to a private one. Closing that would mean resolving DNS ourselves
 * and pinning the socket to the resolved address, which is a large amount of
 * machinery for a single-admin app.
 */
export function validateSourceUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(normaliseSourceUrl(raw));
  } catch {
    return { ok: false, message: "That is not a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      message: "Only http://, https:// and webcal:// URLs are supported.",
    };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowPrivate = opts.allowPrivate ?? allowPrivateHosts();

  if (
    !allowPrivate &&
    (host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      host === "0.0.0.0" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      // Link-local, including the cloud metadata endpoint at 169.254.169.254.
      /^169\.254\./.test(host) ||
      /^f[cd][0-9a-f]{2}:/.test(host) ||
      /^fe80:/.test(host))
  ) {
    return {
      ok: false,
      message:
        "That address is on a private network. Set SYNC_ALLOW_PRIVATE_HOSTS=true to allow it.",
    };
  }

  return { ok: true, url };
}

export async function fetchIcsSource(
  raw: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const validated = validateSourceUrl(raw, { allowPrivate: opts.allowPrivate });
  if (!validated.ok) return { kind: "error", message: validated.message };

  const doFetch = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
    "User-Agent": "simple-scheduler (+https://nigel-smith.dev)",
  };
  // Steady state for a calendar polled every 30 minutes is "nothing changed",
  // and a 304 costs neither transfer nor parse.
  if (opts.etag) headers["If-None-Match"] = opts.etag;
  if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

  let response: Response;
  try {
    response = await doFetch(validated.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `The source did not respond within ${TIMEOUT_MS / 1000}s.`
        : `Could not reach the source: ${(error as Error).message}`;
    return { kind: "error", message };
  }

  if (response.status === 304) return { kind: "not_modified" };

  if (!response.ok) {
    return {
      kind: "error",
      message: `The source returned HTTP ${response.status}.`,
    };
  }

  // Trust the advertised length when it is there, but still cap while reading:
  // Content-Length is absent on chunked responses and is not binding anyway.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
    return { kind: "error", message: "That feed is larger than 5 MB." };
  }

  let body: string;
  try {
    body = await readCapped(response);
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }

  // An expired subscription link typically answers 200 with a login page, which
  // would otherwise parse to zero events and look like "the source is empty".
  if (!/BEGIN:VCALENDAR/i.test(body)) {
    return {
      kind: "error",
      message: "The source did not return an iCalendar file.",
    };
  }

  return {
    kind: "ok",
    body,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

/** Reads the body, aborting once it exceeds the cap rather than after. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error("That feed is larger than 5 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(merged);
}
