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
