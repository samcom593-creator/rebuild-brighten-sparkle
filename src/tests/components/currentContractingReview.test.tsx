import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agent, emptyProfile, fakeBackend } from "../helpers/reviewFixtures";

const auth = vi.hoisted(() => ({ user: { id: "staff-1" }, isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
const backend = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fakeBackend> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (name: string, args?: Record<string, unknown>) => backend.current!.rpc(name, args) } }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";
import { ContractingReviewBanner } from "@/components/contracting-review/ContractingReviewBanner";

function mount(path = "/dashboard/team?view=contracting", banner = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter initialEntries={[path]}>{banner ? <ContractingReviewBanner /> : <ContractingReviewWorkspace />}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  Object.assign(auth, { user: { id: "staff-1" }, isAdmin: true, isManager: false, isVaManager: false, isVa: false });
  backend.current = fakeBackend([agent({ id: "ann", display_name: "Ann Lee", marked: ["combine", "aflac", "gto", "ethos"] }), agent({ id: "bo", display_name: "Bo Chen" })]);
});

describe("current contracting workspace", () => {
  it("uses current receipt data and never infers readiness from obsolete marks", async () => {
    mount();
    expect(await screen.findByRole("article", { name: "Contracting records for Ann Lee" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Ethos Received/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Chubb/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/all four|of 4 confirmed|Combine|AFLAC|GTO/)).not.toBeInTheDocument();
    expect(screen.getByText("Details incomplete")).toBeInTheDocument();
    expect(backend.current!.calls("team_carrier_contract_status").map((call) => call.args)).toEqual([{ p_agent_id: "ann" }]);
  });
  it("loads receipts for a selected agent only and follows a valid deep link", async () => {
    mount("/dashboard/team?view=contracting&review=bo");
    expect(await screen.findByRole("article", { name: "Contracting records for Bo Chen" })).toBeInTheDocument();
    expect(backend.current!.calls("team_carrier_contract_status").map((call) => call.args)).toEqual([{ p_agent_id: "bo" }]);
    fireEvent.change(screen.getByLabelText("Choose contracting agent"), { target: { value: "ann" } });
    expect(await screen.findByRole("article", { name: "Contracting records for Ann Lee" })).toBeInTheDocument();
  });
  it("does not silently open a different person when the deep link is outside the authorized roster", async () => {
    mount("/dashboard/team?view=contracting&review=missing");
    expect(await screen.findByText(/linked agent is not in this authorized roster/)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(backend.current!.calls("team_carrier_contract_status")).toHaveLength(0);
  });
  it("preserves profile/placement editing and original history without showing old carrier circles in the editor", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Profile and placement level" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Placement level percent")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("NPN number")).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Carriers" })).not.toBeInTheDocument();
    expect(await within(dialog).findByText("aflac confirmed")).toBeInTheDocument();
  });
  it("retains manager historical access through the existing My Team route", async () => {
    auth.isAdmin = false; auth.isManager = true;
    mount();
    expect(await screen.findByRole("link", { name: "Historical carrier review" })).toHaveAttribute("href", "/dashboard/team?view=contracting&reviewMode=legacy");
  });
  it("does not render a false empty status when the roster fails", async () => {
    backend.current!.state.rosterError = "Unavailable";
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("No receipt status is inferred");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(backend.current!.calls("team_carrier_contract_status")).toHaveLength(0);
  });
  it("uses incomplete profile data for the home prompt, not old circle counts", async () => {
    mount(undefined, true);
    expect(await screen.findByText(/2 agents have incomplete contracting profile details/)).toBeInTheDocument();
    expect(screen.queryByText(/carrier circle/)).not.toBeInTheDocument();
  });
  it("shows no incomplete-profile prompt for complete profiles even if old circles are empty", async () => {
    backend.current = fakeBackend([agent({ profile: emptyProfile({ complete: true }) })]);
    mount(undefined, true);
    await waitFor(() => expect(backend.current!.calls("contract_review_roster")).toHaveLength(1));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
