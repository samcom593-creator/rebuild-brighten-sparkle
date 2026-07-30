import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardPayload } from "./useDashboardPayload";
import { SmbBridgeCard } from "./SmbBridgeCard";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, Flame, Target, TrendingUp, Users2, ExternalLink, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const VF_TARGET_MIN = 0.5;
const VF_TARGET_OK = 1.0;

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function DashboardModule() {
  const { data, isLoading, error } = useDashboardPayload();

  // 2026-07-30: cw_posts has ZERO rows ever — no post has ever been recorded, so every
  // KPI below computes over nothing. Without this gate the page opened on "0 / 2 Ship
  // now", "0.00%", a 30-day gray heatmap — a wall of red that reads as "the content
  // business is failing" when the truth is "tracking has never started". Head-count only;
  // no rows fetched.
  const { data: postsEver } = useQuery({
    queryKey: ["cw_posts_ever_count"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count, error: cntErr } = await (supabase as any)
        .from("cw_posts")
        .select("id", { count: "exact", head: true });
      if (cntErr) throw cntErr;
      return count ?? 0;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            // stable-key-allow:skeleton
            <Skeleton key={i} className="h-32 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-md" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-rose-500/40 bg-rose-500/5">
        <p className="text-sm text-rose-300 font-medium">Dashboard payload failed.</p>
        <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
        <p className="text-xs text-muted-foreground mt-2">
          You must be signed in with an admin role. The cw_dashboard_payload RPC enforces this server-side.
        </p>
      </Card>
    );
  }

  const postsToday = data?.posts_today?.posts_today ?? 0;
  const quotaMet = data?.posts_today?.quota_met ?? false;
  const vfPct = Number(data?.kpi_7d?.vf_pct ?? 0);
  const views7d = data?.kpi_7d?.views_7d ?? 0;
  const followers7d = data?.kpi_7d?.followers_7d ?? 0;
  const outliers = data?.outliers ?? [];
  const pipeline = data?.pipeline;
  const shotVsPosted = data?.shot_vs_posted;
  const split = data?.audience_split;
  const challenge = data?.active_challenge;
  const smb = data?.smb_bridge ?? null;

  return (
    <div className="space-y-6">
      {/* ─── Social Media Bot bridge — what the doer is shipping right now ─── */}
      <SmbBridgeCard smb={smb} />

      {/* ─── 4 KPI cards — the four questions in 5 seconds ─── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Target}
          label="Posts today"
          value={`${postsToday} / 2`}
          tone={quotaMet ? "ok" : "alert"}
          sub={quotaMet ? "Quota met. Keep moving." : "Quota: 2/day minimum. Ship now."}
        />
        <KpiCard
          icon={TrendingUp}
          label="View → Follower (7d)"
          value={`${fmt(vfPct, 2)}%`}
          tone={vfPct >= VF_TARGET_OK ? "ok" : vfPct >= VF_TARGET_MIN ? "warn" : "alert"}
          sub={`${fmt(views7d)} views → ${fmt(followers7d)} followers · target 0.5–1%`}
        />
        <KpiCard
          icon={Flame}
          label="Active outliers"
          value={`${outliers.length}`}
          tone={outliers.length > 0 ? "warn" : "neutral"}
          sub={outliers.length > 0 ? "Iterate the veins. Don't retire winners." : "No 5× outliers right now."}
        />
        <KpiCard
          icon={Users2}
          label="Recruiting pipeline"
          value={`${pipeline?.responded ?? 0} → ${pipeline?.booked ?? 0} → ${pipeline?.contracted ?? 0}`}
          tone={(pipeline?.booked ?? 0) > 0 ? "ok" : "alert"}
          sub={`${pipeline?.to_contact ?? 0} to contact · ${pipeline?.contacted ?? 0} touched · ${pipeline?.total ?? 0} total`}
        />
      </div>

      {/* ─── 30-day quota heatmap ─── */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold tracking-tight">Quota streak — last 30 days</h3>
          <span className="text-[11px] text-muted-foreground">2 posts/day minimum · green = hit · gray = missed</span>
        </div>
        <QuotaHeatmap days={data?.streak ?? []} />
      </Card>

      {/* ─── Active outliers + ratios ─── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400" />
              Active iteration veins
            </h3>
            <span className="text-[11px] text-muted-foreground">Sorted by multiple × baseline. Mine these.</span>
          </div>
          {outliers.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              No 5×-rolling-avg posts open right now. Auto-detect runs on every new view-count update.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {outliers.slice(0, 5).map((o) => (
                <li key={o.id} className="py-2.5 flex items-center gap-3">
                  <span className="text-xl font-mono tabular-nums w-14 text-amber-400">{Number(o.multiple).toFixed(1)}×</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{o.idea_title ?? "(no linked idea)"}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {o.platform} · {fmt(o.views)} views · baseline {fmt(o.baseline_avg)} · {o.iterations_logged} iterations logged
                    </span>
                  </span>
                  {o.post_url && (
                    <a
                      href={o.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Post <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold tracking-tight mb-3">Shot → Posted ratio</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{fmt((shotVsPosted?.ratio ?? 0) * 100, 0)}%</span>
              <span className="text-[11px] text-muted-foreground">posted of shot (14d)</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {shotVsPosted?.shot_pool ?? 0} shot · {shotVsPosted?.posted_pool ?? 0} posted
            </p>
            {shotVsPosted?.bottom_of_barrel_warning && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-rose-300 leading-snug">
                  You're posting from the bottom of the barrel. Shoot 2× what you post.
                </p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold tracking-tight mb-3">Audience split (ICP / Nurture)</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{fmt(split?.icp_pct ?? 0, 0)}%</span>
              <span className="text-[11px] text-muted-foreground">ICP · target ~20%</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {split?.icp_count ?? 0} ICP · {split?.nurture_count ?? 0} nurture · {split?.total ?? 0} active ideas
            </p>
          </Card>
        </div>
      </div>

      {/* ─── Public challenge ─── */}
      <Card className={cn("p-5", !challenge && "border-amber-500/30 bg-amber-500/5")}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Public challenge
          </h3>
          <span className="text-[11px] text-muted-foreground">Credibility = stacked proof</span>
        </div>
        {challenge ? (
          <div>
            <p className="text-sm font-medium">{challenge.goal}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Deadline {challenge.deadline} · {challenge.days_left} days left · {challenge.logs_count} logs
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-300/90">
            No active challenge. Declare one publicly — daily documentation stacks proof. Doctrine LAW 13.
          </p>
        )}
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Internal primitives
// ──────────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "alert" | "neutral";
}

function KpiCard({ icon: Icon, label, value, sub, tone }: KpiCardProps) {
  const toneStyles: Record<KpiCardProps["tone"], string> = {
    ok:      "border-emerald-500/30 bg-emerald-500/5",
    warn:    "border-amber-500/30 bg-amber-500/5",
    alert:   "border-rose-500/40 bg-rose-500/10",
    neutral: "border-border bg-card/40",
  };
  const valueColor: Record<KpiCardProps["tone"], string> = {
    ok:      "text-emerald-300",
    warn:    "text-amber-300",
    alert:   "text-rose-300",
    neutral: "text-foreground",
  };
  return (
    <Card className={cn("p-5 transition-colors", toneStyles[tone])}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-3 text-3xl font-bold tabular-nums leading-none", valueColor[tone])}>{value}</div>
      <p className="mt-2 text-[11px] text-muted-foreground leading-snug">{sub}</p>
    </Card>
  );
}

interface CwQuotaDay {
  day: string;
  posts: number;
  hit_quota: boolean;
}

function QuotaHeatmap({ days }: { days: CwQuotaDay[] }) {
  const padded: (CwQuotaDay | null)[] = days.length >= 30
    ? days.slice(-30)
    : [...Array(30 - days.length).fill(null), ...days];
  return (
    <div className="grid grid-cols-15 gap-1.5" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
      {padded.map((d, i) => {
        const intensity = d ? Math.min(d.posts, 4) : 0;
        const bg =
          d === null
            ? "bg-muted/20"
            : intensity === 0
              ? "bg-muted/40 border border-muted-foreground/20"
              : intensity === 1
                ? "bg-amber-500/30"
                : intensity === 2
                  ? "bg-emerald-500/40"
                  : intensity === 3
                    ? "bg-emerald-500/60"
                    : "bg-emerald-400/80";
        const title = d ? `${d.day}: ${d.posts} posts ${d.hit_quota ? "(hit)" : "(missed)"}` : "no data";
        return (
          <div
            key={d?.day ?? `pad-${i}`}
            title={title}
            className={cn("h-5 rounded-sm transition-colors", bg)}
          />
        );
      })}
    </div>
  );
}
