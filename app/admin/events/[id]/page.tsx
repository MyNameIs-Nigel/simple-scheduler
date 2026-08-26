import { notFound } from "next/navigation";

import { EventForm } from "@/components/admin/EventForm";
import { OccurrenceList } from "@/components/admin/OccurrenceList";
import { timezone } from "@/lib/env";
import { parseRRule } from "@/lib/events/rrule";
import { getEventById, listCalendars, listOverridesFor } from "@/lib/events/queries";
import { toDateInput, toLocalInput } from "@/lib/time";
import { requestNow } from "@/lib/now";

export const metadata = { title: "Edit event" };

export default async function EditEventPage(props: PageProps<"/admin/events/[id]">) {
  const { id } = await props.params;

  const event = await getEventById(id);
  if (!event) notFound();

  const zone = timezone();
  const now = await requestNow();
  const calendars = await listCalendars();
  const overrides = await listOverridesFor([event.id]);

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">
        Edit event
      </h2>

      <EventForm
        calendars={calendars}
        values={{
          id: event.id,
          calendarId: event.calendarId,
          summary: event.summary,
          description: event.description ?? "",
          location: event.location ?? "",
          url: event.url ?? "",
          allDay: event.allDay,
          start: event.allDay
            ? toDateInput(event.dtstart, zone)
            : toLocalInput(event.dtstart, zone),
          // DTEND is exclusive; the form shows the last day inclusive.
          end: event.allDay
            ? toDateInput(event.dtend - 24 * 60 * 60 * 1000, zone)
            : toLocalInput(event.dtend, zone),
          status: event.status,
          recurrence: parseRRule(event.rrule, zone),
        }}
      />

      {event.rrule && (
        <div className="mt-10">
          <OccurrenceList event={event} overrides={overrides} zone={zone} now={now} />
        </div>
      )}

      <dl className="mt-10 space-y-1 border-t border-border pt-4 font-mono text-[10px] text-muted">
        <div className="flex gap-2">
          <dt>UID</dt>
          <dd className="truncate text-fg">{event.uid}</dd>
        </div>
        <div className="flex gap-2">
          <dt>SEQUENCE</dt>
          <dd className="text-fg">{event.sequence}</dd>
        </div>
      </dl>
    </div>
  );
}
