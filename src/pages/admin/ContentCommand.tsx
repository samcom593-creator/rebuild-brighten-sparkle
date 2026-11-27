import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  Clipboard,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Filter,
  Instagram,
  Music2,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  XCircle,
  Youtube,
  Camera,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { ContentWorkspaceNav } from "@/components/content/ContentWorkspaceNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SocialDraftReviewDialog } from "@/components/content/SocialDraftReviewDialog";
import { safeContentUrl } from "@/lib/socialDraftReview";

type DraftStatus = "pending" | "awaiting_approval" | "awaiting_film" | "approved" | "shipped" | "rejected" | string;

type Draft = {
  id: number;
  draft_date: string | null;
  platform: string | null;
  account: string | null;
  content_hash: string;
  slot: string | null;
  pillar: string | null;
  title: string | null;
  hook: string | null;
  body: string | null;
  cta: string | null;
  caption: string | null;
  hashtags: string | null;
  sound: string | null;
  duration_sec: number | null;
  file_path: string | null;
  status: DraftStatus;
  approved_at: string | null;
  shipped_at: string | null;
  shipped_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

type RunRow = {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  mode: string | null;
  entries: number | null;
};

type InboundRow = {
  id: number;
  ts: string;
  platform: string;
  handle: string | null;
  intent: string | null;
  status: string;
  tier: string | null;
  conversion_value_usd: number | null;
};

// awaiting_film is a real status in the table (drafts written but not yet filmed).
// It was missing from this list, which made those rows invisible on every surface of
// this page — not filtered out, just never fetched.
const ACTIVE_STATUSES = ["pending", "awaiting_approval", "awaiting_film", "approved"];

// Sits above the live active-draft count (559 awaiting_approval + 1 approved as of
// 2026-07-28) so a normal day is never truncated. If the queue ever grows past this the
// page says so out loud instead of quietly showing a subset — silent truncation on a
// review queue reads as "that's all of them", which is how 387 drafts stayed invisible.
const DRAFT_FETCH_LIMIT = 1000;

function platformIcon(platform?: string | null) {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("youtube")) return Youtube;
  if (p.includes("tiktok")) return Music2;
  if (p.includes("instagram") || p === "ig") return Instagram;
  if (p.includes("snap")) return Camera;
  return FileText;
}

function platformTone(platform?: string | null) {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("youtube")) return "text-red-300 border-red-500/30";
  if (p.includes("tiktok")) return "text-info border-info/30";
  if (p.includes("instagram") || p === "ig") return "text-pink-300 border-pink-500/30";
  if (p.includes("snap")) return "text-yellow-200 border-yellow-500/30";
  return "text-slate-600 dark:text-slate-300 border-slate-500/30";
}

function statusTone(status: DraftStatus) {
  if (status === "shipped") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "approved") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (status === "rejected") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  if (status === "awaiting_approval") return "bg-slate-500/15 text-info border-info/30";
  if (status === "awaiting_film") return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  return "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30";
}


function draftCopy(d: Draft) {
  return [
    d.hook ? `Hook: ${d.hook}` : null,
    d.body ? `Body:\n${d.body}` : null,
    d.caption ? `Caption:\n${d.caption}` : null,
    d.cta ? `CTA: ${d.cta}` : null,
    d.hashtags ? `Hashtags: ${d.hashtags}` : null,
  ].filter(Boolean).join("\n\n");
}

function scoreDraft(d: Draft) {
  const due = d.draft_date ? new Date(`${d.draft_date}T12:00:00`).getTime() : Date.now() + 99_999_999;
  const daysUntil = Math.round((due - Date.now()) / 86_400_000);
  const status = d.status === "awaiting_approval" ? 50 : d.status === "pending" ? 40 : d.status === "approved" ? 30 : 0;
  const dueScore = daysUntil <= 0 ? 50 : daysUntil <= 3 ? 25 : daysUntil <= 7 ? 10 : 0;
  const platform = (d.platform ?? "").toLowerCase().includes("tiktok") ? 8 : (d.platform ?? "").toLowerCase().includes("youtube") ? 6 : 3;
  return status + dueScore + platform;
}

async function copyText(text: string, label: string) {
  await navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
}

type CultureEvent = {
  id: number;
  deal_id: string;
  created_at: string;
  annual_premium: number | null;
  product_sold: string | null;
  agent_name: string | null;
  draft_id: number | null;
  draft_status: string | null;
  draft_hook: string | null;
};

function CultureFeed({ onApproveDraft }: { onApproveDraft: (id: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["culture_feed"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_culture_feed")
        .select("id, deal_id, created_at, annual_premium, product_sold, agent_name, draft_id, draft_status, draft_hook")
        .limit(8);
      if (error) return [];
      return (data ?? []) as CultureEvent[];
    },
    staleTime: 30_000,
    refetchInterval: 300_000,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data || data.length === 0) return null;

  const pending = data.filter((e) => e.draft_status === "awaiting_approval");

  return (
    <Card className="border-border bg-white/[0.02]">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          Deal Win Feed
          {pending.length > 0 && (
            <Badge variant="outline" className="text-[11px] text-amber-300 border-amber-500/30 bg-amber-500/10 ml-1">
              {pending.length} draft{pending.length > 1 ? "s" : ""} awaiting approval
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.map((ev) => (
            <div
              key={ev.id}
              className="rounded-md border border-border bg-white/[0.02] p-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{ev.agent_name ?? "—"}</span>
                <span className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                <span className="text-sm font-bold text-emerald-300">
                  ${Number(ev.annual_premium ?? 0).toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{ev.product_sold ?? "Life"}</span>
              </div>
              {ev.draft_hook && (
                <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{ev.draft_hook}</p>
              )}
              {ev.draft_id && ev.draft_status === "awaiting_approval" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 mt-0.5"
                  onClick={() => onApproveDraft(ev.draft_id!)}
                >
                  Review draft
                </Button>
              ) : ev.draft_status === "approved" ? (
                <Badge variant="outline" className="text-[11px] text-amber-300 border-amber-500/30 w-fit">approved</Badge>
              ) : ev.draft_status === "shipped" ? (
                <Badge variant="outline" className="text-[11px] text-muted-foreground border-slate-600 w-fit">shipped</Badge>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ContentCommand() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("active");
  const [platformFilter, setPlatformFilter] = useState("all");
  // Render window — the draft list can be 1,000+ (~152,000px DOM wall).
  const [visibleCount, setVisibleCount] = useState(60);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHook, setEditHook] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editBody, setEditBody] = useState("");

  const { data: drafts, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["content_command_drafts", statusFilter],
    refetchInterval: 300_000,
    queryFn: async () => {
      // 2026-07-28: this query used to be `.order(draft_date ASC).limit(200)` against 587
      // rows, which returned the OLDEST 200 — draft_date 2025-12-10 through 2026-06-04 —
      // and hid 387 drafts, ALL of them awaiting_approval, including everything written
      // from 2026-06-05 to today. The page whose entire job is "what should Sam post today"
      // was showing him last December and hiding today.
      //
      // 2026-07-30: the fetch then hard-coded `.in(status, ACTIVE_STATUSES)` while the
      // dropdown still offered Rejected / Shipped / All statuses — three filter options
      // that could never return a row because the server never sent one. The filter now
      // drives the fetch: a specific status fetches that status, "Active only" fetches
      // the active set, "All statuses" drops the status clause entirely. Limit sits above
      // the current active count (~560) so nothing is silently cut; if any fetch fills the
      // window, the UI reports the overflow rather than quietly truncating (banner below).
      let query = (supabase as any)
        .from("social_bot_drafts").select("id, draft_date, platform, account, slot, pillar, title, hook, body, cta, caption, hashtags, file_path, status, created_at, content_hash, shipped_at, shipped_url, updated_at");
      if (statusFilter === "active") query = query.in("status", ACTIVE_STATUSES);
      else if (statusFilter !== "all") query = query.eq("status", statusFilter);
      const { data, error } = await query
        .order("draft_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(DRAFT_FETCH_LIMIT);
      if (error) throw error;
      return (data ?? []) as Draft[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["content_command_runs"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_bot_runs")
        .select("id, started_at, ended_at, status, mode, entries")
        .order("started_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data ?? []) as RunRow[];
    },
  });

  const { data: inbound } = useQuery({
    queryKey: ["content_command_inbound"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_bot_inbound")
        .select("id, ts, platform, handle, intent, status, tier, conversion_value_usd")
        .order("ts", { ascending: false })
        .limit(6);
      if (error) return [];
      return (data ?? []) as InboundRow[];
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (draft: Draft) => {
      const { data, error } = await (supabase as any).from("social_bot_drafts")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", draft.id).eq("content_hash", draft.content_hash).eq("status", draft.status)
        .select("id").maybeSingle();
      if (error) throw error;
      if (data?.id !== draft.id) throw new Error("This draft changed or is no longer available. Refresh before retrying.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content_command_drafts"] });
      void qc.invalidateQueries({ queryKey: ["content_command_status_counts"] });
      toast.success("Draft rejected");
    },
    onError: (e) => toast.error(`Draft update failed: ${String(e)}`),
  });

  const saveMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!editing || editing.id !== id) throw new Error("Open the draft again before saving.");
      const { data, error } = await (supabase as any)
        .from("social_bot_drafts")
        .update({
          title: editTitle,
          hook: editHook,
          caption: editCaption,
          body: editBody,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id).eq("content_hash", editing.content_hash).eq("status", editing.status)
        .select("id").maybeSingle();
      if (error) throw error;
      if (data?.id !== id) throw new Error("This draft changed. Reopen it before saving edits.");
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["content_command_drafts"] });
      toast.success("Draft edits saved");
    },
    onError: (e) => toast.error(`Save failed: ${String(e)}`),
  });

  const filtered = useMemo(() => {
    const rows = drafts ?? [];
    return rows.filter((d) => {
      if (statusFilter === "active" && !ACTIVE_STATUSES.includes(d.status)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && d.status !== statusFilter) return false;
      if (platformFilter !== "all" && (d.platform ?? "").toLowerCase() !== platformFilter) return false;
      return true;
    });
  }, [drafts, platformFilter, statusFilter]);

  // Reset the render window when the filter changes.
  useEffect(() => {
    setVisibleCount(60);
  }, [platformFilter, statusFilter]);

  const ranked = useMemo(
    () => (drafts ?? [])
      .filter((d) => ACTIVE_STATUSES.includes(d.status))
      .sort((a, b) => scoreDraft(b) - scoreDraft(a))
      .slice(0, 5),
    [drafts],
  );

  const platforms = useMemo(
    () => Array.from(new Set((drafts ?? []).map((d) => (d.platform ?? "unknown").toLowerCase()))).sort(),
    [drafts],
  );

  // The draft list is now filtered to ACTIVE_STATUSES server-side, so `shipped` rows are
  // never in `drafts` — counting them from that array would peg the Shipped tile at 0
  // forever. These counts come straight from the table with head:true (no rows fetched),
  // so every tile stays true regardless of what the list window holds.
  const { data: statusCounts } = useQuery({
    queryKey: ["content_command_status_counts"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const count = async (status: string) => {
        const { count: c, error } = await (supabase as any)
          .from("social_bot_drafts")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        if (error) throw error;
        if (typeof c !== "number") throw new Error("Draft counts could not be verified.");
        return c;
      };
      const [awaiting, approved, pending, awaitingFilm] = await Promise.all([
        count("awaiting_approval"),
        count("approved"),
        count("pending"),
        count("awaiting_film"),
      ]);
      return { awaiting, approved, pending, awaitingFilm };
    },
  });

  const totals = {
    active: statusCounts ? statusCounts.awaiting + statusCounts.approved + statusCounts.pending + statusCounts.awaitingFilm : null,
    awaiting: statusCounts?.awaiting ?? null,
    awaitingFilm: statusCounts?.awaitingFilm ?? null,
    approved: statusCounts?.approved ?? null,
  };

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const rejectSelected = async () => {
    const selected = filtered.filter(d => selectedIds.has(d.id) && d.status !== "shipped" && d.status !== "rejected");
    if (!selected.length || bulkBusy) return;
    setBulkBusy(true);
    let done = 0;
    try {
      for (const draft of selected) {
        await statusMutation.mutateAsync(draft);
        done += 1;
        setSelectedIds(previous => { const next = new Set(previous); next.delete(draft.id); return next; });
      }
      toast.success(`${done} drafts rejected`);
    } catch (error) {
      toast.error(`Stopped after ${done} of ${selected.length}: ${error instanceof Error ? error.message : "Change not confirmed"}`);
    } finally { setBulkBusy(false); }
  };

  const openEditor = (d: Draft) => {
    setEditing(d);
    setEditTitle(d.title ?? "");
    setEditHook(d.hook ?? "");
    setEditCaption(d.caption ?? "");
    setEditBody(d.body ?? "");
  };

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1500px] mx-auto space-y-5 ops-surface ops-fade-in">
      <PageHeader
        accent="amber"
        eyebrow="Admin · Content"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Content Command"
        subtitle="Review the complete draft and its destination, approve that version, and track the recorded publishing outcome."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-4 w-4 mr-2", isRefetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      <ContentWorkspaceNav />

      <CultureFeed onApproveDraft={setReviewId} />
      {isError && <p role="alert" className="text-sm text-destructive">Drafts could not be loaded. Refresh to try again.</p>}

      {/* Silent truncation on a review queue reads as "that is all of them". It is exactly
          how 387 drafts stayed invisible behind an ascending .limit(200). If the queue ever
          fills the window, say so. */}
      {(drafts?.length ?? 0) >= DRAFT_FETCH_LIMIT && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold">Showing the newest {DRAFT_FETCH_LIMIT.toLocaleString()} drafts</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The queue has reached the fetch window, so older drafts are not on this page.
            This list is a subset, not the whole backlog.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Active drafts" value={totals.active} tone="text-info" />
        <Metric label="Needs approval" value={totals.awaiting} tone="text-amber-300" />
        <Metric label="Awaiting film" value={totals.awaitingFilm} tone="text-violet-300" />
        <Metric label="Approved" value={totals.approved} tone="text-emerald-300" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="space-y-4">
          <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-background to-background">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-amber-300" /> Review next
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? <Skeleton className="h-28 w-full" /> : ranked.length === 0 ? (
                <HonestEmpty
                  title={isError ? "Drafts unavailable" : "No active drafts in this view"}
                  detail="Refresh the queue or choose an active status to review drafts."
                />
              ) : ranked.map((d, index) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  rank={index + 1}
                  onReview={() => setReviewId(d.id)}
                  onReject={() => statusMutation.mutate(d)}
                  busy={bulkBusy || statusMutation.isPending}
                  onEdit={() => openEditor(d)}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4 text-info" /> Draft queue
                </CardTitle>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger aria-label="Filter drafts by status" className="w-full sm:w-[180px]"><Filter className="h-3.5 w-3.5 mr-2" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active only</SelectItem>
                      <SelectItem value="awaiting_approval">Awaiting approval</SelectItem>
                      <SelectItem value="awaiting_film">Awaiting film</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="shipped">Shipped</SelectItem>
                      <SelectItem value="all">All statuses</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={platformFilter} onValueChange={setPlatformFilter}>
                    <SelectTrigger aria-label="Filter drafts by platform" className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All platforms</SelectItem>
                      {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            {selectedIds.size > 0 && (
              <div className="mx-6 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                <span className="text-xs font-semibold tabular-nums">
                  {selectedIds.size} selected
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy || !filtered.some(d => selectedIds.has(d.id) && d.status === "awaiting_approval")}
                  onClick={() => { const next = filtered.find(d => selectedIds.has(d.id) && d.status === "awaiting_approval"); if (next) setReviewId(next.id); }}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Review selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  onClick={() => void rejectSelected()}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject selected
                </Button>
                <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
                <span className="text-[12px] text-muted-foreground">
                  Each approval requires a full version review.
                </span>
              </div>
            )}

            <CardContent className="space-y-2">
              {isLoading ? <Skeleton className="h-96 w-full" /> : filtered.length === 0 ? (
                <HonestEmpty
                  title={isError ? "Drafts unavailable" : "No drafts match this filter"}
                  detail="Refresh the queue or change the filters."
                />
              ) : (
                <>
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <input
                      type="checkbox"
                      id="cc-select-all"
                      className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                      checked={filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))}
                      onChange={(e) => {
                        setSelectedIds(e.target.checked ? new Set(filtered.map((d) => d.id)) : new Set());
                      }}
                    />
                    <label htmlFor="cc-select-all" className="cursor-pointer text-xs text-muted-foreground">
                      Select all {filtered.length.toLocaleString()} in this filter
                    </label>
                  </div>
                  {filtered.slice(0, visibleCount).map((d) => (
                    <div key={d.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Select draft ${d.title ?? d.id}`}
                        className="mt-4 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                        checked={selectedIds.has(d.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <DraftRow
                          draft={d}
                          onReview={() => setReviewId(d.id)}
                          onReject={() => statusMutation.mutate(d)}
                          busy={bulkBusy || statusMutation.isPending}
                          onEdit={() => openEditor(d)}
                        />
                      </div>
                    </div>
                  ))}
                  {filtered.length > visibleCount && (
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-3 text-sm">
                      <span className="text-muted-foreground">
                        Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setVisibleCount((n) => n + 120)}
                        className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted"
                      >
                        Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)
                      </button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="h-4 w-4 text-slate-600 dark:text-slate-300" /> Recent bot runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(runs ?? []).length === 0 ? (
                <HonestEmpty title="No run rows loaded" detail="Expected table: public.social_bot_runs." />
              ) : (runs ?? []).map((run) => (
                <div key={run.id} className="rounded-md border border-border bg-white/[0.03] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{run.mode ?? `run ${run.id}`}</span>
                    <Badge variant="outline">{run.status}</Badge>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 mt-1">{formatDistanceToNow(new Date(run.started_at), { addSuffix: true })} · {run.entries ?? 0} entries</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Clipboard className="h-4 w-4 text-emerald-300" /> Inbound money signals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(inbound ?? []).length === 0 ? (
                <HonestEmpty title="No inbound rows loaded" detail="Expected table: public.social_bot_inbound." />
              ) : (inbound ?? []).map((row) => (
                <div key={row.id} className="rounded-md border border-border bg-white/[0.03] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{row.handle ?? row.platform}</span>
                    <Badge variant="outline">{row.status}</Badge>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 mt-1">{row.intent ?? "inbound"} · {row.tier ?? "no tier"} · ${Math.round(row.conversion_value_usd ?? 0).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      {reviewId !== null && <SocialDraftReviewDialog key={reviewId} draftId={reviewId} ownerOnly onClose={() => setReviewId(null)} onApproved={() => setSelectedIds(previous => { const next = new Set(previous); next.delete(reviewId); return next; })} />}
      {editing ? (
        <Card className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl border-amber-500/30 bg-background/95 backdrop-blur shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Edit draft #{editing.id}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
            <Input value={editHook} onChange={(e) => setEditHook(e.target.value)} placeholder="Hook" />
            <Textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} placeholder="Caption" className="h-20" />
            <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} placeholder="Body/script" className="h-28" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(editing.id)} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save draft"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-3xl font-bold tabular-nums", tone)}>{value ?? "—"}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function DraftRow({
  draft,
  rank,
  onReview,
  onReject,
  onEdit,
  busy,
}: {
  draft: Draft;
  rank?: number;
  onReview: () => void;
  onReject: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  const Icon = platformIcon(draft.platform);
  const due = draft.draft_date ? format(new Date(`${draft.draft_date}T12:00:00`), "MMM d") : "no date";
  const sourceHref = safeContentUrl(draft.file_path);
  const publishedUrl = safeContentUrl(draft.shipped_url);

  return (
    <div className="rounded-lg border border-border bg-white/[0.025] p-3 hover:border-amber-500/30 transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {rank ? <Badge variant="outline" className="border-amber-500/40 text-amber-300">#{rank}</Badge> : null}
            <Badge variant="outline" className={platformTone(draft.platform)}>
              <Icon className="h-3 w-3 mr-1" /> {draft.platform ?? "unknown"}
            </Badge>
            <Badge variant="outline" className={statusTone(draft.status)}>{draft.status}</Badge>
            <span className="text-slate-600 dark:text-slate-300">Due {due}</span>
            {draft.pillar ? <span className="text-slate-600 dark:text-slate-300">· {draft.pillar}</span> : null}
          </div>
          <div className="mt-2 font-medium leading-snug">{draft.title ?? "Untitled draft"}</div>
          {draft.hook ? <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 italic line-clamp-2">"{draft.hook}"</div> : null}
          {draft.file_path ? <div className="mt-2 text-[12px] text-slate-600 dark:text-slate-300 font-mono truncate">{draft.file_path}</div> : null}
        </div>
        <div className="flex flex-wrap lg:justify-end gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={onReview} disabled={busy}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Review
          </Button>
          {draft.status === "shipped" && publishedUrl && draft.shipped_at ? <Button size="sm" variant="outline" asChild><a href={publishedUrl} target="_blank" rel="noopener noreferrer">Recorded post <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button> : draft.status === "shipped" ? <span className="text-xs text-muted-foreground">Publishing receipt unavailable</span> : null}
          {draft.status !== "rejected" && draft.status !== "shipped" ? (
            <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy || draft.status === "shipped"}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => copyText(draftCopy(draft), "Draft copy")}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy
          </Button>
          {sourceHref ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={sourceHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Source
              </a>
            </Button>
          ) : draft.file_path ? (
            <Button size="sm" variant="ghost" onClick={() => copyText(draft.file_path ?? "", "Source path")}>Copy path</Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <Link to="/admin/contentwheel">Wheel</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function HonestEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-white/[0.02] p-5 text-sm">
      <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
      <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{detail}</div>
    </div>
  );
}
