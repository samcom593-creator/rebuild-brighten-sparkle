// MP-264 follow-on — Producer Reactivation ("easy pickins")
//
// 60% of everyone who has ever produced at Apex is dark. The top three
// lifetime producers all went quiet inside 46 days, carrying ~$300K of proven
// annual premium between them. Reactivating a proven closer costs one phone
// call; replacing them costs a full recruit-license-onboard-ramp cycle.
//
// Reads public.v_producer_reactivation.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Phone, RefreshCw, Search, Snowflake, TrendingDown, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { contactLinkProps, phoneHref } from "@/lib/phone";

type Tier = "hot_winback" | "proven_cold" | "warm_winback" | "long_dormant" | "light_producer";

interface Row {
  agent_name: string;
  agent_id: string | null;
  agent_status: string | null;
  license_status: string | null;
  agent_phone: string | null;
  agent_email: string | null;
  agent_instagram: string | null;
  deals: number;
  lifetime_alp: number;
  avg_alp_per_deal: number | null;
  alp_per_month_when_active: number | null;
  last_deal_at: string | null;
  days_dark: number;
  deals_90d: number;
  alp_90d: number;
  reactivation_tier: Tier;
  reactivation_score: number;
}

// Three severity levels only, always the -600 dark:-400 pair so they stay
// legible on the white light-theme card as well as the dark one. The three
// cold tiers stay neutral — their label is what separates them, not a colour.
const NEUTRAL_BADGE = "border-border bg-muted/40 text-muted-foreground";

const TIERS: { key: Tier | "all"; label: string; badge: string; num: string }[] = [
  { key: "all", label: "All dormant", badge: NEUTRAL_BADGE, num: "text-foreground" },
  {
    key: "hot_winback",
    label: "Hot win-back",
    badge: "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    num: "text-rose-600 dark:text-rose-400",
  },
  {
    key: "warm_winback",
    label: "Warm win-back",
    badge: "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    num: "text-amber-600 dark:text-amber-400",
  },
  { key: "proven_cold", label: "Proven, cold", badge: NEUTRAL_BADGE, num: "text-foreground" },
  { key: "long_dormant", label: "Long dormant", badge: NEUTRAL_BADGE, num: "text-foreground" },
  { key: "light_producer", label: "Light", badge: NEUTRAL_BADGE, num: "text-foreground" },
];

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;

export default function ProducerReactivation() {
  usePageTitle("Producer Reactivation");
  const [tier, setTier] = useState<Tier | "all">("hot_winback");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);

  const q = useQuery({
    queryKey: ["producer-reactivation"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_producer_reactivation")
        .select("*")
        .order("reactivation_score", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.reactivation_tier] = (m[r.reactivation_tier] ?? 0) + 1;
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    let base = tier === "all" ? rows : rows.filter((r) => r.reactivation_tier === tier);
    const s = search.trim().toLowerCase();
    if (s) base = base.filter((r) => r.agent_name.toLowerCase().includes(s));
    return base;
  }, [rows, tier, search]);

  // Recoverable = summed monthly run-rate of everything currently listed.
  // Stated as "if every one came back", never as a forecast.
  const recoverable = useMemo(
    () => filtered.reduce((sum, r) => sum + Number(r.alp_per_month_when_active ?? 0), 0),
    [filtered],
  );

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        title="Producer Reactivation"
        subtitle="Agents who already proved they can sell, then went quiet. Cheaper to call than to replace."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-10 w-full sm:h-9 sm:w-auto"
            aria-label="Refresh reactivation list"
            onClick={() => void q.refetch()}
          >
            <RefreshCw className={cn("mr-1.5 h-4 w-4", q.isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Dormant production</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Everyone counted here already closed business at Apex and has since stopped — the ALP figure
          is the run-rate they held while active, not a forecast.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Dormant producers" value={String(rows.length)} icon={TrendingDown} tone="rose" />
          <Kpi label="Hot win-backs" value={String(counts.hot_winback ?? 0)} icon={Flame} tone="amber" />
          <Kpi label="In this view" value={String(filtered.length)} icon={Users} tone="neutral" />
          <Kpi
            label="Monthly ALP if all returned"
            value={usd(recoverable)}
            icon={RefreshCw}
            tone="emerald"
          />
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Call list</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {filtered.length}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Ranked by reactivation score — the big number on each row is how many days that producer has
          been dark.
        </p>

        <div className="relative mb-3 w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search producer…"
            className="h-10 pl-9 sm:h-9"
            aria-label="Search producers"
          />
        </div>

        <div className="-mx-4 mb-3 overflow-x-auto pb-1 sm:mx-0">
          <div className="flex min-w-max gap-2 px-4 sm:px-0">
            {TIERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTier(t.key)}
                aria-pressed={tier === t.key}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors sm:h-9",
                  "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  tier === t.key
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("text-xs font-bold tabular-nums", t.num)}>
                  {t.key === "all" ? rows.length : counts[t.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {q.isLoading ? (
          <div className="space-y-2">
            {/* stable-key-allow:skeleton */}
            {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-[108px] w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Snowflake className="h-7 w-7" />}
            variant="default"
            title="No dormant producer in this tier"
            description={
              search
                ? "No producer matches that search. Clear the box or widen the tier."
                : "Nobody sits at this level right now. Switch tiers to see who else has gone dark."
            }
          />
        ) : (
          <>
          <ul className="space-y-2">
            {filtered.slice(0, visibleCount).map((r) => {
              const meta = TIERS.find((t) => t.key === r.reactivation_tier);
              return (
                <li
                  key={`${r.agent_name}|${r.last_deal_at ?? "none"}`}
                  className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{r.agent_name}</span>
                        {meta && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 px-2 py-0 text-[10px] font-bold uppercase tracking-wide",
                              meta.badge,
                            )}
                          >
                            {meta.label}
                          </Badge>
                        )}
                        {r.agent_status && r.agent_status !== "active" && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 px-2 py-0 text-[10px] font-bold uppercase tracking-wide",
                              NEUTRAL_BADGE,
                            )}
                          >
                            {r.agent_status}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
                        {r.deals} deals · {usd(r.lifetime_alp)} lifetime · {usd(r.avg_alp_per_deal)}/deal
                        {r.last_deal_at ? ` · last ${r.last_deal_at}` : ""}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <div
                        className={cn(
                          "text-2xl font-bold leading-none tabular-nums",
                          meta?.num ?? "text-foreground",
                        )}
                      >
                        {r.days_dark}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        days dark
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-col gap-2 border-t border-border/40 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="min-w-0 truncate text-sm">
                      <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {usd(r.alp_per_month_when_active)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">/mo while active</span>
                    </p>

                    {r.agent_phone ? (
                      <Button asChild size="sm" className="h-10 w-full shrink-0 sm:h-9 sm:w-auto">
                        <a
                          href={phoneHref(r.agent_phone.replace(/[^\d+]/g, "")) ?? `tel:${r.agent_phone.replace(/[^\d+]/g, "")}`} {...contactLinkProps(phoneHref(r.agent_phone.replace(/[^\d+]/g, "")))}
                          aria-label={`Call ${r.agent_name}`}
                        >
                          <Phone className="mr-1.5 h-4 w-4" /> Call
                        </a>
                      </Button>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">no phone on file</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {filtered.length > visibleCount && (
            <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
              <span className="text-muted-foreground">Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}</span>
              <button type="button" onClick={() => setVisibleCount((n) => n + 200)} className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted">Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)</button>
              <button type="button" onClick={() => setVisibleCount(filtered.length)} className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline">Show all</button>
            </div>
          )}
          </>
        )}
      </GlassCard>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: {
  label: string; value: string; icon: typeof Users; tone: "rose" | "amber" | "emerald" | "neutral";
}) {
  const tones: Record<string, string> = {
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    neutral: "text-foreground",
  };
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className={cn("truncate text-2xl font-bold leading-none tabular-nums", tones[tone])}>
        {value}
      </p>
    </div>
  );
}
