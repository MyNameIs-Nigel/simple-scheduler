# 04 — Output contract

Token efficiency is the reason this project exists, so it deserves an explicit
contract rather than being left to whoever implements each tool.

Every tool response obeys these rules. They are cheap to follow at build time
and expensive to retrofit.

---

## 1. Emit resolved local times, never instants or offsets

The app stores UTC epoch milliseconds and converts at the edges. A tool response
is an edge.

A model reasoning about `1757433600000` — or about `2026-09-09T21:00:00Z` when
the user is in Mountain Time — is spending tokens to arrive at "Tuesday
afternoon." Do the conversion server-side, using `SCHEDULER_TIMEZONE`, and emit
what a human would read.

State the zone **once**, in a header line, not per event.

## 2. Emit occurrences, never recurrence rules

The tool returns concrete instances. `RRULE` strings never cross the boundary.

The app already has a tested expander that handles the floating-UTC DST case
correctly. Asking a model to reproduce that reasoning is both more expensive and
less reliable than reusing code that's already right.

The one exception is `get_event`, which describes recurrence in prose —
"every Tuesday until December 15" — because there the *pattern* is the answer.

## 3. Prefer compact lines over structured objects

JSON with repeated keys is the largest avoidable cost in the whole design. Ten
events in verbose JSON repeat the same field names ten times, for no benefit —
the model reads prose at least as well as it reads objects.

A compact tabular line carrying day, time, title, and calendar communicates
everything an agenda needs. Something like:

```
Tue 09  14:00–15:00  Team standup            [work]
Tue 09  16:30–17:45  CCNA study block        [school]
Wed 10  all day      Semester begins         [school]
```

This is not a formatting preference. Across a dozen calendars and a full week,
the difference between this and per-event JSON objects is the difference between
a cheap call and an expensive one.

**Where structure does earn its place:** `get_event` (one object, many fields,
no repetition) and `summarize_schedule` (labeled figures). The rule is about
repetition, not about structure as such.

## 4. Omit rather than nullify

No `location: null`, no `"description": ""`, no empty arrays. A field with no
value is absent. Its absence means what its presence would have denied.

Every emitted null is pure cost.

## 5. Collapse all-day events

An all-day event is `all day`, not `00:00–23:59`. Multi-day is a date range on
one line, not one line per day.

## 6. Bound everything by default, and say when you truncated

Every list tool has a default window (`MCP_DEFAULT_WINDOW_DAYS`) and a hard
result ceiling (`MCP_MAX_RESULTS`). The platform caps tool results around
150,000 characters, but the practical ceiling should be far lower — a response
approaching the platform cap has already failed at the actual goal.

**When results are truncated, say so, and say what to do about it.** A silent
truncation makes Claude confidently report an incomplete schedule, which is
worse than an error. The truncation notice should suggest the narrowing move —
a shorter range, a calendar filter — so the retry is one call rather than a
guessing game.

## 7. Deduplicate, and note provenance once

An event reachable through several calendars or feeds appears exactly once, with
its sources noted compactly. Duplicates cost tokens twice and then cost more
when the model tries to work out whether it's looking at two commitments or one.

## 8. Use short, stable IDs

Follow-up calls need to reference a specific occurrence. Whatever identifier
appears in agenda output must be usable directly by `get_event`, `update_event`,
and `delete_event` with no transformation.

Keep it short. A long opaque identifier repeated on every line of a week's agenda
is a meaningful fraction of the response, and the internal event UID — which is
built from `SITE_URL` and designed for RFC 5545 correctness, not brevity — is
the wrong thing to expose. A short reference resolved server-side is better.

## 9. Errors explain the fix

Tool errors are read by a model that will decide what to do next. `Invalid
request` produces a retry loop. `That calendar mirrors an external source and
cannot be edited here` produces the right next action.

Every error names what went wrong *and* what would work instead. This applies
especially to the two hard constraints — mirrored calendars being read-only, and
recurring edits requiring explicit occurrence-or-series scope.

## 10. An empty result is an answer, not an absence

"Nothing scheduled Thursday" is a complete, correct, useful response. It should
read like a statement, not like a failed query — and it must be distinguishable
from "the calendar that would have told you failed to sync."

That distinction connects back to `list_calendars` surfacing sync status. A
mirrored calendar whose last sync failed is *unknown*, not *empty*, and the app
already deliberately preserves the previous events rather than blanking them. A
tool response covering a stale calendar should carry that caveat rather than
implying confidence it doesn't have.

---

## The test

Before adding any field to a response, ask: **would removing this change what
Claude concludes or recommends?**

If not, it's decoration, and decoration is the thing that made the multi-calendar
problem expensive in the first place.
