import { redirect } from "next/navigation";

import { ImportForm } from "@/components/admin/ImportForm";
import { listCalendars } from "@/lib/events/queries";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  // A mirrored calendar's events come from its source, so an upload into one
  // would be wiped by the next sync. The action refuses it either way.
  const calendars = (await listCalendars()).filter((c) => !c.sourceUrl);
  if (calendars.length === 0) redirect("/admin/calendars/new");

  return (
    <div className="max-w-lg">
      <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-muted">
        Import .ics
      </h2>
      <p className="mb-6 text-xs leading-relaxed text-muted">
        Bring in an existing calendar — export one from Google Calendar, Apple
        Calendar or Outlook and upload it here. Events keep their original UID,
        so importing the same file twice updates the events rather than
        duplicating them. Modified single occurrences of a recurring series are
        skipped, and the import is all-or-nothing.
      </p>
      <p className="mb-6 text-xs leading-relaxed text-muted">
        This is a one-off copy. For a calendar published at a URL that keeps changing — a work
        schedule, say — set a subscription URL on the calendar instead and it will mirror itself
        automatically. Subscribed calendars are not listed here.
      </p>
      <ImportForm calendars={calendars} />
    </div>
  );
}
