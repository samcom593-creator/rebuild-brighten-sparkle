import { describe, expect, it } from "vitest";
import { providerLines } from "@/components/calendar/ProviderHealthPanel";
import type { ProviderHealth } from "@/components/calendar/calendarApi";

const NOW = Date.parse("2026-10-06T12:00:00Z");

function health(over: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    measured_at: "2026-10-06T12:00:00Z",
    calendly_last_webhook_booking_at: "2026-10-05T10:03:02Z",
    calendly_last_reconcile_at: "2026-10-06T11:48:00Z",
    calendly_last_reconcile_status: "ok",
    calendly_reconcile_failures_24h: 0,
    google_last_synced_at: "2026-06-10T15:00:00Z",
    google_sync_job_active: false,
    onboarding_invites_queued: 0,
    onboarding_invites_sent: 4,
    onboarding_invites_failed: 0,
    onboarding_invite_last_error: null,
    interview_reminders_enabled: false,
    interview_reminders_sent: 0,
    ics_feed_last_polled_at: null,
    ...over,
  };
}

const line = (lines: ReturnType<typeof providerLines>, label: string) => lines.find((l) => l.label === label)!;

describe("providerLines", () => {
  it("reports Google Calendar as not connected when no sync job exists, whatever rows it once imported", () => {
    const g = line(providerLines(health(), NOW), "Google Calendar");
    expect(g.state).toBe("Not connected");
    expect(g.detail).toContain("no sync job runs");
  });

  it("says Unknown — not 'Not connected' — when the job table could not be read", () => {
    expect(line(providerLines(health({ google_sync_job_active: null }), NOW), "Google Calendar").state).toBe("Unknown");
  });

  it("Calendly is receiving only with a recent green reconcile; a stale or failed one is flagged", () => {
    expect(line(providerLines(health(), NOW), "Calendly").state).toBe("Receiving");
    const stale = line(providerLines(health({ calendly_last_reconcile_at: "2026-10-01T00:00:00Z" }), NOW), "Calendly");
    expect(stale.state).toBe("Check sync");
    expect(stale.tone).toBe("bad");
    const failed = line(providerLines(health({ calendly_last_reconcile_status: "failed" }), NOW), "Calendly");
    expect(failed.state).toBe("Check sync");
    expect(line(providerLines(health({ calendly_last_reconcile_status: null, calendly_last_reconcile_at: null }), NOW), "Calendly").state).toBe("Unknown");
  });

  it("surfaces failed onboarding invites with the last error", () => {
    const inv = line(providerLines(health({ onboarding_invites_failed: 2, onboarding_invite_last_error: "resend 422" }), NOW), "Onboarding invites");
    expect(inv.state).toBe("2 failed");
    expect(inv.tone).toBe("bad");
    expect(inv.detail).toContain("resend 422");
  });

  it("states plainly that staff-booked interview reminders are off and Calendly's are not visible", () => {
    const r = line(providerLines(health(), NOW), "Interview reminders");
    expect(r.state).toBe("Off");
    expect(r.detail).toMatch(/not visible here/);
  });
});
