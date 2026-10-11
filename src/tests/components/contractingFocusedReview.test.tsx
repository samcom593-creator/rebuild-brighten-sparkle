import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agent, emptyProfile, fakeBackend } from "../helpers/reviewFixtures";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const backend = vi.hoisted(() => ({ current: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a?: Record<string, unknown>) => backend.current!.rpc(n, a) } }));

import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";

let fb: ReturnType<typeof fakeBackend>;
const mount = (agents = [agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen", marked: ["aflac"] })]) => {
  fb = fakeBackend(agents);
  backend.current = fb;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ContractingReviewWorkspace /></MemoryRouter></QueryClientProvider>);
};
const circle = (name: RegExp) => screen.getByRole("button", { name });
const circlesFor = (rowName: string) => within(screen.getByText(rowName).closest("li") as HTMLElement);

beforeEach(() => {
  Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false });
  Object.values(toast).forEach((f) => f.mockClear());
});

describe("focused contracting review", () => {
  const panel = (name = "Ann Lee") => within(screen.getByRole("article", { name: `Review ${name}` }));
  it("opens on four readable carrier cards and keeps completed people selected until Next", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee", marked: ["combine", "aflac", "gto"] }), agent({ id: "bo", display_name: "Bo Chen" })]);
    await screen.findByRole("article", { name: "Review Ann Lee" });
    expect(panel().getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Combine carrier", "AFLAC carrier", "GTO carrier", "Ethos carrier", "Agent placement level"]);
    fireEvent.click(panel().getByRole("button", { name: /^Ethos:/ }));
    await waitFor(() => expect(panel().getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4"));
    await waitFor(() => expect(panel().getByRole("button", { name: "Next agent" })).toBeEnabled());
    expect(screen.getByRole("article", { name: "Review Ann Lee" })).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Next agent" }));
    expect(await screen.findByRole("article", { name: "Review Bo Chen" })).toBeInTheDocument();
  });
  it("keeps an unsaved level while switching controls are locked, and saves before Next", async () => {
    mount(); await screen.findByRole("article", { name: "Review Ann Lee" });
    fireEvent.change(panel().getByLabelText("Level (%)"), { target: { value: "85" } });
    expect(screen.getByLabelText("Search agents")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Bo Chen/ })).toBeDisabled();
    fireEvent.click(panel().getByRole("button", { name: "Save level & next" }));
    expect(await screen.findByRole("article", { name: "Review Bo Chen" })).toBeInTheDocument();
    expect(fb.state.agents.find((a) => a.agent_id === "ann")?.level?.pct).toBe(85);
  });
  it("does not advance on a rejected level save or lose the typed value", async () => {
    mount(); await screen.findByRole("article", { name: "Review Ann Lee" });
    fb.state.failNext = { name: "set_review_placement_level" };
    fireEvent.change(panel().getByLabelText("Level (%)"), { target: { value: "90" } });
    fireEvent.click(panel().getByRole("button", { name: "Save level & next" }));
    expect(await panel().findByRole("alert")).toBeInTheDocument();
    expect(panel().getByLabelText("Level (%)")).toHaveValue("90");
    fireEvent.click(panel().getByRole("button", { name: "Discard edit" }));
    expect(screen.getByLabelText("Search agents")).toBeEnabled();
  });
  it("holds navigation during a circle save and restores the mark on a thrown network error", async () => {
    mount(); await screen.findByRole("article", { name: "Review Ann Lee" });
    const original = fb.rpc;
    let reject!: (error: Error) => void;
    backend.current = { rpc: (name, args) => name === "set_contract_review_mark" ? new Promise((_, no) => { reject = no; }) : original(name, args) };
    fireEvent.click(panel().getByRole("button", { name: /^Combine:/ }));
    expect(panel().getByRole("button", { name: "Next agent" })).toBeDisabled();
    await act(async () => { reject(new Error("offline")); });
    await waitFor(() => expect(panel().getByRole("button", { name: /^Combine:/ })).toHaveAttribute("aria-pressed", "false"));
    expect(toast.error).toHaveBeenCalled();
  });
  it("does not change a carrier when opening its portal", async () => {
    mount(); await screen.findByRole("article", { name: "Review Ann Lee" });
    const link = within(panel().getByRole("region", { name: "AFLAC carrier" })).getByRole("link", { name: "Open portal" });
    expect(link).toHaveAttribute("href", "https://login.aflac.com/");
    fireEvent.click(link);
    expect(fb.calls("set_contract_review_mark")).toHaveLength(0);
  });
  it("scopes counts to the chosen team", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee", manager_id: "m1", manager_name: "One" }), agent({ id: "bo", display_name: "Bo Chen", manager_id: "m2", manager_name: "Two", marked: ["aflac"] })]);
    await screen.findByRole("article", { name: "Review Ann Lee" });
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "m2" } });
    expect(screen.getByRole("button", { name: /Needs review/ })).toHaveTextContent("1");
    expect(screen.getByRole("article", { name: "Review Bo Chen" })).toBeInTheDocument();
  });
  it("protects unsaved profile edits when the details panel is closed", async () => {
    mount(); await screen.findByRole("article", { name: "Review Ann Lee" });
    fireEvent.click(panel().getByRole("button", { name: "Profile & history" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("First name"), { target: { value: "Annie" } });
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("unsaved edits");
    fireEvent.click(dialog.getByRole("button", { name: "Keep editing" }));
    expect(dialog.getByLabelText("First name")).toHaveValue("Annie");
  });
});

describe("focused contracting review: following a link while already open", () => {
  it("switches to the person named by ?review= when the URL changes after mount (a drawer's 'Open in review' on My Team)", async () => {
    let go: ((to: string) => void) | null = null;
    const Nav = () => { go = useNavigate(); return null; };
    fb = fakeBackend([agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen", marked: ["aflac"] })]);
    backend.current = fb;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/team?view=contracting"]}><Nav /><ContractingReviewWorkspace /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("article", { name: "Review Ann Lee" });
    act(() => { go?.("/team?view=contracting&review=bo"); });
    await screen.findByRole("article", { name: "Review Bo Chen" });
    expect(screen.queryByRole("article", { name: "Review Ann Lee" })).toBeNull();
  });
});
