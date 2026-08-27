import Link from "next/link";

import { Container } from "@/components/Container";
import { requireAdmin } from "@/lib/auth/dal";

/**
 * Gate for everything under /admin. `requireAdmin()` here covers page renders;
 * each Server Action repeats the check for itself, since actions are reachable
 * without ever rendering this layout.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();

  const tabs = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/events", label: "Events" },
    { href: "/admin/calendars", label: "Calendars" },
    { href: "/admin/feeds", label: "Feeds" },
    { href: "/admin/import", label: "Import" },
  ];

  return (
    <Container className="py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-tight text-fg">
            <span className="text-accent-1">{">"}</span> admin
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted">{session.email}</p>
        </div>

        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:border-red-500/50 hover:text-red-400"
          >
            Sign out
          </button>
        </form>
      </div>

      <nav className="mb-8 flex flex-wrap gap-1 border-b border-border" aria-label="Admin">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted transition-colors duration-200 hover:border-accent-1/50 hover:text-fg"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </Container>
  );
}
