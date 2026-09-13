import { ImageResponse } from "next/og";

/**
 * Generated favicon: the portfolio's terminal-prompt mark — a green `>_` on a
 * black rounded square, matching
 * cyber-portfolio's `public/favicon/icon.svg` (`#22c55e` on black, ~15%
 * corner radius) and the `>` motif in this site's navbar.
 *
 * Code-generated rather than a static file so the brand lives in one place:
 * change the mark here and every icon size updates with it.
 */
export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
          borderRadius: 80,
        }}
      >
        <div
          style={{
            color: "#22c55e",
            fontSize: 290,
            fontWeight: 900,
            fontFamily: "monospace",
            letterSpacing: -12,
            // Pull the glyph block up slightly so the underscore bar clears
            // the rounded corner at small raster sizes.
            marginBottom: 30,
          }}
        >
          &gt;_
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
