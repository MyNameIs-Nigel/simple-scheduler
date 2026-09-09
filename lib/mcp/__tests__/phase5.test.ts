import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../../app/mcp/route";
import { issueAccessToken, registerMcpClient } from "@/lib/mcp/oauth";
import { db } from "@/db";
import { calendars, events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DateTime } from "luxon";

describe("Phase 5 — Write Tools (create_event, update_event, delete_event)", () => {
  const originalEnv = { ...process.env };
  let readOnlyToken = "";
  let writeToken = "";
  const zone = "America/New_York";
  const nativeCalId = `cal_native_${nanoid(6)}`;
  const mirrorCalId = `cal_mirror_${nanoid(6)}`;

  beforeEach(async () => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
    process.env.SCHEDULER_TIMEZONE = zone;

    const client = await registerMcpClient({
      clientName: "Phase 5 Client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });

    readOnlyToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read",
    });

    writeToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read schedule:write",
    });

    await db
      .insert(calendars)
      .values({
        id: nativeCalId,
        slug: `native-${nanoid(4)}`,
        name: "Personal",
        isPublic: true,
      })
      .run();

    await db
      .insert(calendars)
      .values({
        id: mirrorCalId,
        slug: `mirror-${nanoid(4)}`,
        name: "Work Shifts Mirror",
        sourceUrl: "https://external.work/shifts.ics",
        isPublic: false,
      })
      .run();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await db.delete(events).where(eq(events.calendarId, nativeCalId)).run();
    await db.delete(events).where(eq(events.calendarId, mirrorCalId)).run();
    await db.delete(calendars).where(eq(calendars.id, nativeCalId)).run();
    await db.delete(calendars).where(eq(calendars.id, mirrorCalId)).run();
  });

  it("gating: write tools fail when called with read-only token", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readOnlyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: {
          name: "create_event",
          arguments: {
            calendar: "personal",
            summary: "Gym Session",
            start: "2026-09-10T08:00:00",
            end: "2026-09-10T09:00:00",
          },
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("schedule:write scope required");
  });

  it("mirrored calendars: create/update/delete refuses mirrored calendars with explanatory error", async () => {
    // 1. Create on mirror calendar
    const [mirrorCal] = await db.select().from(calendars).where(eq(calendars.id, mirrorCalId)).limit(1);

    const reqCreate = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tools/call",
        params: {
          name: "create_event",
          arguments: {
            calendar: mirrorCal.slug,
            summary: "Shift Override",
            start: "2026-09-10T08:00:00",
            end: "2026-09-10T16:00:00",
          },
        },
      }),
    });

    const resCreate = await mcpPost(reqCreate);
    const dataCreate = await resCreate.json();
    expect(dataCreate.result.content[0].text).toContain("mirrors an external subscription URL and is read-only");
  });

  it("creates, updates, and deletes event on native calendar successfully", async () => {
    const [nativeCal] = await db.select().from(calendars).where(eq(calendars.id, nativeCalId)).limit(1);

    // 1. Create event
    const reqCreate = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "3",
        method: "tools/call",
        params: {
          name: "create_event",
          arguments: {
            calendar: nativeCal.slug,
            summary: "Dentist Appointment",
            start: "2026-09-12T10:00:00",
            end: "2026-09-12T11:00:00",
            location: "Dental Clinic",
          },
        },
      }),
    });

    const resCreate = await mcpPost(reqCreate);
    const dataCreate = await resCreate.json();
    const createText = dataCreate.result.content[0].text;
    expect(createText).toContain("Created event 'Dentist Appointment'");
    expect(createText).toContain(nativeCal.name);

    // Extract ID
    const match = createText.match(/#([a-zA-Z0-9_-]+)/);
    expect(match).toBeTruthy();
    const eventId = match![1];

    // 2. Update event
    const reqUpdate = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "4",
        method: "tools/call",
        params: {
          name: "update_event",
          arguments: {
            id: `#${eventId}`,
            summary: "Dentist & Cleaning",
            location: "Suite 400",
          },
        },
      }),
    });

    const resUpdate = await mcpPost(reqUpdate);
    const dataUpdate = await resUpdate.json();
    expect(dataUpdate.result.content[0].text).toContain("Updated event 'Dentist & Cleaning'");

    // Verify DB
    const [updatedRow] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    expect(updatedRow.summary).toBe("Dentist & Cleaning");
    expect(updatedRow.location).toBe("Suite 400");

    // 3. Delete event
    const reqDelete = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "5",
        method: "tools/call",
        params: {
          name: "delete_event",
          arguments: {
            id: `#${eventId}`,
          },
        },
      }),
    });

    const resDelete = await mcpPost(reqDelete);
    const dataDelete = await resDelete.json();
    expect(dataDelete.result.content[0].text).toContain("Permanently deleted event");

    // Verify gone from DB
    const [goneRow] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    expect(goneRow).toBeUndefined();
  });
});
