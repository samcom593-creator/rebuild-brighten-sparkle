import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { CwBridgeStripForSmb } from "@/components/contentwheel/CwBridgeStripForSmb";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sparkles, AlertTriangle, CheckCircle2, XCircle, Send,
  Users, MessageSquare, Target,
  Radio, Anchor, FileText, RefreshCw, Crown,
  Youtube, Music2, Instagram, Camera, Activity,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";

// ─── types ─────────────────────────────────────────────────────────────────
type Draft = {
  id: number; draft_date: string; platform: string; slot: string | null;
  pillar: string | null; title: string; hook: string | null; body: string | null;
  cta: string | null; caption: string | null; hashtags: string | null;
  sound: string | null; duration_sec: number | null; file_path: string | null;
  status: "pending" | "approved" | "shipped" | "rejected";
  approved_at: string | null; shipped_at: string | null;
  approved_by: string | null; shipped_url: string | null; notes: string | null;
};
type Analytics = {
  id: number; snapshot_ts: string; platform: string; channel_handle: string | null;
  channel_id: string | null; subscribers: number | null; total_views: number | null;
  total_videos: number | null; window_days: number | null; views_window: number | null;
  subscribers_gained: number | null; subscribers_lost: number | null;
  subscribers_net: number | null; watch_minutes: number | null;
  avg_view_pct: number | null; likes: number | null; comments: number | null;
  last_upload_date: string | null; days_since_upload: number | null;
  raw_json: Record<string, unknown> | null;
};
type Blocker = {
  id: number; created_at: string; title: string; description: string | null;
  severity: "critical" | "high" | "medium" | "low"; status: "open" | "resolved";
  resolved_at: string | null; dollar_impact: number; fix_action: string | null;
  source: string | null;
};
type Inbound = {
  id: number; ts: string; platform: string; handle: string | null;
  intent: string | null; message: string | null; status: string;
  tier: string | null; stripe_link: string | null; draft_reply: string | null;
  conversion_value_usd: number | null; notes: string | null; source_url: string | null;
};
type Goal = {
  id: number; goal_key: string; goal_label: string; target_value: number;
  target_date: string; current_value: number | null; unit: string | null;
  direction: string | null; last_updated: string | null;
};
type HookRow = {
  id: number; hook_text: string; category: string | null; is_starred: boolean;
  is_archived: boolean; uses: number; avg_retention_pct: number | null;
  best_video_id: string | null; notes: string | null;
};
type Run = {
  id: number; started_at: string; ended_at: string | null; status: string;
  mode: string | null; entries: number | null; log_excerpt: string | null;
  source: string | null;
};
type Scoreboard = {
  id: number; week_of: string; generated_at: string;
  scoreboard_md: string | null; metrics: Record<string, unknown> | null;
};
type DashboardRow = {
  drafts_today: number; drafts_approved_today: number;
  drafts_shipped_today: number; drafts_pending_today: number;
  inbound_7d_count: number; inbound_7d_paid: number;
  inbound_7d_revenue_usd: number;
  open_blockers: number; critical_blockers: number;
  total_followers: number;
  today_pack: Draft[] | null; analytics: Analytics[] | null;
  blockers: Blocker[] | null; inbound: Inbound[] | null;
  goals: Goal[] | null; scoreboard: Scoreboard | null;
  recent_runs: Run[] | null; top_hooks: HookRow[] | null;
  generated_at: string; as_of: string;
};

// ─── platform helpers ──────────────────────────────────────────────────────
const platformIcon = (p: string) => {
  if (p.startsWith("youtube")) return Youtube;
  if (p === "tiktok") return Music2;
  if (p === "instagram") return Instagram;
  if (p === "snapchat") return Camera;
  return FileText;
};
const platformColor = (p: string) => {
  if (p.startsWith("youtube")) return "text-red-400";
  if (p === "tiktok") return "text-cyan-400";
  if (p === "instagram") return "text-pink-400";
  if (p === "snapchat") return "text-yellow-300";
  return "text-zinc-300";
};
const statusBadge = (s: string) => {
  if (s === "shipped")  return <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">shipped</Badge>;
  if (s === "approved") return <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40">approved</Badge>;
  if (s === "rejected") return <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40">rejected</Badge>;
  return <Badge className="bg-zinc-700/40 text-zinc-300 border border-zinc-600/50">pending</Badge>;
};
const severityBadge = (s: string) => {
  if (s === "critical") return <Badge className="bg-rose-600/30 text-rose-200 border border-rose-500">CRITICAL</Badge>;
  if (s === "high")     return <Badge className="bg-orange-500/30 text-orange-200 border border-orange-500/50">high</Badge>;
  if (s === "medium")   return <Badge className="bg-amber-500/30 text-amber-200 border border-amber-500/50">medium</Badge>;
  return <Badge className="bg-zinc-700/40 text-zinc-300">low</Badge>;
};
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

// ─── page ──────────────────────────────────────────────────────────────────
export default function SocialMediaBot() {
  const qc = useQueryClient();
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["social-bot-dashboard"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_social_bot_dashboard")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as DashboardRow;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const mutateDraftStatus = async (id: number, status: "approved" | "rejected" | "shipped") => {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "shipped")  patch.shipped_at  = new Date().toISOString();
    const { error } = await (supabase as any).from("social_bot_drafts").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Draft ${status}`);
    qc.invalidateQueries({ queryKey: ["social-bot-dashboard"] });
  };

  const resolveBlocker = async (id: number) => {
    const { error } = await (supabase as any)
      .from("social_bot_blockers")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Blocker marked resolved");
    qc.invalidateQueries({ queryKey: ["social-bot-dashboard"] });
  };

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!data) return [];
    return [
      {
        icon: FileText,
        label: "Drafts Today",
        value: `${data.drafts_pending_today}/${data.drafts_today}`,
        sub: `pending · ${data.drafts_approved_today} approved · ${data.drafts_shipped_today} shipped`,
        accent: "text-amber-300",
      },
      {
        icon: Users,
        label: "Total Followers",
        value: fmtNum(data.total_followers),
        sub: "tracked across wired platforms",
        accent: "text-cyan-300",
      },
      {
        icon: MessageSquare,
        label: "Inbound DMs (7d)",
        value: fmtNum(data.inbound_7d_count),
        sub: `${data.inbound_7d_paid} paid · ${fmtUsd(data.inbound_7d_revenue_usd)} revenue`,
        accent: "text-emerald-300",
      },
      {
        icon: AlertTriangle,
        label: "Open Blockers",
        value: fmtNum(data.open_blockers),
        sub: data.critical_blockers > 0 ? `${data.critical_blockers} CRITICAL` : "all non-critical",
        accent: data.critical_blockers > 0 ? "text-rose-400" : "text-zinc-300",
      },
    ];
  }, [data]);

  // ── render ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Social Media Bot data unavailable"
          description="The bot's Supabase view is unreachable. Confirm RLS + auth, or check ~/business-ops/social-media-bot/heartbeat.txt for the daemon."
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        icon={Sparkles}
        title="Social Media Bot"
        subtitle="APEX Standard content engine — daemon + chat-session intel · auto-refresh every 30s"
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* ContentWheel bridge — strategic KPIs from the BRAIN */}
      <CwBridgeStripForSmb />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wide">
                <k.icon className="h-3.5 w-3.5" />
                {k.label}
              </div>
              <div className={`mt-2 text-3xl font-bold ${k.accent}`}>{k.value}</div>
              <div className="mt-1 text-xs text-zinc-500">{k.sub}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Goals + Blockers row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-amber-300" /> 3 Public Goals
              </h3>
              <span className="text-xs text-zinc-500">Brand Bible Ch 10</span>
            </div>
            <div className="space-y-4">
              {(data.goals ?? []).map((g) => {
                const pct = g.current_value != null
                  ? g.direction === "down"
                    ? Math.max(0, Math.min(100, ((g.target_value / g.current_value) * 100)))
                    : Math.max(0, Math.min(100, (g.current_value / g.target_value) * 100))
                  : 0;
                const daysLeft = Math.max(0, Math.ceil(
                  (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                ));
                return (
                  <div key={g.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{g.goal_label}</span>
                      <span className="text-zinc-400">
                        {g.current_value ?? "—"}{g.unit ?? ""} / {g.target_value}{g.unit ?? ""} · {daysLeft}d left
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-amber-200 rounded-full"
                        style={{ width: `${pct.toFixed(1)}%` }}
                      />
                    </div>
                    <div className="text-xs text-zinc-500">{pct.toFixed(1)}% complete</div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>

        <GlassCard className="p-5">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-rose-400" /> Open Blockers
          </h3>
          {(data.blockers ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500">All clear. Hold the Standard.</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {(data.blockers ?? []).map((b) => (
                <div key={b.id} className="rounded-md border border-zinc-700/50 bg-zinc-900/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium leading-tight">{b.title}</div>
                    {severityBadge(b.severity)}
                  </div>
                  {b.dollar_impact > 0 && (
                    <div className="mt-1 text-xs text-emerald-300">
                      Impact: {fmtUsd(b.dollar_impact)}/yr
                    </div>
                  )}
                  {b.fix_action && (
                    <div className="mt-2 text-xs text-zinc-400 leading-snug">{b.fix_action}</div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => resolveBlocker(b.id)}>
                      Mark Resolved
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Tabs: detailed views */}
      <Tabs defaultValue="pack" className="w-full">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full">
          <TabsTrigger value="pack">Today's Pack</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="inbound">Inbound</TabsTrigger>
          <TabsTrigger value="scoreboard">Scoreboard</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        {/* TODAY'S PACK */}
        <TabsContent value="pack" className="mt-4">
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                Today's Pack — {format(new Date(data.as_of), "EEE, MMM d")}
              </h3>
              <Badge variant="outline">{data.drafts_today} drafts</Badge>
            </div>
            {(data.today_pack ?? []).length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No drafts queued for today"
                description="The morning daemon fires at 6:03 AM CT. Manually trigger with: launchctl start com.samjames.apex.social-media-bot"
              />
            ) : (
              <div className="space-y-3">
                {(data.today_pack ?? []).map((d) => {
                  const Icon = platformIcon(d.platform);
                  return (
                    <div
                      key={d.id}
                      className="rounded-md border border-zinc-700/50 bg-zinc-900/40 p-3 md:p-4 hover:border-amber-500/40 transition-colors cursor-pointer"
                      onClick={() => setActiveDraft(d)}
                    >
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wider">
                            <Icon className={`h-3.5 w-3.5 ${platformColor(d.platform)}`} />
                            <span>{d.platform}</span>
                            {d.slot && <span>· {d.slot}</span>}
                            {d.pillar && <span>· {d.pillar}</span>}
                            {d.duration_sec && <span>· {d.duration_sec}s</span>}
                          </div>
                          <div className="mt-1.5 font-medium text-sm md:text-base leading-snug">{d.title}</div>
                          {d.hook && (
                            <div className="mt-1.5 text-sm text-zinc-300 italic line-clamp-2">"{d.hook}"</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {statusBadge(d.status)}
                          {d.status === "pending" && (
                            <>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); mutateDraftStatus(d.id, "approved"); }}>
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); mutateDraftStatus(d.id, "rejected"); }}>
                                <XCircle className="h-4 w-4 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {d.status === "approved" && (
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); mutateDraftStatus(d.id, "shipped"); }}>
                              <Send className="h-4 w-4 mr-1" /> Mark Shipped
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* ANALYTICS */}
        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(data.analytics ?? []).map((a) => {
              const Icon = platformIcon(a.platform);
              const wired = a.subscribers != null;
              return (
                <GlassCard key={a.id} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className={`h-5 w-5 ${platformColor(a.platform)}`} />
                    <span className="font-semibold uppercase text-sm">{a.platform}</span>
                  </div>
                  {wired ? (
                    <>
                      <div className="text-3xl font-bold">{fmtNum(a.subscribers)}</div>
                      <div className="text-xs text-zinc-400 mb-3">{a.channel_handle ?? "—"}</div>
                      <div className="space-y-1.5 text-sm">
                        {a.subscribers_net != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Net Δ (28d)</span>
                            <span className={a.subscribers_net >= 0 ? "text-emerald-300" : "text-rose-300"}>
                              {a.subscribers_net >= 0 ? "+" : ""}{a.subscribers_net}
                            </span>
                          </div>
                        )}
                        {a.views_window != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Views (28d)</span>
                            <span>{fmtNum(a.views_window)}</span>
                          </div>
                        )}
                        {a.avg_view_pct != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Avg view %</span>
                            <span className={a.avg_view_pct >= 50 ? "text-emerald-300" : "text-amber-300"}>
                              {a.avg_view_pct.toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {a.days_since_upload != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Days since upload</span>
                            <span className={a.days_since_upload <= 7 ? "text-emerald-300" : "text-rose-300"}>
                              {a.days_since_upload}d
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-zinc-500">
                      <div className="mb-2">Handle: {a.channel_handle ?? "—"}</div>
                      <Badge variant="outline">API not authed</Badge>
                      {a.raw_json?.note != null && (
                        <p className="mt-2 text-xs">{String(a.raw_json.note)}</p>
                      )}
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>
        </TabsContent>

        {/* INBOUND */}
        <TabsContent value="inbound" className="mt-4">
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-300" /> Mentorship Inbox (7d)
              </h3>
              <Badge variant="outline">{data.inbound_7d_count} DMs</Badge>
            </div>
            {(data.inbound ?? []).length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No inbound DMs captured yet"
                description="The hourly daemon (9 AM–9 PM CT) scans YT comments. TT/IG/Snap DMs await API auth. Manual DMs can be inserted via the CRM."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-zinc-400 uppercase">
                    <tr><th className="text-left p-2">When</th><th className="text-left p-2">Platform</th><th className="text-left p-2">Handle</th><th className="text-left p-2">Intent</th><th className="text-left p-2">Status</th><th className="text-right p-2">$</th></tr>
                  </thead>
                  <tbody>
                    {(data.inbound ?? []).map((i) => (
                      <tr key={i.id} className="border-t border-zinc-800">
                        <td className="p-2 text-zinc-400">{formatDistanceToNow(parseISO(i.ts), { addSuffix: true })}</td>
                        <td className="p-2">{i.platform}</td>
                        <td className="p-2">{i.handle ?? "—"}</td>
                        <td className="p-2"><Badge variant="outline">{i.intent ?? "—"}</Badge></td>
                        <td className="p-2">{i.status}</td>
                        <td className="p-2 text-right text-emerald-300">{fmtUsd(i.conversion_value_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* SCOREBOARD */}
        <TabsContent value="scoreboard" className="mt-4">
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-300" /> Weekly Scoreboard
              </h3>
              {data.scoreboard?.week_of && (
                <span className="text-xs text-zinc-400">
                  Week of {format(new Date(data.scoreboard.week_of), "MMM d, yyyy")}
                </span>
              )}
            </div>
            {data.scoreboard?.scoreboard_md ? (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 font-mono bg-zinc-950/50 p-4 rounded border border-zinc-800 max-h-[500px] overflow-y-auto">
                {data.scoreboard.scoreboard_md}
              </pre>
            ) : (
              <EmptyState
                icon={Crown}
                title="No scoreboard yet"
                description="The Monday 7:03 AM CT daemon ships the weekly scoreboard."
              />
            )}
          </GlassCard>
        </TabsContent>

        {/* HOOKS */}
        <TabsContent value="hooks" className="mt-4">
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Anchor className="h-5 w-5 text-amber-300" /> Hook Library — Top Performers
              </h3>
              <Badge variant="outline">{(data.top_hooks ?? []).length} active</Badge>
            </div>
            <div className="space-y-2">
              {(data.top_hooks ?? []).map((h) => (
                <div key={h.id} className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
                  <div className="flex-1">
                    <div className="text-sm leading-snug">{h.hook_text}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <Badge variant="outline" className="capitalize">{h.category ?? "uncategorized"}</Badge>
                      {h.is_starred && <span className="text-amber-300">★ starred</span>}
                      <span>· {h.uses} uses</span>
                      {h.avg_retention_pct != null && <span>· {h.avg_retention_pct.toFixed(1)}% avg retention</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </TabsContent>

        {/* RUNS */}
        <TabsContent value="runs" className="mt-4">
          <GlassCard className="p-4 md:p-5">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-cyan-300" /> Recent Bot Runs
            </h3>
            <div className="space-y-2 text-sm">
              {(data.recent_runs ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 border-t border-zinc-800 py-2">
                  <div className="flex items-center gap-2">
                    <Radio className={`h-3.5 w-3.5 ${r.status === "complete" ? "text-emerald-300" : r.status === "failed" ? "text-rose-300" : "text-amber-300"}`} />
                    <span className="text-zinc-400">{format(parseISO(r.started_at), "MMM d HH:mm")}</span>
                    <Badge variant="outline" className="capitalize">{r.mode ?? "manual"}</Badge>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                  <div className="text-xs text-zinc-500 truncate max-w-[60%]" title={r.log_excerpt ?? ""}>{r.log_excerpt}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Footer + sign-off */}
      <div className="text-center text-xs text-zinc-600 pt-6 border-t border-zinc-800">
        Generated {data.generated_at ? format(parseISO(data.generated_at), "MMM d, yyyy HH:mm:ss") : ""} ·
        Daemon: launchd <code className="text-zinc-500">com.samjames.apex.social-media-bot</code> ·
        Engine: <code className="text-zinc-500">~/business-ops/social-media-bot/</code>
        <div className="mt-1 text-zinc-500 italic">Hold the Standard. Average is the disease.</div>
      </div>

      {/* Draft detail dialog */}
      <Dialog open={!!activeDraft} onOpenChange={(o) => !o && setActiveDraft(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeDraft && (() => {
                const Ico = platformIcon(activeDraft.platform);
                return <Ico className={`h-5 w-5 ${platformColor(activeDraft.platform)}`} />;
              })()}
              {activeDraft?.title}
            </DialogTitle>
          </DialogHeader>
          {activeDraft && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{activeDraft.platform}</Badge>
                {activeDraft.slot && <Badge variant="outline">slot: {activeDraft.slot}</Badge>}
                {activeDraft.pillar && <Badge variant="outline">{activeDraft.pillar}</Badge>}
                {activeDraft.duration_sec && <Badge variant="outline">{activeDraft.duration_sec}s</Badge>}
                {statusBadge(activeDraft.status)}
              </div>
              {activeDraft.hook && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Hook (3 sec)</div>
                  <div className="text-base italic">"{activeDraft.hook}"</div>
                </div>
              )}
              {activeDraft.body && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Body</div>
                  <div className="whitespace-pre-wrap">{activeDraft.body}</div>
                </div>
              )}
              {activeDraft.cta && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">CTA</div>
                  <div>{activeDraft.cta}</div>
                </div>
              )}
              {activeDraft.caption && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Caption</div>
                  <div className="whitespace-pre-wrap text-zinc-300">{activeDraft.caption}</div>
                </div>
              )}
              {activeDraft.hashtags && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Hashtags</div>
                  <div className="text-zinc-300">{activeDraft.hashtags}</div>
                </div>
              )}
              {activeDraft.sound && (
                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Sound</div>
                  <div className="text-zinc-300">{activeDraft.sound}</div>
                </div>
              )}
              {activeDraft.file_path && (
                <div className="text-xs text-zinc-500">
                  Source file: <code>{activeDraft.file_path}</code>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {activeDraft?.status === "pending" && (
              <>
                <Button variant="ghost" onClick={() => { if (activeDraft) { mutateDraftStatus(activeDraft.id, "rejected"); setActiveDraft(null); } }}>
                  Reject
                </Button>
                <Button onClick={() => { if (activeDraft) { mutateDraftStatus(activeDraft.id, "approved"); setActiveDraft(null); } }}>
                  Approve
                </Button>
              </>
            )}
            {activeDraft?.status === "approved" && (
              <Button onClick={() => { if (activeDraft) { mutateDraftStatus(activeDraft.id, "shipped"); setActiveDraft(null); } }}>
                <Send className="h-4 w-4 mr-2" /> Mark Shipped
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
