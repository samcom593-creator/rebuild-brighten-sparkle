import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CarrierPolicyCohortView } from "@/components/dashboard/CarrierPolicyCohortCard";
import type { CarrierPolicyCohort } from "@/lib/carrierPolicyCohort";
const base: CarrierPolicyCohort = {
  viewer_user_id: "viewer-a", requested_agent_id: null, agent_id: null,
  window: { start: "2026-11-01", end_exclusive: "2026-11-25" }, as_of: "2026-11-24T23:00:00Z", timezone: "America/Phoenix", basis: "Synthetic fixture",
  scopes: { personal: { posted_policies: 4, posted_ap: 4800, matched_policies: 4, unmatched_policies: 0, ambiguous_policies: 0,
    status_known_policies: 4, payment_supported_policies: 4, paying_status_policies: 2, paying_status_ap: 2400,
    in_force_policies: 2, pending_policies: 1, not_placed_policies: 1, at_risk_policies: 0, lapsed_policies: 0, conflicting_policies: 0,
    oldest_observed_on: "2026-11-23", newest_observed_on: "2026-11-24" } },
};
describe("carrier cohort presentation", () => {
  it("shows the numerator, denominator and source dates without calling annual premium receipts", () => {
    render(<CarrierPolicyCohortView data={base} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("$2,400")).toBeInTheDocument();
    expect(screen.getByText(/Exact carrier matches: 4 \/ 4/)).toBeInTheDocument();
    expect(screen.getByText(/not premium receipts or commission cash/)).toBeInTheDocument();
  });
  it("withholds an incomplete total rather than dividing only the matched subset", () => {
    render(<CarrierPolicyCohortView data={{ ...base, scopes: { personal: { ...base.scopes.personal, payment_supported_policies: 3 } } }} />);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.getByText(/total placement rate is withheld/)).toBeInTheDocument();
  });
  it("masks every financial amount, policy count and calculated rate in Present mode", () => {
    const { container } = render(<CarrierPolicyCohortView data={base} hidden />);
    expect(container).not.toHaveTextContent("$2,400");
    expect(container).not.toHaveTextContent("$4,800");
    expect(container).not.toHaveTextContent("50%");
    expect(container).not.toHaveTextContent("2 matched policies");
    expect(screen.getByText("Carrier matching and coverage counts hidden.")).toBeInTheDocument();
  });
});
