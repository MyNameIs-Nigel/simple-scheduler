import Link from "next/link";

import { Container } from "@/components/Container";
import { optionalAdmin } from "@/lib/auth/dal";
import { btnPill } from "@/lib/ui";

/**
 * Glassmorphic sticky bar, matching nigel-smith.dev. Server component: it reads
 * the session to decide between "Sign in" and "Admin".
 */
export async function Navbar() {
  const admin = await optionalAdmin();

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-bg/60 backdrop-blur-xl transition-colors duration-200">
      <Container className="flex items-center justify-between py-3">
        <Link
          href="/"
          className="font-mono text-sm font-semibold tracking-tight text-fg transition-colors duration-200 hover:text-accent-1"
        >
          <span className="text-accent-1">{">"}</span>
          <span className="ml-2">schedule</span>
        </Link>

        <nav className="flex items-center gap-6" aria-label="Main">
          <a
            href="https://nigel-smith.dev"
            className="hidden text-sm text-muted transition-colors duration-200 hover:text-fg sm:inline"
          >
            Portfolio
          </a>
          {admin ? (
            <Link href="/admin" className={btnPill}>
              Admin
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm text-muted transition-colors duration-200 hover:text-fg"
            >
              Sign in
            </Link>
          )}
        </nav>
      </Container>
    </header>
  );
}
