import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverFiveKBadge, amountFor } from "@/components/team/OverFiveKBadge";
import { OVER_5K } from "@/lib/overFiveK";

const row = { today_alp: 100, mtd_alp: 5001, l30_alp: 5000, lifetime_alp: null };
const on = { active: true, metric: "alp" as const, period: "month_to_date" as const, scope: "personal" as const, reversals: "ignore" as const };

describe("Over $5K badge", () => {
  it("renders nothing while the rule is inactive, even for a large number", () => {
    render(<OverFiveKBadge row={{ ...row, mtd_alp: 99999 }} />);
    expect(screen.queryByText("Over $5K")).toBeNull();
    expect(OVER_5K.active).toBe(false);
  });
  it("when active, shows the badge only strictly over $5,000 for the configured period, with a tooltip stating the metric and period", () => {
    render(<OverFiveKBadge row={row} cfg={on} />);
    expect(screen.getByText("Over $5K")).toHaveAttribute("title", "Over $5,000 ALP this month, personal production.");
  });
  it("exactly $5,000 is not over, and a missing number is never treated as $0", () => {
    const { rerender } = render(<OverFiveKBadge row={row} cfg={{ ...on, period: "last_30_days" }} />);
    expect(screen.queryByText("Over $5K")).toBeNull();
    rerender(<OverFiveKBadge row={row} cfg={{ ...on, period: "lifetime" }} />);
    expect(screen.queryByText("Over $5K")).toBeNull();
    expect(amountFor(row, { ...on, period: "lifetime" })).toBeNull();
    expect(amountFor(row, { ...on, metric: "annual_premium" })).toBeNull();
  });
});
