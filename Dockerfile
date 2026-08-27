# syntax=docker/dockerfile:1

# better-sqlite3 compiles a native addon, so the build stage needs a toolchain
# that the runtime stage does not. Keeping them separate is what stops the
# final image carrying python3/make/g++ around forever.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- dependencies ---------------------------------------------------------
FROM base AS deps
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- build ----------------------------------------------------------------
FROM base AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No build args: every setting, SITE_URL included, is read from the environment
# at startup. The image is therefore portable — the same artifact runs against
# localhost or the public hostname without rebuilding.
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# --- runtime --------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/scheduler.db

# su-exec drops privileges in the entrypoint; see docker-entrypoint.sh.
RUN apk add --no-cache libc6-compat su-exec \
 && addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# The standalone bundle carries its own minimal node_modules, but not the two
# packages excluded from bundling via serverExternalPackages, so those are
# copied explicitly. better-sqlite3 brings its compiled .node binary with it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ is tracked via a .gitkeep. Git does not record empty directories, and
# without that file this COPY fails in CI while succeeding locally, where the
# directory still exists in the working tree.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations run before the server starts, so the runner needs the SQL, the
# migrator script, and drizzle's own runtime.
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh

# The standalone bundle lays node_modules out the way pnpm does: packages live
# under .pnpm/<name>@<version>/node_modules/<name>, reachable only through
# top-level symlinks that the trace does not always emit. Next's own server
# resolves better-sqlite3 through its traced paths, but the entrypoint scripts
# are plain Node and resolve normally — without this link they fail with
# ERR_MODULE_NOT_FOUND and the container never starts.
RUN set -eu; \
    target="$(find /app/node_modules/.pnpm -maxdepth 4 -type d \
      -path '*better-sqlite3*/node_modules/better-sqlite3' | head -1)"; \
    if [ -z "$target" ]; then echo "better-sqlite3 missing from standalone output" >&2; exit 1; fi; \
    ln -sfn "$target" /app/node_modules/better-sqlite3; \
    node -e "require('better-sqlite3')"

# This chown only covers the no-bind-mount case; a bind mount replaces the
# directory at runtime, ownership included. The entrypoint handles that.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data && chmod +x /app/docker-entrypoint.sh

# Deliberately root: a bind-mounted ./data arrives with the host's ownership,
# which the image cannot predict, so the entrypoint fixes it and then drops to
# nextjs via su-exec. The server itself never runs as root.
EXPOSE 3000
VOLUME ["/app/data"]

# No curl/wget in the base image; node is already here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/calendars/all.ics').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
