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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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

const TIERS: { key: Tier | "all"; label: string; tone: string }[] = [
  { key: "all",            label: "All dormant",   tone: "text-slate-300 border-slate-500/40 bg-slate-500/10" },
  { key: "hot_winback",    label: "Hot win-back",  tone: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  { key: "warm_winback",   label: "Warm win-back", tone: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  { key: "proven_cold",    label: "Proven, cold",  tone: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  { key: "long_dormant",   label: "Long dormant",  tone: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
  { key: "light_producer", label: "Light",         tone: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10" },
];

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;

export default function ProducerReactivation() {
  usePageTitle("Producer Reactivation");
  const [tier, setTier] = useState<Tier | "all">("hot_winback");
  const [search, setSearch] = useState("");

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
    <div className="w-full max-w-full space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Producer Reactivation"
        subtitle="Agents who already proved they can sell, then went quiet. Cheaper to call than to replace."
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Dormant producers" value={String(rows.length)} icon={TrendingDown} tone="rose" />
        <Kpi label="Hot win-backs" value={String(counts.hot_winback ?? 0)} icon={Flame} tone="amber" />
        <Kpi label="In this view" value={String(filtered.length)} icon={Users} tone="slate" />
        <Kpi
          label="Monthly ALP if all returned"
          value={usd(recoverable)}
          icon={RefreshCw}
          tone="teal"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Search producer…" className="pl-9" aria-label="Search producers" />
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh reactivation list"
                onClick={() => void q.refetch()}>
          <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TIERS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTier(t.key)}
            aria-pressed={tier === t.key}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              t.tone, tier === t.key && "ring-2 ring-teal-400/70",
            )}
          >
            {t.label}
            <span className="rounded-full bg-black/30 px-1.5 tabular-nums">
              {t.key === "all" ? rows.length : counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-10 text-center">
          <p className="font-medium">Nothing in this tier</p>
          <p className="text-sm text-muted-foreground">
            {search ? "No producer matches that search." : "No dormant producers here."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const meta = TIERS.find((t) => t.key === r.reactivation_tier);
            return (
              <div key={`${r.agent_name}|${r.last_deal_at ?? "none"}`}
                   className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{r.agent_name}</span>
                      {meta && <Badge className={cn("shrink-0 text-[10px]", meta.tone)}>{meta.label}</Badge>}
                      {r.agent_status && r.agent_status !== "active" && (
                        <Badge className="shrink-0 border-zinc-600/40 bg-zinc-600/10 text-[10px] text-zinc-400">
                          {r.agent_status}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.deals} deals · {usd(r.lifetime_alp)} lifetime · {usd(r.avg_alp_per_deal)}/deal ·
                      {" "}dark {r.days_dark} days
                      {r.last_deal_at ? ` (last ${r.last_deal_at})` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-teal-300/90">
                      {usd(r.alp_per_month_when_active)}/mo while active
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {r.agent_phone ? (
                      <Button asChild size="sm" className="bg-teal-500 text-slate-950 hover:bg-teal-400">
                        <a href={`tel:${r.agent_phone.replace(/[^\d+]/g, "")}`}
                           aria-label={`Call ${r.agent_name}`}>
                          <Phone className="mr-1.5 h-3.5 w-3.5" /> Call
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">no phone on file</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: {
  label: string; value: string; icon: typeof Users; tone: string;
}) {
  const tones: Record<string, string> = {
    rose: "text-rose-300 border-rose-500/30",
    amber: "text-amber-300 border-amber-500/30",
    slate: "text-slate-300 border-slate-500/30",
    teal: "text-teal-300 border-teal-500/30",
  };
  return (
    <div className={cn("rounded-lg border bg-slate-950/60 p-3", tones[tone])}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
