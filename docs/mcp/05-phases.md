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

## Open questions

Things this design deliberately leaves unsettled, because they want a decision
made against real data rather than in a document.

**Do private calendars appear in MCP output?** The connector authenticates as the
admin, so the defensible answer is yes — you're looking at your own data. But
`private` currently means "not on the public site," and MCP is a third surface
the existing two-state model didn't anticipate. Worth deciding explicitly rather
than inheriting whichever behavior falls out.

**Where does the stale-mirror caveat surface?** `list_calendars` clearly carries
sync status. Should `get_agenda` also flag that one of its sources last synced
four days ago? Useful, but it's a line of overhead on every response — and the
output contract says decoration is the enemy. Possibly only when the staleness
exceeds some multiple of `SYNC_INTERVAL_MINUTES`.

**Is Claude Code's static-header path worth maintaining?** It's genuinely easier
for development and debugging than round-tripping a browser flow, and header auth
works reliably there today. But it's a second authentication path into the same
data, which is a second thing to get right. Reasonable either way; leaning yes,
behind its own flag, disabled in production.

**Does read access want rate limiting at all?** One user, one client, local
SQLite reads. Probably not for capacity — but a compromised token with no rate
limit is an unbounded schedule exfiltration, and the audit log only tells you
afterward.

**What happens to tokens on restore-from-backup?** The token tables live in
`data/`, so a restore restores live grants — possibly ones you revoked after the
backup was taken. Worth deciding whether restore should invalidate all grants by
default.
