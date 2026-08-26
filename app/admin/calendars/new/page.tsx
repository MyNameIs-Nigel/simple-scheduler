import { CalendarForm } from "@/components/admin/CalendarForm";

export const metadata = { title: "New calendar" };

export default function NewCalendarPage() {
  return (
    <div className="max-w-lg">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted">
        New calendar
      </h2>
      <CalendarForm />
    </div>
  );
}
