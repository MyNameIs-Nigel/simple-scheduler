# simple-scheduler MCP Design Notes

Conceptual design documents for exposing `schedule.nigel-smith.dev` to Claude as a custom connector (remote Model Context Protocol server), served directly from the existing Next.js application at `/mcp`, authenticated with OAuth 2.1.

These documents record architectural decisions, trade-offs, constraints, and phased implementation plans.

## Documents

| Document | Description |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | Placement, transport (Streamable HTTP), environment configuration, deployment considerations, and direct SQLite/in-process data access layer |
| [02-oauth.md](./02-oauth.md) | Authorization server design, Dynamic Client Registration (DCR), PKCE (S256), token issuance and rotation, delegation to Google OAuth identity |
| [03-tool-surface.md](./03-tool-surface.md) | Specification of MCP tools (`list_calendars`, `get_agenda`, `get_event`, `find_free_time`, `search_events`, `summarize_schedule`, `check_conflicts`, and Phase 5 write tools), plus prompts and resources |
| [04-output-contract.md](./04-output-contract.md) | Token efficiency contract, resolved local time formatting, concise tabular line items, bounded results, deduplication, and error actionable feedback |
| [05-phases.md](./05-phases.md) | Phased delivery breakdown (Phases 0 through 6), verification criteria, and key open questions |
