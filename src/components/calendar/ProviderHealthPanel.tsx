import { useQuery } from "@tanstack/react-query";
import { formatTimeAgo } from "@/lib/dateUtils";
import { fetchProviderHealth, type ProviderHealth } from "@/components/calendar/calendarApi";
import { cn } from "@/lib/utils";

/**
 * Honest provider strip. Every line is read from a real signal through
 * calendar_provider_health() (staff only); nothing here says "synced" without a
 * timestamp behind it, and an unmeasurable value is printed as unknown.
 *
 * Calendly is "receiving" when a webhook-origin booking or a green reconcile
 * run is recent. Google Calendar is "not connected" unless a sync job exists.
 */
const DAY = 86_400_000;

type Line = { label: string; state: string; detail: string; tone: "ok" | "warn" | "bad" | "muted" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  return formatTimeAgo(iso);
}

export function providerLines(h: ProviderHealth, now = Date.now()): Line[] {
  const lines: Line[] = [];

  const reconcileAge = h.calendly_last_reconcile_at ? now - Date.parse(h.calendly_last_reconcile_at) : null;
  const reconcileOk = h.calendly_last_reconcile_status === "ok" && reconcileAge !== null && reconcileAge < DAY;
  lines.push({
    label: "Calendly",
    state: reconcileOk ? "Receiving" : h.calendly_last_reconcile_status === null ? "Unknown" : "Check sync",
    detail: `last webhook booking ${ago(h.calendly_last_webhook_booking_at)} · reconcile ${h.calendly_last_reconcile_status ?? "unknown"} ${ago(h.calendly_last_reconcile_at)}`
      + (h.calendly_reconcile_failures_24h ? ` · ${h.calendly_reconcile_failures_24h} failed run(s) in 24h` : ""),
    tone: reconcileOk ? (h.calendly_reconcile_failures_24h ? "warn" : "ok") : "bad",
  });

  lines.push({
    label: "Google Calendar",
    state: h.google_sync_job_active === null ? "Unknown" : h.google_sync_job_active ? "Scheduled" : "Not connected",
    detail: h.google_sync_job_active
      ? `last sync ${ago(h.google_last_synced_at)}`
      : `no sync job runs · last import ${ago(h.google_last_synced_at)}`,
    tone: h.google_sync_job_active ? "ok" : "muted",
  });

  const failed = h.onboarding_invites_failed ?? 0;
  lines.push({
    label: "Onboarding invites",
    state: failed > 0 ? `${failed} failed` : `${h.onboarding_invites_sent ?? "?"} sent`,
    detail: `${h.onboarding_invites_queued ?? "?"} queued`
      + (failed > 0 && h.onboarding_invite_last_error ? ` · last error: ${h.onboarding_invite_last_error}` : ""),
    tone: failed > 0 ? "bad" : (h.onboarding_invites_queued ?? 0) > 0 ? "warn" : "ok",
  });

  lines.push({
    label: "Interview reminders",
    state: h.interview_reminders_enabled ? "On (inbox, T-30)" : "Off",
    detail: h.interview_reminders_enabled
      ? `${h.interview_reminders_sent ?? "?"} sent so far · Calendly bookings use Calendly's own reminders (not visible here)`
      : "No reminder is sent for staff-booked interviews · Calendly bookings use Calendly's own reminders (not visible here)",
    tone: h.interview_reminders_enabled ? "ok" : "muted",
  });

  lines.push({
    label: "Phone calendar feed",
    state: h.ics_feed_last_polled_at ? "Subscribed" : "No device",
    detail: h.ics_feed_last_polled_at
      ? `last polled ${ago(h.ics_feed_last_polled_at)} · carries tasks, not appointments`
      : "no device has polled the .ics feed",
    tone: "muted",
  });
  return lines;
}

const TONE: Record<Line["tone"], string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

export function ProviderHealthPanel({ enabled }: { enabled: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["calendar-provider-health"],
    queryFn: fetchProviderHealth,
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;
  if (isLoading) return <p className="text-xs text-muted-foreground">Reading provider status…</p>;
  if (!data || data.state === "forbidden") {
    return <p className="text-xs text-muted-foreground">Booking-provider status is visible to scheduling staff.</p>;
  }
  if (data.state === "error") {
    return <p className="text-xs text-destructive">Provider status could not be read: {data.message}. Nothing is assumed healthy.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-xs">
        <caption className="sr-only">Calendar provider and reminder status</caption>
        <tbody className="divide-y divide-border">
          {providerLines(data.health).map((line) => (
            <tr key={line.label}>
              <th scope="row" className="w-40 whitespace-nowrap px-3 py-2 text-left font-medium text-foreground">{line.label}</th>
              <td className={cn("w-32 whitespace-nowrap px-3 py-2 font-medium", TONE[line.tone])}>{line.state}</td>
              <td className="px-3 py-2 text-muted-foreground">{line.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
