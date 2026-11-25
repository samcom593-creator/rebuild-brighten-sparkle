import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCoachingCard } from "@/components/calltraining/AgentCoachingCard";

const table = vi.hoisted(() => ({ from: vi.fn(), limit: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null, isLoading: false }));
vi.mock("@/lib/looseSupabase", () => ({ looseSupabase: { from: table.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

const row = { agent_name: "Test agent", summary: "Keep the discovery focused on the client's goal.",
  habits: [], watch_outs: [], coaching_tips: [], strengths: [], next_call_focus: "Ask one follow-up before presenting.",
  source_count: 7, generated_at: null };
function mount(overrides: Record<string, unknown> = {}) {
  table.limit.mockResolvedValue({ data: [{ ...row, ...overrides }], error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AgentCoachingCard agentName="Test agent" /></QueryClientProvider>);
  return { ...view, update: () => view.rerender(<QueryClientProvider client={client}><AgentCoachingCard agentName="Test agent" /></QueryClientProvider>) };
}
function section(title: string) { return screen.getByText(title).parentElement!; }
beforeEach(() => {
  auth.user = { id: "user-a" }; auth.isLoading = false;
  table.from.mockReset(); table.limit.mockReset();
  const chain = { select: vi.fn(), eq: vi.fn(), limit: table.limit };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  table.from.mockReturnValue(chain);
});
afterEach(cleanup);

describe("coaching text rendering", () => {
  it("removes another account's cached coaching before checking the same agent under the new login", async () => {
    const view = mount({ coaching_tips: ["Private coaching for the first account."] });
    await screen.findByText("Private coaching for the first account.");
    auth.user = { id: "user-b" };
    table.limit.mockResolvedValue({ data: [], error: null });
    view.update();
    expect(screen.queryByText("Private coaching for the first account.")).toBeNull();
    expect(screen.queryByText(row.summary)).toBeNull();
    await screen.findByText(/No coaching summary for this agent yet/);
    expect(table.limit).toHaveBeenCalledTimes(2);
  });

  it.each(["signed-out", "checking-access"])("does not query coaching while %s", state => {
    auth.user = state === "signed-out" ? null : { id: "user-a" };
    auth.isLoading = state === "checking-access";
    mount();
    expect(table.from).not.toHaveBeenCalled();
    expect(screen.queryByText(row.summary)).toBeNull();
    expect(screen.getByText(state === "signed-out" ? "Sign in to view coaching." : "Checking coaching access…")).toBeInTheDocument();
  });

  it("preserves an entire scalar coaching value as one item, including punctuation and line breaks", async () => {
    const tip = "On every call, ask what prompted the inquiry.\nPause for the complete answer before presenting.";
    mount({ watch_outs: "Title the concern before trying to resolve it.", coaching_tips: tip });
    await screen.findByText(row.summary);
    expect(within(section("Watch out for")).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Title the concern before trying to resolve it."]);
    expect(within(section("Coaching tips")).getAllByRole("listitem").map(item => item.textContent)).toEqual([tip]);
    expect(screen.queryByText(/This coaching section is incomplete/)).toBeNull();
  });

  it("preserves complete list entries and short legitimate bullets without joining them", async () => {
    mount({ habits: ["Pause", "Listen", "Confirm"], strengths: ["A", "B"] });
    await screen.findByText(row.summary);
    expect(within(section("Habits")).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Pause", "Listen", "Confirm"]);
    expect(within(section("Keep doing")).getAllByRole("listitem").map(item => item.textContent)).toEqual(["A", "B"]);
  });

  it("marks the observed truncated character arrays incomplete without inventing their missing advice", async () => {
    mount({ watch_outs: ["T", "i", "t", "l", "e"], coaching_tips: ["O", "n", "e", "v", "e", "r"] });
    await screen.findByText(row.summary);
    for (const title of ["Watch out for", "Coaching tips"]) {
      expect(within(section(title)).queryAllByRole("listitem")).toHaveLength(0);
      expect(within(section(title)).getByRole("status")).toHaveTextContent("incomplete");
    }
    expect(screen.queryByText("Title")).toBeNull();
    expect(screen.queryByText("Onever")).toBeNull();
    expect(screen.getByText(row.next_call_focus)).toBeInTheDocument();
  });

  it("retains valid text from a mixed list and exposes incomplete entries without object coercion", async () => {
    mount({ coaching_tips: ["Ask one open question.", { advice: "Unsupported object" }, 42, null] });
    await screen.findByText(row.summary);
    const tips = within(section("Coaching tips"));
    expect(tips.getAllByRole("listitem").map(item => item.textContent)).toEqual(["Ask one open question."]);
    expect(tips.getByRole("status")).toHaveTextContent("incomplete");
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.textContent).not.toContain("Unsupported object");
  });

  it.each([{}, 42, true])("shows an incomplete state for an unsupported coaching field: %j", async coaching_tips => {
    mount({ coaching_tips });
    await screen.findByText(row.summary);
    expect(within(section("Coaching tips")).getByRole("status")).toHaveTextContent("incomplete");
  });

  it("keeps genuinely empty sections absent", async () => {
    mount({ habits: null, watch_outs: [], coaching_tips: "  ", strengths: ["", " "] });
    await screen.findByText(row.summary);
    expect(screen.queryByText("Habits")).toBeNull();
    expect(screen.queryByText("Watch out for")).toBeNull();
    expect(screen.queryByText("Coaching tips")).toBeNull();
    expect(screen.queryByText("Keep doing")).toBeNull();
    expect(screen.queryByText(/This coaching section is incomplete/)).toBeNull();
  });
});
