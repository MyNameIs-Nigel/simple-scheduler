# simple-scheduler Documentation

Welcome to the technical and operational documentation for **simple-scheduler** (`schedule.nigel-smith.dev`).

simple-scheduler is a self-hosted personal scheduling application built with Next.js 16 (App Router), React 19, Tailwind CSS v4, Drizzle ORM, and SQLite (`better-sqlite3`). It serves as a single source of truth for personal schedules by aggregating local events and mirrored remote calendar subscriptions into on-demand iCalendar (`.ics`) feeds and responsive web views.

---

## Documentation Index

```
docs/
├── README.md                 # This overview and table of contents
├── architecture.md           # System architecture, data flow, invariants, and storage
├── configuration.md          # Environment variables, security secrets, and runtime configuration
├── development.md            # Local development, testing, database migrations, and toolchain
├── deployment.md             # Containerisation, Docker Compose, GHCR, Watchtower, and edge tunneling
├── features.md               # Calendar subscription mirrors, merged feeds, recurring events, imports
└── mcp/                      # Model Context Protocol (remote MCP server) design specifications
    ├── README.md             # MCP design notes overview & premise
    ├── 01-architecture.md    # Endpoint placement, transport, and in-process data access
    ├── 02-oauth.md           # OAuth 2.1 authorization server, DCR, and token lifecycle
    ├── 03-tool-surface.md    # MCP tool catalog, selection principles, prompts, and resources
    ├── 04-output-contract.md # Output token efficiency rules and formatting specifications
    └── 05-phases.md          # Implementation phases (0–6) and verification milestones
```

---

## Core Guides

### 1. [System Architecture](./architecture.md)
Detailed walkthrough of application layers:
- **Presentation Layer**: Server-rendered React components for public calendar views (Month, Week, Agenda) and administrative dashboard.
- **Data Access & Storage**: UTC epoch milliseconds representation, schema design (calendars, events, event overrides, published feeds), and query optimization.
- **Recurrence & Timezone Engine**: Floating UTC expansion using `rrule` and Luxon to guarantee zero drift across Daylight Saving Time (DST) boundaries.
- **Security & Authorization**: Primary data-access layer (DAL) authentication (`requireAdmin()`) via signed stateless session JWTs, separated from optimistic routing proxies (`proxy.ts`).

### 2. [Configuration Reference](./configuration.md)
Reference of all environment variables parsed by Zod at boot time:
- Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL`).
- Security keys (`SESSION_SECRET`).
- Runtime routing and timezone parameters (`SITE_URL`, `SCHEDULER_TIMEZONE`, `DATABASE_PATH`).
- Background synchronization controls (`SYNC_ENABLED`, `SYNC_INTERVAL_MINUTES`, `SYNC_ALLOW_PRIVATE_HOSTS`).

### 3. [Development & Testing](./development.md)
Instructions for local contributors:
- Toolchain requirements (Node.js 22+, pnpm 11+).
- Database migrations with `scripts/migrate.mjs` and seed data scripts (`dev-seed.mjs`).
- Test suite execution with Vitest and linting with ESLint 9.
- Handling Next.js 16 conventions (`proxy.ts`, server-only boundary enforcement).

### 4. [Deployment & Operations](./deployment.md)
Production deployment workflow:
- Multi-architecture Docker builds (`linux/amd64`, `linux/arm64`) pushed to GitHub Container Registry (GHCR) via GitHub Actions (`publish.yml`).
- Automatic container updates via Watchtower with strict label filtering.
- Cloudflare Tunnel ingress routing and reverse proxy setup.
- Container permission handling (`su-exec`, UID 1001) and SQLite WAL backup routines.

### 5. [Features & Capabilities](./features.md)
In-depth explanation of calendar functionality:
- **Subscribed Calendars**: Mirroring external `.ics` feeds, conditional fetching (`If-None-Match`, `If-Modified-Since`), sanitization, and safety guards (e.g., zero-event protections).
- **Published Feeds**: Merging arbitrary sets of public and private calendars into custom subscribable `.ics` endpoints.
- **Recurring Events & Overrides**: Full RFC 5545 RRULE support with per-occurrence skips and edits (`RECURRENCE-ID`).
- **iCalendar Import**: Preview and bulk-import mechanism for external `.ics` files.

### 6. [Model Context Protocol (MCP) Design Notes](./mcp/README.md)
Complete conceptual design specifications for integrating the scheduler with Claude as a remote MCP server:
- [01 Architecture](./mcp/01-architecture.md)
- [02 OAuth 2.1 & Identity Delegation](./mcp/02-oauth.md)
- [03 Tool Surface & Selection Principles](./mcp/03-tool-surface.md)
- [04 Output Contract & Token Efficiency](./mcp/04-output-contract.md)
- [05 Phased Implementation Plan](./mcp/05-phases.md)
