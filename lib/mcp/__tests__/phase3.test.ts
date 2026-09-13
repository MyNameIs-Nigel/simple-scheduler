import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../../app/mcp/route";
import { issueAccessToken, registerMcpClient } from "@/lib/mcp/oauth";
import { db } from "@/db";
import { calendars, events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DateTime } from "luxon";

describe("Phase 3 — Answer-shaped Tools (find_free_time, search_events, summarize_schedule, check_conflicts)", () => {
  const originalEnv = { ...process.env };
  let testAccessToken = "";
  const zone = "America/New_York";
  const calId = `cal_test_${nanoid(6)}`;
  const evtId1 = `evt_test_${nanoid(6)}`;
  const evtId2 = `evt_test_${nanoid(6)}`;

  beforeEach(async () => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
    process.env.SCHEDULER_TIMEZONE = zone;

    const client = await registerMcpClient({
      clientName: "Phase 3 Client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    testAccessToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read",
    });

    await db
      .insert(calendars)
      .values({
        id: calId,
        slug: `testcal-${nanoid(4)}`,
        name: "Test Calendar",
        isPublic: true,
      })
      .run();

    const now = DateTime.now().setZone(zone);
    const eventStart = now.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const eventEnd = now.set({ hour: 11, minute: 30, second: 0, millisecond: 0 });

    await db
      .insert(events)
      .values({
        id: evtId1,
        calendarId: calId,
        uid: `${evtId1}@schedule.nigel-smith.dev`,
        summary: "Dentist Appointment",
        description: "Routine cleaning",
        location: "Downtown Clinic",
        dtstart: eventStart.toMillis(),
        dtend: eventEnd.toMillis(),
        allDay: false,
      })
      .run();

    const event2Start = now.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    const event2End = now.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });

    await db
      .insert(events)
      .values({
        id: evtId2,
        calendarId: calId,
        uid: `${evtId2}@schedule.nigel-smith.dev`,
        summary: "Study Block CCNA",
        description: "Chapter 4 subnetting",
        location: "Library",
        dtstart: event2Start.toMillis(),
        dtend: event2End.toMillis(),
        allDay: false,
      })
      .run();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await db.delete(events).where(eq(events.calendarId, calId)).run();
    await db.delete(calendars).where(eq(calendars.id, calId)).run();
  });

  it("find_free_time returns available slots without listing events", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: {
          name: "find_free_time",
          arguments: {
            durationMinutes: 60,
            window: "today",
            earliestHour: 9,
            latestHour: 17,
            bufferMinutes: 15,
            // The tool only searches Mon–Fri by default, so without this the
            // test finds nothing when CI runs on a weekend.
            includeDays: [1, 2, 3, 4, 5, 6, 7],
          },
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const text = data.result.content[0].text;

    expect(text).toContain("Zone: America/New_York");
    expect(text).toContain("Found");
    expect(text).toContain("mins open");
    // Verify no individual event objects or event titles are exposed
    expect(text).not.toContain("Dentist Appointment");
    expect(text).not.toContain("Study Block CCNA");
  });

  it("search_events finds events across range with keyword query", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tools/call",
        params: {
          name: "search_events",
          arguments: {
            query: "dentist",
          },
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const text = data.result.content[0].text;

    expect(text).toContain("Dentist Appointment");
    expect(text).toContain("@ Downtown Clinic");
    expect(text).not.toContain("Study Block CCNA");
  });

  it("summarize_schedule returns workload statistics without events", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "3",
        method: "tools/call",
        params: {
          name: "summarize_schedule",
          arguments: {
            window: "today",
          },
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const text = data.result.content[0].text;

    expect(text).toContain("Total commitments: 2");
    expect(text).toContain("Total committed time: 2.5 hours");
    expect(text).toContain("Test Calendar: 2.5 hrs");
    expect(text).not.toContain("Dentist Appointment");
  });

  it("check_conflicts detects collisions or confirms clear", async () => {
    const now = DateTime.now().setZone(zone);
    const collisionStart = now.set({ hour: 10, minute: 30, second: 0 }).toISO()!;
    const collisionEnd = now.set({ hour: 11, minute: 0, second: 0 }).toISO()!;

    // 1. Collision check
    const req1 = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "4",
        method: "tools/call",
        params: {
          name: "check_conflicts",
          arguments: {
            start: collisionStart,
            end: collisionEnd,
          },
        },
      }),
    });

    const res1 = await mcpPost(req1);
    const data1 = await res1.json();
    const text1 = data1.result.content[0].text;
    expect(text1).toContain("Collision detected with 1 event(s):");
    expect(text1).toContain("Dentist Appointment");

    // 2. Clear check
    const clearStart = now.set({ hour: 12, minute: 0, second: 0 }).toISO()!;
    const clearEnd = now.set({ hour: 13, minute: 0, second: 0 }).toISO()!;

    const req2 = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "5",
        method: "tools/call",
        params: {
          name: "check_conflicts",
          arguments: {
            start: clearStart,
            end: clearEnd,
          },
        },
      }),
    });

    const res2 = await mcpPost(req2);
    const data2 = await res2.json();
    const text2 = data2.result.content[0].text;
    expect(text2).toContain("Clear: No conflicting events found in this window.");
  });
});
