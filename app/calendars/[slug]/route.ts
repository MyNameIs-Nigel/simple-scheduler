import { NextResponse, type NextRequest } from "next/server";

import { buildFeed } from "@/lib/ics/build";

/**
 * Public subscribable feed: /calendars/<slug>.ics, plus /calendars/all.ics for
 * every public calendar combined.
 *
 * Next captures dots inside a dynamic segment, so `work.ics` arrives intact as
 * the slug and the suffix is stripped in buildFeed.
 *
 * Route handlers are uncached by default in Next 16, which is what we want:
 * the feed is generated per request from the database, so an admin edit is
 * live immediately. The ETag then makes the common "no change since last poll"
 * case cost a 304 instead of a body.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/calendars/[slug]">) {
  const { slug } = await ctx.params;

  const feed = await buildFeed(slug);
  if (!feed) {
    return new NextResponse("Calendar not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const filename = slug.toLowerCase().endsWith(".ics") ? slug : `${slug}.ics`;

  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "public, max-age=300, must-revalidate",
    ETag: feed.etag,
  };

  if (request.headers.get("if-none-match") === feed.etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(feed.body, { status: 200, headers });
}
