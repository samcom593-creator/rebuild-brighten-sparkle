import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealCoverageReview } from "@/lib/dealCoverageReview";

const state = vi.hoisted(() => ({
  user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as { id: string } | null,
  loading: false,
  preview: false,
  rpc: vi.fn(),
  announce: vi.fn(),
  invalidate: vi.fn(),
  removeQueued: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user, isLoading: state.loading, isAdmin: true }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/lib/looseSupabase", () => ({ looseSupabase: { rpc: state.rpc } }));
vi.mock("@/lib/dealCelebrations", async (original) => ({ ...await original<typeof import("@/lib/dealCelebrations")>(), announcePostedDealReceipt: state.announce }));
vi.mock("@/lib/invalidateOperationalTruth", () => ({ invalidateOperationalTruth: state.invalidate }));
vi.mock("@/lib/offlineQueue", () => ({ removeQueuedDealAfterReceipt: state.removeQueued }));
vi.mock("sonner", () => ({ toast: { success: state.success, info: state.info, error: state.error } }));
import { DealCoverageReviewQueue } from "@/components/deals/DealCoverageReviewQueue";
import { setDemoMode } from "@/lib/demoMode";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const manager = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reviewId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const draftId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const dealId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const idempotencyKey = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const instant = "2026-11-27T04:00:00Z";
const reason = "Reviewed the current policy and documented a separate coverage need.";
let row: DealCoverageReview;
const queue = () => ({ viewer_user_id: state.user?.id, as_of: instant, has_more: false, reviews: [row] });
const clients: QueryClient[] = [];
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  return render(<MemoryRouter><QueryClientProvider client={client}><DealCoverageReviewQueue /></QueryClientProvider></MemoryRouter>);
};
const loaded = () => screen.findByRole("article", { name: "Coverage review for Synthetic Client" });

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: owner };
  state.loading = state.preview = false;
  setDemoMode(false);
  row = {
    id: reviewId, draft_id: draftId, owner_user_id: owner, idempotency_key: idempotencyKey,
    agent_id: owner, agent_name: "Synthetic Producer", manager_name: "Synthetic Manager",
    status: "pending", version: 3, client_name: "Synthetic Client", carrier_name: "Example Carrier",
    product: "Term", policy_number: "SYNTHETIC-NEW", application_date: "2026-11-26", annual_premium: 1200,
    match_count: 2, match_signals: ["name_dob"], created_at: instant, updated_at: instant,
    reviewed_at: null, decision_reason: null, payload_current: true, can_decide: false, can_resume: false,
    requires_admin: false, deal_id: null,
    matched_policies: [{ deal_id: dealId, policy_number: "SYNTHETIC-EXISTING", client_name: "Synthetic Client", carrier_name: "Example Carrier", product: "Whole life", status: "in_force", agent_name: "Synthetic Producer" }],
  };
  state.rpc.mockImplementation(async (fn: string) => {
    if (fn === "deal_coverage_review_queue") return { data: queue(), error: null };
    throw new Error(`Unexpected mutation: ${fn}`);
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); setDemoMode(false); });

describe("coverage review queue", () => {
  it("keeps requester holds out of production and follows server capabilities, even for an admin login", async () => {
    mount();
    await loaded();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText(/Pending and rejected requests do not add production/)).toBeInTheDocument();
    expect(screen.getByText(/Some matching policy details are outside your access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve coverage review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post approved deal" })).not.toBeInTheDocument();
    expect(state.rpc.mock.calls.every(([fn]) => fn === "deal_coverage_review_queue")).toBe(true);
    expect(state.announce).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.removeQueued).not.toHaveBeenCalled();
  });

  it("requires a rationale and records the exact version without posting on approval", async () => {
    state.user = { id: manager };
    row.can_decide = true;
    state.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "deal_coverage_review_queue") return { data: queue(), error: null };
      if (fn === "decide_deal_coverage_review") {
        row = { ...row, status: "approved", version: 4, can_decide: false, decision_reason: String(args.p_reason), reviewed_at: instant };
        return { data: { ok: true, reviewId, status: "approved", version: 4 }, error: null };
      }
      throw new Error("Approval must not post a deal");
    });
    mount();
    await loaded();
    const approve = screen.getByRole("button", { name: "Approve coverage review" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "short" } });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: `  ${reason}  ` } });
    fireEvent.click(approve);
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("decide_deal_coverage_review", {
      p_review_id: reviewId, p_decision: "approved", p_reason: reason, p_expected_version: 3,
    }));
    expect(await screen.findByText("Approved to resume")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([fn]) => fn === "resume_deal_coverage_review")).toBe(false);
    expect(state.announce).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
  });

  it("re-reads a version conflict and cannot retry a changed request automatically", async () => {
    state.user = { id: manager };
    row.can_decide = true;
    state.rpc.mockImplementation(async (fn: string) => {
      if (fn === "deal_coverage_review_queue") return { data: queue(), error: null };
      if (fn === "decide_deal_coverage_review") {
        row = { ...row, version: 4, can_decide: false, payload_current: false };
        return { data: null, error: { code: "40001", message: "This request changed. Refresh it." } };
      }
      throw new Error("Unexpected mutation");
    });
    mount();
    await loaded();
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: reason } });
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    expect(await screen.findByText(/The saved draft changed after this review/)).toBeInTheDocument();
    expect(state.rpc.mock.calls.filter(([fn]) => fn === "decide_deal_coverage_review")).toHaveLength(1);
    expect(state.rpc.mock.calls.filter(([fn]) => fn === "deal_coverage_review_queue").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Approve coverage review" })).not.toBeInTheDocument();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("requires an explicit requester posting confirmation and a durable receipt", async () => {
    row = { ...row, status: "approved", can_resume: true, decision_reason: reason, reviewed_at: instant };
    state.rpc.mockImplementation(async (fn: string) => {
      if (fn === "deal_coverage_review_queue") return { data: queue(), error: null };
      if (fn === "resume_deal_coverage_review") {
        row = { ...row, status: "submitted", can_resume: false, version: 4, deal_id: dealId };
        return { data: { dealId, status: "submitted", replayed: false }, error: null };
      }
      throw new Error("Unexpected mutation");
    });
    mount();
    await loaded();
    expect(state.rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Post approved deal" }));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirm posting" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("resume_deal_coverage_review", { p_review_id: reviewId, p_expected_version: 3 }));
    expect(await screen.findByRole("link", { name: "Open posted deal" })).toHaveAttribute("href", `/dashboard/production?deal=${dealId}`);
    expect(state.announce).toHaveBeenCalledExactlyOnceWith(owner, { dealId, status: "submitted", replayed: false });
    expect(state.invalidate).toHaveBeenCalledTimes(1);
    expect(state.removeQueued).toHaveBeenCalledExactlyOnceWith(owner, idempotencyKey);
  });

  it("keeps a re-held resume out of production and reports the new required review", async () => {
    row = { ...row, status: "approved", can_resume: true };
    state.rpc.mockImplementation(async (fn: string) => {
      if (fn === "deal_coverage_review_queue") return { data: queue(), error: null };
      if (fn === "resume_deal_coverage_review") {
        row = { ...row, status: "pending", can_resume: false, version: 4 };
        return { data: { ok: false, status: "review_required", reviewId, reviewVersion: 4, matchCount: 3 }, error: null };
      }
      throw new Error("Unexpected mutation");
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Post approved deal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm posting" }));
    expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
    expect(state.info).toHaveBeenCalledWith("Coverage changed and needs another review. Nothing was posted.");
    expect(state.announce).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.removeQueued).not.toHaveBeenCalled();
  });

  it.each([
    { dealId: "not-a-durable-id", status: "submitted" },
    { dealId, status: "draft" },
    { ok: false, dealId, status: "submitted" },
    { dealId, status: ["submitted"] },
    { ok: true },
  ])("does not report an invalid posting receipt as success: %j", async (receipt) => {
    row = { ...row, status: "approved", can_resume: true };
    state.rpc.mockImplementation(async (fn: string) => fn === "deal_coverage_review_queue"
      ? { data: queue(), error: null } : { data: receipt, error: null });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Post approved deal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm posting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Posting was not confirmed");
    expect(state.announce).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.removeQueued).not.toHaveBeenCalled();
  });

  it("refuses a queue response from another account", async () => {
    state.rpc.mockResolvedValue({ data: { ...queue(), viewer_user_id: manager }, error: null });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("did not match this account");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Client")).not.toBeInTheDocument();
  });

  it("withholds stale decision controls after a failed refresh", async () => {
    state.user = { id: manager };
    row.can_decide = true;
    mount();
    await loaded();
    state.rpc.mockResolvedValue({ data: null, error: { message: "Read unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh reviews" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Read unavailable");
    expect(screen.queryByRole("button", { name: "Approve coverage review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("does not read or expose the review queue during role preview, demo or sign-out", async () => {
    state.preview = true;
    const view = mount();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Coverage review queue")).not.toBeInTheDocument();
    act(() => { setDemoMode(true); state.preview = false; });
    view.rerender(<MemoryRouter><QueryClientProvider client={clients[0]}><DealCoverageReviewQueue /></QueryClientProvider></MemoryRouter>);
    expect(state.rpc).not.toHaveBeenCalled();
    state.user = null;
    act(() => setDemoMode(false));
    view.rerender(<MemoryRouter><QueryClientProvider client={clients[0]}><DealCoverageReviewQueue /></QueryClientProvider></MemoryRouter>);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Coverage review queue")).not.toBeInTheDocument();
  });
});
