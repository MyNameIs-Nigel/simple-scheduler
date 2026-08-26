import { Container } from "@/components/Container";
import { timezone } from "@/lib/env";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <Container className="flex flex-col gap-2 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          All times shown in <span className="font-mono text-fg">{timezone()}</span>.
        </p>
        <p>
          <a
            href="https://nigel-smith.dev"
            className="transition-colors duration-200 hover:text-accent-1"
          >
            nigel-smith.dev
          </a>
        </p>
      </Container>
    </footer>
  );
}
