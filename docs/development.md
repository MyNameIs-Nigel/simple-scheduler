# Local Development & Testing

This guide covers setting up your local development environment, running tests, managing migrations, and working with Next.js 16.

---

## Prerequisites

- **Node.js**: Version 22 LTS or newer.
- **pnpm**: Version 11+ (`corepack enable && corepack use pnpm@11`).
- **SQLite 3**: Embedded via `better-sqlite3` native bindings.

---

## Getting Started

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/MyNameIs-Nigel/simple-scheduler.git
   cd simple-scheduler
   pnpm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Ensure `SITE_URL` is set to `http://localhost:3000`.

3. **Run migrations and initial seed:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

4. **(Optional) Load rich developer seed:**
   To populate multiple calendars, recurring events, moved occurrences, and sample subscriptions:
   ```bash
   node --env-file=.env.local scripts/dev-seed.mjs
   ```

5. **Start development server:**
   ```bash
   pnpm dev
   ```
   Visit `http://localhost:3000` to view the public schedule or `http://localhost:3000/admin` to access the admin portal.

---

## Available Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Starts Next.js development server with Turbopack. |
| `pnpm build` | Builds the standalone production distribution. |
| `pnpm start` | Runs the built application using `next start`. |
| `pnpm lint` | Runs ESLint 9 checks across the codebase. |
| `pnpm test` | Runs the Vitest test suite once. |
| `pnpm test:watch` | Runs Vitest in interactive watch mode. |
| `pnpm db:generate` | Creates new migration SQL files in `db/migrations/` using Drizzle Kit. |
| `pnpm db:migrate` | Runs `scripts/migrate.mjs` against `DATABASE_PATH`. |
| `pnpm db:seed` | Seeds default calendars (`scripts/seed.mjs`). |
| `pnpm db:studio` | Launches Drizzle Studio GUI for inspecting database contents. |

---

## Database Migrations

Database migrations are defined using Drizzle ORM and stored under `db/migrations/`.

### Migration Execution (`scripts/migrate.mjs`)
In production containers, `scripts/migrate.mjs` runs before the Next.js server binds. It uses `better-sqlite3` directly (without requiring `drizzle-orm` in the runtime standalone bundle):
- Reads the journal at `db/migrations/meta/_journal.json`.
- Compares SHA-256 hashes of migration statements against `__drizzle_migrations`.
- Executes each migration within an atomic transaction.

### Modifying the Schema
1. Edit table definitions in `db/schema.ts`.
2. Generate migration files:
   ```bash
   pnpm db:generate
   ```
3. Apply migrations locally:
   ```bash
   pnpm db:migrate
   ```

---

## Testing Strategy

The test suite is built on **Vitest** and covers both isolated domain logic and integration tests:

- **Database Mutations (`db/__tests__/mutations.test.ts`)**:
  Executes against temporary SQLite databases migrated using `scripts/migrate.mjs`. Tests event creation, updates, sequence increments, overrides, and cascade deletions.
- **RFC 5545 Parsing & Building (`lib/ics/__tests__/`)**:
  Validates round-trip export/import of `.ics` files, DST stability, `VTIMEZONE` output, and edge case calendar feeds.
- **Recurrence & Expansion (`lib/events/__tests__/`)**:
  Validates `rrule` expansion across leap days, DST boundaries, and per-occurrence cancellations.
- **Feed Synchronization (`lib/sync/__tests__/`)**:
  Validates external calendar fetching, `ETag` handling, 304 skipping, and description stripping.

To run tests:
```bash
pnpm test
```

---

## Next.js 16 & React 19 Guidelines

- **Routing Middleware**: In Next.js 16, `middleware.ts` is named `proxy.ts`. Remember that `proxy.ts` is only for optimistic browser redirects. Never place security-critical access controls in `proxy.ts`.
- **Server External Packages**: `better-sqlite3` and `@touch4it/ical-timezones` are configured under `serverExternalPackages` in `next.config.ts`. Do not import them in client components.
- **Server Components & Server Actions**: Server Actions must always start with `await requireAdmin()`.
