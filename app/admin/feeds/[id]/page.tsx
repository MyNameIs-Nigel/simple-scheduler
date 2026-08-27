import { notFound } from "next/navigation";
import Link from "next/link";

import { deleteFeed } from "@/app/admin/actions";
import { FeedForm } from "@/components/admin/FeedForm";
import { siteUrl } from "@/lib/env";
import { getFeedById, listCalendars, listFeedCalendars } from "@/lib/events/queries";
import { btnDanger } from "@/lib/ui";

export const metadata = { title: "Edit feed" };

export default async function EditFeedPage({ params }: PageProps<"/admin/feeds/[id]">) {
  const { id } = await params;

  const feed = await getFeedById(id);
  if (!feed) notFound();

  const [calendars, members] = await Promise.all([listCalendars(), listFeedCalendars(feed.id)]);

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Edit feed</h2>
        <a
          href={`${siteUrl()}/calendars/${feed.slug}.ics`}
          className="mt-1 block truncate font-mono text-[10px] text-muted transition-colors duration-200 hover:text-accent-1"
        >
          {siteUrl()}/calendars/{feed.slug}.ics
        </a>
      </div>

      <FeedForm feed={feed} calendars={calendars} memberIds={members.map((c) => c.id)} />

      <div className="mt-10 border-t border-border pt-6">
        <form action={deleteFeed}>
          <input type="hidden" name="id" value={feed.id} />
          <button type="submit" className={btnDanger}>
            Delete feed
          </button>
        </form>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Deletes the feed URL only — the member calendars and their events are untouched.
          Anyone subscribed to{" "}
          <Link href={`/calendars/${feed.slug}.ics`} className="font-mono text-accent-1">
            /calendars/{feed.slug}.ics
          </Link>{" "}
          will start getting a 404.
        </p>
      </div>
    </div>
  );
}
