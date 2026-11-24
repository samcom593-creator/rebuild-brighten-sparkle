import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), downlines: vi.fn(), rpc: vi.fn(), auth: { user: { id: "owner-one" } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/components/ui/email-typo-hint", () => ({ EmailTypoHint: () => null }));
vi.mock("@/lib/contractingDownlines", async (original) => ({
  ...await original<typeof import("@/lib/contractingDownlines")>(),
  contractingDownlines: { actor: mocks.actor, downlines: mocks.downlines },
}));
import ContractingDownlines from "@/pages/ContractingDownlines";

beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.user.id = "owner-one";
  mocks.actor.mockImplementation(async () => ({ data: { ok: true, is_manager: true, is_admin: false, ref_slug: mocks.auth.user.id, default_pct: 60, writes_enabled: false }, error: null }));
  mocks.downlines.mockResolvedValue({ data: { ok: true, rows: [{ agent_id: "agent-1", display_name: "Fixture Producer", email: "fixture@example.com", npn: "1234567", agent_status: "active", on_sheet: true, ethos_state: "delivered", comp_pct: 60 }] }, error: null });
  mocks.rpc.mockImplementation(async () => ({ data: { active: true, ref_slug: mocks.auth.user.id, link: "https://old-preview.invalid/apply" }, error: null }));
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = () => <QueryClientProvider client={client}><MemoryRouter><ContractingDownlines /></MemoryRouter></QueryClientProvider>;
  const view = render(app());
  return { client, rerender: () => view.rerender(app()) };
}
describe("Grow my team workflow", () => {
  it("copies public links with the current owner's attribution and connects applicants to carrier review", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    expect(await screen.findByLabelText("Your recruiting link")).toHaveValue("https://galaxyfinancial.org/r/owner-one");
    expect(screen.getByLabelText("Your contracting join link")).toHaveValue("https://galaxyfinancial.org/contract/owner-one");
    expect(screen.getByRole("link", { name: "See applicants" })).toHaveAttribute("href", "/dashboard/recruiting");
    expect(await screen.findByRole("link", { name: "Review agent" })).toHaveAttribute("href", "/dashboard/team?view=contracting&review=agent-1");
    expect(screen.getByText(/Sheet receipt verified/)).toHaveTextContent("Carrier approval still needs its own confirmation");
    expect(screen.queryByRole("link", { name: "Contracts management" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy contracting join link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://galaxyfinancial.org/contract/owner-one"));
  });
  it("reloads links and the scoped contracting board when the signed-in owner changes", async () => {
    const view = mount();
    await screen.findByDisplayValue("https://galaxyfinancial.org/r/owner-one");
    mocks.auth.user.id = "owner-two";
    view.rerender();
    await screen.findByDisplayValue("https://galaxyfinancial.org/r/owner-two");
    expect(screen.getByLabelText("Your contracting join link")).toHaveValue("https://galaxyfinancial.org/contract/owner-two");
    expect(mocks.downlines).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryData(["my-recruiting-link", "owner-one"])).toEqual(expect.objectContaining({ ref_slug: "owner-one" }));
    expect(view.client.getQueryData(["my-recruiting-link", "owner-two"])).toEqual(expect.objectContaining({ ref_slug: "owner-two" }));
  });
  it("reports a failed recruiting-link read instead of saying the link does not exist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("read unavailable") });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your recruiting link did not load.");
    expect(screen.queryByText("Your recruiting link is not set up. Ask an admin.")).not.toBeInTheDocument();
  });
});
