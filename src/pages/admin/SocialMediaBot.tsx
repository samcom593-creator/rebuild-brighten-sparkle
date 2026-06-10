import { useMemo, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
  ScrollText, FlaskConical, Flame, Quote, ArrowRight, Plus,
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

// ─── ContentWheel types (brand tab) ───────────────────────────────────────
type CwPillar = {
  id: string; code: string; name: string; description: string | null;
  monetization_tie: string | null; display_order: number;
};
type CwDogma = { id: string; number: number; text: string };
type CwHookRow = {
  id: string; idea_id: string; variant_label: string; text: string;
  keyword_a: string | null; keyword_b: string | null;
  is_agenda: boolean | null; context_ok: boolean | null;
  contrarian_ok: boolean | null; openloop_ok: boolean | null;
};
type CwIdeaRow = {
  id: string; title: string; audience: string; pillar_id: string | null;
  dogma_id: string | null; status: string; score: number | null;
};

// ─── cinematic moments (Brand Bible Ch 1, ranked) ────────────────────────
const CINEMATIC_MOMENTS = [
  { num: 1, name: "The Shower Prayer",      note: "the vow + the next-morning hire — flagship" },
  { num: 2, name: "The Highway Walk",       note: "broken shoulder, 11 PM, football gear" },
  { num: 3, name: "The $100K Scam",         note: "wholesale deal stolen, demoralized" },
  { num: 4, name: "The Coach Who Buried You", note: "killed the dream the day before season" },
  { num: 5, name: "The $5K Graduation Flex", note: "threw $5K in the air — bought the exact car" },
  { num: 6, name: "Globe AO Betrayal",      note: "agency-stealing chapter" },
  { num: 7, name: "Nigerian Boarding School", note: "the reset that built the man" },
  { num: 8, name: "Braxton's Missed Call",  note: "SACRED — only when right, never overplayed" },
];

// ─── voice rules (Brand Bible Ch 6 + 19) ─────────────────────────────────
const VOICE_RULES = [
  { do_text: "Direct, faith-aware (Christian, never performative), anti-soft",  dont: "Performative faith / sprinkled-for-points" },
  { do_text: "First person. Calm authority. He's been at the bottom.",          dont: "Hype-bro yelling / Gary-Vee energy" },
  { do_text: "7th-grade English in hooks. Word economy.",                       dont: "Corporate larp / synergy / leverage as a noun" },
  { do_text: "Say 'hold the standard' naturally. Drop closer-talk: 'closed', 'objection-killer'.", dont: "Fake humility / pretending to be older than 20" },
  { do_text: "Reference Nigeria as origin, never as flex. Mention Aisha authentically.", dont: "Forcing hero-story beats where they don't fit" },
];

// ─── page ──────────────────────────────────────────────────────────────────
export default function SocialMediaBot() {
  const qc = useQueryClient();
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [sandcastleJson, setSandcastleJson] = useState("");
  const [sandcastleStatus, setSandcastleStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [selectedPillarCode, setSelectedPillarCode] = useState<string | null>(null);

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

  // Brand tab queries — ContentWheel pillars, dogmas, hooks
  const { data: pillars } = useQuery({
    queryKey: ["cw_pillars"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cw_pillars").select("*").order("display_order");
      if (error) throw error;
      return data as CwPillar[];
    },
    staleTime: 5 * 60_000,
  });
  const { data: dogmas } = useQuery({
    queryKey: ["cw_dogmas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cw_dogmas").select("*").order("number");
      if (error) throw error;
      return data as CwDogma[];
    },
    staleTime: 5 * 60_000,
  });
  const { data: cwHooks } = useQuery({
    queryKey: ["cw_hooks_with_idea"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cw_hooks")
        .select("*, cw_ideas!inner(title, audience, pillar_id)")
        .limit(50);
      if (error) throw error;
      return data as Array<CwHookRow & { cw_ideas: { title: string; audience: string; pillar_id: string | null } }>;
    },
    staleTime: 60_000,
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
          icon={<AlertTriangle className="h-7 w-7" />}
          title="Social Media Bot data unavailable"
          description="The bot's Supabase view is unreachable. Confirm RLS + auth, or check ~/business-ops/social-media-bot/heartbeat.txt for the daemon."
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-[1400px] mx-auto ops-surface ops-fade-in">
      <PageHeader
        eyebrow="Content engine"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Social Media Bot"
        subtitle="APEX Standard content engine — daemon + chat-session intel · auto-refresh every 30s"
        accent="amber"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* ContentWheel bridge — strategic KPIs from the BRAIN */}
      <CwBridgeStripForSmb />

      {/* KPI strip — bigger, higher contrast, more glance-able */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <GlassCard className="p-5 md:p-6 border-amber-500/20 bg-gradient-to-br from-amber-500/[0.03] via-zinc-900/40 to-zinc-900/60 hover:border-amber-500/40 transition-colors">
              <div className="flex items-center gap-2 text-[11px] text-amber-300/90 uppercase tracking-[0.14em] font-semibold">
                <k.icon className="h-4 w-4" />
                {k.label}
              </div>
              <div className={`mt-3 text-4xl md:text-5xl font-bold tabular-nums leading-none ${k.accent}`}>{k.value}</div>
              <div className="mt-2 text-xs text-zinc-400 leading-snug">{k.sub}</div>
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
            <div className="space-y-5">
              {(data.goals ?? []).map((g) => {
                // Followers goal pulls live count from the dashboard total
                const liveCurrent = g.goal_key === "total_followers" ? data.total_followers : g.current_value;
                const pct = liveCurrent != null
                  ? g.direction === "down"
                    ? Math.max(0, Math.min(100, ((g.target_value / liveCurrent) * 100)))
                    : Math.max(0, Math.min(100, (liveCurrent / g.target_value) * 100))
                  : 0;
                const daysLeft = Math.max(0, Math.ceil(
                  (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                ));
                const gap = g.direction === "up" ? Math.max(0, g.target_value - (liveCurrent ?? 0)) : Math.max(0, (liveCurrent ?? 0) - g.target_value);
                const dailyNeeded = daysLeft > 0 ? Math.ceil(gap / daysLeft) : null;
                return (
                  <div key={g.id} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-sm md:text-base">{g.goal_label}</span>
                      <span className="font-mono text-xs text-zinc-300 shrink-0">
                        <span className="text-amber-300 font-semibold">{fmtNum(liveCurrent ?? 0)}{g.unit === "%" ? "%" : ""}</span>
                        <span className="text-zinc-500"> / {fmtNum(g.target_value)}{g.unit === "%" ? "%" : ""}</span>
                      </span>
                    </div>
                    <div className="relative h-3 bg-slate-50 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 via-amber-300 to-amber-200 rounded-full shadow-[0_0_12px_rgba(232,197,71,0.4)]"
                        style={{ width: `${pct.toFixed(1)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                      <span>{pct.toFixed(1)}% complete</span>
                      <span>
                        {daysLeft}d left
                        {dailyNeeded != null && dailyNeeded > 0 && g.direction === "up" && (
                          <> · need <span className="text-amber-300">{fmtNum(dailyNeeded)}{g.unit ? `/${g.unit?.replace("followers","f").replace("USD","$")}` : ""}/day</span></>
                        )}
                      </span>
                    </div>
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
                <div key={b.id} className="rounded-md border border-zinc-700/50 bg-white dark:bg-zinc-900/40 p-3">
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
                  <BlockerActions blocker={b} onResolve={() => resolveBlocker(b.id)} />
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
          <TabsTrigger value="brand">Brand</TabsTrigger>
          <TabsTrigger value="sandcastles">Sandcastles Lab</TabsTrigger>
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
                icon={<FileText className="h-7 w-7" />}
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
                      className="rounded-md border border-zinc-700/50 bg-white dark:bg-zinc-900/40 p-3 md:p-4 hover:border-amber-500/40 transition-colors cursor-pointer"
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

        {/* BRAND — pillars, dogmas, voice, hero beats, proof-backed suggestions */}
        <TabsContent value="brand" className="mt-4 space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ScrollText className="h-5 w-5 text-amber-300" /> The 6 Pillars
              </h3>
              <span className="text-xs text-zinc-500">Brand Bible Ch 8 · click to filter hooks</span>
            </div>
            <p className="text-xs text-zinc-500 mb-4">Every post lands under exactly one pillar. Best posts weave 2-3.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(pillars ?? []).map((p) => {
                const active = selectedPillarCode === p.code;
                const hookCount = (cwHooks ?? []).filter(h => h.cw_ideas?.pillar_id === p.id).length;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPillarCode(active ? null : p.code)}
                    className={`text-left rounded-lg border p-3 transition-colors ${active ? "border-amber-500/60 bg-amber-500/10" : "border-zinc-700/50 bg-white dark:bg-zinc-900/40 hover:border-zinc-600"}`}
                  >
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="font-mono uppercase tracking-wider">{p.code}</span>
                      <Badge variant="outline">{hookCount} hooks</Badge>
                    </div>
                    <div className="mt-1.5 font-semibold text-sm">{p.name}</div>
                    {p.description && <div className="mt-1 text-xs text-zinc-500 leading-snug">{p.description}</div>}
                    {p.monetization_tie && (
                      <div className="mt-2 text-[11px] text-emerald-300/80 italic">→ {p.monetization_tie}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </GlassCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GlassCard className="p-5">
              <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                <Flame className="h-5 w-5 text-rose-400" /> The 15 Dogmas
              </h3>
              <p className="text-xs text-zinc-500 mb-3">Every piece of content carries exactly one.</p>
              <ol className="space-y-2 text-sm leading-snug">
                {(dogmas ?? []).map((d) => (
                  <li key={d.id} className="flex gap-2.5 border-b border-zinc-800 pb-2 last:border-b-0">
                    <span className="font-mono text-amber-300/70 shrink-0 w-6">{String(d.number).padStart(2, '0')}</span>
                    <span className="text-zinc-200">{d.text}</span>
                  </li>
                ))}
              </ol>
            </GlassCard>

            <div className="space-y-4">
              <GlassCard className="p-5">
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <Quote className="h-5 w-5 text-cyan-300" /> 8 Cinematic Moments
                </h3>
                <p className="text-xs text-zinc-500 mb-3">Spine of every long-form. Use surgically.</p>
                <ol className="space-y-1.5 text-sm">
                  {CINEMATIC_MOMENTS.map((m) => (
                    <li key={m.num} className="flex items-baseline gap-2">
                      <span className="font-mono text-amber-300/70 shrink-0 w-5">{m.num}</span>
                      <div>
                        <span className="font-medium">{m.name}</span>
                        <span className="text-zinc-500 italic"> — {m.note}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </GlassCard>

              <GlassCard className="p-5">
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <Sparkles className="h-5 w-5 text-amber-300" /> Voice Rules
                </h3>
                <p className="text-xs text-zinc-500 mb-3">Hard. Enforced at the output gate.</p>
                <div className="space-y-2.5 text-sm">
                  {VOICE_RULES.map((r, i) => (
                    <div key={i} className="border-l-2 border-amber-500/40 pl-3">
                      <div className="text-emerald-300 text-xs uppercase tracking-wider font-mono">DO</div>
                      <div className="mb-1">{r.do_text}</div>
                      <div className="text-rose-400 text-xs uppercase tracking-wider font-mono">DON'T</div>
                      <div className="text-zinc-400">{r.dont}</div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </div>

          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" /> Proof-Backed Hooks
                {selectedPillarCode && <Badge className="ml-2">filtered: {selectedPillarCode}</Badge>}
              </h3>
              <Badge variant="outline">{(cwHooks ?? []).length} in library</Badge>
            </div>
            <p className="text-xs text-zinc-500 mb-3">
              Why each hook works → linked pillar + dogma + ICP/Nurture audience. Click a pillar above to filter.
              Empty rows mean the hook has been authored but not yet posted; outlier multipliers populate after cw_posts get analytics.
            </p>
            <div className="space-y-2">
              {(cwHooks ?? [])
                .filter(h => !selectedPillarCode || (pillars ?? []).find(p => p.id === h.cw_ideas?.pillar_id)?.code === selectedPillarCode)
                .slice(0, 30)
                .map((h) => {
                  const pillar = (pillars ?? []).find(p => p.id === h.cw_ideas?.pillar_id);
                  return (
                    <div key={h.id} className="rounded-md border border-zinc-700/50 bg-white dark:bg-zinc-900/40 p-3">
                      <div className="text-sm leading-snug">"{h.text}"</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {pillar && <Badge variant="outline">{pillar.code} {pillar.name}</Badge>}
                        {h.cw_ideas?.audience && <Badge variant="outline" className={h.cw_ideas.audience === "icp" ? "border-emerald-500/40 text-emerald-300" : ""}>{h.cw_ideas.audience}</Badge>}
                        {h.is_agenda && <Badge variant="outline" className="border-rose-500/40 text-rose-300">agenda</Badge>}
                        {h.context_ok && h.contrarian_ok && h.openloop_ok && (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">3 C's ✓</Badge>
                        )}
                        <span className="text-zinc-600 italic ml-auto truncate max-w-[40%]" title={h.cw_ideas?.title ?? ""}>
                          {h.cw_ideas?.title}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {(cwHooks ?? []).length === 0 && (
                <EmptyState
                  icon={<Anchor className="h-7 w-7" />}
                  title="No hooks in ContentWheel yet"
                  description="Seed cw_ideas + cw_hooks via the Sandcastles Lab tab → paste research → run engine → insert. Today's pack already wrote 11 ideas and 12 hooks; refresh if you don't see them."
                />
              )}
            </div>
          </GlassCard>
        </TabsContent>

        {/* SANDCASTLES LAB — operate the demand → content engine */}
        <TabsContent value="sandcastles" className="mt-4 space-y-4">
          <SandcastlesAutonomous />
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
                      <Badge variant="outline" className="mb-2">
                        {a.platform === "snapchat" ? "No public count" : "API not authed"}
                      </Badge>
                      {a.platform === "snapchat" && <SnapManualInput handle={a.channel_handle ?? "@SamuelJamesHQ"} />}
                      {a.raw_json?.note != null && (
                        <p className="mt-2 text-xs">{String(a.raw_json.note)}</p>
                      )}
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>
          <Card className="p-4 mt-3 border-amber-500/30 bg-amber-500/5">
            <div className="text-xs text-amber-200/90 leading-relaxed">
              <strong className="text-amber-300">Snapchat note:</strong> Snap doesn't expose public subscriber counts unless your account is a designated Snap Star (apply once you cross 1K subscribers + post Spotlight regularly). Until then, use the "Set Snap stats" input above to log your Snap Insights numbers (in app: Profile → ⚙ → Snap Insights) — they land in <code>social_bot_analytics_snapshots</code> and feed all KPIs.
            </div>
          </Card>
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
                icon={<MessageSquare className="h-7 w-7" />}
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
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 font-mono bg-white dark:bg-zinc-950/50 p-4 rounded border border-zinc-800 max-h-[500px] overflow-y-auto">
                {data.scoreboard.scoreboard_md}
              </pre>
            ) : (
              <EmptyState
                icon={<Crown className="h-7 w-7" />}
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
                <div key={h.id} className="flex items-start gap-3 rounded-md border border-zinc-800 bg-white dark:bg-zinc-900/30 p-3">
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

// ============================================================================
// SnapManualInput — Snap doesn't expose API. Sam pastes numbers from Snap Insights.
// ============================================================================
function SnapManualInput({ handle }: { handle: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subs, setSubs] = useState("");
  const [storyViews, setStoryViews] = useState("");
  const [spotlightViews, setSpotlightViews] = useState("");
  const save = async () => {
    const subN = parseInt(subs, 10);
    const storyN = parseInt(storyViews, 10);
    const spotN = parseInt(spotlightViews, 10);
    if (Number.isNaN(subN) && Number.isNaN(storyN) && Number.isNaN(spotN)) {
      toast.error("Enter at least one number");
      return;
    }
    const { error } = await (supabase as any).from("social_bot_analytics_snapshots").insert({
      platform: "snapchat",
      channel_handle: handle,
      subscribers: Number.isNaN(subN) ? null : subN,
      views_window: Number.isNaN(spotN) ? null : spotN,
      raw_json: {
        source: "manual_snap_insights",
        story_views_recent: Number.isNaN(storyN) ? null : storyN,
        spotlight_views_total: Number.isNaN(spotN) ? null : spotN,
        entered_by: "dashboard",
      },
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Snap stats logged");
    qc.invalidateQueries({ queryKey: ["social-bot-dashboard"] });
    setOpen(false); setSubs(""); setStoryViews(""); setSpotlightViews("");
  };
  if (!open) {
    return <Button size="sm" variant="outline" className="mt-1 w-full" onClick={() => setOpen(true)}>Set Snap stats</Button>;
  }
  return (
    <div className="mt-2 space-y-1.5 p-2 rounded bg-white dark:bg-zinc-900/60 border border-zinc-700">
      <Input className="h-8 text-xs" placeholder="Subscribers" value={subs} onChange={(e) => setSubs(e.target.value)} />
      <Input className="h-8 text-xs" placeholder="Story views (recent)" value={storyViews} onChange={(e) => setStoryViews(e.target.value)} />
      <Input className="h-8 text-xs" placeholder="Spotlight views total" value={spotlightViews} onChange={(e) => setSpotlightViews(e.target.value)} />
      <div className="flex gap-1.5">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ============================================================================
// BlockerActions — 1-click resolution per blocker intent
// ============================================================================
function BlockerActions({ blocker, onResolve }: { blocker: Blocker; onResolve: () => void }) {
  const title = blocker.title.toLowerCase();
  const actions: Array<{ label: string; href?: string; onClick?: () => void; primary?: boolean }> = [];

  if (title.includes("samueljameshq.com")) {
    actions.push({ label: "Open Vercel domain buy", href: "https://vercel.com/samcom593-creators-projects/samueljameshq/domains", primary: true });
    actions.push({ label: "Namecheap search", href: "https://www.namecheap.com/domains/registration/results/?domain=samueljameshq.com" });
  } else if (title.includes("handle") || title.includes("rebrand")) {
    actions.push({ label: "Check TT", href: "https://www.tiktok.com/@SamuelJamesHQ", primary: true });
    actions.push({ label: "Check IG", href: "https://instagram.com/SamuelJamesHQ" });
  } else if (title.includes("stripe") || title.includes("mentorship") || title.includes("payment link")) {
    actions.push({ label: "Stripe dashboard", href: "https://dashboard.stripe.com/payment-links", primary: true });
  } else if (title.includes("upload gap") || title.includes("youtube")) {
    actions.push({ label: "YT Studio upload", href: "https://studio.youtube.com/", primary: true });
  } else if (title.includes("supabase") || title.includes("pat") || title.includes("readymode")) {
    actions.push({ label: "Create Supabase PAT", href: "https://supabase.com/dashboard/account/tokens", primary: true });
  } else if (title.includes("analytics") || title.includes("api")) {
    actions.push({ label: "TikTok Developers", href: "https://developers.tiktok.com/" });
    actions.push({ label: "Meta for Devs", href: "https://developers.facebook.com/" });
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
      {actions.map((a, i) => (
        a.href ? (
          <a
            key={i}
            href={a.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors ${a.primary ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-zinc-700 text-zinc-300 hover:bg-slate-50 dark:bg-zinc-800"}`}
          >
            <ArrowRight className="h-3 w-3" /> {a.label}
          </a>
        ) : (
          <Button key={i} size="sm" variant={a.primary ? "default" : "ghost"} onClick={a.onClick}>{a.label}</Button>
        )
      ))}
      <Button size="sm" variant="ghost" onClick={onResolve}>Mark Resolved</Button>
    </div>
  );
}

// ============================================================================
// Sandcastles Autonomous — topic in, daemon does the rest
// ============================================================================
type SandcastlesQueueRow = {
  id: number; requested_at: string; topic: string; hint: string | null;
  status: "queued" | "running" | "complete" | "failed";
  started_at: string | null; completed_at: string | null;
  ideas_inserted: number | null; hooks_inserted: number | null; mines_inserted: number | null;
  result_json: Record<string, unknown> | null; error_text: string | null;
};
const SUGGESTED_TOPICS = [
  "Leaving a stable W-2 job for commission/insurance sales — fear and objections",
  "Why new insurance/sales agents quit in the first 90 days",
  "How young people make six figures in sales with no degree",
  "What nobody tells you before joining a sales/insurance agency",
  "Recruiting agents without cold-calling or buying leads",
  "Faith + ambition: how Christian operators reconcile money vs God",
  "287→220: hybrid-athlete cut at 20 with no PEDs",
];
function SandcastlesAutonomous() {
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");
  const [hint, setHint] = useState("");
  const { data: queue } = useQuery({
    queryKey: ["sandcastles_queue"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sandcastles_queue").select("*")
        .order("requested_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as SandcastlesQueueRow[];
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const runAutonomous = async (t: string, h?: string) => {
    if (!t.trim()) { toast.error("Topic required"); return; }
    const { error } = await (supabase as any).from("sandcastles_queue").insert({
      topic: t.trim(), hint: (h ?? "").trim() || null, requested_by: "dashboard",
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Queued — daemon picks up within 2 min`);
    qc.invalidateQueries({ queryKey: ["sandcastles_queue"] });
    if (t === topic) setTopic("");
    setHint("");
  };
  const counts = (queue ?? []).reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return (
    <>
      <GlassCard className="p-5">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-purple-300" /> Sandcastles — Autonomous
            </h3>
            <p className="text-sm text-zinc-400 mt-1 leading-snug">
              Type a topic. Click Run. Daemon does research, runs Gate A → Translation → Gate B, inserts ideas + hooks into ContentWheel. You do nothing else.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500 font-mono shrink-0">
            <div>queued <span className="text-amber-300">{counts.queued ?? 0}</span></div>
            <div>running <span className="text-cyan-300">{counts.running ?? 0}</span></div>
            <div>complete <span className="text-emerald-300">{counts.complete ?? 0}</span></div>
            {(counts.failed ?? 0) > 0 && <div>failed <span className="text-rose-300">{counts.failed}</span></div>}
          </div>
        </div>
        <div className="space-y-2">
          <Input
            placeholder="Narrow topic (e.g. 'Why new agents quit in the first 90 days')"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="text-sm"
          />
          <Input
            placeholder="Optional hint: competitors, subreddits, demographic… (e.g. 'Cody Askins, r/insurancesales, 22-28 yo')"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={() => runAutonomous(topic, hint)} disabled={!topic.trim()}>
              <FlaskConical className="h-4 w-4 mr-1.5" /> Run Autonomous
            </Button>
            <span className="text-xs text-zinc-500 self-center">Daemon: <code>com.samjames.apex.sandcastles-worker</code> · every 2 min</span>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-mono mb-2">Quick-pick topics (1 click)</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_TOPICS.map((t) => (
              <button
                key={t}
                onClick={() => runAutonomous(t)}
                className="text-xs px-2.5 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15 transition-colors leading-snug max-w-md text-left"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="text-base font-semibold mb-3">Run history</h3>
        {(queue ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">No runs yet. Drop a topic above to kick off the first one.</p>
        ) : (
          <div className="space-y-2">
            {(queue ?? []).map((r) => (
              <div key={r.id} className="rounded border border-zinc-700/50 bg-white dark:bg-zinc-900/40 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-snug truncate">{r.topic}</div>
                    {r.hint && <div className="text-xs text-zinc-500 mt-0.5 italic">hint: {r.hint}</div>}
                    <div className="text-xs text-zinc-500 mt-1">
                      {format(parseISO(r.requested_at), "MMM d HH:mm")}
                      {r.completed_at && ` · finished in ${Math.max(1, Math.round((new Date(r.completed_at).getTime() - new Date(r.requested_at).getTime()) / 1000))}s`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant="outline" className={
                      r.status === "complete" ? "border-emerald-500/40 text-emerald-300" :
                      r.status === "running"  ? "border-cyan-500/40 text-cyan-300" :
                      r.status === "failed"   ? "border-rose-500/40 text-rose-300" :
                      "border-amber-500/40 text-amber-300"
                    }>{r.status}</Badge>
                    {r.status === "complete" && (
                      <div className="text-xs text-zinc-400 mt-1">
                        {(r.ideas_inserted ?? 0)} ideas · {(r.hooks_inserted ?? 0)} hooks · {(r.mines_inserted ?? 0)} mines
                      </div>
                    )}
                  </div>
                </div>
                {r.error_text && <div className="text-xs text-rose-300 mt-2">{r.error_text}</div>}
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </>
  );
}
