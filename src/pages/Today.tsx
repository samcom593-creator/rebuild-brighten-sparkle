import { useState, useEffect, useMemo } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import {
  Sunrise, Target, Flame, Coffee, TrendingUp, Users,
  DollarSign, Mic, FileText, CheckCircle2, Copy, Calendar as CalendarIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

interface TopAgent { name: string; alp: number; }

export default function Today() {
  const { isAdmin } = useAuth();
  const [weekAlp, setWeekAlp]     = useState(0);
  const [weekDeals, setWeekDeals] = useState(0);
  const [activeAgents, setActiveAgents] = useState(0);
  const [pipeline, setPipeline]   = useState(0);
  const [uncontacted, setUncontacted] = useState(0);
  const [contractedWeek, setContractedWeek] = useState(0);
  const [top5, setTop5]           = useState<TopAgent[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const monday = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
        const sunday = format(endOfWeek(now,   { weekStartsOn: 1 }), "yyyy-MM-dd");
        const weekStart7 = new Date(Date.now() - 7 * 86400000).toISOString();

        const [
          { data: deals },
          { data: agents },
          { data: apps },
          { data: unr },
          { data: contracted },
        ] = await Promise.all([
          // Pull from deals (Agent Link truth) by effective_date with valid
          // status — matches the rest of the dashboards. daily_production
          // is agent self-report and drifts from agency totals.
          supabase.from("deals").select("agent_id, annual_premium")
            .gte("effective_date", monday).lte("effective_date", sunday)
            .in("status", ["submitted", "active"]),
          supabase.from("agents").select("id, profile:profiles(full_name)")
            .eq("is_deactivated", false).eq("is_inactive", false).eq("status", "active"),
          supabase.from("applications").select("id", { count: "exact", head: true })
            .is("terminated_at", null).is("contracted_at", null),
          supabase.from("applications").select("id", { count: "exact", head: true })
            .is("terminated_at", null).is("contacted_at", null),
          supabase.from("applications").select("id", { count: "exact", head: true })
            .gte("contracted_at", weekStart7).is("terminated_at", null),
        ]);

        if (cancelled) return;

        const nameById: Record<string, string> = {};
        for (const a of (agents ?? []) as any[]) nameById[a.id] = a.profile?.full_name ?? "Agent";

        const totals: Record<string, number> = {};
        let totalAlp = 0, totalDeals = 0;
        for (const r of (deals ?? []) as any[]) {
          const n = Number(r.annual_premium ?? 0);
          totalAlp += n; totalDeals += 1;
          if (r.agent_id) totals[r.agent_id] = (totals[r.agent_id] ?? 0) + n;
        }
        const top = Object.entries(totals)
          .map(([id, alp]) => ({ name: nameById[id] ?? "Agent", alp }))
          .sort((a, b) => b.alp - a.alp).slice(0, 5);

        setWeekAlp(Math.round(totalAlp));
        setWeekDeals(totalDeals);
        setActiveAgents((agents ?? []).length);
        setPipeline(((apps as any)?.count ?? 0));
        setUncontacted(((unr as any)?.count ?? 0));
        setContractedWeek(((contracted as any)?.count ?? 0));
        setTop5(top);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Dynamic today's target: close 1 recruit per 15 live pipeline slots ──
  const recruitTargetToday = useMemo(() => {
    const base = Math.max(1, Math.ceil(pipeline / 15));
    return Math.min(base, 5); // cap sanity
  }, [pipeline]);

  // Dynamic production target: 20% uplift on weekly run-rate / 7
  const prodTargetToday = useMemo(() => Math.max(500, Math.round((weekAlp / 7) * 1.2)), [weekAlp]);

  const briefNotes = useMemo(() => [
    `Pipeline live: ${pipeline} applicants, ${uncontacted} still uncontacted.`,
    `${contractedWeek} new contracts last 7 days — ${recruitTargetToday === 1 ? "push 1 more today" : `target ${recruitTargetToday} today`}.`,
    top5[0]
      ? `Top producer this week: ${top5[0].name} at ${fmt$(top5[0].alp)}. Shout-out in group chat.`
      : "No production logged yet this week — open day 1 hard.",
    activeAgents > 0 && weekAlp / Math.max(activeAgents, 1) < 1000
      ? "Team per-agent average under $1K weekly — set the pace in first hour."
      : `Team per-agent avg this week: ${fmt$(weekAlp / Math.max(activeAgents, 1))}.`,
    `Production target today: ${fmt$(prodTargetToday)} (20% over run-rate).`,
  ], [pipeline, uncontacted, contractedWeek, recruitTargetToday, top5, activeAgents, weekAlp, prodTargetToday]);

  const huddleMsg = useMemo(() => {
    const topLine = top5[0] ? `🔥 ${top5[0].name} leading the board — ${fmt$(top5[0].alp)}.` : "🌅 Fresh day, open board.";
    return [
      `*APEX Morning Huddle — ${format(new Date(), "EEE MMM d")}*`,
      "",
      topLine,
      "",
      `Pipeline: ${pipeline} live · Uncontacted: ${uncontacted} · New contracts this week: ${contractedWeek}`,
      `Today's focus: close ${recruitTargetToday} recruit${recruitTargetToday > 1 ? "s" : ""}, hit ${fmt$(prodTargetToday)} team ALP.`,
      "",
      "🏆 *Top 5 This Week:*",
      ...top5.map((a, i) => `${i + 1}. ${a.name} — ${fmt$(a.alp)}`),
      "",
      "Let's lock in. 💥",
    ].join("\n");
  }, [top5, pipeline, uncontacted, contractedWeek, recruitTargetToday, prodTargetToday]);

  const copyHuddle = async () => {
    await navigator.clipboard.writeText(huddleMsg);
    toast.success("Copied — paste into WhatsApp / Discord");
  };

  const postToTeamChat = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) { toast.error("Sign in required"); return; }
      const { data: prof } = await supabase.from("profiles").select("full_name, avatar_url")
        .eq("user_id", userData.user.id).maybeSingle();
      const { error } = await supabase.from("team_chat_messages" as any).insert({
        user_id: userData.user.id,
        author_name: (prof as any)?.full_name ?? "Sam",
        author_avatar: (prof as any)?.avatar_url ?? null,
        body: huddleMsg,
      });
      if (error) throw error;
      toast.success("Posted to Team Chat — everyone sees it live");
    } catch (e: any) {
      toast.error(e?.message ?? "Post failed");
    }
  };

  const triggerMorningBrief = async () => {
    try {
      const { error } = await supabase.functions.invoke("morning-brief", { body: {} });
      if (error) throw error;
      toast.success("Discord + email sent");
    } catch (e: any) {
      toast.error(e?.message ?? "Morning brief not deployed yet");
    }
  };

  const waHref = `https://wa.me/?text=${encodeURIComponent(huddleMsg)}`;
  const calendlyHref = "https://calendly.com/sam-com593/1on1-call-clone";

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="h-32 bg-muted/30 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/30 to-violet-500/20 flex items-center justify-center">
          <Sunrise className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="apex-headline text-3xl md:text-4xl font-bold">Today</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE · MMMM d, yyyy")}</p>
        </div>
      </div>

      {/* Headline targets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-4 bg-gradient-to-br from-emerald-500/15 to-transparent border-emerald-500/30 win-glow card-tilt">
          <div className="flex items-center gap-2 mb-1"><Target className="h-4 w-4 text-emerald-400" /><span className="text-[10px] uppercase tracking-wider text-emerald-300">Recruit Target</span></div>
          <div className="text-3xl font-bold tabular-nums text-emerald-300">{recruitTargetToday}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">close today</div>
        </GlassCard>
        <GlassCard className="p-4 bg-gradient-to-br from-amber-500/15 to-transparent border-amber-500/30 gold-glow card-tilt">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="h-4 w-4 text-amber-400" /><span className="text-[10px] uppercase tracking-wider text-amber-300">ALP Target</span></div>
          <div className="text-3xl font-bold tabular-nums text-amber-300">{fmt$(prodTargetToday)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">team today</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-primary" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pipeline Live</span></div>
          <div className="text-3xl font-bold tabular-nums">{pipeline}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{uncontacted} uncontacted</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="h-4 w-4 text-violet-400" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Week ALP</span></div>
          <div className="text-3xl font-bold tabular-nums text-violet-300">{fmt$(weekAlp)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{weekDeals} deals · {activeAgents} active</div>
        </GlassCard>
      </div>

      {/* Meeting brief + top 5 */}
      <div className="grid md:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-3"><Coffee className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Meeting Brief</h2></div>
          <ul className="space-y-2.5">
            {briefNotes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-3"><Flame className="h-5 w-5 text-amber-400" /><h2 className="text-lg font-bold">Top 5 This Week</h2></div>
          {top5.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No production logged yet this week.</p>
          ) : (
            <div className="space-y-2">
              {top5.map((a, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors leaderboard-row relative">
                  <span className="flex items-center gap-2">
                    <span className="w-6 text-center">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="text-xs text-muted-foreground">{i + 1}.</span>}</span>
                    <span className="font-semibold text-sm">{a.name}</span>
                  </span>
                  <span className={cn("tabular-nums font-bold text-sm", i < 3 ? "text-amber-300" : "text-muted-foreground")}>
                    {fmt$(a.alp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Quick share row — copy huddle text, send to chat, or fire Discord */}
      {isAdmin && (
        <GlassCard className="p-4">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground mr-2">Push the huddle:</span>
            <Button onClick={copyHuddle} size="sm" className="gap-1.5"><Copy className="h-3.5 w-3.5" /> Copy</Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={waHref} target="_blank" rel="noopener noreferrer" rel="noopener"><FileText className="h-3.5 w-3.5" /> WhatsApp</a>
            </Button>
            <Button onClick={postToTeamChat} size="sm" variant="outline" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Team Chat
            </Button>
            <Button onClick={triggerMorningBrief} size="sm" variant="outline" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Discord + Email
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Calendly */}
      {isAdmin && (
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <CalendarIcon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <h3 className="font-semibold">Your Calendly</h3>
              <p className="text-xs text-muted-foreground">One-tap to share with a recruit or copy link for bio.</p>
            </div>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={calendlyHref} target="_blank" rel="noopener noreferrer" rel="noopener">Open</a>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(calendlyHref); toast.success("Calendly link copied"); }}>
              <Copy className="h-3.5 w-3.5" /> Copy link
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
