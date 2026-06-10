import { useCallback, useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Book, Search, RefreshCw, AlertTriangle, Eye, TrendingDown, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { AgentLinkConnectionPrompt } from "@/components/dashboard/AgentLinkConnectionPrompt";

interface DealRow {
  id: string;
  agent_id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  policy_number: string | null;
  product_sold: string | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  effective_date: string | null;
  posted_at: string | null;
  pipeline_stage: string | null;
  policy_status_standard: string | null;
  status_updated_at: string | null;
  synced_to_insuracloud_at: string | null;
  external_deal_id: string | null;
  insuracloud_sync_error: string | null;
  source: string | null;
  status: string | null;
  carrier_id: string | null;
  pipeline_client_id?: number | null;
  created_at: string;
  agent_name?: string;
  carrier_name?: string;
}

// Full client profile loaded on demand from agentlink_clients via
// pipeline_client_id. Shows the banking / financial / health fields the
// agent needs to actually service the policy.
type ClientFullRow = Record<string, unknown> & {
  insuracloud_pipeline_client_id?: number;
};

type SortKey = "created_at" | "monthly_premium" | "annual_premium" | "effective_date" | "posted_at" | "client";
type SortDir = "asc" | "desc";

const STAGE_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  active:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  approved:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  paid:      "bg-amber-500/20 text-amber-300 border-amber-500/40",
  lapsed:    "bg-rose-500/20 text-rose-300 border-rose-500/40",
  cancelled: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  charged_back: "bg-red-500/20 text-red-300 border-red-500/40",
  pending:   "bg-sky-500/20 text-sky-300 border-sky-500/40",
};

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function sourceKey(source?: string | null): "apex" | "agent_link" {
  return source === "agent_link" || source === "agentlink" || source === "insuracloud" ? "agent_link" : "apex";
}

function pipelineLabel(deal: DealRow): string {
  return deal.policy_status_standard || deal.pipeline_stage || deal.status || "submitted";
}

// PL-043 — chargeback widget: list of policies that flipped to
// charged_back within a user-controlled date range. Default 30 days
// (the old hardcoded 7-day window was always 0 because chargebacks
// don't cluster that recently).

interface ChargebackRow {
  id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  agent_id: string | null;
  agent_name?: string;
  carrier_name?: string;
  policy_number: string | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  status_updated_at: string | null;
  posted_at: string | null;
}

export default function BookOfBusiness() {
  const { user, isAdmin, isManager } = useAuth();
  const [deals, setDeals]       = useState<DealRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [agentScopeIds, setAgentScopeIds] = useState<string[] | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null);
  const [search, setSearch]     = useState("");
  const [sourceFilter, setSource] = useState<"all" | "apex" | "agent_link">("all");
  const [stageFilter, setStage]   = useState<string>("all");
  const [sortKey, setSortKey]     = useState<SortKey>("posted_at");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");

  // PL-043 — chargeback widget state
  const [cbSince, setCbSince] = useState<string>(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [cbUntil, setCbUntil] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [chargebacks, setChargebacks] = useState<ChargebackRow[]>([]);
  const [cbLoading, setCbLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) {
        setAgentScopeIds([]);
        return;
      }
      if (isAdmin) {
        setAgentScopeIds(null);
        return;
      }
      const { data: agent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (!agent?.id) {
        setAgentScopeIds([]);
        return;
      }
      const ids = new Set<string>([agent.id]);
      if (isManager) {
        const { data: downline } = await supabase.rpc("my_downline_agent_ids" as any);
        for (const row of ((downline as any[]) ?? [])) {
          if (row.agent_id) ids.add(row.agent_id);
        }
      }
      setAgentScopeIds(Array.from(ids));
    })();
    return () => { cancelled = true; };
  }, [user?.id, isAdmin, isManager]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!isAdmin && agentScopeIds !== null && agentScopeIds.length === 0) {
        setDeals([]);
        return;
      }

      // v9 audit 2026-06-10: BookOfBusiness was only reading the apex
      // `deals` table, stale 20+ days since the AgentLink sync went dark.
      // Sam: "Book of business has nothing at all." Fix: ALSO read
      // agentlink_deals_snapshot (1,247 real policies, refreshed every 30 min
      // by com.samjames.apex.agentlink-sync) and merge. Dedup by policy_number.
      let query = supabase
        .from("deals")
        .select(`
          id, agent_id, client_first_name, client_last_name, policy_number,
          product_sold, monthly_premium, annual_premium, effective_date,
          posted_at, pipeline_stage, policy_status_standard, status_updated_at,
          synced_to_insuracloud_at, external_deal_id, insuracloud_sync_error,
          source, status, carrier_id, pipeline_client_id, created_at
        `)
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(500);

      if (!isAdmin && agentScopeIds !== null) {
        query = query.in("agent_id", agentScopeIds);
      }

      const [{ data }, { data: alSnapshot }] = await Promise.all([
        query,
        supabase
          .from("agentlink_deals_snapshot" as any)
          .select("id, client_first_name, client_last_name, policy_number, product_sold, monthly_premium, annual_premium, effective_date, raw_status, carrier_id, snapshot_at")
          .order("effective_date", { ascending: false, nullsFirst: false })
          .limit(500),
      ]);

      const apexRows = (data ?? []) as DealRow[];
      const seenPolicies = new Set(apexRows.map((r) => r.policy_number).filter(Boolean));

      const alRows: DealRow[] = ((alSnapshot ?? []) as Array<Record<string, unknown>>)
        .filter((r) => r.policy_number && !seenPolicies.has(String(r.policy_number)))
        .map((r) => ({
          id: `al-${String(r.id ?? "")}`,
          agent_id: "",
          client_first_name: String(r.client_first_name ?? ""),
          client_last_name: String(r.client_last_name ?? ""),
          policy_number: String(r.policy_number ?? ""),
          product_sold: r.product_sold ? String(r.product_sold) : null,
          monthly_premium: r.monthly_premium != null ? Number(r.monthly_premium) : null,
          annual_premium: r.annual_premium != null ? Number(r.annual_premium) : null,
          effective_date: r.effective_date ? String(r.effective_date) : null,
          posted_at: r.snapshot_at ? String(r.snapshot_at) : null,
          pipeline_stage: null,
          policy_status_standard: r.raw_status ? String(r.raw_status) : null,
          status_updated_at: null,
          synced_to_insuracloud_at: null,
          external_deal_id: null,
          insuracloud_sync_error: null,
          source: "agentlink",
          status: "active",
          carrier_id: r.carrier_id != null ? String(r.carrier_id) : null,
          pipeline_client_id: null,
          created_at: r.snapshot_at ? String(r.snapshot_at) : new Date().toISOString(),
        }) as DealRow);

      const rows = [...apexRows, ...alRows];

      // Resolve agent + carrier names in one batch
      const agentIds   = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
      const carrierIds = [...new Set(rows.map(r => r.carrier_id).filter((v): v is string => Boolean(v)))];

      const [{ data: agents }, { data: carriers }] = await Promise.all([
        agentIds.length
          ? supabase.from("agents").select("id, display_name, profile:profiles(full_name)").in("id", agentIds)
          : Promise.resolve({ data: [] } as any),
        carrierIds.length
          ? supabase.from("carriers").select("id, name").in("id", carrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const agentMap: Record<string, string> = {};
      for (const a of (agents ?? []) as any[]) agentMap[a.id] = a.profile?.full_name ?? a.display_name ?? "Unmatched agent";
      const carrierMap: Record<string, string> = {};
      for (const c of (carriers ?? []) as any[]) carrierMap[c.id] = c.name;

      setDeals(rows.map(r => ({
        ...r,
        agent_name:   agentMap[r.agent_id] ?? "Agent",
        carrier_name: r.carrier_id ? carrierMap[r.carrier_id] ?? "" : "",
      })));
    } finally {
      setLoading(false);
    }
  }, [agentScopeIds, isAdmin]);

  useEffect(() => {
    if (isAdmin || agentScopeIds !== null) load();
  }, [agentScopeIds, isAdmin, load]);

  // Realtime subscription
  useEffect(() => {
    if (!isAdmin && agentScopeIds === null) return;
    const scopeKey = isAdmin ? "admin" : (agentScopeIds ?? []).slice().sort().join(",");
    const ch = supabase.channel(`bob-${scopeKey}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [agentScopeIds, isAdmin, load]);

  // PL-043 — chargeback fetch, refreshed on date change OR scope change
  const loadChargebacks = useCallback(async () => {
    if (!isAdmin && agentScopeIds !== null && agentScopeIds.length === 0) {
      setChargebacks([]);
      return;
    }
    setCbLoading(true);
    try {
      // Date range covers status_updated_at (when the chargeback flipped)
      // OR posted_at as fallback for older rows missing status_updated_at.
      const startIso = `${cbSince}T00:00:00.000Z`;
      const endIso   = `${cbUntil}T23:59:59.999Z`;
      let query = supabase
        .from("deals")
        .select(`
          id, agent_id, client_first_name, client_last_name, policy_number,
          monthly_premium, annual_premium, status_updated_at, posted_at,
          carrier_id, policy_status_standard, pipeline_stage, status
        `)
        .or("policy_status_standard.eq.charged_back,pipeline_stage.eq.charged_back,status.eq.charged_back")
        .gte("status_updated_at", startIso)
        .lte("status_updated_at", endIso)
        .neq("status", "draft")
        .order("status_updated_at", { ascending: false })
        .limit(500);
      if (!isAdmin && agentScopeIds !== null) {
        query = query.in("agent_id", agentScopeIds);
      }
      const { data } = await query;
      const rows = (data ?? []) as any[];

      // Hydrate agent + carrier names
      const agentIds   = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
      const carrierIds = [...new Set(rows.map(r => r.carrier_id).filter((v: any): v is string => Boolean(v)))];
      const [{ data: agents }, { data: carriers }] = await Promise.all([
        agentIds.length
          ? supabase.from("agents").select("id, display_name, profile:profiles(full_name)").in("id", agentIds)
          : Promise.resolve({ data: [] } as any),
        carrierIds.length
          ? supabase.from("carriers").select("id, name").in("id", carrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);
      const agentMap: Record<string, string> = {};
      for (const a of (agents ?? []) as any[]) agentMap[a.id] = a.profile?.full_name ?? a.display_name ?? "Unmatched";
      const carrierMap: Record<string, string> = {};
      for (const c of (carriers ?? []) as any[]) carrierMap[c.id] = c.name;

      setChargebacks(rows.map(r => ({
        id: r.id,
        client_first_name: r.client_first_name,
        client_last_name: r.client_last_name,
        agent_id: r.agent_id,
        agent_name: agentMap[r.agent_id] ?? "Agent",
        carrier_name: r.carrier_id ? carrierMap[r.carrier_id] ?? "" : "",
        policy_number: r.policy_number,
        monthly_premium: r.monthly_premium,
        annual_premium: r.annual_premium,
        status_updated_at: r.status_updated_at,
        posted_at: r.posted_at,
      })));
    } finally {
      setCbLoading(false);
    }
  }, [agentScopeIds, isAdmin, cbSince, cbUntil]);

  useEffect(() => {
    if (isAdmin || agentScopeIds !== null) loadChargebacks();
  }, [isAdmin, agentScopeIds, loadChargebacks]);

  const cbTotalALP     = useMemo(() => chargebacks.reduce((s, c) => s + Number(c.annual_premium ?? 0), 0), [chargebacks]);
  const cbTotalMonthly = useMemo(() => chargebacks.reduce((s, c) => s + Number(c.monthly_premium ?? 0), 0), [chargebacks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals
      .filter(d => sourceFilter === "all" || sourceKey(d.source) === sourceFilter)
      .filter(d => stageFilter === "all"  || pipelineLabel(d) === stageFilter)
      .filter(d => {
        if (!q) return true;
        const hay = [
          d.agent_name, d.client_first_name, d.client_last_name,
          d.policy_number, d.product_sold, d.carrier_name, d.external_deal_id,
          d.policy_status_standard, d.pipeline_stage, d.status,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortKey) {
          case "monthly_premium": return ((a.monthly_premium ?? 0) - (b.monthly_premium ?? 0)) * dir;
          case "annual_premium":  return ((a.annual_premium ?? 0) - (b.annual_premium ?? 0)) * dir;
          case "effective_date":  return ((a.effective_date ?? "") > (b.effective_date ?? "") ? 1 : -1) * dir;
          case "posted_at":       return (((a.posted_at ?? a.created_at) > (b.posted_at ?? b.created_at)) ? 1 : -1) * dir;
          case "client":          return ((a.client_last_name ?? "") > (b.client_last_name ?? "") ? 1 : -1) * dir;
          default:                return ((a.created_at > b.created_at) ? 1 : -1) * dir;
        }
      });
  }, [deals, search, sourceFilter, stageFilter, sortKey, sortDir]);

  const totalALP = useMemo(
    () => filtered.reduce((s, d) => s + Number(d.annual_premium ?? 0), 0),
    [filtered],
  );
  const totalMonthly = useMemo(
    () => filtered.reduce((s, d) => s + Number(d.monthly_premium ?? 0), 0),
    [filtered],
  );
  const apexCount = useMemo(() => filtered.filter(d => sourceKey(d.source) === "apex").length, [filtered]);
  const agentLinkCount = useMemo(() => filtered.filter(d => sourceKey(d.source) === "agent_link").length, [filtered]);
  const syncErrors = useMemo(
    () => filtered.filter((d) => Boolean(d.insuracloud_sync_error)).length,
    [filtered],
  );

  const headerBtn = (label: string, key: SortKey) => (
    <button
      onClick={() => {
        if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className="text-left font-semibold hover:text-primary transition-colors"
    >
      {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
                eyebrow="Production · Book of Business"
        eyebrowIcon={<Book className="h-3 w-3" />}
        title="Book of Business"
        subtitle={
          (isAdmin ? "Admin view: every policy record across the agency." :
            isManager ? "Manager view: your downline's policy records." :
            "Agent view: your policy records.") +
          " · Synced from AgentLink every minute. Click any row for the full client profile."
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="default" size="sm" asChild>
              <a href="https://agentlink.insuracloud.ai/book-of-business" target="_blank" rel="noopener noreferrer">
                Open AgentLink
              </a>
            </Button>
          </>
        }
      />

      {/* PL-047 — surface AgentLink sync prompt for non-admin agents w/o data */}
      <AgentLinkConnectionPrompt />

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Deals</div>
          <div className="text-2xl font-bold tabular-nums">{filtered.length}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmt$(totalMonthly)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Annual (ALP)</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmt$(totalALP)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">APEX / AgentLink</div>
          <div className="text-2xl font-bold tabular-nums">
            {apexCount}
            <span className="text-muted-foreground"> / </span>
            {agentLinkCount}
          </div>
        </GlassCard>
      </div>

      {syncErrors > 0 && (
        <GlassCard className="border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {syncErrors} deal{syncErrors === 1 ? "" : "s"} have AgentLink sync errors. Filter/search by policy or external id before trusting totals.
          </div>
        </GlassCard>
      )}

      {/* PL-043 — period chargeback widget (custom date range) */}
      <GlassCard className="p-4 border-rose-500/30 bg-rose-500/5">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-rose-300" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              Chargebacks · {cbSince} → {cbUntil}
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="date"
              value={cbSince}
              onChange={e => setCbSince(e.target.value)}
              className="h-8 w-full sm:w-[150px] text-xs"
              max={cbUntil}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={cbUntil}
              onChange={e => setCbUntil(e.target.value)}
              className="h-8 w-full sm:w-[150px] text-xs"
              min={cbSince}
              max={format(new Date(), "yyyy-MM-dd")}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setCbSince(format(subDays(new Date(), 30), "yyyy-MM-dd"));
                setCbUntil(format(new Date(), "yyyy-MM-dd"));
              }}
            >
              30d
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setCbSince(format(subDays(new Date(), 90), "yyyy-MM-dd"));
                setCbUntil(format(new Date(), "yyyy-MM-dd"));
              }}
            >
              90d
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setCbSince(format(subDays(new Date(), 365), "yyyy-MM-dd"));
                setCbUntil(format(new Date(), "yyyy-MM-dd"));
              }}
            >
              YTD
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Count</div>
            <div className="text-2xl font-bold tabular-nums text-rose-300">
              {cbLoading ? "…" : chargebacks.length}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly lost</div>
            <div className="text-2xl font-bold tabular-nums text-rose-300">
              {cbLoading ? "…" : fmt$(cbTotalMonthly)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">ALP lost</div>
            <div className="text-2xl font-bold tabular-nums text-rose-300">
              {cbLoading ? "…" : fmt$(cbTotalALP)}
            </div>
          </div>
        </div>
        {!cbLoading && chargebacks.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
              Show {chargebacks.length} chargeback{chargebacks.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 space-y-1 max-h-[260px] overflow-y-auto">
              {chargebacks.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-background/40 border border-border/30">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {c.client_first_name} {c.client_last_name}
                      {c.policy_number && <span className="ml-2 font-mono text-[10px] text-muted-foreground">#{c.policy_number}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {c.agent_name} · {c.carrier_name || "—"} · {c.status_updated_at ? format(new Date(c.status_updated_at), "MMM d, yyyy") : "—"}
                    </div>
                  </div>
                  <div className="text-right tabular-nums shrink-0">
                    <div className="text-rose-300 font-semibold">{c.monthly_premium ? fmt$(Number(c.monthly_premium)) : "—"}/mo</div>
                    <div className="text-[10px] text-muted-foreground">{c.annual_premium ? fmt$(Number(c.annual_premium)) : "—"} ALP</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        {!cbLoading && chargebacks.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No chargebacks in this range. Widen the window if you expect to see older ones.
          </p>
        )}
      </GlassCard>

      {/* Filters */}
      <GlassCard className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agent, client, policy, carrier…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={sourceFilter} onValueChange={v => setSource(v as any)}>
          <SelectTrigger className="w-full sm:w-[150px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="apex">APEX</SelectItem>
            <SelectItem value="agent_link">Agent Link</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={v => setStage(v as any)}>
          <SelectTrigger className="w-full sm:w-[150px] h-9"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="lapsed">Lapsed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="charged_back">Chargeback</SelectItem>
          </SelectContent>
        </Select>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">{headerBtn("Client", "client")}</th>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-left px-3 py-2">Policy #</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2">Carrier</th>
                <th className="text-right px-3 py-2">{headerBtn("Monthly", "monthly_premium")}</th>
                <th className="text-right px-3 py-2">{headerBtn("ALP", "annual_premium")}</th>
                <th className="text-left px-3 py-2">{headerBtn("Posted", "posted_at")}</th>
                <th className="text-left px-3 py-2">{headerBtn("Effective", "effective_date")}</th>
                <th className="text-left px-3 py-2">Stage</th>
                <th className="text-left px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/30">
                    {Array.from({ length: 11 }).map((__, j) => (
                      <td key={j} className="px-3 py-3"><div className="h-3 bg-muted/30 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-16 text-center text-muted-foreground">
                    No deals match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map(d => (
                  <tr key={d.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setSelectedDeal(d)}
                        className="inline-flex items-center gap-1.5 text-left text-primary hover:underline"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {d.client_first_name} {d.client_last_name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{d.agent_name}</td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{d.policy_number}</td>
                    <td className="px-3 py-2">{d.product_sold}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.carrier_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-400">
                      {d.monthly_premium ? fmt$(Number(d.monthly_premium)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-400">
                      {d.annual_premium ? fmt$(Number(d.annual_premium)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {(d.posted_at || d.created_at) ? format(new Date(d.posted_at || d.created_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {d.effective_date ? format(new Date(d.effective_date), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn("text-[10px] border", STAGE_COLORS[pipelineLabel(d)] ?? "bg-muted text-muted-foreground border-border")}>
                        {pipelineLabel(d)}
                      </Badge>
                      {d.insuracloud_sync_error && (
                        <div className="mt-1 text-[10px] text-amber-300">sync issue</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn(
                        "text-[10px] border",
                        sourceKey(d.source) === "apex"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                          : "bg-blue-500/15 text-blue-300 border-blue-500/40",
                      )}>
                        {sourceKey(d.source) === "apex" ? "APEX" : "AgentLink"}
                      </Badge>
                      {d.external_deal_id && (
                        <div className="mt-1 max-w-[120px] truncate text-[10px] text-muted-foreground">
                          {d.external_deal_id}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <DealDetailDialog deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
    </div>
  );
}

// ─── Rich detail dialog: deal + full client profile from agentlink_clients ──
function DealDetailDialog({ deal, onClose }: { deal: DealRow | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [client, setClient] = useState<ClientFullRow | null>(null);
  const [clientLoading, setClientLoading] = useState(false);

  useEffect(() => {
    if (!deal?.pipeline_client_id) { setClient(null); return; }
    setClientLoading(true);
    (async () => {
      const { data } = await supabase
        .from("agentlink_clients" as any)
        .select("*")
        .eq("insuracloud_pipeline_client_id", deal.pipeline_client_id)
        .maybeSingle();
      setClient((data as ClientFullRow | null) ?? null);
      setClientLoading(false);
    })();
  }, [deal?.pipeline_client_id]);

  if (!deal) return null;

  const Row = ({ label, value }: { label: string; value: unknown }) => {
    if (value === null || value === undefined || value === "" || value === false) return null;
    return (
      <div className="rounded-md border border-border/50 p-2.5 bg-card/30">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-xs font-medium">{String(value)}</p>
      </div>
    );
  };
  const Section = ({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) => (
    <div className="space-y-2">
      <h3 className={cn("text-[11px] font-semibold uppercase tracking-wider", accent ?? "text-muted-foreground")}>{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
    </div>
  );
  const fmtMoney = (n: unknown) => {
    const v = Number(n ?? 0);
    return v ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
  };

  return (
    <Dialog open={Boolean(deal)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {deal.client_first_name} {deal.client_last_name}
          </DialogTitle>
          <div className="flex items-center gap-2 mt-1 text-xs">
            <Badge className={cn("border", STAGE_COLORS[pipelineLabel(deal)] ?? "bg-muted text-muted-foreground border-border")}>
              {pipelineLabel(deal)}
            </Badge>
            <span className="text-muted-foreground">{deal.policy_number || "—"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{deal.carrier_name || "—"}</span>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <Section title="Deal · Policy">
            <Row label="Agent" value={deal.agent_name} />
            <Row label="Policy Number" value={deal.policy_number} />
            <Row label="Carrier" value={deal.carrier_name} />
            <Row label="Product" value={deal.product_sold} />
            <Row label="Monthly Premium" value={deal.monthly_premium ? fmt$(Number(deal.monthly_premium)) : null} />
            <Row label="Annual Premium" value={deal.annual_premium ? fmt$(Number(deal.annual_premium)) : null} />
            <Row label="Face Amount" value={fmtMoney((client as any)?.face_amount)} />
            <Row label="Effective Date" value={deal.effective_date ? format(new Date(deal.effective_date), "MMM d, yyyy") : null} />
            <Row label="Posted Date" value={deal.posted_at ? format(new Date(deal.posted_at), "MMM d, yyyy") : null} />
            <Row label="Source" value={sourceKey(deal.source) === "apex" ? "APEX" : "AgentLink"} />
            <Row label="External ID" value={deal.external_deal_id} />
            <Row label="Sync Status" value={deal.insuracloud_sync_error || deal.synced_to_insuracloud_at || "OK"} />
          </Section>

          {clientLoading && (
            <p className="text-xs text-muted-foreground italic">Loading full client profile…</p>
          )}

          {client && (
            <>
              <Section title="Contact · Address" accent="text-blue-400">
                <Row label="Phone" value={client.phone} />
                <Row label="Phone Type" value={client.phone_type} />
                <Row label="Email" value={client.email} />
                <Row label="Preferred Contact" value={client.preferred_contact_method} />
                <Row label="Best Time to Call" value={client.best_time_to_call} />
                <Row label="Timezone" value={client.client_timezone} />
                <Row label="Address" value={client.street_address} />
                <Row label="City / State / Zip" value={`${client.city ?? ""} ${client.state ?? ""} ${client.zip_code ?? ""}`.trim() || null} />
                <Row label="DNC" value={client.do_not_call ? "DO NOT CALL" : null} />
                <Row label="DNE" value={client.do_not_email ? "DO NOT EMAIL" : null} />
                <Row label="DNT" value={client.do_not_text ? "DO NOT TEXT" : null} />
              </Section>

              <Section title="Health · Personal" accent="text-rose-400">
                <Row label="DOB" value={client.date_of_birth ? format(new Date(String(client.date_of_birth)), "MMM d, yyyy") : null} />
                <Row label="SSN last 4" value={client.ssn_last4 ? `***-**-${client.ssn_last4}` : null} />
                <Row label="Born In" value={client.born_location} />
                <Row label="Smoker" value={client.is_smoker ? "Yes" : null} />
                <Row label="Height" value={client.height} />
                <Row label="Weight" value={client.weight} />
                <Row label="Medical Notes" value={client.medical_notes} />
                <Row label="Physician" value={client.physician_name} />
                <Row label="Physician Phone" value={client.physician_phone} />
                <Row label="Physician Address" value={client.physician_address} />
                <Row label="Occupation" value={client.employer_occupation} />
                <Row label="Employment Status" value={client.employment_status} />
              </Section>

              {isAdmin && (client.bank_name || client.bank_account_number) && (
                <Section title="Banking · Admin only" accent="text-amber-400">
                  <Row label="Bank Name" value={client.bank_name} />
                  <Row label="Account Type" value={client.bank_account_type} />
                  <Row label="Account Number" value={client.bank_account_number} />
                  <Row label="Routing Number" value={client.bank_routing_number} />
                </Section>
              )}

              <Section title="Financial Profile" accent="text-emerald-400">
                <Row label="Total Monthly Income" value={fmtMoney(client.total_monthly_income)} />
                <Row label="Total Monthly Expenses" value={fmtMoney(client.total_monthly_expenses)} />
                <Row label="Monthly Surplus" value={fmtMoney(client.monthly_surplus)} />
                <Row label="Earned Income" value={fmtMoney(client.earned_income)} />
                <Row label="Pension Income" value={fmtMoney(client.pension_income)} />
                <Row label="Social Security" value={fmtMoney(client.social_security_income)} />
                <Row label="Qualified Accounts" value={fmtMoney(client.qualified_accounts)} />
                <Row label="Non-Qualified Accounts" value={fmtMoney(client.non_qualified_accounts)} />
                <Row label="Total Investable" value={fmtMoney(client.total_investable)} />
                <Row label="Retirement Age Goal" value={client.retirement_age_goal} />
                <Row label="Legacy Estate" value={fmtMoney(client.legacy_estate)} />
              </Section>

              {(client.beneficiary_first_name || client.beneficiary_count) && (
                <Section title="Beneficiary" accent="text-purple-400">
                  <Row label="First Name" value={client.beneficiary_first_name} />
                  <Row label="Last Name" value={client.beneficiary_last_name} />
                  <Row label="Phone" value={client.beneficiary_number} />
                  <Row label="Total Beneficiaries" value={client.beneficiary_count} />
                </Section>
              )}

              <Section title="Activity · Engagement" accent="text-cyan-400">
                <Row label="Stage Changed" value={client.stage_changed_at ? format(new Date(String(client.stage_changed_at)), "MMM d, yyyy") : null} />
                <Row label="Last Contact" value={client.last_contact_date ? format(new Date(String(client.last_contact_date)), "MMM d, yyyy") : null} />
                <Row label="Next Action Date" value={client.next_action_date ? format(new Date(String(client.next_action_date)), "MMM d, yyyy") : null} />
                <Row label="Next Action Notes" value={client.next_action_notes} />
                <Row label="Callback Date" value={client.callback_date ? format(new Date(String(client.callback_date)), "MMM d, yyyy") : null} />
                <Row label="Callback Time" value={client.callback_time} />
                <Row label="Client Health Score" value={client.client_health_score} />
                <Row label="Objectives" value={client.objectives} />
                <Row label="Communication Notes" value={client.communication_notes} />
                <Row label="Reminder Notes" value={client.reminder_notes} />
                <Row label="Lead Source" value={client.lead_vendor_name} />
                <Row label="Lead Product" value={client.lead_product_name} />
              </Section>
            </>
          )}

          {!client && !clientLoading && !deal.pipeline_client_id && (
            <p className="text-xs text-muted-foreground italic">
              No upstream pipeline client linked. Full servicing profile unavailable for this deal.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
