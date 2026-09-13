import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

import { timezone } from "@/lib/env";
import { getDaySummary, parseDayParam } from "@/lib/events/day";

/**
 * The per-day share image behind `/day`, wired up by the page's
 * `generateMetadata` as `/day/og?date=YYYY-MM-DD`.
 *
 * A dedicated route (rather than the `opengraph-image.tsx` file convention)
 * because that convention only receives route `params` — the selected day
 * travels in `?date=`, which only a handler reading the request URL can see.
 *
 * Layout: top-left is the brand (`>_` mark in portfolio green plus
 * nigel-smith.dev), the event count is very large and right-aligned, and
 * "Schedule" sits bottom-left in larger text.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

const BG = "#0a0a0a";
const FG = "#e5e5e5";
const MUTED = "#737373";
const GREEN = "#22c55e";

export async function GET(request: NextRequest) {
  const zone = timezone();
  const dateIso = parseDayParam(request.nextUrl.searchParams.get("date"), zone);
  const summary = await getDaySummary(dateIso, zone);

  const count = String(summary.count);
  const unit = summary.count === 1 ? "event" : "events";
  // Three-digit days still have to fit the right column.
  const countSize = summary.count >= 100 ? 200 : 300;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: 72,
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
            <span style={{ color: GREEN, fontSize: 44, fontWeight: 900 }}>&gt;_</span>
            <span style={{ color: FG, fontSize: 34, marginLeft: 20 }}>nigel-smith.dev</span>
          </div>
          <span style={{ color: MUTED, fontSize: 28 }}>{summary.title}</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <span
            style={{
              color: GREEN,
              fontSize: countSize,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {count}
          </span>
          <span style={{ color: MUTED, fontSize: 30, marginTop: 8 }}>{unit} that day</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: FG, fontSize: 84, fontWeight: 700 }}>Schedule</span>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
