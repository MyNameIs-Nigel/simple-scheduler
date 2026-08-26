import { z } from "zod";

/** Zod v4. Shared by the admin forms and the .ics importer. */

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only")
  // `all` is the combined feed; a calendar with that slug would be unreachable.
  .refine((s) => s !== "all", { message: "`all` is reserved for the combined feed" });

export const calendarSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: slugSchema,
  description: z.string().trim().max(500).optional().or(z.literal("")),
  accent: z.coerce.number().int().min(1).max(4),
  isPublic: z.coerce.boolean(),
});

export type CalendarInput = z.infer<typeof calendarSchema>;

export const recurrenceSchema = z.object({
  freq: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
  interval: z.coerce.number().int().min(1).max(365).default(1),
  byWeekday: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  endMode: z.enum(["never", "count", "until"]).default("never"),
  count: z.coerce.number().int().min(1).max(1000).optional(),
  until: z.string().optional(),
});

export const eventSchema = z
  .object({
    calendarId: z.string().min(1, "Pick a calendar"),
    summary: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    location: z.string().trim().max(200).optional().or(z.literal("")),
    url: z.union([z.url("Must be a valid URL"), z.literal("")]).optional(),
    allDay: z.coerce.boolean().default(false),
    start: z.string().min(1, "Start is required"),
    end: z.string().min(1, "End is required"),
    status: z.enum(["CONFIRMED", "TENTATIVE", "CANCELLED"]).default("CONFIRMED"),
    recurrence: recurrenceSchema,
  })
  .refine((v) => !(v.recurrence.freq === "weekly" && v.recurrence.byWeekday.length === 0), {
    message: "Pick at least one weekday for a weekly repeat",
    path: ["recurrence", "byWeekday"],
  });

export type EventInput = z.infer<typeof eventSchema>;

/** Shape returned by every action, consumed by useActionState. */
export type ActionState = {
  ok: boolean;
  message?: string;
  /** Dotted field path -> first error message. */
  errors?: Record<string, string>;
};

export function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
