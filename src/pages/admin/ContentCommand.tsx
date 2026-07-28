import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
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

type DraftStatus = "pending" | "awaiting_approval" | "approved" | "shipped" | "rejected" | string;

type Draft = {
  id: number;
  draft_date: string | null;
  platform: string | null;
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

const ACTIVE_STATUSES = ["pending", "awaiting_approval", "approved"];

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
  if (p.includes("tiktok")) return "text-cyan-300 border-cyan-500/30";
  if (p.includes("instagram") || p === "ig") return "text-pink-300 border-pink-500/30";
  if (p.includes("snap")) return "text-yellow-200 border-yellow-500/30";
  return "text-slate-600 dark:text-slate-300 border-slate-500/30";
}

function statusTone(status: DraftStatus) {
  if (status === "shipped") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "approved") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (status === "rejected") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  if (status === "awaiting_approval") return "bg-slate-500/15 text-cyan-300 border-cyan-500/30";
  return "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30";
}

function sourceFileHref(filePath?: string | null) {
  if (!filePath) return null;
  const clean = filePath.split("#")[0];
  if (!clean.startsWith("/")) return null;
  return `file://${clean}`;
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
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data || data.length === 0) return null;

  const pending = data.filter((e) => e.draft_status === "awaiting_approval");

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          Deal Win Feed
          {pending.length > 0 && (
            <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/30 bg-amber-500/10 ml-1">
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
              className="rounded-md border border-white/5 bg-white/[0.02] p-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{ev.agent_name ?? "—"}</span>
                <span className="text-[10px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                <span className="text-sm font-bold text-emerald-300">
                  ${Number(ev.annual_premium ?? 0).toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{ev.product_sold ?? "Life"}</span>
              </div>
              {ev.draft_hook && (
                <p className="text-[10px] text-slate-400 leading-snug line-clamp-2">{ev.draft_hook}</p>
              )}
              {ev.draft_id && ev.draft_status === "awaiting_approval" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 mt-0.5"
                  onClick={() => onApproveDraft(ev.draft_id!)}
                >
                  Approve draft
                </Button>
              ) : ev.draft_status === "approved" ? (
                <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/30 w-fit">approved</Badge>
              ) : ev.draft_status === "shipped" ? (
                <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-600 w-fit">shipped</Badge>
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
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHook, setEditHook] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editBody, setEditBody] = useState("");

  const { data: drafts, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["content_command_drafts"],
    refetchInterval: 30_000,
    queryFn: async () => {
      // 2026-07-28: this query used to be `.order(draft_date ASC).limit(200)` against 587
      // rows, which returned the OLDEST 200 — draft_date 2025-12-10 through 2026-06-04 —
      // and hid 387 drafts, ALL of them awaiting_approval, including everything written
      // from 2026-06-05 to today. The page whose entire job is "what should Sam post today"
      // was showing him last December and hiding today.
      //
      // Now: newest first, and filtered to the active statuses server-side so the 23
      // archived rows cannot eat slots in the window. Limit sits above the current active
      // count (~560) so nothing is silently cut; if the backlog ever exceeds it, the UI
      // reports the overflow rather than quietly truncating (see truncated banner below).
      const { data, error } = await (supabase as any)
        .from("social_bot_drafts").select("id, draft_date, platform, slot, pillar, title, hook, body, cta, caption, hashtags, file_path, status, created_at")
        .in("status", ACTIVE_STATUSES)
        .order("draft_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(DRAFT_FETCH_LIMIT);
      if (error) throw error;
      return (data ?? []) as Draft[];
    },
  });

  const { data: bridge } = useQuery({
    queryKey: ["content_command_bridge"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_smb_cw_bridge").select("*").maybeSingle();
      if (error) return null;
      return data as Record<string, unknown> | null;
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["content_command_runs"],
    refetchInterval: 60_000,
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
    refetchInterval: 60_000,
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
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" | "shipped" }) => {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status, updated_at: now };
      if (status === "approved") patch.approved_at = now;
      if (status === "shipped") patch.shipped_at = now;
      const { error } = await (supabase as any).from("social_bot_drafts").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content_command_drafts"] });
      qc.invalidateQueries({ queryKey: ["social-bot-dashboard"] });
      toast.success("Draft updated");
    },
    onError: (e) => toast.error(`Draft update failed: ${String(e)}`),
  });

  const saveMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await (supabase as any)
        .from("social_bot_drafts")
        .update({
          title: editTitle,
          hook: editHook,
          caption: editCaption,
          body: editBody,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
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
    refetchInterval: 30_000,
    queryFn: async () => {
      const count = async (status: string) => {
        const { count: c, error } = await (supabase as any)
          .from("social_bot_drafts")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        if (error) throw error;
        return c ?? 0;
      };
      const [awaiting, approved, shipped, pending] = await Promise.all([
        count("awaiting_approval"),
        count("approved"),
        count("shipped"),
        count("pending"),
      ]);
      return { awaiting, approved, shipped, pending };
    },
  });

  const totals = useMemo(() => ({
    active: (statusCounts?.awaiting ?? 0) + (statusCounts?.approved ?? 0) + (statusCounts?.pending ?? 0),
    awaiting: statusCounts?.awaiting ?? 0,
    approved: statusCounts?.approved ?? 0,
    shipped: statusCounts?.shipped ?? 0,
  }), [statusCounts]);

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
        subtitle="One place for drafts, approvals, source files, ContentWheel context, and what Sam should post next."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/contentwheel">ContentWheel <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-4 w-4 mr-2", isRefetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      <PoolOverview drafts={drafts ?? []} />

      <CultureFeed onApproveDraft={(id) => statusMutation.mutate({ id, status: "approved" })} />

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
        <Metric label="Active drafts" value={totals.active} tone="text-cyan-300" />
        <Metric label="Awaiting stamp" value={totals.awaiting} tone="text-amber-300" />
        <Metric label="Approved" value={totals.approved} tone="text-emerald-300" />
        <Metric label="Shipped" value={totals.shipped} tone="text-slate-600 dark:text-slate-300" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="space-y-4">
          <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-background to-background">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-amber-300" /> What Sam should post next
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? <Skeleton className="h-28 w-full" /> : ranked.length === 0 ? (
                <HonestEmpty
                  title="No active drafts found"
                  detail="Expected source: public.social_bot_drafts with status pending, awaiting_approval, or approved."
                />
              ) : ranked.map((d, index) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  rank={index + 1}
                  onApprove={() => statusMutation.mutate({ id: d.id, status: "approved" })}
                  onReject={() => statusMutation.mutate({ id: d.id, status: "rejected" })}
                  onShip={() => statusMutation.mutate({ id: d.id, status: "shipped" })}
                  onEdit={() => openEditor(d)}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4 text-cyan-300" /> Draft queue
                </CardTitle>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[180px]"><Filter className="h-3.5 w-3.5 mr-2" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active only</SelectItem>
                      <SelectItem value="awaiting_approval">Awaiting approval</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="shipped">Shipped</SelectItem>
                      <SelectItem value="all">All statuses</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={platformFilter} onValueChange={setPlatformFilter}>
                    <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All platforms</SelectItem>
                      {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? <Skeleton className="h-96 w-full" /> : filtered.length === 0 ? (
                <HonestEmpty
                  title="No drafts match this filter"
                  detail="Source checked: public.social_bot_drafts. Change filters or run the Social Media Bot draft generator."
                />
              ) : filtered.map((d) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  onApprove={() => statusMutation.mutate({ id: d.id, status: "approved" })}
                  onReject={() => statusMutation.mutate({ id: d.id, status: "rejected" })}
                  onShip={() => statusMutation.mutate({ id: d.id, status: "shipped" })}
                  onEdit={() => openEditor(d)}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-300" /> Source health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <HealthLine label="Draft table" ok={(drafts?.length ?? 0) > 0} detail={`${drafts?.length ?? 0} rows loaded from social_bot_drafts`} />
              <HealthLine label="ContentWheel bridge" ok={Boolean(bridge)} detail={bridge ? "v_smb_cw_bridge reachable" : "v_smb_cw_bridge missing or blocked"} />
              <HealthLine label="STAMP queue" ok detail="/Users/samjames/business-ops/social-media-bot/drafts/STAMP-QUEUE.md" />
              <HealthLine label="Approval actions" ok detail="approve / reject / shipped update social_bot_drafts directly" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="h-4 w-4 text-slate-600 dark:text-slate-300" /> Recent bot runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(runs ?? []).length === 0 ? (
                <HonestEmpty title="No run rows loaded" detail="Expected table: public.social_bot_runs." />
              ) : (runs ?? []).map((run) => (
                <div key={run.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs">
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
                <div key={row.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs">
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

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-3xl font-bold tabular-nums", tone)}>{value}</div>
        <div className="text-xs text-slate-400 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function DraftRow({
  draft,
  rank,
  onApprove,
  onReject,
  onShip,
  onEdit,
}: {
  draft: Draft;
  rank?: number;
  onApprove: () => void;
  onReject: () => void;
  onShip: () => void;
  onEdit: () => void;
}) {
  const Icon = platformIcon(draft.platform);
  const due = draft.draft_date ? format(new Date(`${draft.draft_date}T12:00:00`), "MMM d") : "no date";
  const sourceHref = sourceFileHref(draft.file_path);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3 hover:border-amber-500/30 transition-colors">
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
          {draft.file_path ? <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 font-mono truncate">{draft.file_path}</div> : null}
        </div>
        <div className="flex flex-wrap lg:justify-end gap-1.5 shrink-0">
          {draft.status !== "approved" && draft.status !== "shipped" ? (
            <Button size="sm" variant="outline" onClick={onApprove}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          ) : null}
          {draft.status === "approved" ? (
            <Button size="sm" onClick={onShip}>
              <Send className="h-3.5 w-3.5 mr-1" /> Shipped
            </Button>
          ) : null}
          {draft.status !== "rejected" && draft.status !== "shipped" ? (
            <Button size="sm" variant="ghost" onClick={onReject}>
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
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

function HealthLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5" /> : <XCircle className="h-4 w-4 text-amber-400 mt-0.5" />}
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-slate-600 dark:text-slate-300">{detail}</div>
      </div>
    </div>
  );
}

function HonestEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm">
      <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
      <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{detail}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------
   PoolOverview — 7-pool flow strip per Sam's add-on. Reads real ContentWheel
   tables (cw_ideas / cw_hooks / cw_demand_mines / cw_outliers) + the local
   drafts param. Empty pools render '—' instead of fake zero.
   ------------------------------------------------------------------------ */
function PoolOverview({ drafts }: { drafts: any[] }) {
  const { data } = useQuery({
    queryKey: ["content_command_pools"],
    queryFn: async () => {
      const probes = await Promise.all([
        (supabase as any).from("cw_ideas").select("id", { count: "exact", head: true }),
        (supabase as any).from("cw_hooks").select("id", { count: "exact", head: true }),
        (supabase as any).from("cw_demand_mines").select("id", { count: "exact", head: true }),
        (supabase as any).from("cw_outliers").select("id", { count: "exact", head: true }),
        (supabase as any).from("cw_posts").select("id", { count: "exact", head: true }),
      ]);
      return {
        ideas: probes[0].count ?? null,
        hooks: probes[1].count ?? null,
        demand_mines: probes[2].count ?? null,
        outliers: probes[3].count ?? null,
        posts: probes[4].count ?? null,
      };
    },
    staleTime: 5 * 60_000,
  });

  const draftAwait = drafts.filter((d) => d.status === "awaiting_approval" || d.status === "pending").length;
  const draftApproved = drafts.filter((d) => d.status === "approved").length;
  const draftShipped = drafts.filter((d) => d.status === "shipped").length;

  const pools = [
    { label: "Raw Ideas", value: data?.ideas, hint: "cw_ideas", tone: "text-slate-600 dark:text-slate-300" },
    { label: "Demand mines", value: data?.demand_mines, hint: "cw_demand_mines", tone: "text-slate-600 dark:text-slate-300" },
    { label: "Hook pool", value: data?.hooks, hint: "cw_hooks", tone: "text-violet-300" },
    { label: "Outliers", value: data?.outliers, hint: "cw_outliers", tone: "text-cyan-300" },
    { label: "Drafts awaiting", value: draftAwait, hint: "social_bot_drafts", tone: "text-amber-300" },
    { label: "Approved to post", value: draftApproved, hint: "social_bot_drafts", tone: "text-emerald-300" },
    { label: "Shipped", value: draftShipped + (data?.posts ?? 0), hint: "social_bot_drafts + cw_posts", tone: "text-slate-400" },
  ];

  return (
    <Card className="ops-card-depth border-white/10 bg-white/[0.02]">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">Full content flow</span>
          <span className="text-[10px] text-slate-400">read-only · pulls live</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {pools.map((p, i) => (
            <div key={p.label} className="rounded-md border border-white/5 bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn("text-[9px] font-mono", p.tone)}>{i + 1}</span>
                <span className="text-[10px] text-slate-400 truncate">{p.label}</span>
              </div>
              <div className={cn("text-xl font-bold tabular-nums leading-tight", p.tone)}>
                {p.value === null || p.value === undefined ? <span className="text-slate-400">—</span> : p.value}
              </div>
              <div className="text-[9px] text-slate-400 font-mono mt-0.5 truncate" title={p.hint}>{p.hint}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
