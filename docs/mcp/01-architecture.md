# 01 — Architecture

## Placement: same app, same origin, same tunnel

The MCP server is a route inside the existing Next.js application, served at
`https://schedule.nigel-smith.dev/mcp`. It is not a separate service, container,
or tunnel.

**Why not a separate service.** The tunnel maps a public hostname to a local
port; a second hostname would need a second ingress rule for a service that
would immediately need read access to the same SQLite file. Two processes
writing one SQLite database is a problem worth avoiding for no gain. A separate
deployment only earns its keep when the MCP server needs to scale, fail, or
release independently — none of which applies to a single-user aggregator.

**What this inherits for free:**

- The existing cloudflared ingress rule on the edge machine
- TLS termination, so the public endpoint is HTTPS with no extra certificate work
- `SITE_URL` as the canonical public origin, already used for OAuth redirects
- The `data/` bind mount as the entire backup surface — including, later, the
  token tables
- The Watchtower deploy path: a merge to `main` ships the MCP server too

**What this must explicitly *not* inherit: the admin session cookie.**

The current authorization model is `lib/auth/dal.ts`, called by every admin page
and every Server Action, reading a `jose`-signed session cookie. Claude's
requests arrive from Anthropic's cloud with no browser, no cookie, and no way to
acquire one. The `/mcp` route needs a parallel authorization path that verifies a
bearer token instead.

The README already makes the correct argument in a different context — Server
Actions are reachable by direct POST regardless of what the UI renders, so
authorization lives in the DAL rather than in the routing layer. The same
argument applies here with a twist: `/mcp` is a *public, unauthenticated-by-
default* endpoint that the whole internet can POST to. It must call its own
token-verifying check on every single request, before dispatch, with no
reliance on middleware. `proxy.ts` is explicitly not a security boundary and
must not be used as one for this route either.

## Transport

Streamable HTTP. A single endpoint handling POST for client→server messages,
with server→client streaming when a response warrants it.

The legacy HTTP+SSE transport is being deprecated and there is no reason to
carry it. Nothing in this design needs long-lived server-push: every tool is a
request/response database read that completes in milliseconds.

**Origin validation.** The MCP transport spec requires it: if an `Origin` header
is present and not recognized, return `403 Forbidden`. Claude's requests
originate from Anthropic infrastructure; a browser tab on some other site
attempting to reach this endpoint should be refused outright. This is cheap and
prevents a whole category of drive-by request forgery against a route that,
unlike the admin GUI, is designed to be publicly addressable.

## Data access: in-process, not over HTTP

The `/mcp` handlers call the same internal query and recurrence-expansion layer
the `.ics` writer uses. They do **not** make HTTP requests to the app's own
public endpoints.

This is not just a performance preference. Fetching `/calendars/all.ics` and
re-parsing it would mean:

- Re-serializing to RFC 5545 and immediately re-parsing it, twice the work for
  strictly less information
- Losing the private/public distinction, since feeds are a publication surface
- Losing calendar provenance for events that appear in multiple feeds
- A second network hop through the tunnel for data sitting in a local file

Reusing the internal layer also guarantees the property the README already
values: the MCP view and the web view cannot drift, because there is one
expansion implementation.

### Recurrence and timezones are resolved before the boundary

Two of the app's existing invariants extend directly into the MCP layer.

**Instants are UTC epoch milliseconds internally; conversion into
`SCHEDULER_TIMEZONE` happens only at the edges.** The MCP tool response is a new
edge. It gets the same treatment as the calendar UI and the `.ics` writer — a
tool never emits epoch milliseconds. A language model reasoning about
`1757433600000` is a language model burning tokens to arrive at "Tuesday
afternoon."

**Recurrence expands in floating UTC, with the zone reattached on the way out.**
Same rule: a tool emits concrete occurrences with real local times, never an
`RRULE` string. Handing Claude `FREQ=WEEKLY;BYDAY=TU;UNTIL=...` and asking it to
expand the series is both expensive and a correctness risk, and the app already
has a tested expander that handles the DST drift case correctly.

### Known data limitations to document in tool descriptions

Two existing behaviors will surprise a model that doesn't know about them, so
the tool descriptions should state them rather than letting Claude infer that
data is missing:

- **Mirrored events have no descriptions.** Descriptions from subscribed sources
  are discarded before hashing, deliberately, because publishers bury tracking
  links and internal identifiers there. A work shift will have a summary,
  location, and times but never notes. Claude should not conclude the shift is
  malformed or go hunting elsewhere.
- **Mirrored calendars are read-only.** This is enforced in the Server Actions,
  not just the UI, and the MCP write tools must enforce it identically. A tool
  attempting to edit a mirrored event should fail with a clear reason —
  "this calendar mirrors an external source" — rather than a generic error.

## Configuration

Following the existing convention: every setting read from the environment at
startup, invalid configuration failing at boot with a message naming the
offending variable, nothing baked into the image.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MCP_ENABLED` | no | Master switch. Default `false` — the endpoint does not exist until deliberately turned on. |
| `MCP_TOKEN_SECRET` | if enabled | Signing key for access tokens. Separate from `SESSION_SECRET` so that rotating one does not invalidate the other. |
| `MCP_ACCESS_TOKEN_TTL` | no | Access token lifetime. Short by default (minutes to an hour). |
| `MCP_REFRESH_TOKEN_TTL` | no | Refresh token lifetime. Long, but finite. |
| `MCP_ALLOWED_REDIRECT_URIS` | no | Allowlist of client callback URLs. Defaults to Anthropic's documented callbacks. |
| `MCP_MAX_RESULTS` | no | Hard ceiling on events returned by any single tool call. |
| `MCP_DEFAULT_WINDOW_DAYS` | no | Default lookahead when a tool call omits a range. |

`SITE_URL` is reused as-is. It already serves as the canonical public origin for
OAuth redirects, feed URLs, and event UIDs; for MCP it additionally becomes the
OAuth `issuer` and the protected `resource` identifier. One variable, one
source of truth for "what this server is called from outside."

`SCHEDULER_TIMEZONE` is likewise reused as the display zone for all tool output.

**`MCP_ENABLED` defaulting to `false` is deliberate.** The image is public and
the same artifact runs locally and in production. An MCP endpoint that
materializes by default on every deployment of this project is a surprise; one
that requires an explicit opt-in is not.

## Deployment consequences worth being clear-eyed about

The README is already honest about Watchtower: no approval step, a bad image
reaching `:latest` is live within one poll interval, and the CI gate stands in
for review. Adding MCP extends the blast radius of that trade in two specific
ways.

**Tool schemas are a compatibility surface.** Claude caches the tool list for a
connection. Renaming a tool or changing a parameter's meaning mid-conversation
produces confusing failures rather than clean errors. Schema changes should be
treated as breaking changes: additive where possible, and when not, understood
as something that will require reconnecting the connector.

**Token tables live in `data/`.** This is good — the existing backup story
covers them with no changes. It also means a restored backup restores live
tokens, so a restore-from-backup is a moment to consider revocation.

**A schema migration that touches token tables runs before the server binds**,
per the existing startup behavior. Fine, but it means a failed token migration
takes the whole scheduler down, not just MCP. Token storage should be additive
tables, never alterations to existing calendar tables.
