import type { Accent } from "@/types";

/**
 * Ported from nigel-smith.dev (`src/components/projects/fleet/accents.ts`).
 *
 * Tailwind cannot interpolate class names, so accent-driven styling goes through
 * `Record<Accent, string>` lookup maps. Keep these in sync with the portfolio.
 *
 * Here accent is *calendar identity* — each calendar owns one accent, and the
 * same accent is used for its dot in the month grid, its chip in the agenda,
 * and its row in the admin list.
 */

export const accentText: Record<Accent, string> = {
  1: "text-accent-1",
  2: "text-accent-2",
  3: "text-accent-3",
  4: "text-accent-4",
};

/** Marker outline. Kept separate from the wash so the wash can sit on its own layer. */
export const accentRing: Record<Accent, string> = {
  1: "border-accent-1",
  2: "border-accent-2",
  3: "border-accent-3",
  4: "border-accent-4",
};

/** Solid dot / bar — the calendar's identity mark in the month grid. */
export const accentDot: Record<Accent, string> = {
  1: "bg-accent-1",
  2: "bg-accent-2",
  3: "bg-accent-3",
  4: "bg-accent-4",
};

/** Translucent wash. Always layered over an opaque ground. */
export const accentFill: Record<Accent, string> = {
  1: "bg-accent-1/15",
  2: "bg-accent-2/15",
  3: "bg-accent-3/15",
  4: "bg-accent-4/15",
};

/** The pill treatment: /25 border + /10 fill + full-strength text. */
export const accentChip: Record<Accent, string> = {
  1: "border-accent-1/25 bg-accent-1/10 text-accent-1",
  2: "border-accent-2/25 bg-accent-2/10 text-accent-2",
  3: "border-accent-3/25 bg-accent-3/10 text-accent-3",
  4: "border-accent-4/25 bg-accent-4/10 text-accent-4",
};

/** Hover border, the portfolio's universal card affordance. */
export const accentHoverBorder: Record<Accent, string> = {
  1: "hover:border-accent-1/50",
  2: "hover:border-accent-2/50",
  3: "hover:border-accent-3/50",
  4: "hover:border-accent-4/50",
};

/** Accent top-bar on cards. */
export const accentTopBar: Record<Accent, string> = {
  1: "bg-accent-1",
  2: "bg-accent-2",
  3: "bg-accent-3",
  4: "bg-accent-4",
};

/** Event block background in the week grid — opaque enough to read text on. */
export const accentBlock: Record<Accent, string> = {
  1: "border-accent-1/40 bg-accent-1/15 text-accent-1",
  2: "border-accent-2/40 bg-accent-2/15 text-accent-2",
  3: "border-accent-3/40 bg-accent-3/15 text-accent-3",
  4: "border-accent-4/40 bg-accent-4/15 text-accent-4",
};
