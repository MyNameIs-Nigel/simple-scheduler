# 02 — OAuth

This is the part that decides whether the connector works at all, so it gets the
most detail.

## Why OAuth, and not a bearer token

For a single-user personal server, a static API key is the proportionate answer
to the threat model. It is also, on claude.ai, the answer that doesn't reliably
work.

The custom connector UI is built OAuth-first — the Advanced settings expose an
OAuth Client ID and Client Secret and nothing else. A static-header
authentication path exists but has a documented history of the web client
attempting OAuth discovery anyway and failing, sometimes by using the *header
name* as an OAuth `client_id`. Bearer-token-only MCP servers have been reported
as simply incompatible with the web connector.

So the decision is pragmatic rather than principled:

- **claude.ai / Desktop / mobile connector → must speak OAuth.** No way around it.
- **Claude Code → static header auth works reliably today.** Worth supporting as
  a secondary path because it makes local development and debugging far easier
  than round-tripping a browser flow.

The design below therefore builds a real, if minimal, OAuth 2.1 authorization
server, and treats header auth as a development affordance behind its own flag.

## The shape of the problem

MCP authorization has three parties:

1. **The resource server** — `/mcp`, which holds the calendar data
2. **The authorization server** — issues tokens proving the caller is the admin
3. **The client** — Claude, acting on the admin's behalf

For big services these are separate systems. Here, parties 1 and 2 are the same
Next.js app, which collapses most of the complexity. And party 3 has exactly one
member.

The genuinely novel piece is that **the human authentication step already
exists**. The app has a working hand-rolled Google OAuth flow with PKCE that
verifies `id_token` against Google's JWKS and admits exactly one address.

## The central design decision: delegate identity, own authorization

Do not build a second login. The MCP authorization server delegates *identity*
to the existing Google flow and only owns *token issuance*.

Conceptually:

```
Claude → /mcp/authorize
           ↓
     admin session cookie present?
           ↓ no                          ↓ yes
   existing Google OAuth flow  →  issue authorization code
   (PKCE, JWKS, ADMIN_EMAIL)            ↓
           ↓                      redirect to Claude's callback
     back to /mcp/authorize              ↓
                                Claude → /mcp/token → access + refresh token
```

Three properties fall out of this that are worth naming:

**One identity source.** There is exactly one answer to "who is allowed to use
this," and it is still `ADMIN_EMAIL` compared case-insensitively. No second
credential to rotate, no second place for authorization logic to be wrong.

**The consent screen is trivial or absent.** Standard OAuth shows a "do you
allow this app to…" screen because the user and the app owner are different
people. Here they are the same person. Reaching the authorize endpoint with a
valid admin session *is* the consent. A one-click confirmation page is still
worth having — it makes the flow legible and gives a place to see what is being
granted — but it is a UX affordance, not a security control.

**Anyone else who reaches `/mcp/authorize` gets nowhere.** They hit the Google
flow, sign in as themselves, get rejected at the callback exactly as they would
on `/admin`, and never receive a session, an authorization code, or a token.

## Dynamic Client Registration

Claude supports DCR, and enabling it is the difference between "paste a URL,
click connect" and "manually generate a client ID, copy it into Advanced
settings, hope you got it right." Enable it.

**The obvious objection:** DCR means an open registration endpoint. Anyone who
finds the URL can register a client.

**Why that's acceptable here:** registration issues a client identity, not
access. A registered client's only next move is `/mcp/authorize`, which requires
an admin Google session. The attacker's reward for registering is a row in a
table and a hard stop at the login wall. Registration is not an authorization
boundary in OAuth and should not be load-bearing as one.

**What is still worth doing:**

- Rate-limit registration so the table can't be flooded
- Expire registrations that never completed an authorization within a short
  window — the vast majority of rows will be abandoned attempts and there is no
  reason to keep them
- Validate `redirect_uri` at registration against `MCP_ALLOWED_REDIRECT_URIS`,
  defaulting to Anthropic's documented callbacks
  (`https://claude.ai/api/mcp/auth_callback` and the `claude.com` equivalent),
  with loopback URLs permitted for Claude Code
- Log every registration. On a single-user server, a registration you didn't
  initiate is a signal, not noise

## Discovery metadata

Claude finds the authorization server by discovery, not configuration. Two
metadata documents need to exist and need to be correct, because getting them
subtly wrong is the single most common cause of a connector that fails at
"Connect" with an unhelpful error.

**Protected resource metadata** — advertised from the `/mcp` endpoint, pointing
at the authorization server. The `resource` value must match the MCP server URL
*exactly as entered in the connector UI*, including the path. If the connector
is added as `https://schedule.nigel-smith.dev/mcp`, the metadata says exactly
that — not the bare origin, not a trailing slash. List the authorization server
first, since Claude uses the first entry.

**Authorization server metadata** — the standard document describing the
authorize, token, registration, and revocation endpoints, the supported grant
types, and PKCE support.

An unauthenticated request to `/mcp` should respond `401` with a
`WWW-Authenticate` header pointing at the protected resource metadata. That
header is how the discovery chain starts; without it Claude has nothing to
follow.

## Flow requirements

**PKCE with S256** is mandatory. Claude supports it, the app's Google flow
already uses PKCE so the concept is familiar, and for a public client it is the
only thing standing between an intercepted authorization code and a token.

**Authorization codes** are single-use, short-lived (seconds to a couple of
minutes), and bound to the client, the redirect URI, and the PKCE challenge.
A code presented twice invalidates the resulting tokens — replay is a signal
that something went wrong badly enough to warrant starting over.

**Token endpoint parsing.** Claude's token exchange and refresh requests use
`application/x-www-form-urlencoded`, while dynamic client registration uses
JSON. Both parsers need to work. This is an easy thing to get half-right and a
miserable thing to debug from a generic 400.

**Refresh behavior.** Claude refreshes reactively after a `401` and may also
refresh shortly before stored expiry. Return standard OAuth error codes —
`invalid_grant`, `invalid_token` — because Claude branches on them. A generic
500 on an expired token turns a recoverable refresh into a broken connector.

**Rotate refresh tokens on use.** Public clients can't keep a secret, so a
stolen refresh token is otherwise permanent access. Rotation means reuse of a
consumed refresh token is detectable, and the correct response to detecting it
is to revoke the whole token family.

## The architectural cost: this app becomes stateful about auth

Worth stating plainly, because it is the one place where MCP genuinely changes
the app's shape.

Current sessions are stateless `jose`-signed cookies — elegant, nothing to
store, nothing to clean up. That property cannot survive refresh tokens. A
refresh token you cannot revoke is a permanent grant, and revocation requires
server-side state.

The proportionate compromise:

- **Access tokens: stateless and signed.** Short-lived, verified by signature
  alone, no database read on the hot path. Consistent with how sessions already
  work.
- **Refresh tokens: stored.** Hashed at rest, with issue time, last use, family
  lineage for rotation, and a revocation flag.

New tables, additive only, never altering existing calendar tables (see
[01-architecture.md](./01-architecture.md) on migration blast radius):

| Table | Holds |
| --- | --- |
| `mcp_clients` | Registered clients — id, name, redirect URIs, registration time |
| `mcp_authorization_codes` | In-flight codes, their PKCE challenge and bindings; pruned aggressively |
| `mcp_refresh_tokens` | Hashed tokens, lineage, expiry, revocation state |

All three live in the same SQLite file, so they are covered by the existing
`data/` backup surface with no change to the backup procedure.

A **revocation endpoint** and a small admin view listing active grants — which
client, when authorized, when last used, with a revoke button — is the practical
payoff for accepting statefulness. Without it, the only way to cut Claude off is
to rotate `MCP_TOKEN_SECRET`, which is a blunt instrument.

## Scopes

Resist the urge to build a scope system. There is one user and, initially, one
capability set.

The one distinction worth encoding from the start is **read versus write**, so
that Phase 5's write tools arrive as a deliberate grant rather than an implicit
widening of an existing token. Two scopes — something like `schedule:read` and
`schedule:write` — with read-only being the default and write requiring explicit
authorization at grant time.

Anything finer (per-calendar scoping, per-tool permissions) is speculative
complexity for a single-user server and can be added if a real need appears.

## Failure modes to design against

These are the ones that actually bite, drawn from how connectors fail in
practice:

| Symptom | Usual cause |
| --- | --- |
| "Couldn't register with the sign-in service" | Discovery metadata missing, malformed, or unreachable from Anthropic's network |
| Connects, then every tool call 401s | `resource` in protected resource metadata doesn't exactly match the connector URL |
| Auth completes at Google, then token exchange fails | Token endpoint not parsing form-encoded bodies |
| Works for an hour, then breaks | Refresh path returning a non-standard error, or not implemented |
| Works from your laptop, fails from Claude | Discovery endpoints reachable from your LAN but not publicly — verify from outside the network |

That last one deserves emphasis. Every OAuth endpoint in this design must be
reachable from Anthropic's egress network, not only from a browser on your own
machine. The tunnel already handles this for the app, but any endpoint
accidentally gated behind a Cloudflare Access policy will fail in exactly this
confusing way — Access presents an interactive login wall, and an OAuth
handshake has no human to answer it. **If Access is applied to this hostname,
`/mcp` and the OAuth endpoints need a bypass or a service-token policy.**
