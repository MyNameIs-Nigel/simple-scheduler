import Link from "next/link";
import { redirect } from "next/navigation";

import { Container } from "@/components/Container";
import { optionalAdmin } from "@/lib/auth/dal";
import { btnBlock } from "@/lib/ui";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  not_authorized: "That Google account is not the configured admin for this site.",
  email_unverified: "That Google account does not have a verified email address.",
  state_mismatch: "Sign-in could not be verified. Please try again.",
  expired: "The sign-in attempt timed out. Please try again.",
  exchange_failed: "Google rejected the sign-in. Please try again.",
  missing_code: "Google did not return an authorisation code.",
  cancelled: "Sign-in was cancelled.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;

  // Already signed in — skip straight through.
  if (await optionalAdmin()) redirect("/admin");

  const rawReturn = firstParam(params.returnTo);
  const returnTo =
    rawReturn && rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/admin";

  const errorKey = firstParam(params.error);
  const error = errorKey ? (ERRORS[errorKey] ?? "Sign-in failed. Please try again.") : null;

  return (
    <Container className="py-20">
      <div className="mx-auto max-w-sm">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border bg-bg/40 px-4 py-2.5">
            <span className="h-3 w-3 rounded-full bg-red-500/80" aria-hidden />
            <span className="h-3 w-3 rounded-full bg-accent-2/80" aria-hidden />
            <span className="h-3 w-3 rounded-full bg-accent-1/80" aria-hidden />
            <span className="ml-2 font-mono text-xs text-muted">auth</span>
          </div>

          <div className="p-6">
            <h1 className="mb-1 text-lg font-semibold tracking-tight text-fg">Admin sign-in</h1>
            <p className="mb-6 text-xs leading-relaxed text-muted">
              This schedule is publicly readable. Signing in is only needed to edit it,
              and only one Google account is authorised.
            </p>

            {error && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-400"
              >
                {error}
              </p>
            )}

            <a
              href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
              className={btnBlock}
            >
              Continue with Google
              <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </a>

            <p className="mt-6 text-center">
              <Link
                href="/"
                className="text-xs text-muted transition-colors duration-200 hover:text-accent-1"
              >
                ← Back to the schedule
              </Link>
            </p>
          </div>
        </div>
      </div>
    </Container>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
