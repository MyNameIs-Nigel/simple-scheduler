# 03 — Tool surface

## The selection principle

A tool earns its place by making a natural-language question cheaper to answer
than the alternative. Tools that merely expose a database table make the model
do the work and are worse than useless — they consume context to produce
material that consumes more context.

Concretely: the failure mode being designed away is Claude fetching every event
in a range and reasoning over them. Every tool below either answers a question
directly or narrows the field enough that the next call is cheap.

Tools are grouped by what they're *for*, not by what they touch.

---

## Orientation

### `list_calendars`

Returns the calendar inventory: name, slug, whether it's your own or a mirror of
an external source, private/public state, rough event volume, and for mirrors,
last sync time and last sync result.

**Why it exists.** Claude needs to know what "work" or "school" means in this
system before it can filter by it. Without this, every other tool call is
guessing at slugs. It's small, it's cacheable, and it's the natural first call.

**Why sync status is included.** A mirrored calendar whose last sync failed is
serving stale data, and the app already records the reason. Surfacing it means
Claude can say "your work shifts last synced four days ago" instead of
confidently reporting a schedule that's wrong. The existing safety behavior —
a source parsing to zero events is treated as failure, not as an empty calendar —
means stale data is the correct outcome there, but *silently* stale is not.

`readOnlyHint: true`

---

## The workhorse

### `get_agenda`

The primary read tool. Accepts a time range and optional calendar filter,
returns occurrence-expanded, deduplicated, timezone-resolved, chronologically
sorted events across all matching calendars.

**Range handling.** Accepts both natural expressions (`today`, `tomorrow`,
`this week`, `next week`) and explicit ISO dates. Resolving relative ranges
server-side matters more than it looks: it's the difference between Claude
knowing today's date in `SCHEDULER_TIMEZONE` and Claude guessing.

**Defaults to a bounded window** — `MCP_DEFAULT_WINDOW_DAYS`, on the order of a
week. An unbounded agenda is the exact anti-pattern this whole project exists to
avoid, so widening the range should be a deliberate act.

**Cross-calendar deduplication is the point.** An event reachable through
multiple calendars or feeds appears once, with its source calendars noted. This
is a genuine correctness issue that the Google connector cannot solve — it sees
each calendar in isolation.

**Why this replaces most of what you'd do today.** One call, one response, every
calendar, already merged and sorted. The multi-calendar round-tripping that
motivates this project collapses into a single request.

`readOnlyHint: true`

### `get_event`

Full detail for one occurrence: complete times, location, description where one
exists, recurrence described in plain language, whether this occurrence has been
individually edited or skipped, and which calendar owns it.

**Why it's separate from `get_agenda`.** Agenda lines are deliberately terse
(see [04-output-contract.md](./04-output-contract.md)). Most events never need
more than that. Making detail a second, targeted call means the common case
stays cheap and the rare case is still available.

**Recurrence in prose, not `RRULE`.** "Every Tuesday until December 15" costs a
handful of tokens and is immediately usable. `FREQ=WEEKLY;BYDAY=TU;UNTIL=...`
costs more and requires the model to parse a spec it may not handle correctly at
the edges.

`readOnlyHint: true`

---

## Answer-shaped tools

These are the ones that make this server meaningfully better than a calendar
API. Each does work server-side that would otherwise cost thousands of tokens of
event listing.

### `find_free_time`

Given a duration, a search window, and optional constraints (earliest hour,
latest hour, which days, minimum buffer between commitments), returns the open
windows.

**This is the highest-leverage tool in the set.** "When can I fit a two-hour
study block this week?" answered by listing events means loading a week of every
calendar and having Claude do interval arithmetic — expensive, and error-prone
across all-day events and overlapping calendars. Answered by this tool it costs
one call and a handful of lines. **Claude never sees a single event.**

**Design notes worth settling:**
- All-day events need an explicit policy. An all-day "Semester begins" marker
  should not blank out a whole day of availability, while an all-day "Flying to
  Georgia" should. A parameter controlling whether all-day events block,
  defaulting to *not* blocking, is the pragmatic call — with the caller able to
  flip it.
- Buffer between events should be configurable and default to non-zero.
  Back-to-back-to-the-minute is technically free and practically not.
- Which calendars count toward "busy" should be filterable. A calendar you
  merely subscribe to for reference shouldn't necessarily block your time.

`readOnlyHint: true`

### `search_events`

Text search across event summaries and locations within a bounded range,
returning matches in agenda format.

**Why it exists.** "When's my dentist appointment?" and "did I already schedule
that meeting?" are extremely common and catastrophically expensive to answer by
listing. This turns them into one narrow call.

**Bounded by default, both directions.** Search should look backward as well as
forward — "when did I last…" is half the value — but with a default window
rather than the entire database.

`readOnlyHint: true`

### `summarize_schedule`

A rollup over a range: total committed hours, hours per calendar, busiest and
lightest days, count of distinct commitments, largest uninterrupted free block.
No individual events.

**Why it exists.** "How busy is next week?" and "am I overcommitted?" are
questions about shape, not contents. Answering them by listing forty events and
having the model tally them is the most wasteful possible path. This returns a
dozen lines.

**Secondary value:** it's the right tool for a model deciding whether to drill
in. Cheap orientation before an expensive call.

`readOnlyHint: true`

### `check_conflicts`

Given a proposed time range, returns what it collides with — or confirms it's
clear.

**Why it's separate from `find_free_time`.** Different question. `find_free_time`
is "when could this go?"; `check_conflicts` is "I'm thinking of Thursday at
2 — problem?" The second is the natural precondition for creating an event, and
having it as a distinct read-only tool means the conflict check is available
long before write access exists.

`readOnlyHint: true`

---

## Write tools — Phase 5, deliberately last

Read access is where all the value is. Write access adds risk, needs its own
scope, and should not gate the useful part of the project.

### `create_event`, `update_event`, `delete_event`

Standard CRUD on your own calendars, with hard constraints:

**Mirrored calendars are rejected, server-side.** The existing Server Actions
already enforce that subscribed calendars are read-only mirrors and that the
source owns them completely. The MCP layer enforces the same rule at the same
depth — not in the tool description, in the handler. An attempt to edit a
mirrored event returns a clear reason: the calendar mirrors an external source,
and any change would be reverted on the next sync anyway.

**Recurring series need explicit scope.** "This occurrence" versus "the whole
series" is a decision the caller must make, never one the server infers. The app
already models per-occurrence overrides keyed by `RECURRENCE-ID`, so both are
expressible — but a tool that guesses will eventually delete a semester of
classes when you meant to skip one.

**Deletion is annotated destructive** so Claude prompts before invoking it.

`create_event` / `update_event`: `readOnlyHint: false`
`delete_event`: `readOnlyHint: false`, `destructiveHint: true`

### Explicitly out of scope

Calendar creation and deletion, subscription URL management, feed configuration,
and sync triggering all stay in the admin GUI. These are rare, consequential,
and better done by a human looking at a form. An MCP tool that can point a
subscription at an arbitrary URL is also a request-forgery primitive — the app
already guards against this with `SYNC_ALLOW_PRIVATE_HOSTS`, and there's no
reason to reopen that surface through a different door.

---

## Prompts

MCP servers can expose prompts, not just tools. This is underused and directly
relevant.

You already have `/daily-agenda` and `/schedule-briefing` as personal Claude
skills with multi-calendar support. Those are currently client-side: they live in
your Claude configuration, need maintaining there, and don't follow you to other
surfaces.

Exposing them as MCP prompts moves them server-side, next to the data and the
tools they call. They version with the app, ship through the same CI, and appear
automatically wherever the connector is enabled.

| Prompt | Shape |
| --- | --- |
| `daily_agenda` | Today's commitments, formatted as a briefing rather than a list |
| `week_ahead` | Next seven days with shape commentary — heavy days, free blocks, collisions |
| `find_time_for` | Guided scheduling: takes a description, checks conflicts, proposes slots |

**Worth deciding rather than assuming:** whether the server-side prompts replace
the client-side skills or coexist with them. Coexisting risks two definitions of
"daily agenda" drifting apart, which is the same failure the app already avoids
by generating feeds from the database rather than exporting files.

---

## Resources

MCP resources are a poor fit here and should be minimal.

Resources model documents Claude can read. Calendar data is a *query* surface —
the interesting question is always "what's happening between X and Y," which is
a tool with parameters, not a document with a URI.

The one defensible resource is the calendar inventory: a stable, small document
describing what calendars exist. And that's already `list_calendars`.

**Recommendation: ship no resources initially.** Revisit only if a concrete need
appears that a tool can't serve.

---

## Tool description discipline

Tool descriptions are prompt engineering, not documentation, and they cost
context on every conversation where the connector is enabled. Directory
guidelines require names of 64 characters or fewer and descriptions stating
exactly what the tool does and when Claude should call it — good discipline
regardless of whether this is ever submitted anywhere.

Practically, each description should carry:

- What it returns, in one line
- **When to prefer it over a neighbor** — this is the part usually omitted and
  the part that most affects behavior. `summarize_schedule` should say "use this
  instead of `get_agenda` when the question is about workload rather than
  specific events."
- Any data limitation that would otherwise look like a bug — the missing
  descriptions on mirrored events, the read-only mirrors
- Defaults that apply when a parameter is omitted, so Claude doesn't specify
  parameters unnecessarily
