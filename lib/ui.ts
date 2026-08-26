/**
 * De-facto component variants lifted from nigel-smith.dev.
 *
 * The portfolio has no `<Button>` component and no `cn()` helper — it composes
 * with `` `${base} ${className}`.trim() ``. These exported strings keep that
 * approach while giving the variants a single home.
 *
 * The three rules that carry the look:
 *   1. `transition-colors duration-200` on everything interactive.
 *   2. Hover changes the *border colour* — never elevation or scale.
 *   3. Accents read as /10 fill + /40 border + full-strength text.
 */

export const btnPrimary =
  "group rounded-lg border border-accent-1/40 bg-accent-1/10 px-4 py-2 text-sm font-medium text-accent-1 transition-colors duration-200 hover:border-accent-1 hover:bg-accent-1/20 disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1 disabled:cursor-not-allowed disabled:opacity-50";

export const btnDanger =
  "rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors duration-200 hover:border-red-500 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50";

export const btnPill =
  "rounded-full border border-accent-1/40 px-3 py-1 text-sm text-accent-1 transition-colors duration-200 hover:border-accent-1 hover:bg-accent-1/10";

export const btnBlock =
  "group flex w-full items-center justify-center gap-2 rounded-lg border border-accent-1 bg-accent-1/10 px-4 py-3 text-sm font-semibold text-accent-1 transition-colors duration-200 hover:bg-accent-1/20 disabled:cursor-not-allowed disabled:opacity-50";

export const textLink =
  "text-sm font-medium text-accent-1 transition-colors duration-200 hover:text-accent-2";

/** The canonical card. Hover shifts the border, nothing else moves. */
export const card =
  "rounded-xl border border-border bg-surface p-5 transition-colors duration-200";

export const cardHover = `${card} hover:border-accent-1/50`;

/** Form controls, themed to the surface/border tokens. */
export const input =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg transition-colors duration-200 placeholder:text-muted focus:border-accent-1/50 focus:outline-none";

export const label = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted";

export const kbd =
  "rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg";

/** Small caps section eyebrow. */
export const eyebrow = "text-xs font-semibold uppercase tracking-widest";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
