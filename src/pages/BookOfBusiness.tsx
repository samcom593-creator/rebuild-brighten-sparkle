import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Book, Filter, Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
  pipeline_stage: string | null;
  source: string | null;
  status: string | null;
  carrier_id: string | null;
  created_at: string;
  agent_name?: string;
  carrier_name?: string;
}

type SortKey = "created_at" | "monthly_premium" | "effective_date" | "client";
type SortDir = "asc" | "desc";

const STAGE_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  approved:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  paid:      "bg-amber-500/20 text-amber-300 border-amber-500/40",
  lapsed:    "bg-rose-500/20 text-rose-300 border-rose-500/40",
};

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function BookOfBusiness() {
  const [deals, setDeals]       = useState<DealRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [sourceFilter, setSource] = useState<"all" | "apex" | "agent_link">("all");
  const [stageFilter, setStage]   = useState<"all" | "submitted" | "approved" | "paid" | "lapsed">("all");
  const [sortKey, setSortKey]     = useState<SortKey>("created_at");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("deals")
        .select(`
          id, agent_id, client_first_name, client_last_name, policy_number,
          product_sold, monthly_premium, annual_premium, effective_date,
          pipeline_stage, source, status, carrier_id, created_at
        `)
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(500);

      const rows = (data ?? []) as DealRow[];

      // Resolve agent + carrier names in one batch
      const agentIds   = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
      const carrierIds = [...new Set(rows.map(r => r.carrier_id).filter((v): v is string => Boolean(v)))];

      const [{ data: agents }, { data: carriers }] = await Promise.all([
        agentIds.length
          ? supabase.from("agents").select("id, profile:profiles(full_name)").in("id", agentIds)
          : Promise.resolve({ data: [] } as any),
        carrierIds.length
          ? supabase.from("carriers").select("id, name").in("id", carrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const agentMap: Record<string, string> = {};
      for (const a of (agents ?? []) as any[]) agentMap[a.id] = a.profile?.full_name ?? "Agent";
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
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase.channel(`bob-${Math.random()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals
      .filter(d => sourceFilter === "all" || (d.source ?? "apex") === sourceFilter)
      .filter(d => stageFilter === "all"  || (d.pipeline_stage ?? "submitted") === stageFilter)
      .filter(d => {
        if (!q) return true;
        const hay = [
          d.agent_name, d.client_first_name, d.client_last_name,
          d.policy_number, d.product_sold, d.carrier_name,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortKey) {
          case "monthly_premium": return ((a.monthly_premium ?? 0) - (b.monthly_premium ?? 0)) * dir;
          case "effective_date":  return ((a.effective_date ?? "") > (b.effective_date ?? "") ? 1 : -1) * dir;
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Book className="h-6 w-6 text-primary" />
        <h1 className="text-2xl md:text-3xl font-bold">Book of Business</h1>
        <Button variant="outline" size="sm" onClick={load} className="ml-auto">
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

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
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">APEX / Agent Link</div>
          <div className="text-2xl font-bold tabular-nums">
            {filtered.filter(d => (d.source ?? "apex") === "apex").length}
            <span className="text-muted-foreground"> / </span>
            {filtered.filter(d => d.source === "agent_link").length}
          </div>
        </GlassCard>
      </div>

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
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="apex">APEX</SelectItem>
            <SelectItem value="agent_link">Agent Link</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={v => setStage(v as any)}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="lapsed">Lapsed</SelectItem>
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
                <th className="text-left px-3 py-2">{headerBtn("Effective", "effective_date")}</th>
                <th className="text-left px-3 py-2">Stage</th>
                <th className="text-left px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/30">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-3 py-3"><div className="h-3 bg-muted/30 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center text-muted-foreground">
                    No deals match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map(d => (
                  <tr key={d.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">
                      {d.client_first_name} {d.client_last_name}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{d.agent_name}</td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{d.policy_number}</td>
                    <td className="px-3 py-2">{d.product_sold}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.carrier_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-400">
                      {d.monthly_premium ? fmt$(Number(d.monthly_premium)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {d.effective_date ? format(new Date(d.effective_date), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn("text-[10px] border", STAGE_COLORS[d.pipeline_stage ?? "submitted"])}>
                        {d.pipeline_stage ?? "submitted"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn(
                        "text-[10px] border",
                        (d.source ?? "apex") === "apex"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                          : "bg-blue-500/15 text-blue-300 border-blue-500/40",
                      )}>
                        {(d.source ?? "apex") === "apex" ? "APEX" : "Agent Link"}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
