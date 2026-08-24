/**
 * Demo mode's contract, pinned.
 *
 * The failure that matters here is not "a number wasn't faked" — it is masking
 * something the app runs on. If an id, foreign key, timestamp, status or enum
 * gets rewritten, filters stop matching, routes 404, joins break and the demo
 * falls apart in front of whoever Sam is showing it to. Those assertions are
 * the point of this file; the "did it fake the money" ones are the easy half.
 */

import { describe, it, expect } from "vitest";
import { maskPayload } from "@/lib/demoMode";

const row = () => ({
  id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  agent_id: "11111111-2222-3333-4444-555555555555",
  policy_number: "AMH6327973",
  status: "active",
  license_status: "licensed",
  onboarding_stage: "in_field_training",
  is_manager: false,
  passed: true,
  created_at: "2026-08-01T12:00:00.000Z",
  effective_date: "2026-08-01",
  order_index: 3,
  video_watched_percent: 80,
  annual_premium: 2400.5,
  monthly_premium: 200,
  deals_closed: 7,
  first_name: "Xaviar",
  last_name: "Watts",
  display_name: "Xaviar Watts",
  email: "xaviar.watts@realdomain.com",
  phone: "(602) 555-1234",
});

describe("demo mode masking", () => {
  const masked = maskPayload(row()) as Record<string, unknown>;

  it("never rewrites identifiers — joins and routing depend on them", () => {
    expect(masked.id).toBe(row().id);
    expect(masked.agent_id).toBe(row().agent_id);
    expect(masked.policy_number).toBe(row().policy_number);
  });

  /**
   * The assertion that actually earns its place.
   *
   * The three above cannot fail: masking is opt-in by key pattern, so a uuid
   * string is untouched whether or not PROTECTED_KEY exists — deleting the
   * whole protected list left them green, which means they were pinning
   * nothing. The real collision is a NUMERIC foreign key whose name also
   * matches the money/count list: `deal_id` contains "deal",
   * `application_id` contains "application". Those WOULD be rewritten if
   * PROTECTED_KEY stopped winning, and a rewritten foreign key silently breaks
   * every join in the demo.
   */
  it("protects numeric foreign keys whose names collide with the money list", () => {
    const out = maskPayload({
      deal_id: 918273,
      application_id: 44556,
      lead_id: 7788,
      policy_count: 12,
    }) as Record<string, unknown>;

    expect(out.deal_id).toBe(918273);
    expect(out.application_id).toBe(44556);
    expect(out.lead_id).toBe(7788);
    // ...while a genuine count beside them is still masked.
    expect(out.policy_count).not.toBe(12);
  });

  it("never rewrites status, enums or booleans — filters depend on them", () => {
    expect(masked.status).toBe("active");
    expect(masked.license_status).toBe("licensed");
    expect(masked.onboarding_stage).toBe("in_field_training");
    expect(masked.is_manager).toBe(false);
    expect(masked.passed).toBe(true);
  });

  it("never rewrites dates or ordering/percent fields", () => {
    expect(masked.created_at).toBe(row().created_at);
    expect(masked.effective_date).toBe(row().effective_date);
    expect(masked.order_index).toBe(3);
    // A masked percent could render a 140%-complete progress bar.
    expect(masked.video_watched_percent).toBe(80);
  });

  it("replaces money with a different but same-magnitude number", () => {
    const p = masked.annual_premium as number;
    expect(p).not.toBe(2400.5);
    expect(p).toBeGreaterThan(240);      // still four figures, not $0 and not $2M
    expect(p).toBeLessThan(24000);
  });

  it("keeps integer counts integral", () => {
    const d = masked.deals_closed as number;
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it("replaces person identifiers and never leaks the real one", () => {
    expect(masked.first_name).not.toBe("Xaviar");
    expect(masked.last_name).not.toBe("Watts");
    expect(masked.display_name).not.toContain("Xaviar");
    expect(masked.email).not.toContain("realdomain.com");
    expect(String(masked.email)).toContain("@example.com");
    // 555-01xx is the reserved fictional range — it cannot dial a real person.
    expect(String(masked.phone)).toContain("555");
    expect(masked.phone).not.toBe("(602) 555-1234");
  });

  it("is deterministic — a demo that reshuffles on every refetch is useless", () => {
    const a = maskPayload(row()) as Record<string, unknown>;
    const b = maskPayload(row()) as Record<string, unknown>;
    expect(a.annual_premium).toBe(b.annual_premium);
    expect(a.display_name).toBe(b.display_name);
  });

  it("maps the same real person to the same fake person across screens", () => {
    const fromDeals = maskPayload({ agent_name: "Xaviar Watts" }) as Record<string, unknown>;
    const fromBoard = maskPayload({ display_name: "Xaviar Watts" }) as Record<string, unknown>;
    expect(fromDeals.agent_name).toBe(fromBoard.display_name);
  });

  it("handles arrays and nested rows, which is how PostgREST actually answers", () => {
    const out = maskPayload([{ ...row(), agents: { display_name: "Xaviar Watts" } }]) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(out)).toBe(true);
    expect((out[0].agents as Record<string, unknown>).display_name).not.toBe("Xaviar Watts");
  });

  it("leaves zero alone, so an empty state stays an empty state", () => {
    const out = maskPayload({ annual_premium: 0, deals_closed: 0 }) as Record<string, unknown>;
    expect(out.annual_premium).toBe(0);
    expect(out.deals_closed).toBe(0);
  });

  it("masks numeric strings, which is how PostgREST returns numeric/bigint", () => {
    const out = maskPayload({ annual_premium: "2400.50" }) as Record<string, unknown>;
    expect(typeof out.annual_premium).toBe("string");
    expect(out.annual_premium).not.toBe("2400.50");
  });
});

/**
 * Regression: a mask that returns its input is not a mask.
 *
 * round(n * jitter) lands back on n for a wide band of small integers, and small
 * integers — deals today, hires this week, agents on a leg — are most of what a
 * demo screen shows. Found by a failing assertion, not by reading the code.
 */
describe("demo mode never returns the real number", () => {
  it("changes every small integer count from 1 to 200", () => {
    const leaked: number[] = [];
    for (let n = 1; n <= 200; n++) {
      const out = maskPayload({ policy_count: n }) as Record<string, unknown>;
      if (out.policy_count === n) leaked.push(n);
    }
    expect(leaked).toEqual([]);
  });

  it("changes money amounts across several magnitudes", () => {
    const leaked: number[] = [];
    for (const amount of [1, 9, 99, 250.5, 2400.5, 18000, 113259, 2376706.08]) {
      const out = maskPayload({ annual_premium: amount }) as Record<string, unknown>;
      if (out.annual_premium === amount) leaked.push(amount);
    }
    expect(leaked).toEqual([]);
  });

  it("still leaves zero alone — an empty state must stay empty", () => {
    const out = maskPayload({ policy_count: 0 }) as Record<string, unknown>;
    expect(out.policy_count).toBe(0);
  });
});
