import { z } from "zod";

/**
 * Parsed once at module load so a misconfigured deploy fails loudly on boot
 * rather than at the first sign-in attempt.
 *
 * Every value here is server-only. SITE_URL deliberately has no NEXT_PUBLIC_
 * prefix: nothing on the client reads it (the subscribe panel receives its
 * feed URLs as props), so keeping it server-side means it is read from the
 * environment at runtime rather than inlined at build time. That is what lets
 * one published image run against any hostname without a rebuild.
 */
const serverSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  ADMIN_EMAIL: z.email("ADMIN_EMAIL must be a valid email address"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters — generate with: openssl rand -base64 32"),
  SITE_URL: z.url("SITE_URL must be an absolute URL"),
  SCHEDULER_TIMEZONE: z.string().min(1).default("UTC"),
  DATABASE_PATH: z.string().min(1).default("./data/scheduler.db"),
  // Optional with defaults on purpose: this schema throws on boot, so making
  // either of these required would stop the running container from restarting
  // after a `docker compose pull` until the .env on the host caught up.
  SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),

  // MCP Configuration
  MCP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MCP_TOKEN_SECRET: z.string().optional(),
  MCP_ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).default(3600), // 1 hour in seconds
  MCP_REFRESH_TOKEN_TTL: z.coerce.number().int().min(3600).default(30 * 24 * 3600), // 30 days in seconds
  MCP_ALLOWED_REDIRECT_URIS: z.string().optional(),
  MCP_MAX_RESULTS: z.coerce.number().int().min(1).max(500).default(100),
  MCP_DEFAULT_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  MCP_DEV_STATIC_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.MCP_ENABLED) {
    if (!data.MCP_TOKEN_SECRET || data.MCP_TOKEN_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MCP_TOKEN_SECRET"],
        message: "MCP_TOKEN_SECRET must be at least 32 characters when MCP_ENABLED is true",
      });
    }
  }
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** Normalised origin with no trailing slash — safe to concatenate paths onto. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The zone every date is rendered in. Storage is always UTC epoch ms. */
export function timezone(): string {
  return process.env.SCHEDULER_TIMEZONE || "UTC";
}

/** Case-insensitive: Google may return a differently-cased local part. */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === env().ADMIN_EMAIL.trim().toLowerCase();
}

/** How often a subscribed calendar is re-fetched. */
export function syncIntervalMs(): number {
  const raw = Number(process.env.SYNC_INTERVAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 5 && raw <= 1440 ? raw : 30;
  return minutes * 60 * 1000;
}

/** False disables the background poller entirely — used by CI and the test run. */
export function syncEnabled(): boolean {
  return (process.env.SYNC_ENABLED ?? "true") !== "false";
}

export function mcpEnabled(): boolean {
  return (process.env.MCP_ENABLED ?? "false") === "true";
}

export function mcpTokenSecret(): string {
  const secret = process.env.MCP_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("MCP_TOKEN_SECRET must be at least 32 characters");
  }
  return secret;
}

export function mcpAccessTokenTtl(): number {
  const raw = Number(process.env.MCP_ACCESS_TOKEN_TTL);
  return Number.isFinite(raw) && raw >= 60 ? raw : 3600;
}

export function mcpRefreshTokenTtl(): number {
  const raw = Number(process.env.MCP_REFRESH_TOKEN_TTL);
  return Number.isFinite(raw) && raw >= 3600 ? raw : 30 * 24 * 3600;
}

export function mcpMaxResults(): number {
  const raw = Number(process.env.MCP_MAX_RESULTS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 500 ? raw : 100;
}

export function mcpDefaultWindowDays(): number {
  const raw = Number(process.env.MCP_DEFAULT_WINDOW_DAYS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 90 ? raw : 7;
}

export function mcpAllowedRedirectUris(): string[] {
  const raw = process.env.MCP_ALLOWED_REDIRECT_URIS;
  if (raw && raw.trim().length > 0) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Default Anthropic documented callbacks + localhost
  return [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
  ];
}

