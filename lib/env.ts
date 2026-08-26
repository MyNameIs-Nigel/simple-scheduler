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
