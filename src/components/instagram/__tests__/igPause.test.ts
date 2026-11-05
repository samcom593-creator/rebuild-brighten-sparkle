// Sam's Instagram pause (2026-11-04): the desk banner must say "paused on purpose" and must not
// call the quiet bot broken. A dead token still outranks it, because a dead token also breaks the
// inbound name lookup and the resume.
import { describe, expect, it } from "vitest";
import { alertVerdict } from "../IgHealthAlert";
import type { IgStatus } from "../igTypes";

const NOW = Date.parse("2026-11-05T02:30:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// Only the fields alertVerdict reads; the rest of IgStatus is irrelevant to the verdict.
function status(over: Partial<IgStatus> = {}): IgStatus {
  return {
    token_ok: true, token_checked_at: iso(0), ig_username: "sell4daddy",
    links_blocked: false, links_blocked_at: null, last_link_refusal_at: null, links_proven_at: iso(1),
    last_delivered_at: iso(30), last_bot_delivered_at: iso(30), last_inbound_at: iso(1),
    nudge_cron_last_at: iso(2), nudge_cron_last_status: "failed",
    ...over,
  } as unknown as IgStatus;
}

describe("Instagram pause banner", () => {
  it("without a pause the silent bot and the stale follow-ups still read as faults", () => {
    const v = alertVerdict(status(), 3, NOW, null);
    expect(v?.kind).toBe("bot_silent");
  });

  it("paused outranks links_blocked, bot_silent and followups_stale", () => {
    const v = alertVerdict(status({ links_blocked: true, links_blocked_at: iso(14) }), 3, NOW, { paused: true, since: iso(2) });
    expect(v?.kind).toBe("paused");
    expect(v?.sentence).toContain("paused");
    expect(v?.sentence).toContain("since");
  });

  it("paused wins over a dead token and says the token is dead too", () => {
    const v = alertVerdict(status({ token_ok: false }), 0, NOW, { paused: true, since: iso(2) });
    expect(v?.kind).toBe("paused");
    expect(v?.sentence).toContain("token is also dead");
  });

  it("a dead token is still the top fault when nothing is paused", () => {
    const v = alertVerdict(status({ token_ok: false }), 0, NOW, null);
    expect(v?.kind).toBe("token_dead");
  });

  it("an unpaused status row changes nothing", () => {
    const v = alertVerdict(status({ nudge_cron_last_status: "succeeded", nudge_cron_last_at: iso(0), last_bot_delivered_at: iso(0.5) }), 0, NOW, { paused: false, since: null });
    expect(v).toBeNull();
  });
});
