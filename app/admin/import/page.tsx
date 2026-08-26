import { redirect } from "next/navigation";

import { ImportForm } from "@/components/admin/ImportForm";
import { listCalendars } from "@/lib/events/queries";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const calendars = await listCalendars();
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
      <ImportForm calendars={calendars} />
    </div>
  );
}
