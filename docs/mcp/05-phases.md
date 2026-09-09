# 05 — Phases

Ordered so that each phase produces something verifiable on its own, and so that
the riskiest unknown — OAuth — is settled before any effort goes into tools that
depend on it.

---

## Phase 0 — Endpoint exists and refuses correctly

Config plumbed (`MCP_ENABLED` and friends, failing at boot by name per the
existing convention). The `/mcp` route exists, speaks Streamable HTTP, validates
`Origin` and returns `403` on a bad one, and returns `401` with a
`WWW-Authenticate` header pointing at protected resource metadata. Both metadata
documents served and correct.

No tools. No tokens. Nothing readable.

**Proves:** the route is reachable from outside, TLS terminates, the tunnel
carries it, and — critically — the discovery chain is fetchable *from Anthropic's
network*, not just from your LAN.

**Verify from outside the network.** This is the single highest-value check in
the whole build, because a discovery endpoint that works from your browser and
not from Anthropic produces the most confusing class of connector failure.

**Done when:** adding the connector in Claude gets past discovery and fails at
authorization — the *correct* failure at this stage.

---

## Phase 1 — Authorization server

DCR, authorize (delegating to the existing Google flow), token, refresh,
revocation. Token tables added as new tables only. Stateless signed access
tokens, stored hashed refresh tokens with rotation. Scopes defined —
`schedule:read` and `schedule:write` — with write never granted yet.

One trivial tool (`ping`, or `list_calendars` returning names only) exists solely
to prove an authenticated call completes end to end.

**Proves:** the whole auth chain. This is the phase most likely to consume more
time than expected, which is exactly why nothing valuable is built on top of it
yet.

**Watch for:** the token endpoint parsing form-encoded bodies while registration
parses JSON; `resource` in protected resource metadata matching the connector URL
character for character; standard OAuth error codes on the refresh path.

**Done when:** connecting works from claude.ai, a tool call succeeds, and the
connection survives a token expiry and refresh without manual intervention.

---

## Phase 2 — Read tools

`list_calendars`, `get_agenda`, `get_event`. In-process access to the existing
query and expansion layer. The output contract from
[04-output-contract.md](./04-output-contract.md) applied from the first line —
retrofitting it later means rewriting every tool.

**Proves:** the actual thesis. At the end of this phase, one call replaces the
multi-calendar round-tripping that motivated the project.

**Worth measuring here:** the token cost of a week's agenda through this server
versus the same question answered through the Google Calendar connector. That
number is the project's justification and it's cheap to capture while both paths
still exist.

**Done when:** "what's on my calendar this week" is answered in one call, from
every calendar, correctly merged.

---

## Phase 3 — Answer-shaped tools

`find_free_time`, `search_events`, `summarize_schedule`, `check_conflicts`.

**Proves:** the difference between a calendar API and a useful one. Phase 2 makes
reading cheap; Phase 3 makes reading unnecessary for a whole class of questions.

**The all-day policy in `find_free_time` needs settling here**, and it needs
settling against your real calendars rather than in the abstract.

**Done when:** "when can I fit a two-hour study block this week" is answered
without a single event crossing the boundary.

---

## Phase 4 — Prompts

`daily_agenda`, `week_ahead`, `find_time_for` exposed server-side.

Decide at this point whether these replace the existing client-side
`/daily-agenda` and `/schedule-briefing` skills or coexist with them. Coexisting
means two definitions that will drift — the same failure the app already avoids
by generating feeds from the database rather than exporting files.

**Done when:** the briefing works from a surface where you never configured
anything locally.

---

## Phase 5 — Write tools

`create_event`, `update_event`, `delete_event`, gated behind `schedule:write`,
with server-side enforcement of the mirrored-calendar rule and mandatory
occurrence-or-series scope on recurring edits. Deletion annotated destructive.

Requires re-authorizing the connector to pick up the new scope — which is the
point. Write access should be a deliberate act with a visible moment, not
something that silently appears in a deploy.

**Done when:** an event created through Claude appears in the web UI and in the
`.ics` feeds, and an attempt to edit a mirrored shift fails with a reason that
explains itself.

---

## Phase 6 — Hardening

Rate limiting on registration and token endpoints. Pruning of abandoned client
registrations and expired codes. An admin view of active grants with revoke.
An audit log of tool invocations — what was called, when, by which grant.

**Why the audit log matters more than it looks.** This endpoint is publicly
addressable by design and holds your whole schedule. The log is how you'd ever
know something was wrong, and on a single-user server every line in it should be
attributable to something you did.

---

## Settled Decisions on Open Questions

These decisions were settled during the implementation based on the principles of token efficiency, administrative transparency, and defensive security:

1. **Do private calendars appear in MCP output?**
   - **Decision:** **Yes, by default.** Since the MCP connector authenticates exclusively via the admin Google OAuth identity (`ADMIN_EMAIL`), the caller is the calendar owner examining their own schedule. `list_calendars` supports an optional `includePrivate: false` flag if caller wishes to exclude them, but default is inclusive.

2. **Where does the stale-mirror caveat surface?**
   - **Decision:** In `list_calendars` always (where complete sync health and last counts are reported), and in `get_agenda` **only as a concise one-line notice** when a target mirror calendar's last sync resulted in an error or is older than 24 hours. Normal healthy syncs add zero lines of overhead.

3. **Is Claude Code's static-header path worth maintaining?**
   - **Decision:** **Yes, via `MCP_DEV_STATIC_KEY`.** When configured, requests with `Authorization: Bearer <MCP_DEV_STATIC_KEY>` are admitted with full read/write scopes for rapid local development and testing without completing a browser OAuth cycle. Disabled when unset.

4. **Does read access want rate limiting at all?**
   - **Decision:** **Yes.** We implement defensive sliding-window rate limiting on all endpoints:
     - DCR (`/mcp/register`): 10 registrations per IP per hour.
     - Token exchange & refresh (`/mcp/token`): 60 requests per IP per minute.
     - Tool calls (`/mcp`): 120 calls per minute per client.
     This protects SQLite and bounds token exfiltration if credentials are leak-compromised.

5. **What happens to tokens on restore-from-backup?**
   - **Decision:** Tokens live in the SQLite database and restore with it. However, the admin dashboard (`/admin/mcp`) provides instant single-click revocation of active token families and a button to prune stale data. Furthermore, any detected refresh token reuse automatically revokes the entire token family immediately.
