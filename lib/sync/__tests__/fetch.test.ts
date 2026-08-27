import { describe, expect, it } from "vitest";

import { MAX_FEED_BYTES, fetchIcsSource, normaliseSourceUrl, validateSourceUrl } from "../fetch";

/**
 * The failure modes here are the ones that only ever show up against a real
 * remote server, so they are exercised with a stub `fetch` instead.
 */

const MINIMAL = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";

function stub(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("normaliseSourceUrl", () => {
  it("rewrites webcal to https", () => {
    expect(normaliseSourceUrl("webcal://example.com/a.ics")).toBe("https://example.com/a.ics");
    expect(normaliseSourceUrl("WEBCALS://example.com/a.ics")).toBe("https://example.com/a.ics");
  });

  it("leaves http(s) alone", () => {
    expect(normaliseSourceUrl(" https://example.com/a.ics ")).toBe("https://example.com/a.ics");
  });
});

describe("validateSourceUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateSourceUrl("https://example.com/a.ics").ok).toBe(true);
  });

  it("accepts webcal by way of the rewrite", () => {
    const result = validateSourceUrl("webcal://example.com/a.ics");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.protocol).toBe("https:");
  });

  it.each(["file:///etc/passwd", "ftp://example.com/a.ics", "javascript:alert(1)"])(
    "rejects %s",
    (url) => {
      expect(validateSourceUrl(url).ok).toBe(false);
    },
  );

  it.each([
    "http://localhost:3000/a.ics",
    "http://127.0.0.1/a.ics",
    "http://10.10.20.104/a.ics",
    "http://192.168.1.5/a.ics",
    "http://172.16.0.1/a.ics",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.ics",
  ])("rejects the private address %s", (url) => {
    const result = validateSourceUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/private network/);
  });

  it("does not mistake a public address for a private one", () => {
    // 172.32 is outside the 172.16/12 private block, and 10 in another position
    // must not trip the /^10\./ check.
    expect(validateSourceUrl("http://172.32.0.1/a.ics").ok).toBe(true);
    expect(validateSourceUrl("http://8.8.10.1/a.ics").ok).toBe(true);
  });

  it("rejects a malformed URL", () => {
    expect(validateSourceUrl("not a url").ok).toBe(false);
  });

  it("allows a private address when explicitly opted in", () => {
    // SYNC_ALLOW_PRIVATE_HOSTS — mirroring a calendar published on the LAN is
    // a legitimate thing to want on a self-hosted box.
    expect(validateSourceUrl("http://192.168.1.5/a.ics", { allowPrivate: true }).ok).toBe(true);
    expect(validateSourceUrl("http://localhost:8000/a.ics", { allowPrivate: true }).ok).toBe(true);
  });

  it("still rejects a non-http scheme even with private hosts allowed", () => {
    expect(validateSourceUrl("file:///etc/passwd", { allowPrivate: true }).ok).toBe(false);
  });
});

describe("fetchIcsSource", () => {
  it("returns the body of a successful fetch", async () => {
    const { impl } = stub(() => new Response(MINIMAL, { status: 200 }));
    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.body).toContain("BEGIN:VCALENDAR");
  });

  it("sends the stored validators as conditional headers", async () => {
    const { impl, calls } = stub(() => new Response(null, { status: 304 }));

    const result = await fetchIcsSource("https://example.com/a.ics", {
      etag: '"abc"',
      lastModified: "Mon, 02 Mar 2026 10:00:00 GMT",
      fetchImpl: impl,
    });

    expect(result.kind).toBe("not_modified");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"abc"');
    expect(headers["If-Modified-Since"]).toBe("Mon, 02 Mar 2026 10:00:00 GMT");
  });

  it("returns the validators from the response", async () => {
    const { impl } = stub(
      () =>
        new Response(MINIMAL, {
          status: 200,
          headers: { etag: '"v2"', "last-modified": "Tue, 03 Mar 2026 10:00:00 GMT" },
        }),
    );

    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.etag).toBe('"v2"');
      expect(result.lastModified).toBe("Tue, 03 Mar 2026 10:00:00 GMT");
    }
  });

  it("reports an HTTP error rather than treating it as an empty calendar", async () => {
    const { impl } = stub(() => new Response("gone", { status: 404 }));
    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("404");
  });

  it("rejects a 200 that is not an iCalendar file", async () => {
    // The shape an expired subscription link actually takes: a login page,
    // served with a cheerful 200, which would otherwise parse to zero events
    // and read as "the source is empty".
    const { impl } = stub(() => new Response("<html><body>Sign in</body></html>", { status: 200 }));
    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/did not return an iCalendar/);
  });

  it("rejects a body over the size cap", async () => {
    const huge = `BEGIN:VCALENDAR\r\n${"X".repeat(MAX_FEED_BYTES + 1024)}\r\nEND:VCALENDAR`;
    const { impl } = stub(() => new Response(huge, { status: 200 }));

    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/larger than 5 MB/);
  });

  it("rejects an oversized Content-Length without reading the body", async () => {
    const { impl } = stub(
      () =>
        new Response(MINIMAL, {
          status: 200,
          headers: { "content-length": String(MAX_FEED_BYTES + 1) },
        }),
    );

    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });
    expect(result.kind).toBe("error");
  });

  it("surfaces a timeout as a readable message", async () => {
    const { impl } = stub(() => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    });

    const result = await fetchIcsSource("https://example.com/a.ics", { fetchImpl: impl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/did not respond within/);
  });

  it("never reaches the network for a rejected URL", async () => {
    const { impl, calls } = stub(() => new Response(MINIMAL, { status: 200 }));

    const result = await fetchIcsSource("http://169.254.169.254/latest", { fetchImpl: impl });

    expect(result.kind).toBe("error");
    expect(calls).toHaveLength(0);
  });
});
