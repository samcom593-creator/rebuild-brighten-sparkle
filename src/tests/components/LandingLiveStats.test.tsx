import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LandingLiveStats } from "@/lib/landingLiveStats";

const facts = vi.hoisted(() => ({ data: undefined as LandingLiveStats | undefined, isError: false, isPending: true, isFetching: false, refetch: vi.fn() }));
vi.mock("@/hooks/useLandingLiveStats", () => ({ useLandingLiveStats: () => facts }));
vi.mock("@/shared/hooks/useInteractionGate", () => ({ useInteractionGate: () => true }));
vi.mock("@/components/ui/animated-counter", () => ({ AnimatedCounter: ({ value }: { value: number }) => <span>{value}</span> }));
import { LiveStatsCounterStrip } from "@/components/landing/LiveStatsCounterStrip";
import { CareerPathwaySection } from "@/components/landing/CareerPathwaySection";
import { CTASection } from "@/components/landing/CTASection";

beforeEach(() => {
  facts.data = undefined;
  facts.isError = false;
  facts.isPending = true;
  facts.isFetching = false;
  facts.refetch.mockReset();
  localStorage.clear();
});

describe("public landing without live data", () => {
  it("does not present an old browser cache as current data", () => {
    localStorage.setItem("apex_live_stats_last_good", JSON.stringify({ applications_30d: 999, carriers_partnered: 999 }));
    render(<LiveStatsCounterStrip />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading agency numbers");
    expect(screen.getAllByLabelText("Not available")).toHaveLength(2);
    expect(screen.queryByText("999")).toBeNull();
  });

  it("renders verified zero counts and offers a real retry after a failure", () => {
    facts.data = { active_agents: 0, applications_30d: 0, carriers_partnered: 0 };
    facts.isPending = false;
    const view = render(<LiveStatsCounterStrip />);
    expect(screen.getAllByText("0")).toHaveLength(2);
    facts.isError = true;
    view.rerender(<LiveStatsCounterStrip />);
    expect(screen.getByRole("status")).toHaveTextContent("Last available numbers");
    fireEvent.click(screen.getByRole("button", { name: "Retry agency numbers" }));
    expect(facts.refetch).toHaveBeenCalledOnce();
  });

  it("does not disguise a first-load failure as continued loading", () => {
    facts.isPending = false;
    facts.isError = true;
    render(<LiveStatsCounterStrip />);
    expect(screen.getByRole("status")).toHaveTextContent("Agency numbers are unavailable right now");
    expect(screen.queryByText(/Loading agency numbers/)).toBeNull();
  });

  it("keeps the career roadmap usable without inventing agent or carrier totals", () => {
    render(<CareerPathwaySection />);
    expect(screen.getByLabelText("Active Agents unavailable")).toHaveTextContent("—");
    expect(screen.getByLabelText("Carrier Partners unavailable")).toHaveTextContent("—");
    expect(screen.getByText(/Review carrier and product options with your manager/)).toBeInTheDocument();
    expect(screen.queryByText("40")).toBeNull();
  });

  it("shows exact verified roadmap counts without an initial zero animation", () => {
    facts.data = { active_agents: 7, applications_30d: 0, carriers_partnered: 3 };
    facts.isPending = false;
    render(<CareerPathwaySection />);
    expect(screen.getByText("Active Agents").previousElementSibling).toHaveTextContent("7");
    expect(screen.getByText("Carrier Partners").previousElementSibling).toHaveTextContent("3");
  });

  it("keeps the closing application link attributed without a fabricated roster claim", () => {
    render(<MemoryRouter initialEntries={["/?ref=sample-manager"]}><CTASection /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Start Your Application" })).toHaveAttribute("href", "/apply?ref=sample-manager");
    expect(screen.queryByText(/agents are already moving/)).toBeNull();
  });
});
