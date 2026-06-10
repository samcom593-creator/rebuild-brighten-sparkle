import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Wallet, Loader2, AlertCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";
import { PageHeader } from "@/components/ui/page-header";

type LedgerRow = {
  id: string;
  deal_id: string;
  annual_premium: number;
  rate_pct: number;
  rate_source: string;
  amount: number;
  status: "pending" | "paid" | "clawed_back" | "voided";
  expected_paid_date: string | null;
  actual_paid_date: string | null;
  created_at: string;
  carrier_name?: string;
  client_name?: string;
  product?: string;
  source?: "ledger" | "estimate";
};

export default function MyCommissions() {
  const { user } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) { if (!cancelled) { setAgentId(null); setLoading(false); } return; }
      const { data: agent } = await supabase.from("agents")
        .select("id, contract_percentage").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (!agent?.id) { setAgentId(null); setLoading(false); return; }
      setAgentId(agent.id);

      const { data: ledger } = await supabase.from("commission_ledger" as any)
        .select(`id, deal_id, annual_premium, rate_pct, rate_source, amount, status,
          expected_paid_date, actual_paid_date, created_at,
          deal:deals(client_first_name, client_last_name, product_sold,
            carrier:carriers(name))`)
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false });

      let mapped: LedgerRow[] = (ledger as any[] ?? []).map(r => ({
        id: r.id,
        deal_id: r.deal_id,
        annual_premium: Number(r.annual_premium),
        rate_pct: Number(r.rate_pct),
        rate_source: r.rate_source,
        amount: Number(r.amount),
        status: r.status,
        expected_paid_date: r.expected_paid_date,
        actual_paid_date: r.actual_paid_date,
        created_at: r.created_at,
        carrier_name: r.deal?.carrier?.name,
        client_name: r.deal ? `${r.deal.client_first_name ?? ""} ${r.deal.client_last_name ?? ""}`.trim() : undefined,
        product: r.deal?.product_sold,
        source: "ledger",
      }));

      if (mapped.length === 0) {
        const { data: deals } = await supabase
          .from("deals")
          .select("id, annual_premium, product_sold, client_first_name, client_last_name, posted_at, created_at, status")
          .eq("agent_id", agent.id)
          .in("status", DEAL_TRUTH_STATUS_FILTER)
          .order("posted_at", { ascending: false, nullsFirst: false })
          .limit(250);
        const ratePct = Number(agent.contract_percentage ?? 65);
        mapped = ((deals as any[]) ?? []).map((deal) => {
          const annualPremium = Number(deal.annual_premium ?? 0);
          return {
            id: `estimate-${deal.id}`,
            deal_id: deal.id,
            annual_premium: annualPremium,
            rate_pct: ratePct,
            rate_source: "agent contract percentage estimate",
            amount: annualPremium * (ratePct / 100),
            status: "pending",
            expected_paid_date: null,
            actual_paid_date: null,
            created_at: deal.posted_at ?? deal.created_at,
            client_name: `${deal.client_first_name ?? ""} ${deal.client_last_name ?? ""}`.trim(),
            product: deal.product_sold,
            source: "estimate",
          } satisfies LedgerRow;
        });
      }
      setRows(mapped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const pending = rows.filter(r => r.status === "pending");
  const paid    = rows.filter(r => r.status === "paid");
  const clawed  = rows.filter(r => r.status === "clawed_back");
  const totalPending = pending.reduce((a, r) => a + r.amount, 0);
  const totalPaid    = paid.reduce((a, r) => a + r.amount, 0);
  const totalClawed  = clawed.reduce((a, r) => a + r.amount, 0);
  const estimatedRows = rows.filter(r => r.source === "estimate").length;

  // PL-050: YTD by-month breakdown — mirrors AgentLink's finances tab cadence.
  const ytd = rows.filter(r => new Date(r.created_at).getFullYear() === new Date().getFullYear());
  const byMonth = new Map<string, { label: string; premium: number; commission: number; deals: number }>();
  for (const r of ytd) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const cur = byMonth.get(key) ?? { label, premium: 0, commission: 0, deals: 0 };
    cur.premium += r.annual_premium || 0;
    cur.commission += r.amount || 0;
    cur.deals += 1;
    byMonth.set(key, cur);
  }
  const monthsDesc = Array.from(byMonth.entries()).sort((a,b) => b[0].localeCompare(a[0]));
  const totalYtdCommission = ytd.reduce((a, r) => a + (r.amount || 0), 0);
  const totalYtdPremium    = ytd.reduce((a, r) => a + (r.annual_premium || 0), 0);
  const avgPerDeal = ytd.length > 0 ? totalYtdCommission / ytd.length : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto page-enter">
      <PageHeader
                eyebrow="Production · Earnings"
        eyebrowIcon={<Wallet className="h-3 w-3" />}
        title="My Commissions"
        subtitle={
          estimatedRows > 0
            ? "Estimated from valid AgentLink/APEX deals until the commission ledger is populated."
            : "Live ledger — every deal's commission computed from your contract rate. Pulled from Supabase."
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading ledger…
        </div>
      ) : !agentId ? (
        <GlassCard className="p-8 text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You don't have an agent record linked to your user account. Contact your manager.</p>
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Wallet className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No valid AgentLink/APEX deals or commission ledger rows are visible for this account.</p>
        </GlassCard>
      ) : (
        <>
          {estimatedRows > 0 && (
            <GlassCard className="border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 text-sm text-amber-200">
                <AlertCircle className="h-4 w-4" />
                Showing estimated commissions from deal premium and contract percentage. Actual payout dates require `commission_ledger`.
              </div>
            </GlassCard>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <GlassCard className="p-4">
              <div className="text-xs text-muted-foreground">Pending</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-400">${totalPending.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div className="text-xs text-muted-foreground mt-1">{pending.length} deal{pending.length === 1 ? "" : "s"}</div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-xs text-muted-foreground">Paid (YTD)</div>
              <div className="text-2xl font-bold tabular-nums">${totalPaid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div className="text-xs text-muted-foreground mt-1">{paid.length} deal{paid.length === 1 ? "" : "s"}</div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-xs text-muted-foreground">Clawed back</div>
              <div className={cn("text-2xl font-bold tabular-nums", totalClawed > 0 ? "text-rose-400" : "")}>${totalClawed.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div className="text-xs text-muted-foreground mt-1">{clawed.length} deal{clawed.length === 1 ? "" : "s"}</div>
            </GlassCard>
          </div>

          {monthsDesc.length > 0 && (
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between text-sm">
                <span className="font-semibold">YTD by month · {new Date().getFullYear()}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  ${totalYtdCommission.toLocaleString(undefined,{maximumFractionDigits:0})} commission · ${totalYtdPremium.toLocaleString(undefined,{maximumFractionDigits:0})} premium · avg ${avgPerDeal.toLocaleString(undefined,{maximumFractionDigits:0})}/deal
                </span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="text-left px-3 py-2">Month</th>
                    <th className="text-right px-3 py-2">Deals</th>
                    <th className="text-right px-3 py-2">Premium</th>
                    <th className="text-right px-3 py-2">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {monthsDesc.map(([k, m]) => (
                    <tr key={k} className="border-t border-border/20">
                      <td className="px-3 py-1.5 font-medium">{m.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.deals}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">${m.premium.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-400">${m.commission.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          )}

          <GlassCard className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 text-sm font-semibold">Ledger ({rows.length})</div>
            <table className="w-full text-xs">
              <thead className="bg-muted/20">
                <tr>
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-left px-3 py-2">Carrier</th>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Premium</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Expected pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border/20">
                    <td className="px-3 py-1.5 font-medium">{r.client_name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.carrier_name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.product ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">${r.annual_premium.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.rate_pct}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">${r.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant="outline" className={cn(
                        r.status === "paid"        && "border-emerald-500/40 text-emerald-400",
                        r.status === "pending"     && "border-amber-500/40 text-amber-400",
                        r.status === "clawed_back" && "border-rose-500/40 text-rose-400",
                        r.status === "voided"      && "border-muted-foreground/40 text-muted-foreground")}>
                        {r.status}
                      </Badge>
                      {r.source === "estimate" && (
                        <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-400">estimate</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.expected_paid_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </>
      )}
    </div>
  );
}
