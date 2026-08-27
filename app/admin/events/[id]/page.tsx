import { notFound } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";

import { EventForm } from "@/components/admin/EventForm";
import { OccurrenceList } from "@/components/admin/OccurrenceList";
import { timezone } from "@/lib/env";
import { parseRRule } from "@/lib/events/rrule";
import {
  getCalendarById,
  getEventById,
  listCalendars,
  listOverridesFor,
} from "@/lib/events/queries";
import { describeRRule } from "@/lib/events/rrule";
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

  const calendar = await getCalendarById(event.calendarId);
  if (calendar?.sourceUrl) {
    return <MirroredEvent event={event} calendar={calendar} zone={zone} />;
  }

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">
        Edit event
      </h2>

      <EventForm
        calendars={calendars.filter((c) => !c.sourceUrl)}
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

/**
 * A synced event, shown but not editable.
 *
 * The actions refuse the write regardless — this is the part that explains why,
 * and points at the one place a change would actually stick.
 */
function MirroredEvent({
  event,
  calendar,
  zone,
}: {
  event: NonNullable<Awaited<ReturnType<typeof getEventById>>>;
  calendar: NonNullable<Awaited<ReturnType<typeof getCalendarById>>>;
  zone: string;
}) {
  const start = DateTime.fromMillis(event.dtstart, { zone });
  const end = DateTime.fromMillis(event.dtend, { zone });

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">Event</h2>

      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-fg">{event.summary}</p>
        <p className="mt-1 font-mono text-[10px] tabular-nums text-muted">
          {event.allDay
            ? start.toFormat("ccc d LLL yyyy")
            : `${start.toFormat("ccc d LLL yyyy · HH:mm")} – ${end.toFormat("HH:mm")}`}
          {" · "}
          {describeRRule(event.rrule)}
        </p>
        {event.location && <p className="mt-2 text-xs text-muted">{event.location}</p>}
        {event.description && (
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">
            {event.description}
          </p>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-accent-4/25 bg-accent-4/5 p-4">
        <p className="font-mono text-xs text-accent-4">🔒 synced — read-only</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          This event is mirrored from the subscription URL on{" "}
          <Link href={`/admin/calendars/${calendar.id}`} className="text-accent-1">
            {calendar.name}
          </Link>
          , so editing it here would be undone by the next sync. Change it at the source, or add
          your own event on a different calendar and publish both through a{" "}
          <Link href="/admin/feeds" className="text-accent-1">
            feed
          </Link>
          .
        </p>
        <p className="mt-2 truncate font-mono text-[10px] text-muted">{calendar.sourceUrl}</p>
      </div>

      <dl className="mt-10 space-y-1 border-t border-border pt-4 font-mono text-[10px] text-muted">
        <div className="flex gap-2">
          <dt>UID</dt>
          <dd className="truncate text-fg">{event.uid}</dd>
        </div>
        <div className="flex gap-2">
          <dt>SOURCE UID</dt>
          <dd className="truncate text-fg">{event.sourceUid ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt>SEQUENCE</dt>
          <dd className="text-fg">{event.sequence}</dd>
        </div>
      </dl>
    </div>
  );
}
