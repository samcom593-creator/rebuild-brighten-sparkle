/**
 * MyPlaques — revamped. Reads from BOTH sources:
 *   - public.agentlink_rewards  (auto-issued nightly from leaderboard)
 *   - public.plaque_awards      (historical awards and original artwork)
 * Renders each with the unified <Plaque /> component. One grid, sorted
 * by date, share buttons per card. Admins see everyone; agents see
 * their own.
 */

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveAgentNames,
  AGENT_NAME_FALLBACK,
  type AgentNameSource,
} from "@/shared/api/agentDisplayNames";
import { useAuth } from "@/hooks/useAuth";
import { Award, Loader2, Crown, Medal, Trophy, Copy } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Plaque } from "@/components/plaque/Plaque";
import { presentPlaqueDate, presentPlaqueMetric } from "@/components/awards/plaqueAwardPresentation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AwardCopyActions } from "@/components/awards/AwardCopyActions";

type Card = {
  id: string;
  source: "reward" | "plaque";
  agentName: string;
  avatarUrl?: string | null;
  achievement: string;
  rank?: number;
  subtitle?: string;
  period?: string;
  description?: string;
  date: string;
  dateIso: string;
  imageUrl?: string | null;
  shareSlug?: string | null;
};

const REWARD_LIMIT = 500;
const PLAQUE_LIMIT = 100;
type AwardSource = "all" | "reward" | "plaque";

function rewardPremium(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value !== "number" && typeof value !== "string")) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount)
    : null;
}

function rewardPeriod(period: unknown, key: unknown): string {
  const label = period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : period === "monthly" ? "Monthly"
    : typeof period === "string" && period.trim() ? period.trim() : null;
  const periodKey = typeof key === "string" && key.trim() ? key.trim() : null;
  return `Award period: ${[label, periodKey].filter(Boolean).join(" · ") || "Not recorded"}`;
}

function hasAwardIdentity(row: unknown): row is Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  return typeof record.id === "string" && record.id.trim().length > 0
    && typeof record.agent_id === "string" && record.agent_id.trim().length > 0;
}

export default function MyPlaques() {
  usePageTitle("Award history · Galaxy");
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedSource = new URLSearchParams(location.search).get("source");
  const source: AwardSource = selectedSource === "reward" || selectedSource === "plaque" ? selectedSource : "all";
  const changeSource = (next: AwardSource) => {
    const params = new URLSearchParams(location.search);
    if (next === "all") params.delete("source");
    else params.set("source", next);
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
  };
  const [scope, setScope] = useState<"mine" | "all">(isAdmin || isManager ? "all" : "mine");
  const canViewAll = isAdmin || isManager;
  const effectiveScope = canViewAll ? scope : "mine";

  const awards = useQuery({
    queryKey: ["my-plaques", user?.id, effectiveScope],
    enabled: Boolean(user?.id) && !authLoading,
    queryFn: async ({ signal }) => {
      if (!user?.id) throw new Error("Sign in to verify your awards.");
      let myAgentId: string | null = null;
      if (effectiveScope === "mine") {
        const { data: agent, error } = await supabase.from("agents").select("id").eq("user_id", user.id)
          .order("created_at", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
        if (error) throw error;
        myAgentId = agent?.id ?? null;
        // An unresolved personal identity is not permission to request all awards.
        if (!myAgentId) return { identityUnavailable: true, cards: [] as Card[] };
      }

      const rewardsQ = supabase.from("agentlink_rewards" as any)
        .select("id, agent_id, period, period_key, rank, title, description, alp, awarded_at")
        .order("awarded_at", { ascending: false }).order("id", { ascending: true })
        .limit(REWARD_LIMIT + 1).abortSignal(signal);
      // Table is `plaque_awards` (not `plaques`). This was silently
      // returning 0 rows before — every agent saw an empty screen.
      // Also pulling image_svg_url as fallback since most rows have
      // only SVG populated.
      const plaquesQ = supabase.from("plaque_awards" as any)
        .select("id, agent_id, milestone_type, milestone_date, amount, image_png_url, image_svg_url, share_slug, badge_label, created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .limit(PLAQUE_LIMIT + 1).abortSignal(signal);

      const [rewardsRes, plaquesRes] = await Promise.all([
        myAgentId ? rewardsQ.eq("agent_id", myAgentId) : rewardsQ,
        myAgentId ? plaquesQ.eq("agent_id", myAgentId) : plaquesQ,
      ]);
      if (rewardsRes.error) throw rewardsRes.error;
      if (plaquesRes.error) throw plaquesRes.error;
      if (!Array.isArray(rewardsRes.data) || !Array.isArray(plaquesRes.data)) {
        throw new Error("The award history could not be verified.");
      }
      if (!rewardsRes.data.every(row => hasAwardIdentity(row) && typeof row.title === "string"
        && typeof row.awarded_at === "string" && Number.isFinite(Date.parse(row.awarded_at))
        && (row.period == null || typeof row.period === "string")
        && (row.period_key == null || typeof row.period_key === "string")
        && (row.description == null || typeof row.description === "string"))
        || !plaquesRes.data.every(row => hasAwardIdentity(row)
          && typeof row.milestone_type === "string" && row.milestone_type.trim().length > 0
          && (row.badge_label == null || typeof row.badge_label === "string")
          && typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)))) {
        throw new Error("The award records could not be verified.");
      }
      if (!rewardsRes.data.length && !plaquesRes.data.length) return { identityUnavailable: false, cards: [] as Card[] };

      const rewardsRows = rewardsRes.data.slice(0, REWARD_LIMIT);
      const plaquesRows = plaquesRes.data.slice(0, PLAQUE_LIMIT);

      const ids = new Set<string>();
      [...rewardsRows, ...plaquesRows].forEach((r: any) => {
        if (r.agent_id) ids.add(r.agent_id);
      });
      const { data: agents, error: agentError } = await supabase.from("agents")
        .select("id, user_id, display_name")
        .in("id", Array.from(ids)).abortSignal(signal);
      if (agentError) throw agentError;
      const resolved = await resolveAgentNames((agents ?? []) as AgentNameSource[]);
      const byId = new Map(
        (agents ?? []).map((a: any) => [
          a.id,
          { full_name: resolved.get(a.id)?.name ?? null, avatar_url: resolved.get(a.id)?.avatarUrl ?? null },
        ]),
      );

      const rewardCards: Card[] = rewardsRows.map((r: any) => ({
        id: `reward-${r.id}`,
        source: "reward",
        agentName: (byId.get(r.agent_id) as any)?.full_name ?? AGENT_NAME_FALLBACK,
        avatarUrl: (byId.get(r.agent_id) as any)?.avatar_url ?? null,
        achievement: r.title,
        rank: Number.isInteger(r.rank) && r.rank > 0 ? r.rank : undefined,
        subtitle: rewardPremium(r.alp) !== null ? `${rewardPremium(r.alp)} ALP` : "Recorded premium unavailable",
        period: rewardPeriod(r.period, r.period_key),
        description: r.description?.trim() || undefined,
        date: `Awarded: ${new Date(r.awarded_at).toLocaleDateString()}`,
        dateIso: r.awarded_at,
      }));

      const plaqueCards: Card[] = plaquesRows.map((p: any) => {
        const metric = presentPlaqueMetric(p);
        const milestoneDate = presentPlaqueDate({ ...p, milestone_date: p.milestone_date ?? "" });
        return {
          id: `plaque-${p.id}`,
          source: "plaque",
          agentName: (byId.get(p.agent_id) as any)?.full_name ?? AGENT_NAME_FALLBACK,
          avatarUrl: (byId.get(p.agent_id) as any)?.avatar_url ?? null,
          achievement: p.badge_label || p.milestone_type.replace(/_/g, " "),
          subtitle: `${metric.label}: ${metric.value ?? metric.missingText}`,
          date: `${milestoneDate.label}: ${milestoneDate.value}`,
          dateIso: p.milestone_date || p.created_at,
          imageUrl: p.image_png_url || p.image_svg_url,
          shareSlug: p.share_slug,
        };
      });

      const combined = [...rewardCards, ...plaqueCards].sort(
        (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
      );
      return { identityUnavailable: false, cards: combined, rewardsCapped: rewardsRes.data.length > REWARD_LIMIT, plaquesCapped: plaquesRes.data.length > PLAQUE_LIMIT };
    },
  });
  const allCards = awards.data?.cards ?? [];
  const cards = source === "all" ? allCards : allCards.filter(card => card.source === source);

  const copyShare = async (slug: string) => {
    const url = `${window.location.origin}/plaque/${slug}`;
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    catch { toast.error("Copy failed — select the URL manually"); }
  };

  return (
    <div className="galaxy-page mx-auto max-w-7xl">
      <PageHeader
        accent="amber"
        eyebrow="Production · Recognition"
        eyebrowIcon={<Award className="h-3 w-3" />}
        title="Award history"
        subtitle="Production awards and milestone plaques in one place."
        primaryAction={<Button asChild variant="outline"><Link to="/dashboard/awards">Win wall</Link></Button>}
        viewControls={
          canViewAll && (
            <div role="group" aria-label="Award recipients" className="flex gap-1 bg-muted/20 rounded-lg p-1">
              <Button size="sm" aria-pressed={effectiveScope === "mine"} variant={effectiveScope === "mine" ? "default" : "ghost"} onClick={() => setScope("mine")}>Mine</Button>
              <Button size="sm" aria-pressed={effectiveScope === "all"} variant={effectiveScope === "all"  ? "default" : "ghost"} onClick={() => setScope("all")}>All agents</Button>
            </div>
          )
        }
      />

      <div role="group" aria-label="Award type" className="flex flex-wrap gap-2">
        {([ ["all", "All awards"], ["reward", "Production awards"], ["plaque", "Milestone plaques"] ] as const).map(([key, label]) => (
          <Button key={key} variant={source === key ? "default" : "outline"} aria-pressed={source === key} onClick={() => changeSource(key)}>{label}</Button>
        ))}
      </div>

      {awards.data && !awards.isError && !awards.data.identityUnavailable && (
        <p className="text-sm text-muted-foreground" role="status">
          {cards.length.toLocaleString()} award{cards.length === 1 ? "" : "s"} in this view.
          {(source !== "plaque" && awards.data.rewardsCapped) && ` Showing the latest ${REWARD_LIMIT} production awards.`}
          {(source !== "reward" && awards.data.plaquesCapped) && ` Showing the latest ${PLAQUE_LIMIT} milestone plaques.`}
        </p>
      )}

      {authLoading || awards.isPending ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plaques…
        </div>
      ) : awards.isError ? (
        <GlassCard role="alert" className="p-6 space-y-3">
          <p className="font-semibold">Plaques could not be loaded.</p>
          <p className="text-sm text-muted-foreground">Award history is unavailable. This does not mean there are no awards.</p>
          <Button variant="outline" onClick={() => void awards.refetch()}>Retry awards</Button>
        </GlassCard>
      ) : awards.data?.identityUnavailable ? (
        <GlassCard role="alert" className="p-6 space-y-3">
          <p className="font-semibold">Your agent profile could not be verified.</p>
          <p className="text-sm text-muted-foreground">Your personal awards are unavailable until your agent profile is linked.</p>
          <Button variant="outline" onClick={() => void awards.refetch()}>Retry profile</Button>
        </GlassCard>
      ) : cards.length === 0 ? (
        <GlassCard className="p-12 text-center space-y-3">
          <Trophy className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No award records were returned for this view.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(c => (
            <div key={c.id} className="space-y-2 group">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.achievement} className="w-full rounded-md shadow-2xl" />
              ) : (
                <div className="w-full min-w-0">
                  <Plaque
                    agentName={c.agentName}
                    achievement={c.achievement}
                    date={c.date}
                    period={c.period}
                    rank={c.rank}
                    subtitle={c.subtitle}
                    watermark={c.source === "plaque" ? "MILESTONE" : undefined}
                    avatarUrl={c.avatarUrl}
                    width={640} height={800}
                  />
                </div>
              )}
              {c.source === "plaque" && c.imageUrl && (
                <div className="px-1 space-y-1">
                  <p className="text-xs text-muted-foreground">Original artwork</p>
                  <p className="text-sm font-semibold tabular-nums">{c.subtitle}</p>
                  <p className="text-xs text-muted-foreground">{c.date}</p>
                </div>
              )}
              {c.source === "reward" && c.description && (
                <details className="px-1 text-sm text-muted-foreground">
                  <summary className="cursor-pointer font-semibold text-foreground">Recorded award details</summary>
                  <p className="mt-2 break-words">{c.description}</p>
                </details>
              )}
              <AwardCopyActions
                caption={[c.agentName, c.achievement, c.rank && `Rank: #${c.rank}`, c.subtitle, c.period, c.description, c.date].filter(Boolean).join("\n")}
                summary={[`Agent: ${c.agentName}`, `Award: ${c.achievement}`, c.rank && `Rank: #${c.rank}`, c.subtitle, c.period, c.description, c.date].filter(Boolean).join("\n")}
              />
              <div className="flex items-center gap-2 px-1">
                <Badge variant="outline" className="text-[11px]">
                  {c.source === "reward" ? "Auto award" : "Custom plaque"}
                </Badge>
                {c.rank && c.rank <= 3 && (
                  <Badge variant="outline" className={cn(
                    "text-[11px]",
                    c.rank === 1 && "border-amber-400 text-amber-400",
                    c.rank === 2 && "border-slate-300 text-slate-600 dark:text-slate-300",
                    c.rank === 3 && "border-orange-400 text-orange-400"
                  )}>
                    {c.rank === 1 ? <Crown className="h-3 w-3 mr-1 inline" /> : <Medal className="h-3 w-3 mr-1 inline" />}
                    Rank #{c.rank}
                  </Badge>
                )}
                <div className="flex-1" />
                {c.shareSlug && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copyShare(c.shareSlug!)}>
                    <Copy className="h-3 w-3 mr-1" /> Share
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
