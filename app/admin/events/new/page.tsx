import { redirect } from "next/navigation";
import { DateTime } from "luxon";

import { EventForm } from "@/components/admin/EventForm";
import { timezone } from "@/lib/env";
import { EMPTY_RECURRENCE } from "@/lib/events/rrule";
import { listCalendars } from "@/lib/events/queries";

export const metadata = { title: "New event" };

export default async function NewEventPage() {
  // Mirrored calendars are owned by their source: an event created on one
  // would be deleted by the next sync, so they are not offered as a target.
  const calendars = (await listCalendars()).filter((c) => !c.sourceUrl);
  // Nothing to attach an event to yet — send them to create a calendar first.
  if (calendars.length === 0) redirect("/admin/calendars/new");

  const zone = timezone();
  // Default to the next round hour, an hour long.
  const start = DateTime.now().setZone(zone).plus({ hours: 1 }).startOf("hour");

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">New event</h2>
      <EventForm
        calendars={calendars}
        values={{
          calendarId: calendars[0].id,
          summary: "",
          description: "",
          location: "",
          url: "",
          allDay: false,
          start: start.toFormat("yyyy-MM-dd'T'HH:mm"),
          end: start.plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"),
          status: "CONFIRMED",
          recurrence: { ...EMPTY_RECURRENCE },
        }}
      />
    </div>
  );
}
