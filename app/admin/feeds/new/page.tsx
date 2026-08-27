import { redirect } from "next/navigation";

import { FeedForm } from "@/components/admin/FeedForm";
import { listCalendars } from "@/lib/events/queries";

export const metadata = { title: "New feed" };

export default async function NewFeedPage() {
  const calendars = await listCalendars();
  if (calendars.length === 0) redirect("/admin/calendars/new");

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">New feed</h2>
      <FeedForm calendars={calendars} />
    </div>
  );
}
