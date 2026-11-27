import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftDateKey } from "@/lib/businessClock";

const state = vi.hoisted(() => ({
  identity: { agentId: "synthetic-agent", identity: { status: "resolved" }, isLoading: false, refetch: vi.fn() } as Record<string, unknown>,
  workspace: { data: undefined, isPending: false, isError: false, refetch: vi.fn() } as Record<string, unknown>,
}));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => state.identity }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-11-26" }));
vi.mock("@/hooks/useProducerWorkspace", () => ({ useProducerWorkspace: () => state.workspace }));
import { TrophyProgression } from "@/components/awards/TrophyProgression";

beforeEach(() => {
  const days = [];
  for (let day = "2026-11-01"; day <= "2026-11-26"; day = shiftDateKey(day, 1)) days.push({ day, scheduled: true, production_ap: day === "2026-11-26" ? 3000 : 0, deals: 1 });
  state.identity = { agentId: "synthetic-agent", identity: { status: "resolved" }, isLoading: false, refetch: vi.fn() };
  state.workspace = { data: { agent_id: "synthetic-agent", today: "2026-11-26", days }, isPending: false, isError: false, refetch: vi.fn() };
});
const page = () => render(<MemoryRouter><TrophyProgression /></MemoryRouter>);
describe("trophy progression", () => {
  it("shows five measured trophies, the next step and a working lead destination", () => {
    page();
    expect(screen.getAllByRole("progressbar")).toHaveLength(5);
    expect(screen.getByText("$2,000 to Platinum.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Work my leads" })).toHaveAttribute("href", "/dashboard/my-leads");
  });
  it("hides stale numbers after identity or source verification fails", () => {
    state.identity.agentId = "synthetic-other-agent";
    page();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry trophy progress" })).toBeInTheDocument();
  });
  it("keeps failed refresh evidence unknown", () => {
    state.workspace.isError = true;
    page();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("does not show a fake empty trophy path for a verified non-producer", () => {
    state.identity = { agentId: null, identity: { status: "none" }, isLoading: false, refetch: vi.fn() };
    const { container } = page();
    expect(container).toBeEmptyDOMElement();
  });
});
