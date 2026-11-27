import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ContentCommand from "@/pages/admin/ContentCommand";
import ContentQueue from "@/pages/ContentQueue";
import SocialDashboard from "@/pages/SocialDashboard";
import { SocialDraftReviewDialog } from "@/components/content/SocialDraftReviewDialog";

const auth = vi.hoisted(() => ({ id: "owner" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: auth.id, email: "owner@example.invalid" }, isAdmin: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const fullDraft = { id: 1, draft_date: "2026-11-27", title: "Draft for review", hook: "Visible hook", body: "The full owner script", caption: "Owner caption", cta: "Apply", hashtags: null, platform: "tiktok", account: "actual-account", slot: null, pillar: null, file_path: null, status: "awaiting_approval", content_hash: "a".repeat(32), approved_content_hash: null, shipped_at: null, shipped_url: null, created_at: "2026-11-26T12:00:00Z", updated_at: "2026-11-26T12:00:00Z" };
const clip = { content_id: "clip-1", original_filename: "clip.mp4", current_filename: null, media_type: "video", duration_seconds: "30", brand: "Team", pillar: "Recruiting", status: "NEEDS_REVIEW", hook: "Clip hook", caption: "Complete clip caption", cta: "Apply now", priority: null, privacy_risk: null, earnings_claim_risk: null, approved_by: null, notes: "archived 2026-11-26", thumbnail_url: "https://example.com/thumb.jpg", media_path: null, updated_at: "2026-11-26T12:00:00Z" };
type Write = { table: string; operation: string; payload: unknown; filters: Record<string, unknown> };
const db = { writes: [] as Write[], receipt: true, snapshots: [] as Array<Record<string, unknown>>, reads: [] as string[] };
const rpc = vi.mocked(supabase.rpc as unknown as (name: string, args: unknown) => Promise<{ data: unknown; error: null }>);

beforeEach(() => {
  auth.id = "owner";
  db.writes = []; db.receipt = true; db.snapshots = []; db.reads = [];
  vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async name => ({ data: name === "social_draft_review" ? fullDraft : name === "approve_social_draft" ? "approved" : name === "content_queue_review_set_status" ? "APPROVED" : null, error: null }));
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    let write: Write | null = null;
    let countOnly = false;
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (write) return { data: db.receipt ? table === "content_queue" ? { content_id: "clip-1" } : { id: 1 } : null, error: null };
      db.reads.push(table);
      if (countOnly) return { data: null, count: 1, error: null };
      if (table === "social_bot_drafts") return { data: [fullDraft, { ...fullDraft, id: 2, title: "Approved draft", status: "approved" }], error: null };
      if (table === "content_queue") return { data: [clip], error: null };
      if (table === "v_social_latest") return { data: db.snapshots, error: null };
      return { data: [], error: null };
    };
    const chain = {
      select: (_columns?: string, options?: { head?: boolean }) => { countOnly = !!options?.head; return chain; },
      order: () => chain, limit: () => chain, in: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      update: (payload: unknown) => { write = { table, operation: "update", payload, filters }; db.writes.push(write); return chain; },
      insert: (payload: unknown) => { write = { table, operation: "insert", payload, filters }; db.writes.push(write); return chain; },
      maybeSingle: () => Promise.resolve(result()), single: () => Promise.resolve(result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  }) as never);
});

function mount(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);
}

describe("owner content review", () => {
  it("opens a complete version review and uses the canonical owner RPC; cannot mark shipped", async () => {
    mount(<ContentCommand />);
    await screen.findAllByText("Draft for review");
    expect(screen.queryByRole("button", { name: "Shipped" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve selected" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
    await screen.findByText("The full owner script");
    expect(db.writes).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this copy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve reviewed version" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("approve_social_draft", { p_id: 1, p_seen_hash: fullDraft.content_hash }));
    expect(db.writes).toEqual([]);
  });
  it("keeps stale owner edits open and requires a returned row", async () => {
    db.receipt = false;
    mount(<ContentCommand />);
    await screen.findAllByText("Draft for review");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByPlaceholderText("Body/script"), { target: { value: "My edited script" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(db.writes[0].filters).toEqual({ id: 1, content_hash: fullDraft.content_hash, status: fullDraft.status });
    expect(screen.getByDisplayValue("My edited script")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("clears a previous account's review error when the signed-in account changes", async () => {
    rpc.mockImplementation(async name => ({ data: name === "social_draft_review" ? fullDraft : name === "approve_social_draft" ? "changed" : null, error: null }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const view = render(<SocialDraftReviewDialog draftId={1} ownerOnly onClose={onClose} />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await screen.findByText("The full owner script");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this copy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve reviewed version" }));
    await screen.findByRole("alert");
    auth.id = "another-reviewer";
    view.rerender(<SocialDraftReviewDialog draftId={1} ownerOnly onClose={onClose} />);
    await screen.findByText("The full owner script");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /I reviewed this copy/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this copy/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve reviewed version" })).toBeEnabled());
  });
  it("ignores a late approval receipt after the account changes without closing the new review", async () => {
    let settle: (value: { data: unknown; error: null }) => void = () => {};
    rpc.mockImplementation(name => name === "approve_social_draft" ? new Promise(resolve => { settle = resolve; }) : Promise.resolve({ data: name === "social_draft_review" ? fullDraft : null, error: null }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn(), onApproved = vi.fn();
    const view = render(<SocialDraftReviewDialog draftId={1} ownerOnly onClose={onClose} onApproved={onApproved} />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await screen.findByText("The full owner script");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this copy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve reviewed version" }));
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    auth.id = "another-reviewer";
    view.rerender(<SocialDraftReviewDialog draftId={1} ownerOnly onClose={onClose} onApproved={onApproved} />);
    await screen.findByRole("button", { name: "Approve reviewed version" });
    await act(async () => { settle({ data: "approved", error: null }); });
    expect(onClose).not.toHaveBeenCalled(); expect(onApproved).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("clip queue review", () => {
  it("never infers published metrics from archive notes and cannot play a thumbnail", async () => {
    mount(<ContentQueue />);
    await screen.findByText("Clip hook");
    expect(screen.queryByText(/Yesterday.*posted|streak|last 7 days.*\//)).toBeNull();
    expect(screen.getByRole("button", { name: "No clip yet" })).toBeDisabled();
    expect(screen.getByText(/No clips assigned to today’s slate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("content_queue_review_set_status", { p_content_id: clip.content_id, p_seen_updated_at: clip.updated_at, p_status: "APPROVED" }));
    expect(db.writes).toEqual([]);
  });
  it("saves edits against the viewed version and preserves the form on a no-row conflict", async () => {
    db.receipt = false;
    mount(<ContentQueue />);
    await screen.findByText("Clip hook");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Caption"), { target: { value: "Edited caption" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This clip changed. Refresh the queue before saving."));
    expect(db.writes[0].filters).toEqual({ content_id: clip.content_id, updated_at: clip.updated_at });
    expect(screen.getByDisplayValue("Edited caption")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("social account observations", () => {
  it("shows actual account identity, observation age and reported window", async () => {
    db.snapshots = [{ platform: "instagram", handle: "real_account", source: "manual", taken_at: "2026-11-01T12:00:00Z", followers: 123, views_7d: 456, reach_7d: 300, payload: { window_days: 30 } }];
    mount(<SocialDashboard />);
    expect(await screen.findByRole("link", { name: "@real_account" })).toHaveAttribute("href", "https://www.instagram.com/real_account/");
    expect(screen.getByText(/Manual entry.*Nov 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Views · 30d")).toBeInTheDocument();
    expect(screen.getByText("Reach · 30d")).toBeInTheDocument();
    expect(screen.queryByText(/auto-sync every/)).toBeNull();
  });
  it("validates observation numbers and confirms the inserted row before reporting saved", async () => {
    mount(<SocialDashboard />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add manual observation" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Instagram account handle" }), { target: { value: "actual_account" } });
    fireEvent.change(screen.getByLabelText("Followers"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(db.writes).toEqual([]);
    vi.mocked(toast.error).mockClear();
    db.receipt = false;
    fireEvent.change(screen.getByLabelText("Followers"), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The observation was not confirmed. Refresh before retrying."));
    expect(toast.success).not.toHaveBeenCalled();
    db.receipt = true;
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Instagram observation saved"));
    expect(db.writes.at(-1)?.payload).toMatchObject({ platform: "instagram", handle: "actual_account", followers: 125, source: "manual", payload: { window_days: 7 } });
    expect(db.reads.filter(table => table === "v_social_latest").length).toBeGreaterThan(1);
  });
});
