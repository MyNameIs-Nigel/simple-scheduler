/** Accent identity, shared with nigel-smith.dev. Tailwind cannot interpolate
 *  class names, so every accent-driven style goes through the lookup maps in
 *  `lib/accents.ts` rather than a template string. */
export type Accent = 1 | 2 | 3 | 4;

export const ACCENTS: readonly Accent[] = [1, 2, 3, 4];

/** Calendars are assigned an accent on creation; cycling keeps adjacent
 *  calendars visually distinct without asking the admin to pick a colour. */
export function accentForIndex(index: number): Accent {
  return ACCENTS[index % ACCENTS.length];
}
