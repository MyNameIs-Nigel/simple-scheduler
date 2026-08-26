import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * All instants are stored as **integer Unix epoch milliseconds, UTC**.
 * Conversion into SCHEDULER_TIMEZONE happens only at the rendering edges
 * (the calendar UI and the .ics writer), never in the database.
 */

const now = sql`(unixepoch() * 1000)`;

export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey(),
    /** URL segment for the public feed: /calendars/<slug>.ics */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** 1-4, keyed to the shared accent palette in lib/accents.ts */
    accent: integer("accent").notNull().default(1),
    /** Excluded from the public UI and from all.ics when false. */
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("calendars_slug_idx").on(t.slug)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /**
     * Stable iCalendar UID. Never regenerated on edit — subscribers key off
     * this to update an existing entry instead of creating a duplicate.
     */
    uid: text("uid").notNull(),
    summary: text("summary").notNull(),
    description: text("description"),
    location: text("location"),
    url: text("url"),
    /** UTC epoch ms. For all-day events this is midnight in SCHEDULER_TIMEZONE. */
    dtstart: integer("dtstart").notNull(),
    /** Exclusive end, per RFC 5545. */
    dtend: integer("dtend").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    /** RFC 5545 RRULE string without the "RRULE:" prefix. Null = single event. */
    rrule: text("rrule"),
    /** JSON array of UTC epoch ms — occurrences deleted from the series. */
    exdates: text("exdates", { mode: "json" }).$type<number[]>(),
    status: text("status", { enum: ["CONFIRMED", "TENTATIVE", "CANCELLED"] })
      .notNull()
      .default("CONFIRMED"),
    /**
     * RFC 5545 requires this to increment on every substantive edit, otherwise
     * subscribed clients ignore the update.
     */
    sequence: integer("sequence").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("events_uid_idx").on(t.uid),
    index("events_calendar_idx").on(t.calendarId),
    // The public calendar queries a date window; this covers the common range scan.
    index("events_dtstart_idx").on(t.dtstart),
  ],
);

export const eventOverrides = sqliteTable(
  "event_overrides",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /**
     * RECURRENCE-ID: the start instant the occurrence *would* have had under
     * the RRULE. This is the join key, so it must be the original value even
     * when the override moves the occurrence.
     */
    recurrenceId: integer("recurrence_id").notNull(),
    /** Null on any field means "inherit from the parent series". */
    summary: text("summary"),
    description: text("description"),
    location: text("location"),
    dtstart: integer("dtstart"),
    dtend: integer("dtend"),
    /** A cancelled occurrence emits STATUS:CANCELLED rather than disappearing. */
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("event_overrides_event_recurrence_idx").on(t.eventId, t.recurrenceId),
    index("event_overrides_event_idx").on(t.eventId),
  ],
);

export type Calendar = typeof calendars.$inferSelect;
export type NewCalendar = typeof calendars.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type EventOverride = typeof eventOverrides.$inferSelect;
export type NewEventOverride = typeof eventOverrides.$inferInsert;
