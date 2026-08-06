// BookReconciliation — carrier-direct vs internal book quality engine.
//
// Tabs:
//   Overview — KPIs, carrier mix, agent leak ranking
//   Recovery — lapsed/dead policies with NO active successor
//   Duplicates — same client+carrier with multiple policy numbers
//   Ghost Deals — internal deals with no policy number or no carrier match
//   Falloff Watch — Lapse Pending list
//   Quality Score — per-agent quality ranking
//   Ingest — paste in the carrier portal export

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import {
  AlertTriangle, BookMarked, Banknote, ShieldAlert, Search, Filter,
  TrendingDown, Upload, RefreshCw, Phone, Mail, ChevronRight, Sparkles,
  CheckCircle2, XCircle, ListChecks, AlertCircle, Trophy, Users,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CarrierPasteDialog } from "@/components/admin/CarrierPasteDialog";

// ─── Types (matching the views) ─────────────────────────────────────────────
interface Summary {
  total_policies: number;
  distinct_carriers: number;
  missing_policy_num: number;
  on_unsupported_carrier: number;
  unmatched_agents: number;
  no_internal_deal: number;
  dead_policies: number;
  total_premium: number | string;
  live_premium: number | string;
  total_lost_commission_usd: number | string;
}
interface ReconRow {
  id: string; carrier_name: string; policy_number: string | null; policy_status: string | null;
  client_first_name: string | null; client_last_name: string | null;
  effective_date: string | null; face_amount: number | string | null;
  annual_premium: number | string | null;
  agent_id: string | null; agent_name: string | null; agent_raw: string | null;
  carrier_is_supported: boolean | null; carrier_short_code: string | null;
  flag_no_policy_num: boolean; flag_unsupported_carrier: boolean;
  flag_unmatched_agent: boolean; flag_no_internal_deal: boolean;
  flag_dead_policy: boolean;
  approx_lost_commission_usd: number | string;
}
interface LapsedRow {
  id: string; client_first_name: string | null; client_last_name: string | null;
  carrier_name: string; policy_number: string | null; policy_status: string | null;
  effective_date: string | null; face_amount: number | string | null;
  annual_premium: number | string | null;
  agent_name: string | null;
  days_since_effective: number | null;
  approx_walked_commission_usd: number | string;
}
interface DupRow {
  fn_lc: string; ln_lc: string; carrier_name: string; dup_count: number;
  ids: string[]; policy_nums: string[]; statuses: string[];
  live_premium_tied_up: number | string;
}
interface GhostRow {
  deal_id: string; client_first_name: string | null; client_last_name: string | null;
  client_phone: string | null; product_sold: string | null;
  policy_number: string | null; annual_premium: number | string | null;
  posted_at: string | null; deal_status: string | null;
  carrier_name: string | null; agent_name: string | null;
  flag_no_policy_num: boolean; flag_ghost: boolean;
}
interface FalloffRow {
  id: string; client_first_name: string | null; client_last_name: string | null;
  carrier_name: string; policy_number: string | null;
  effective_date: string | null; face_amount: number | string | null;
  annual_premium: number | string | null;
  agent_name: string | null;
  approx_save_commission_usd: number | string;
}
interface QualityRow {
  agent_id: string; agent_name: string | null; agent_code: string | null;
  deal_count: number; no_policy_num_count: number; ghost_deal_count: number;
  dead_deal_count: number; carrier_book_count: number; carrier_dead_count: number;
  quality_score: number;
}
interface CarrierLeak {
  agent_key: string; agent_id: string | null; agent_name: string;
  carrier_name: string; policy_count: number; no_policy_num_count: number;
  dead_count: number; total_premium: number | string; live_premium: number | string;
  approx_lost_commission_usd: number | string; carrier_is_supported: boolean;
}

function fmtUsd(n: number | string | null | undefined, compact = false): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return "$0";
  if (compact) {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}
function fmtNum(n: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(n ?? 0)));
}
function fmtName(f: string | null | undefined, l: string | null | undefined): string {
  return [f, l].filter(Boolean).join(" ") || "(no name)";
}

export default function BookReconciliation() {
  usePageTitle("Book Quality · APEX");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const summary = useQuery({
    queryKey: ["book-recon-summary"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_carrier_book_summary" as any).select("total_policies,distinct_carriers,missing_policy_num,on_unsupported_carrier,live_premium,total_lost_commission_usd").maybeSingle();
      if (error) throw error;
      return data as unknown as Summary | null;
    },
  });

  const recon = useQuery({
    queryKey: ["book-recon-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_carrier_book_recon" as any).select("id,carrier_name,policy_number,policy_status,client_first_name,client_last_name,effective_date,annual_premium,agent_name,agent_raw,carrier_is_supported,carrier_short_code,flag_no_policy_num,flag_unsupported_carrier,flag_dead_policy,flag_no_internal_deal")
        .order("annual_premium", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ReconRow[];
    },
  });

  const lapsed = useQuery({
    queryKey: ["book-recon-lapsed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_lapsed_recovery" as any).select("id,client_first_name,client_last_name,carrier_name,policy_number,policy_status,effective_date,agent_name,approx_walked_commission_usd")
        .order("approx_walked_commission_usd", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as LapsedRow[];
    },
  });

  const dups = useQuery({
    queryKey: ["book-recon-dups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_duplicate_policies" as any).select("fn_lc,ln_lc,carrier_name,dup_count,policy_nums,live_premium_tied_up")
        .order("dup_count", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as DupRow[];
    },
  });

  const ghosts = useQuery({
    queryKey: ["book-recon-ghosts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_ghost_deals" as any).select("deal_id,client_first_name,client_last_name,product_sold,annual_premium,posted_at,carrier_name,agent_name,flag_no_policy_num,flag_ghost")
        .eq("flag_ghost", true)
        .order("annual_premium", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as GhostRow[];
    },
  });

  // The list above is capped at .limit(200); the headline stat must show the TRUE
  // total, not the truncated page length.
  const ghostCount = useQuery({
    queryKey: ["book-recon-ghost-count"],
    queryFn: async () => {
      const { count } = await supabase.from("v_ghost_deals" as any).select("*", { count: "exact", head: true }).eq("flag_ghost", true);
      return count ?? 0;
    },
  });

  const falloff = useQuery({
    queryKey: ["book-recon-falloff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_falloff_watch" as any).select("id,client_first_name,client_last_name,carrier_name,policy_number,effective_date,agent_name,agent_raw,approx_save_commission_usd")
        .order("approx_save_commission_usd", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as FalloffRow[];
    },
  });

  const quality = useQuery({
    queryKey: ["book-recon-quality"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_quality_score" as any).select("agent_id,agent_name,agent_code,deal_count,no_policy_num_count,ghost_deal_count,dead_deal_count,quality_score")
        .order("quality_score", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as QualityRow[];
    },
  });

  const leaks = useQuery({
    queryKey: ["book-recon-leaks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_carrier_money_leak" as any).select("agent_key,carrier_name,agent_name,policy_count,approx_lost_commission_usd,carrier_is_supported")
        .eq("carrier_is_supported", false)
        .order("approx_lost_commission_usd", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as CarrierLeak[];
    },
  });

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["book-recon-summary"] });
    qc.invalidateQueries({ queryKey: ["book-recon-rows"] });
    qc.invalidateQueries({ queryKey: ["book-recon-lapsed"] });
    qc.invalidateQueries({ queryKey: ["book-recon-dups"] });
    qc.invalidateQueries({ queryKey: ["book-recon-ghosts"] });
    qc.invalidateQueries({ queryKey: ["book-recon-falloff"] });
    qc.invalidateQueries({ queryKey: ["book-recon-quality"] });
    qc.invalidateQueries({ queryKey: ["book-recon-leaks"] });
  }

  const carrierMix = useMemo(() => {
    const map = new Map<string, { carrier_name: string; count: number; live_premium: number; supported: boolean }>();
    for (const r of recon.data ?? []) {
      const k = r.carrier_name;
      const existing = map.get(k) ?? { carrier_name: k, count: 0, live_premium: 0, supported: r.carrier_is_supported ?? false };
      existing.count += 1;
      if (!r.flag_dead_policy) existing.live_premium += Number(r.annual_premium ?? 0);
      map.set(k, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.live_premium - a.live_premium);
  }, [recon.data]);

  const s = summary.data;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Finance · Book Quality"
        eyebrowIcon={<BookMarked className="h-3 w-3" />}
        title="Book Reconciliation"
        subtitle="Carrier-direct truth vs internal deal log. Recovery, duplicates, ghost deals, falloff watch, and agent quality — all in one place."
        accent="amber"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={refreshAll} variant="outline" size="sm" disabled={summary.isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${summary.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <CarrierPasteDialog onDone={refreshAll} />
          </div>
        }
      />

      {/* ── HERO STATS ───────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BigStat
          icon={Banknote}
          label="Live premium tracked"
          value={fmtUsd(s?.live_premium, true)}
          sub={`${fmtNum(s?.total_policies)} policies across ${fmtNum(s?.distinct_carriers)} carriers`}
          color="text-emerald-500 dark:text-emerald-400"
          loading={summary.isLoading}
        />
        <BigStat
          icon={TrendingDown}
          label="Lost commission · estimated"
          value={fmtUsd(s?.total_lost_commission_usd, true)}
          sub={`${fmtNum(s?.on_unsupported_carrier)} policies on unsupported carriers`}
          color="text-rose-500 dark:text-rose-400"
          loading={summary.isLoading}
        />
        <BigStat
          icon={ShieldAlert}
          label="Ghost deals (no policy #)"
          value={fmtNum(ghostCount.data ?? ghosts.data?.length ?? 0)}
          sub={`${fmtNum(s?.missing_policy_num)} carrier-side · automatic red flag`}
          color="text-amber-500 dark:text-amber-400"
          loading={ghosts.isLoading}
        />
        <BigStat
          icon={AlertTriangle}
          label="Recovery + falloff"
          value={fmtNum((lapsed.data?.length ?? 0) + (falloff.data?.length ?? 0))}
          sub={`${fmtNum(lapsed.data?.length)} lapsed no successor · ${fmtNum(falloff.data?.length)} pending`}
          color="text-orange-500 dark:text-orange-400"
          loading={lapsed.isLoading || falloff.isLoading}
        />
      </div>

      {/* ── CARRIER MIX + LEAK ───────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Live premium by carrier</p>
              <h3 className="text-lg font-bold">Where the book sits</h3>
            </div>
            <Badge variant="outline" className="text-xs">{carrierMix.length} carriers</Badge>
          </div>
          {recon.isLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : carrierMix.length === 0 ? (
            <EmptyState icon={<BookMarked className="h-6 w-6" />} title="No carrier data ingested yet"
              description="Paste your latest carrier portal export to populate this."
              actions={<CarrierPasteDialog onDone={refreshAll} />} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={carrierMix} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                <XAxis type="number" fontSize={10} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="carrier_name" fontSize={10} width={120} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  formatter={(v: number, _n: string, p: any) => [fmtUsd(v), p?.payload?.supported ? "Supported" : "UNSUPPORTED"]}
                />
                <Bar dataKey="live_premium" radius={[0, 4, 4, 0]}>
                  {/* 2026-08-06: supported slice was hsl(168 70% 45%) teal; the
                      unsupported slice stays red because that is semantic. */}
                  {carrierMix.map((c) => (
                    <Cell key={c.carrier_name} fill={c.supported ? "hsl(var(--primary))" : "hsl(0 70% 55%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Lost-commission leaderboard</p>
              <h3 className="text-lg font-bold">By agent · unsupported writes</h3>
            </div>
            <TrendingDown className="h-5 w-5 text-rose-500 dark:text-rose-400" />
          </div>
          {leaks.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (leaks.data ?? []).length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No leak detected" variant="success" />
          ) : (
            <ul className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-custom pr-1">
              {(leaks.data ?? []).map((l) => (
                <li key={`${l.agent_key}-${l.carrier_name}`} className="flex items-center justify-between rounded-md border border-border/40 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{l.agent_name}</p>
                    <p className="text-[11px] text-muted-foreground">{l.carrier_name} · {l.policy_count} policies</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-rose-500 dark:text-rose-400">
                    {fmtUsd(l.approx_lost_commission_usd, true)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      {/* ── TABS ─────────────────────────────────────────────────── */}
      <Tabs defaultValue="recovery">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1.5">
          <TabsTrigger value="recovery" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Recovery <Badge variant="outline" className="ml-1">{lapsed.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="ghost" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Ghost deals <Badge variant="outline" className="ml-1">{ghosts.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="dups" className="gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Duplicates <Badge variant="outline" className="ml-1">{dups.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="falloff" className="gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Falloff watch <Badge variant="outline" className="ml-1">{falloff.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="quality" className="gap-1.5"><Trophy className="h-3.5 w-3.5" /> Agent quality <Badge variant="outline" className="ml-1">{quality.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5"><BookMarked className="h-3.5 w-3.5" /> Full book <Badge variant="outline" className="ml-1">{recon.data?.length ?? 0}</Badge></TabsTrigger>
        </TabsList>

        {/* RECOVERY */}
        <TabsContent value="recovery" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Lapsed / cancelled / withdrawn policies where the same client has <span className="text-foreground font-semibold">no active replacement</span>.
            Each row is a re-engagement opportunity. Sorted by est. commission left on the table.
          </p>
          {lapsed.isLoading ? <SkelList /> :
            (lapsed.data ?? []).length === 0 ? <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No recovery opportunities" variant="success" /> :
            (lapsed.data ?? []).map((r, i) => (
              <RowCard key={r.id} i={i}>
                <RowMain title={fmtName(r.client_first_name, r.client_last_name)}
                  meta={`${r.carrier_name} · ${r.policy_status} · ${r.agent_name ?? r.policy_number ?? "—"}`}
                  age={r.effective_date ? `Effective ${format(new Date(r.effective_date), "MMM d, yyyy")}` : null} />
                <RowMoney label="Est. walked" value={fmtUsd(r.approx_walked_commission_usd, true)} color="text-rose-500 dark:text-rose-400" />
              </RowCard>
            ))
          }
        </TabsContent>

        {/* GHOST DEALS */}
        <TabsContent value="ghost" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Internal deals submitted with <span className="text-foreground font-semibold">no policy number</span> OR a policy number that doesn't appear on any carrier portal.
            Sam's automatic red-flag list.
          </p>
          {ghosts.isLoading ? <SkelList /> :
            (ghosts.data ?? []).length === 0 ? <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Zero ghost deals" variant="success" /> :
            (ghosts.data ?? []).slice(0, 50).map((g, i) => (
              <RowCard key={g.deal_id} i={i}>
                <RowMain title={fmtName(g.client_first_name, g.client_last_name)}
                  meta={`${g.carrier_name ?? "—"} · ${g.product_sold ?? "—"} · ${g.agent_name ?? "(unassigned)"}`}
                  age={g.posted_at ? format(new Date(g.posted_at), "MMM d, yyyy") : null}
                  badges={g.flag_no_policy_num ? [{ label: "No policy #", color: "bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/40" }] : [{ label: "Unmatched", color: "bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/40" }]}
                />
                <RowMoney label="AP" value={fmtUsd(g.annual_premium, true)} color="text-emerald-500 dark:text-emerald-400" />
              </RowCard>
            ))
          }
          {(ghosts.data?.length ?? 0) > 50 && (
            <p className="text-xs text-center text-muted-foreground py-3">
              Showing first 50 of {ghosts.data?.length.toLocaleString()} ghost deals. Drill in the agent-quality tab to find offenders.
            </p>
          )}
        </TabsContent>

        {/* DUPLICATES */}
        <TabsContent value="dups" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Same client + carrier, multiple policy numbers. Either valid churn or someone got double-credited.
          </p>
          {dups.isLoading ? <SkelList /> :
            (dups.data ?? []).length === 0 ? <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No duplicates detected" variant="success" /> :
            (dups.data ?? []).map((d, i) => (
              <RowCard key={`${d.fn_lc}-${d.ln_lc}-${d.carrier_name}`} i={i}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold capitalize truncate">{d.fn_lc} {d.ln_lc}</p>
                  <p className="text-xs text-muted-foreground">{d.carrier_name} · {d.dup_count}× policies</p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                    {d.policy_nums.join(" · ")}
                  </p>
                </div>
                <RowMoney label="Live tied-up" value={fmtUsd(d.live_premium_tied_up, true)} color="text-amber-500 dark:text-amber-400" />
              </RowCard>
            ))
          }
        </TabsContent>

        {/* FALLOFF */}
        <TabsContent value="falloff" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Policies sitting in <span className="text-foreground font-semibold">Lapse Pending</span>. Save these and you keep the commission.
          </p>
          {falloff.isLoading ? <SkelList /> :
            (falloff.data ?? []).length === 0 ? <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing in falloff" variant="success" /> :
            (falloff.data ?? []).map((f, i) => (
              <RowCard key={f.id} i={i}>
                <RowMain title={fmtName(f.client_first_name, f.client_last_name)}
                  meta={`${f.carrier_name} · ${f.policy_number ?? "—"} · ${f.agent_name ?? f.agent_raw ?? "—"}`}
                  age={f.effective_date ? `Effective ${format(new Date(f.effective_date), "MMM d, yyyy")}` : null}
                />
                <RowMoney label="Save = $" value={fmtUsd(f.approx_save_commission_usd, true)} color="text-emerald-500 dark:text-emerald-400" />
              </RowCard>
            ))
          }
        </TabsContent>

        {/* QUALITY */}
        <TabsContent value="quality" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Per-agent quality score (0-100). Penalties: ghost deals (-20% each), no policy # (-30% each), dead deals (-25% each). Sorted worst-first.
          </p>
          {quality.isLoading ? <SkelList /> :
            (quality.data ?? []).length === 0 ? <EmptyState icon={<Users className="h-6 w-6" />} title="No agents scored yet" /> :
            (quality.data ?? []).map((q, i) => (
              <RowCard key={q.agent_id} i={i}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{q.agent_name ?? "—"}</p>
                    <Badge variant="outline" className="text-[10px]">{q.agent_code ?? "—"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {q.deal_count} deals · {q.no_policy_num_count} no-#  · {q.ghost_deal_count} ghost · {q.dead_deal_count} dead
                  </p>
                </div>
                <div className="text-right shrink-0 min-w-[80px]">
                  <p className={`text-2xl font-bold tabular-nums ${
                    q.quality_score >= 80 ? "text-emerald-500 dark:text-emerald-400" :
                    q.quality_score >= 50 ? "text-amber-500 dark:text-amber-400" :
                    "text-rose-500 dark:text-rose-400"
                  }`}>{q.quality_score}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">score</p>
                </div>
              </RowCard>
            ))
          }
        </TabsContent>

        {/* FULL BOOK */}
        <TabsContent value="all" className="mt-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, carrier, policy, agent" className="pl-9" />
            </div>
            <Badge variant="outline">{(recon.data ?? []).length} rows</Badge>
          </div>
          {recon.isLoading ? <SkelList /> :
            (recon.data ?? []).filter((r) => {
              if (!search.trim()) return true;
              const q = search.toLowerCase();
              return [r.client_first_name, r.client_last_name, r.carrier_name, r.policy_number, r.agent_name, r.agent_raw]
                .filter(Boolean).some((s) => (s as string).toLowerCase().includes(q));
            }).slice(0, 200).map((r, i) => (
              <RowCard key={r.id} i={i}>
                <RowMain
                  title={fmtName(r.client_first_name, r.client_last_name)}
                  meta={`${r.carrier_name} · ${r.policy_number ?? "no policy #"} · ${r.agent_name ?? r.agent_raw ?? "—"}`}
                  age={r.effective_date ? format(new Date(r.effective_date), "MMM d, yyyy") : null}
                  badges={[
                    ...(r.flag_no_policy_num ? [{ label: "No policy #", color: "bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/40" }] : []),
                    ...(r.flag_unsupported_carrier ? [{ label: r.carrier_short_code ?? "Unsupported", color: "bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/40" }] : []),
                    ...(r.flag_dead_policy ? [{ label: r.policy_status ?? "Dead", color: "bg-slate-500/15 text-slate-300 dark:text-slate-300 border-slate-500/40" }] : []),
                    ...(r.flag_no_internal_deal ? [{ label: "No internal deal", color: "bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/40" }] : []),
                  ]}
                />
                <RowMoney label="AP" value={fmtUsd(r.annual_premium, true)} color="text-emerald-500 dark:text-emerald-400" />
              </RowCard>
            ))
          }
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function BigStat({ icon: Icon, label, value, sub, color, loading }: {
  icon: React.ElementType; label: string; value: string | number; sub: string;
  color: string; loading: boolean;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          {loading ? <Skeleton className="h-10 w-32 mt-1" /> : (
            <p className={`text-4xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>
        </div>
        <Icon className={`h-8 w-8 ${color} opacity-70 shrink-0`} />
      </div>
    </GlassCard>
  );
}

function SkelList() {
  // stable-key-allow:skeleton-static-array
  return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
}

function RowCard({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.01, 0.2) }}
    >
      <GlassCard className="p-3 flex items-center gap-3">
        {children}
      </GlassCard>
    </motion.div>
  );
}

function RowMain({ title, meta, age, badges }: {
  title: string; meta: string; age: string | null;
  badges?: Array<{ label: string; color: string }>;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <p className="font-semibold truncate">{title}</p>
        {badges?.map((b) => (
          <Badge key={b.label} variant="outline" className={`text-[10px] ${b.color}`}>{b.label}</Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground truncate">{meta}</p>
      {age && <p className="text-[11px] text-muted-foreground mt-0.5">{age}</p>}
    </div>
  );
}

function RowMoney({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-right shrink-0 min-w-[90px]">
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}
