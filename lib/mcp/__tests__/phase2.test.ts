import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../../app/mcp/route";
import { issueAccessToken, registerMcpClient } from "@/lib/mcp/oauth";
import { db } from "@/db";
import { calendars, events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DateTime } from "luxon";

describe("Phase 2 — Read Tools (list_calendars, get_agenda, get_event)", () => {
  const originalEnv = { ...process.env };
  let testAccessToken = "";

  beforeEach(async () => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
    process.env.SCHEDULER_TIMEZONE = "America/New_York";

    const client = await registerMcpClient({
      clientName: "Phase 2 Client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    testAccessToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lists calendars including private and mirror sync details", async () => {
    const calId = `cal_test_${nanoid(6)}`;
    await db
      .insert(calendars)
      .values({
        id: calId,
        slug: `test-cal-${nanoid(4)}`,
        name: "Test Calendar",
        isPublic: false,
        sourceUrl: "https://example.com/feed.ics",
        lastSyncStatus: "ok",
        lastSyncCount: 5,
        lastSyncedAt: Date.now(),
      })
      .run();

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
          name: "list_calendars",
          arguments: {},
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const text = data.result.content[0].text;
    expect(text).toContain("Zone: America/New_York");
    expect(text).toContain("Test Calendar");
    expect(text).toContain("[private]");
    expect(text).toContain("mirror (status: ok");

    await db.delete(calendars).where(eq(calendars.id, calId)).run();
  });

  it("expands get_agenda with compact lines and short IDs, and retrieves event via get_event", async () => {
    const calId = `cal_test_${nanoid(6)}`;
    const evtId = `evt_test_${nanoid(6)}`;
    const zone = "America/New_York";

    await db
      .insert(calendars)
      .values({
        id: calId,
        slug: `work-${nanoid(4)}`,
        name: "Work",
        isPublic: true,
      })
      .run();

    // Create a 14:00 to 15:00 event in America/New_York today
    const now = DateTime.now().setZone(zone);
    const startDt = now.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    const endDt = now.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });

    await db
      .insert(events)
      .values({
        id: evtId,
        calendarId: calId,
        uid: `${evtId}@schedule.nigel-smith.dev`,
        summary: "Sprint Planning",
        description: "Review backlog",
        location: "Conference Room B",
        dtstart: startDt.toMillis(),
        dtend: endDt.toMillis(),
        allDay: false,
      })
      .run();

    // 1. Call get_agenda for 'today'
    const reqAgenda = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
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
          name: "get_agenda",
          arguments: {
            window: "today",
          },
        },
      }),
    });

    const resAgenda = await mcpPost(reqAgenda);
    expect(resAgenda.status).toBe(200);
    const dataAgenda = await resAgenda.json();
    const textAgenda = dataAgenda.result.content[0].text;

    expect(textAgenda).toContain("Sprint Planning");
    expect(textAgenda).toContain("[Work]");
    expect(textAgenda).toContain(`(#${evtId})`);
    expect(textAgenda).toContain("14:00–15:00");
    expect(textAgenda).toContain("@ Conference Room B");

    // 2. Call get_event with short ID
    const reqEvent = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
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
          name: "get_event",
          arguments: {
            id: `#${evtId}`,
          },
        },
      }),
    });

    const resEvent = await mcpPost(reqEvent);
    expect(resEvent.status).toBe(200);
    const dataEvent = await resEvent.json();
    const textEvent = dataEvent.result.content[0].text;

    expect(textEvent).toContain("Event: Sprint Planning");
    expect(textEvent).toContain(`ID: #${evtId}`);
    expect(textEvent).toContain("Work");
    expect(textEvent).toContain("Location: Conference Room B");
    expect(textEvent).toContain("Description:\nReview backlog");

    // Clean up
    await db.delete(events).where(eq(events.id, evtId)).run();
    await db.delete(calendars).where(eq(calendars.id, calId)).run();
  });
});
