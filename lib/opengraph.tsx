import { ImageResponse } from "next/og";

export const openGraphImageSize = { width: 1200, height: 630 };

/**
 * Shared terminal-inspired treatment for the schedule's social preview cards.
 * Keep the content deliberately spare: individual route cards only need to
 * identify the destination at a glance.
 */
export function openGraphImage(title: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0a0a0a",
          color: "#e5e5e5",
          padding: "72px 80px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", color: "#737373", fontSize: 26 }}>
          nigel-smith.dev
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 92, fontWeight: 700 }}>
          <span style={{ color: "#22c55e" }}>{">"}</span>
          <span style={{ marginLeft: 28 }}>{title}</span>
          <span
            style={{
              width: 12,
              height: 76,
              marginLeft: 20,
              backgroundColor: "#22c55e",
            }}
          />
        </div>
        <div style={{ display: "flex", color: "#737373", fontSize: 28 }}>
          Nigel Smith&apos;s Schedule
        </div>
      </div>
    ),
    openGraphImageSize,
  );
}

/** Turns a URL segment into the deliberately simple label shown on its card. */
export function routeLabel(segment: string) {
  return segment.replaceAll(/[-_]+/g, " ").toLowerCase();
}
