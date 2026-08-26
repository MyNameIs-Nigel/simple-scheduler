#!/bin/sh
set -e

# Migrations run to completion before the server binds. A failed migration must
# stop the container from starting at all, rather than surfacing as a 500 on the
# first request — which is why this is an entrypoint step and not an
# instrumentation hook.
echo "[entrypoint] applying migrations..."
node scripts/migrate.mjs

# Creates the default calendar only when the database has none.
node scripts/seed.mjs

echo "[entrypoint] starting server..."
exec "$@"
