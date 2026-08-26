import { notFound } from "next/navigation";

import { CalendarForm } from "@/components/admin/CalendarForm";
import { getCalendarById } from "@/lib/events/queries";

export const metadata = { title: "Edit calendar" };

export default async function EditCalendarPage(props: PageProps<"/admin/calendars/[id]">) {
  const { id } = await props.params;
  const calendar = await getCalendarById(id);
  if (!calendar) notFound();

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">
        Edit {calendar.name}
      </h2>
      <CalendarForm calendar={calendar} />
    </div>
  );
}
