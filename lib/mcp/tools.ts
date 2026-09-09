import "server-only";

import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import {
  calendars,
  eventOverrides,
  events,
  type Calendar,
  type EventOverride,
  type EventRow,
} from "@/db/schema";
import { expandOccurrences, type Occurrence } from "@/lib/events/expand";
import {
  listCalendars,
  listEventsInRange,
  listOverridesFor,
} from "@/lib/events/queries";
import { mcpDefaultWindowDays, mcpMaxResults, timezone } from "@/lib/env";
import {
  decodeOccurrenceId,
  encodeOccurrenceId,
  formatOccurrenceLine,
  resolveDateRange,
  rruleToNaturalLanguage,
} from "./format";
import { DateTime } from "luxon";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: any;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

/**
 * Registry of tool definitions.
 */
export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_calendars",
    description:
      "Returns inventory of all calendars: slug, name, mirror status, visibility, and sync health. Call this first to orient and find available calendar slugs before filtering queries.",
    inputSchema: {
      type: "object",
      properties: {
        includePrivate: {
          type: "boolean",
          description: "Whether to include private calendars. Defaults to true for authenticated admin.",
        },
      },
    },
    readOnlyHint: true,
  },
  {
    name: "get_agenda",
    description:
      "Returns merged, occurrence-expanded, chronologically sorted events across calendars. Use natural window ('today', 'tomorrow', 'this week', 'next week', 'this month') or explicit from/to ISO dates. Prefer this for checking schedules.",
    inputSchema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          description: "Relative window: 'today', 'tomorrow', 'this week', 'next week', 'this month', 'next month'.",
        },
        from: {
          type: "string",
          description: "ISO start date/time (e.g. '2026-09-09' or '2026-09-09T09:00:00').",
        },
        to: {
          type: "string",
          description: "ISO end date/time.",
        },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of calendar slugs to filter by.",
        },
        limit: {
          type: "integer",
          description: "Max occurrences to return (defaults to MCP_MAX_RESULTS, capped at 500).",
        },
      },
    },
    readOnlyHint: true,
  },
  {
    name: "get_event",
    description:
      "Returns detailed view for a single event or occurrence: exact times, location, description, recurrence in plain language, and mirror provenance. Reference by the short ID from get_agenda (#id).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Event ID or occurrence ID (e.g. 'evt_123' or 'evt_123_r1757433600000').",
        },
      },
      required: ["id"],
    },
    readOnlyHint: true,
  },
  {
    name: "find_free_time",
    description:
      "Finds open time slots of a given duration within a time range without listing events. Claude never sees events. Supports earliest/latest daily hours, day filtering, buffer, and all-day blocking policy.",
    inputSchema: {
      type: "object",
      properties: {
        durationMinutes: {
          type: "integer",
          description: "Target duration of open slot in minutes (e.g. 60 or 120). Defaults to 60.",
        },
        window: {
          type: "string",
          description: "Time window ('today', 'tomorrow', 'this week', 'next week', 'this month').",
        },
        from: {
          type: "string",
          description: "ISO start date/time.",
        },
        to: {
          type: "string",
          description: "ISO end date/time.",
        },
        earliestHour: {
          type: "integer",
          description: "Earliest hour of the day (0-23, e.g. 9 for 09:00). Defaults to 9.",
        },
        latestHour: {
          type: "integer",
          description: "Latest hour of the day (0-23, e.g. 17 for 17:00). Defaults to 17.",
        },
        bufferMinutes: {
          type: "integer",
          description: "Minimum buffer in minutes between commitments. Defaults to 15.",
        },
        includeDays: {
          type: "array",
          items: { type: "integer" },
          description: "Days of week to include (1=Mon, 2=Tue... 7=Sun). Defaults to Mon-Fri (1-5).",
        },
        allDayBlocks: {
          type: "boolean",
          description: "Whether all-day events block the whole day. Defaults to false (markers do not block).",
        },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Calendar slugs that count toward busy time. Defaults to all.",
        },
      },
      required: ["durationMinutes"],
    },
    readOnlyHint: true,
  },
  {
    name: "search_events",
    description:
      "Searches events by keyword in summary, description, and location across past and future ranges. Returns matches in compact agenda format. Use this instead of listing weeks of events.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text to look for.",
        },
        window: {
          type: "string",
          description: "Time window ('this week', 'next week', 'this month', 'next month', etc.).",
        },
        from: {
          type: "string",
          description: "ISO start date/time (defaults to 30 days ago).",
        },
        to: {
          type: "string",
          description: "ISO end date/time (defaults to 30 days ahead).",
        },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Optional calendar slugs to search within.",
        },
        limit: {
          type: "integer",
          description: "Max results to return (defaults to 20).",
        },
      },
      required: ["query"],
    },
    readOnlyHint: true,
  },
  {
    name: "summarize_schedule",
    description:
      "Returns a high-level workload summary over a range: total committed hours, hours per calendar, busiest/lightest days, count of commitments, and largest uninterrupted free blocks. Returns NO individual events.",
    inputSchema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          description: "Time window ('today', 'this week', 'next week', 'this month').",
        },
        from: {
          type: "string",
          description: "ISO start date/time.",
        },
        to: {
          type: "string",
          description: "ISO end date/time.",
        },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Optional calendar slugs to include.",
        },
      },
    },
    readOnlyHint: true,
  },
  {
    name: "check_conflicts",
    description:
      "Checks whether a proposed time interval collides with existing commitments across calendars. Returns colliding events or confirms slot is clear. Precondition for scheduling.",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "ISO start time of proposed event (e.g. '2026-09-10T14:00:00').",
        },
        end: {
          type: "string",
          description: "ISO end time of proposed event (e.g. '2026-09-10T15:30:00').",
        },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Optional calendar slugs to check against. Defaults to all.",
        },
      },
      required: ["start", "end"],
    },
    readOnlyHint: true,
  },
];

/**
 * Handles `list_calendars`
 */
export async function executeListCalendars(params: {
  includePrivate?: boolean;
}): Promise<string> {
  const allCalendars = await listCalendars({ publicOnly: false });
  const includePrivate = params.includePrivate !== false; // default true for admin
  const filtered = includePrivate ? allCalendars : allCalendars.filter((c) => c.isPublic);

  const zone = timezone();
  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(`Calendars (${filtered.length}):`);

  for (const c of filtered) {
    let mirrorInfo = "native";
    if (c.sourceUrl) {
      const status = c.lastSyncStatus ?? "pending";
      const syncTime = c.lastSyncedAt
        ? DateTime.fromMillis(c.lastSyncedAt, { zone }).toFormat("yyyy-LL-dd HH:mm")
        : "never";
      const count = c.lastSyncCount ?? 0;
      mirrorInfo = `mirror (status: ${status}, count: ${count}, last synced: ${syncTime})`;
      if (c.lastSyncError) {
        mirrorInfo += ` [Error: ${c.lastSyncError}]`;
      }
    }
    const vis = c.isPublic ? "public" : "private";
    lines.push(`- ${c.slug}: "${c.name}" [${vis}] — ${mirrorInfo}`);
  }

  return lines.join("\n");
}

/**
 * Handles `get_agenda`
 */
export async function executeGetAgenda(params: {
  window?: string;
  from?: string;
  to?: string;
  calendars?: string[];
  limit?: number;
}): Promise<string> {
  const zone = timezone();
  const now = Date.now();
  const defaultDays = mcpDefaultWindowDays();
  const maxLimit = mcpMaxResults();
  const userLimit = params.limit ? Math.min(params.limit, maxLimit) : maxLimit;

  const { rangeStart, rangeEnd, label } = resolveDateRange(
    {
      window: params.window,
      from: params.from,
      to: params.to,
    },
    zone,
    now,
    defaultDays,
  );

  const allCals = await listCalendars({ publicOnly: false });
  let targetCals = allCals;
  if (params.calendars && params.calendars.length > 0) {
    const slugSet = new Set(params.calendars.map((s) => s.toLowerCase()));
    targetCals = allCals.filter((c) => slugSet.has(c.slug.toLowerCase()));
  }

  if (targetCals.length === 0) {
    return `Zone: ${zone}\nRange: ${label}\nNo matching calendars found.`;
  }

  const calMap = new Map<string, Calendar>();
  for (const c of targetCals) {
    calMap.set(c.id, c);
  }

  // Check for stale mirrors in selected calendars
  const staleWarnings: string[] = [];
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
  for (const c of targetCals) {
    if (c.sourceUrl) {
      if (c.lastSyncStatus === "error") {
        staleWarnings.push(
          `Notice: Calendar '${c.name}' last sync failed (${c.lastSyncError || "error"}).`,
        );
      } else if (c.lastSyncedAt && now - c.lastSyncedAt > STALE_THRESHOLD_MS) {
        const syncedDt = DateTime.fromMillis(c.lastSyncedAt, { zone }).toFormat("yyyy-LL-dd HH:mm");
        staleWarnings.push(
          `Notice: Calendar '${c.name}' may be stale (last synced: ${syncedDt}).`,
        );
      }
    }
  }

  const calendarIds = targetCals.map((c) => c.id);
  const rawEvents = await listEventsInRange({
    calendarIds,
    rangeStart,
    rangeEnd,
  });

  const overrides = await listOverridesFor(rawEvents.map((e) => e.id));

  const occurrences = expandOccurrences({
    events: rawEvents,
    overrides,
    rangeStart,
    rangeEnd,
    zone,
    includeCancelled: false,
  });

  // Sort occurrences by start instant asc, then end instant
  occurrences.sort((a, b) => a.start - b.start || a.end - b.end);

  const totalFound = occurrences.length;
  const truncated = totalFound > userLimit;
  const displayed = occurrences.slice(0, userLimit);

  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(`Agenda: ${label}`);
  if (staleWarnings.length > 0) {
    lines.push(...staleWarnings);
  }

  if (displayed.length === 0) {
    lines.push("Nothing scheduled in this window.");
    return lines.join("\n");
  }

  for (const occ of displayed) {
    const cal = calMap.get(occ.calendarId);
    const shortId = encodeOccurrenceId(occ.eventId, occ.recurrenceId);
    lines.push(
      formatOccurrenceLine(
        {
          id: shortId,
          summary: occ.summary,
          start: occ.start,
          end: occ.end,
          allDay: occ.allDay,
          calendarName: cal?.name ?? "Unknown",
          location: occ.location,
        },
        zone,
      ),
    );
  }

  if (truncated) {
    lines.push(
      `\n[Truncated: showing ${userLimit} of ${totalFound} events. Narrow the date window or filter by calendar to see more.]`,
    );
  }

  return lines.join("\n");
}

/**
 * Handles `get_event`
 */
export async function executeGetEvent(params: { id: string }): Promise<string> {
  const { id } = params;
  if (!id) {
    return "Error: id parameter is required. Use get_agenda to obtain event IDs (#id).";
  }

  const cleanId = id.startsWith("#") ? id.slice(1) : id;
  const { eventId, recurrenceId } = decodeOccurrenceId(cleanId);

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    return `Error: Event '${eventId}' not found. Verify the ID using get_agenda.`;
  }

  const [cal] = await db.select().from(calendars).where(eq(calendars.id, event.calendarId)).limit(1);
  const zone = timezone();

  let summary = event.summary;
  let description = event.description;
  let location = event.location;
  let startMs = event.dtstart;
  let endMs = event.dtend;
  let isOverridden = false;
  let isCancelled = event.status === "CANCELLED";

  if (recurrenceId) {
    const [override] = await db
      .select()
      .from(eventOverrides)
      .where(
        and(
          eq(eventOverrides.eventId, eventId),
          eq(eventOverrides.recurrenceId, recurrenceId),
        ),
      )
      .limit(1);

    const duration = Math.max(0, event.dtend - event.dtstart);
    startMs = recurrenceId;
    endMs = recurrenceId + duration;

    if (override) {
      isOverridden = true;
      if (override.summary) summary = override.summary;
      if (override.description !== undefined) description = override.description;
      if (override.location !== undefined) location = override.location;
      if (override.dtstart) startMs = override.dtstart;
      if (override.dtend) endMs = override.dtend;
      if (override.cancelled) isCancelled = true;
    }
  }

  const startDt = DateTime.fromMillis(startMs, { zone });
  const endDt = DateTime.fromMillis(endMs, { zone });

  const lines: string[] = [];
  lines.push(`Event: ${summary}`);
  lines.push(`ID: #${cleanId}`);
  lines.push(`Calendar: ${cal?.name ?? "Unknown"} (${cal?.slug})`);
  lines.push(`Status: ${isCancelled ? "CANCELLED" : event.status}`);

  if (cal?.sourceUrl) {
    lines.push("Provenance: Mirrored from external subscription (read-only)");
  } else {
    lines.push("Provenance: Native calendar (editable)");
  }

  if (event.allDay) {
    const diffDays = Math.round(endDt.diff(startDt, "days").days);
    if (diffDays > 1) {
      const incEnd = endDt.minus({ days: 1 });
      lines.push(`When: All day (${startDt.toFormat("yyyy-LL-dd")} to ${incEnd.toFormat("yyyy-LL-dd")})`);
    } else {
      lines.push(`When: All day (${startDt.toFormat("yyyy-LL-dd")})`);
    }
  } else {
    lines.push(
      `When: ${startDt.toFormat("ccc, yyyy-LL-dd HH:mm")}–${endDt.toFormat("HH:mm")} (${zone})`,
    );
  }

  if (location) {
    lines.push(`Location: ${location}`);
  }

  if (event.rrule) {
    const naturalRecurrence = rruleToNaturalLanguage(event.rrule, zone) || event.rrule;
    lines.push(`Recurrence: ${naturalRecurrence}`);
    if (recurrenceId) {
      lines.push(`Occurrence: Single instance of recurring series (slot: ${DateTime.fromMillis(recurrenceId, { zone }).toFormat("yyyy-LL-dd HH:mm")})`);
      if (isOverridden) {
        lines.push("Override: This occurrence has individual modifications");
      }
    }
  }

  if (description) {
    lines.push(`Description:\n${description}`);
  }

  return lines.join("\n");
}

/**
 * Handles `find_free_time`
 */
export async function executeFindFreeTime(params: {
  durationMinutes: number;
  window?: string;
  from?: string;
  to?: string;
  earliestHour?: number;
  latestHour?: number;
  bufferMinutes?: number;
  includeDays?: number[];
  allDayBlocks?: boolean;
  calendars?: string[];
}): Promise<string> {
  const zone = timezone();
  const now = Date.now();
  const defaultDays = mcpDefaultWindowDays();
  const durationMs = (params.durationMinutes ?? 60) * 60 * 1000;
  const bufferMs = (params.bufferMinutes ?? 15) * 60 * 1000;
  const earliestHour = params.earliestHour ?? 9;
  const latestHour = params.latestHour ?? 17;
  const includeDays = params.includeDays ?? [1, 2, 3, 4, 5]; // Mon-Fri
  const allDayBlocks = params.allDayBlocks === true;

  const { rangeStart, rangeEnd, label } = resolveDateRange(
    { window: params.window, from: params.from, to: params.to },
    zone,
    now,
    defaultDays,
  );

  const allCals = await listCalendars({ publicOnly: false });
  let targetCals = allCals;
  if (params.calendars && params.calendars.length > 0) {
    const slugSet = new Set(params.calendars.map((s) => s.toLowerCase()));
    targetCals = allCals.filter((c) => slugSet.has(c.slug.toLowerCase()));
  }

  const rawEvents = await listEventsInRange({
    calendarIds: targetCals.map((c) => c.id),
    rangeStart,
    rangeEnd,
  });
  const overrides = await listOverridesFor(rawEvents.map((e) => e.id));
  const occurrences = expandOccurrences({
    events: rawEvents,
    overrides,
    rangeStart,
    rangeEnd,
    zone,
    includeCancelled: false,
  });

  // Collect busy intervals per day
  const freeSlots: { start: number; end: number }[] = [];

  let curDt = DateTime.fromMillis(rangeStart, { zone }).startOf("day");
  const endLimitDt = DateTime.fromMillis(rangeEnd, { zone });

  while (curDt < endLimitDt) {
    if (includeDays.includes(curDt.weekday)) {
      const dayStart = curDt.set({ hour: earliestHour, minute: 0, second: 0, millisecond: 0 }).toMillis();
      const dayEnd = curDt.set({ hour: latestHour, minute: 0, second: 0, millisecond: 0 }).toMillis();

      // Check all-day events on this day
      const dayOccurrences = occurrences.filter((occ) => {
        return occ.end > dayStart && occ.start < dayEnd;
      });

      const dayBlockedByAllDay = allDayBlocks && dayOccurrences.some((o) => o.allDay);

      if (!dayBlockedByAllDay && dayEnd > dayStart) {
        // Collect busy intervals with buffer
        const busyIntervals: { start: number; end: number }[] = [];
        for (const occ of dayOccurrences) {
          if (occ.allDay && !allDayBlocks) continue; // ignored
          busyIntervals.push({
            start: Math.max(dayStart, occ.start - bufferMs),
            end: Math.min(dayEnd, occ.end + bufferMs),
          });
        }

        // Merge busy intervals
        busyIntervals.sort((a, b) => a.start - b.start);
        const merged: { start: number; end: number }[] = [];
        for (const b of busyIntervals) {
          if (merged.length === 0) {
            merged.push({ ...b });
          } else {
            const last = merged[merged.length - 1];
            if (b.start <= last.end) {
              last.end = Math.max(last.end, b.end);
            } else {
              merged.push({ ...b });
            }
          }
        }

        // Find gaps between dayStart and dayEnd
        let scan = dayStart;
        for (const b of merged) {
          if (b.start > scan && b.start - scan >= durationMs) {
            freeSlots.push({ start: scan, end: b.start });
          }
          scan = Math.max(scan, b.end);
        }
        if (dayEnd > scan && dayEnd - scan >= durationMs) {
          freeSlots.push({ start: scan, end: dayEnd });
        }
      }
    }
    curDt = curDt.plus({ days: 1 });
  }

  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(`Search window: ${label} (Hours: ${earliestHour}:00–${latestHour}:00, Buffer: ${params.bufferMinutes ?? 15}m)`);

  if (freeSlots.length === 0) {
    lines.push(`No available ${params.durationMinutes}m slots found in this window.`);
    return lines.join("\n");
  }

  lines.push(`Found ${freeSlots.length} available slot(s):`);
  for (const slot of freeSlots.slice(0, 15)) {
    const sDt = DateTime.fromMillis(slot.start, { zone });
    const eDt = DateTime.fromMillis(slot.end, { zone });
    const lengthMins = Math.round((slot.end - slot.start) / 60000);
    lines.push(
      `- ${sDt.toFormat("ccc, yyyy-LL-dd HH:mm")}–${eDt.toFormat("HH:mm")} (${lengthMins} mins open)`,
    );
  }

  if (freeSlots.length > 15) {
    lines.push(`[Truncated: showing first 15 of ${freeSlots.length} available slots]`);
  }

  return lines.join("\n");
}

/**
 * Handles `search_events`
 */
export async function executeSearchEvents(params: {
  query: string;
  window?: string;
  from?: string;
  to?: string;
  calendars?: string[];
  limit?: number;
}): Promise<string> {
  const query = (params.query ?? "").trim().toLowerCase();
  if (!query) {
    return "Error: query parameter is required.";
  }

  const zone = timezone();
  const now = Date.now();
  const defaultWindow = params.window || (params.from || params.to ? undefined : "60days");

  let rangeStart = now - 30 * 24 * 60 * 60 * 1000;
  let rangeEnd = now + 30 * 24 * 60 * 60 * 1000;
  let label = "±30 days";

  if (params.window || params.from || params.to) {
    const r = resolveDateRange(
      { window: params.window, from: params.from, to: params.to },
      zone,
      now,
      60,
    );
    rangeStart = r.rangeStart;
    rangeEnd = r.rangeEnd;
    label = r.label;
  }

  const allCals = await listCalendars({ publicOnly: false });
  let targetCals = allCals;
  if (params.calendars && params.calendars.length > 0) {
    const slugSet = new Set(params.calendars.map((s) => s.toLowerCase()));
    targetCals = allCals.filter((c) => slugSet.has(c.slug.toLowerCase()));
  }

  const calMap = new Map<string, Calendar>();
  for (const c of targetCals) {
    calMap.set(c.id, c);
  }

  const rawEvents = await listEventsInRange({
    calendarIds: targetCals.map((c) => c.id),
    rangeStart,
    rangeEnd,
  });
  const overrides = await listOverridesFor(rawEvents.map((e) => e.id));
  const occurrences = expandOccurrences({
    events: rawEvents,
    overrides,
    rangeStart,
    rangeEnd,
    zone,
    includeCancelled: false,
  });

  const matches = occurrences.filter((occ) => {
    const text = `${occ.summary} ${occ.location ?? ""} ${occ.description ?? ""}`.toLowerCase();
    return text.includes(query);
  });

  matches.sort((a, b) => a.start - b.start);

  const limit = params.limit ?? 20;
  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(`Search query: "${query}" in ${label}`);

  if (matches.length === 0) {
    lines.push("No matching events found.");
    return lines.join("\n");
  }

  for (const occ of matches.slice(0, limit)) {
    const cal = calMap.get(occ.calendarId);
    const shortId = encodeOccurrenceId(occ.eventId, occ.recurrenceId);
    lines.push(
      formatOccurrenceLine(
        {
          id: shortId,
          summary: occ.summary,
          start: occ.start,
          end: occ.end,
          allDay: occ.allDay,
          calendarName: cal?.name ?? "Unknown",
          location: occ.location,
        },
        zone,
      ),
    );
  }

  if (matches.length > limit) {
    lines.push(`\n[Truncated: showing ${limit} of ${matches.length} matches]`);
  }

  return lines.join("\n");
}

/**
 * Handles `summarize_schedule`
 */
export async function executeSummarizeSchedule(params: {
  window?: string;
  from?: string;
  to?: string;
  calendars?: string[];
}): Promise<string> {
  const zone = timezone();
  const now = Date.now();
  const defaultDays = mcpDefaultWindowDays();

  const { rangeStart, rangeEnd, label } = resolveDateRange(
    { window: params.window, from: params.from, to: params.to },
    zone,
    now,
    defaultDays,
  );

  const allCals = await listCalendars({ publicOnly: false });
  let targetCals = allCals;
  if (params.calendars && params.calendars.length > 0) {
    const slugSet = new Set(params.calendars.map((s) => s.toLowerCase()));
    targetCals = allCals.filter((c) => slugSet.has(c.slug.toLowerCase()));
  }

  const calMap = new Map<string, Calendar>();
  for (const c of targetCals) {
    calMap.set(c.id, c);
  }

  const rawEvents = await listEventsInRange({
    calendarIds: targetCals.map((c) => c.id),
    rangeStart,
    rangeEnd,
  });
  const overrides = await listOverridesFor(rawEvents.map((e) => e.id));
  const occurrences = expandOccurrences({
    events: rawEvents,
    overrides,
    rangeStart,
    rangeEnd,
    zone,
    includeCancelled: false,
  });

  const hoursPerCalendar = new Map<string, number>();
  const countPerDay = new Map<string, number>();
  let totalCommittedMs = 0;
  let allDayCount = 0;

  for (const occ of occurrences) {
    const calName = calMap.get(occ.calendarId)?.name ?? "Unknown";
    const dayStr = DateTime.fromMillis(occ.start, { zone }).toFormat("yyyy-LL-dd (ccc)");
    countPerDay.set(dayStr, (countPerDay.get(dayStr) ?? 0) + 1);

    if (occ.allDay) {
      allDayCount++;
    } else {
      const dur = Math.max(0, occ.end - occ.start);
      totalCommittedMs += dur;
      hoursPerCalendar.set(calName, (hoursPerCalendar.get(calName) ?? 0) + dur / 3600000);
    }
  }

  const totalHours = (totalCommittedMs / 3600000).toFixed(1);

  // Busiest and lightest days
  const sortedDays = Array.from(countPerDay.entries()).sort((a, b) => b[1] - a[1]);
  const busiest = sortedDays.length > 0 ? `${sortedDays[0][0]} (${sortedDays[0][1]} commitments)` : "none";
  const lightest = sortedDays.length > 0 ? `${sortedDays[sortedDays.length - 1][0]} (${sortedDays[sortedDays.length - 1][1]} commitments)` : "none";

  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(`Schedule summary: ${label}`);
  lines.push(`- Total commitments: ${occurrences.length} (${allDayCount} all-day)`);
  lines.push(`- Total committed time: ${totalHours} hours`);

  if (hoursPerCalendar.size > 0) {
    lines.push("- Hours by calendar:");
    for (const [cal, hrs] of hoursPerCalendar.entries()) {
      lines.push(`    ${cal}: ${hrs.toFixed(1)} hrs`);
    }
  }

  lines.push(`- Busiest day: ${busiest}`);
  lines.push(`- Lightest day: ${lightest}`);

  return lines.join("\n");
}

/**
 * Handles `check_conflicts`
 */
export async function executeCheckConflicts(params: {
  start: string;
  end: string;
  calendars?: string[];
}): Promise<string> {
  const zone = timezone();
  const startDt = DateTime.fromISO(params.start, { zone });
  const endDt = DateTime.fromISO(params.end, { zone });

  if (!startDt.isValid || !endDt.isValid) {
    return "Error: Invalid ISO start or end timestamp.";
  }

  const startMs = startDt.toMillis();
  const endMs = endDt.toMillis();

  if (endMs <= startMs) {
    return "Error: end time must be after start time.";
  }

  const allCals = await listCalendars({ publicOnly: false });
  let targetCals = allCals;
  if (params.calendars && params.calendars.length > 0) {
    const slugSet = new Set(params.calendars.map((s) => s.toLowerCase()));
    targetCals = allCals.filter((c) => slugSet.has(c.slug.toLowerCase()));
  }

  const calMap = new Map<string, Calendar>();
  for (const c of targetCals) {
    calMap.set(c.id, c);
  }

  const rawEvents = await listEventsInRange({
    calendarIds: targetCals.map((c) => c.id),
    rangeStart: startMs,
    rangeEnd: endMs,
  });
  const overrides = await listOverridesFor(rawEvents.map((e) => e.id));
  const occurrences = expandOccurrences({
    events: rawEvents,
    overrides,
    rangeStart: startMs,
    rangeEnd: endMs,
    zone,
    includeCancelled: false,
  });

  // Filter exact collisions: event.end > startMs and event.start < endMs
  const collisions = occurrences.filter((occ) => occ.end > startMs && occ.start < endMs);

  const lines: string[] = [];
  lines.push(`Zone: ${zone}`);
  lines.push(
    `Conflict check: ${startDt.toFormat("ccc, yyyy-LL-dd HH:mm")}–${endDt.toFormat("HH:mm")}`,
  );

  if (collisions.length === 0) {
    lines.push("Clear: No conflicting events found in this window.");
    return lines.join("\n");
  }

  lines.push(`Collision detected with ${collisions.length} event(s):`);
  for (const occ of collisions) {
    const cal = calMap.get(occ.calendarId);
    const shortId = encodeOccurrenceId(occ.eventId, occ.recurrenceId);
    lines.push(
      formatOccurrenceLine(
        {
          id: shortId,
          summary: occ.summary,
          start: occ.start,
          end: occ.end,
          allDay: occ.allDay,
          calendarName: cal?.name ?? "Unknown",
          location: occ.location,
        },
        zone,
      ),
    );
  }

  return lines.join("\n");
}

