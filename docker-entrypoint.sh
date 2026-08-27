#!/bin/sh
set -e

# /app/data is a bind mount in the normal deployment, so it arrives owned by
# whatever uid owns the directory on the host — typically root, while the app
# runs as uid 1001. The chown baked into the image does not help: Docker
# overlays the host directory, ownership and all, at container start. Without
# this the first thing the migrator does is fail with SQLITE_CANTOPEN.
#
# So the container starts as root purely to fix that, then drops to nextjs for
# everything else. The server never runs as root.
if [ "$(id -u)" = "0" ]; then
  chown -R nextjs:nodejs /app/data 2>/dev/null || \
    echo "[entrypoint] warning: could not chown /app/data; continuing" >&2
  exec su-exec nextjs "$0" "$@"
fi

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
