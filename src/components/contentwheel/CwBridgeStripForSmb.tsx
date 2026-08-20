import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Crown, ArrowRight, Flame, TrendingUp, Users2, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface SmbCwBridgeRow {
  posts_today: { posts_today: number; quota: number; quota_met: boolean } | null;
  kpi_7d: { views_7d: number; followers_7d: number; vf_pct: number; posts_7d: number } | null;
  pipeline: { to_contact: number; contacted: number; responded: number; booked: number; contracted: number; total: number } | null;
  shot_vs_posted: { ratio: number; bottom_of_barrel_warning: boolean } | null;
  active_outliers: number;
  backlog_ideas: number;
  audience_split: { icp_pct: number; total: number } | null;
  smb_links_count: number;
}

/**
 * ContentWheel KPI strip rendered at the TOP of the Social Media Bot page.
 *
 * Two systems, two purposes:
 *   • This page (SMB) is the DOER — today's drafts, daemon health, blockers.
 *   • ContentWheel is the BRAIN — doctrine, the wheel, outliers, recruiting.
 *
 * This strip surfaces "how are the things I'm shipping actually performing
 * inside the wheel?" so the doer never operates blind to strategy.
 *
 * Backing view: v_smb_cw_bridge. Polls every 60s.
 */
export function CwBridgeStripForSmb() {
  const { data, isLoading } = useQuery({
    queryKey: ["smb", "cw-bridge"],
    queryFn: async (): Promise<SmbCwBridgeRow | null> => {
      const { data, error } = await supabase
        .from("v_smb_cw_bridge")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as SmbCwBridgeRow) ?? null;
    },
    staleTime: 30_000,
    refetchInterval: 300_000,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-4 animate-pulse">
        <div className="text-xs text-muted-foreground">Loading ContentWheel bridge…</div>
      </div>
    );
  }

  const postsToday = data.posts_today?.posts_today ?? 0;
  const quota = data.posts_today?.quota ?? 2;
  const quotaMet = data.posts_today?.quota_met ?? false;
  const vfPct = Number(data.kpi_7d?.vf_pct ?? 0);
  const outliers = data.active_outliers ?? 0;
  const pipeline = data.pipeline;
  const split = data.audience_split;

  return (
    <div className="rounded-md border border-amber-500/30 bg-white dark:bg-card p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-amber-500/15 p-2 border border-amber-500/30 shrink-0">
            <Crown className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">From ContentWheel · the BRAIN</p>
            <h3 className="text-sm font-semibold tracking-tight">How is what you're shipping actually performing?</h3>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              Doctrine + the wheel. Every shipped SMB draft auto-flows into cw_posts → outlier detection + audience tracking + 90-day deal cycle.
            </p>
          </div>
        </div>
        <Link
          to="/admin/contentwheel"
          className="text-xs inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 px-2.5 py-1.5 transition-colors shrink-0"
        >
          Open ContentWheel <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Stat
          icon={Target}
          label="Posts today"
          value={`${postsToday} / ${quota}`}
          sub={quotaMet ? "Quota met" : "2/day minimum"}
          tone={quotaMet ? "ok" : "alert"}
        />
        <Stat
          icon={TrendingUp}
          label="View → Follower"
          value={`${vfPct.toFixed(2)}%`}
          sub={`7d · target 0.5–1%`}
          tone={vfPct >= 1 ? "ok" : vfPct >= 0.5 ? "warn" : "alert"}
        />
        <Stat
          icon={Flame}
          label="Active outliers"
          value={`${outliers}`}
          sub={outliers > 0 ? "Iterate the veins" : "no 5× posts yet"}
          tone={outliers > 0 ? "warn" : "neutral"}
        />
        <Stat
          icon={Users2}
          label="Pipeline"
          value={`${pipeline?.booked ?? 0} booked`}
          sub={`${pipeline?.responded ?? 0} responded · ${pipeline?.to_contact ?? 0} to contact`}
          tone={(pipeline?.booked ?? 0) > 0 ? "ok" : "neutral"}
        />
        <Stat
          icon={Crown}
          label="ICP / Nurture"
          value={`${Math.round(split?.icp_pct ?? 0)}%`}
          sub={`${split?.total ?? 0} active ideas · target ~20% ICP`}
          tone="neutral"
        />
      </div>

      {data.shot_vs_posted?.bottom_of_barrel_warning && (
        <div className="mt-3 rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-300 leading-snug">
          ContentWheel: posting more than half of what you shoot. Shoot 2× what you post.
        </div>
      )}
    </div>
  );
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "alert" | "neutral";
}

function Stat({ icon: Icon, label, value, sub, tone }: StatProps) {
  const ring: Record<StatProps["tone"], string> = {
    ok:      "border-emerald-500/25 bg-emerald-500/5",
    warn:    "border-amber-500/30 bg-amber-500/5",
    alert:   "border-rose-500/40 bg-rose-500/10",
    neutral: "border-border bg-card/40",
  };
  const accent: Record<StatProps["tone"], string> = {
    ok:      "text-emerald-300",
    warn:    "text-amber-300",
    alert:   "text-rose-300",
    neutral: "text-foreground",
  };
  return (
    <div className={cn("rounded-lg border p-3", ring[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("mt-1.5 text-lg font-bold tabular-nums leading-none", accent[tone])}>{value}</div>
      <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{sub}</p>
    </div>
  );
}
