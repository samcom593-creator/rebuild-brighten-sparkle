import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { User, Mail, Phone, ArrowLeft, DollarSign, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AgentDetail = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
  license_status: string | null;
  start_date: string | null;
  total_policies: number | null;
  total_premium: number | null;
  insuracloud_user_id: number | null;
  manager_name: string | null;
  churn_90d_pct: number | null;
};

type Deal = {
  id: string;
  client_first_name: string;
  client_last_name: string;
  annual_premium: number;
  status: string;
  effective_date: string;
  carrier_name: string | null;
};

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [mtdAlp, setMtdAlp] = useState(0);
  const [activeAlp, setActiveAlp] = useState(0);
  const [pendingComm, setPendingComm] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      setLoading(true);
      const { data: a } = await supabase
        .from("agents")
        .select(`id, status, license_status, start_date, total_policies, total_premium,
          insuracloud_user_id, metadata,
          profile:profiles(full_name, email, phone, avatar_url),
          manager:agents!manager_id(profile:profiles(full_name))`)
        .eq("id", id).maybeSingle();
      if (!a) { if (!cancelled) { setAgent(null); setLoading(false); } return; }
      const p = (a as any).profile;
      setAgent({
        id: (a as any).id,
        full_name: p?.full_name,
        email: p?.email,
        phone: p?.phone,
        avatar_url: p?.avatar_url,
        status: (a as any).status,
        license_status: (a as any).license_status,
        start_date: (a as any).start_date,
        total_policies: (a as any).total_policies,
        total_premium: (a as any).total_premium,
        insuracloud_user_id: (a as any).insuracloud_user_id,
        manager_name: (a as any).manager?.profile?.full_name ?? null,
        churn_90d_pct: (a as any).metadata?.churn_90d_pct ?? null,
      });

      const { data: d } = await supabase
        .from("deals")
        .select(`id, client_first_name, client_last_name, annual_premium, status, effective_date,
          carrier:carriers(name)`)
        .eq("agent_id", id)
        .order("effective_date", { ascending: false })
        .limit(50);
      const deals: Deal[] = (d as any[] ?? []).map(x => ({
        id: x.id, client_first_name: x.client_first_name, client_last_name: x.client_last_name,
        annual_premium: Number(x.annual_premium), status: x.status, effective_date: x.effective_date,
        carrier_name: x.carrier?.name ?? null,
      }));
      setDeals(deals);
      setMtdAlp(deals.filter(d => new Date(d.effective_date) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1))
        .reduce((a, d) => a + d.annual_premium, 0));
      setActiveAlp(deals.filter(d => d.status === "active").reduce((a, d) => a + d.annual_premium, 0));

      const { data: ledger } = await supabase
        .from("commission_ledger" as any)
        .select("amount")
        .eq("agent_id", id)
        .eq("status", "pending");
      setPendingComm((ledger as any[] ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0));
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return (
    <div className="p-6 flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
    </div>
  );
  if (!agent) return (
    <div className="p-6 max-w-xl mx-auto">
      <GlassCard className="p-8 text-center">
        <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Agent not found.</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/dashboard/hierarchy">Back to team</Link></Button>
      </GlassCard>
    </div>
  );

  const statusColor = (s: string) => ({
    active:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    submitted:   "bg-primary/20 text-primary border-primary/30",
    lapsed:      "bg-orange-500/20 text-orange-400 border-orange-500/30",
    cancelled:   "bg-rose-500/20 text-rose-400 border-rose-500/30",
    charged_back:"bg-rose-500/20 text-rose-400 border-rose-500/30",
  } as Record<string,string>)[s] ?? "bg-muted";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/dashboard/hierarchy"><ArrowLeft className="h-4 w-4 mr-2" />Back to team</Link></Button>

      <GlassCard className="p-6 flex items-center gap-4">
        {agent.avatar_url ? (
          <img src={agent.avatar_url} alt="" className="h-16 w-16 rounded-full ring-2 ring-border/40" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{agent.full_name ?? "Unknown"}</h1>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {agent.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{agent.email}</span>}
            {agent.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{agent.phone}</span>}
            {agent.manager_name && <span>Manager: {agent.manager_name}</span>}
            {agent.insuracloud_user_id && <Badge variant="outline" className="text-[10px]">AL ID {agent.insuracloud_user_id}</Badge>}
          </div>
          <div className="flex gap-2 mt-2">
            {agent.status && <Badge variant="outline">{agent.status}</Badge>}
            {agent.license_status && <Badge variant="outline">{agent.license_status}</Badge>}
            {agent.start_date && <Badge variant="outline">Started {new Date(agent.start_date).toLocaleDateString()}</Badge>}
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-4"><div className="text-xs text-muted-foreground">MTD ALP</div><div className="text-xl font-bold tabular-nums text-emerald-400">${mtdAlp.toLocaleString(undefined,{maximumFractionDigits:0})}</div></GlassCard>
        <GlassCard className="p-4"><div className="text-xs text-muted-foreground">Active ALP</div><div className="text-xl font-bold tabular-nums">${activeAlp.toLocaleString(undefined,{maximumFractionDigits:0})}</div></GlassCard>
        <GlassCard className="p-4"><div className="text-xs text-muted-foreground">Pending commissions</div><div className="text-xl font-bold tabular-nums text-emerald-400">${pendingComm.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></GlassCard>
        <GlassCard className="p-4"><div className="text-xs text-muted-foreground">Churn 90d</div><div className="text-xl font-bold tabular-nums">{agent.churn_90d_pct != null ? `${agent.churn_90d_pct}%` : "—"}</div></GlassCard>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Deals ({deals.length})
        </div>
        {deals.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No deals yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Carrier</th>
                <th className="text-left px-3 py-2">Effective</th>
                <th className="text-right px-3 py-2">ALP</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(d => (
                <tr key={d.id} className="border-t border-border/20">
                  <td className="px-3 py-1.5 font-medium">{d.client_first_name} {d.client_last_name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{d.carrier_name ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{new Date(d.effective_date).toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">${d.annual_premium.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                  <td className="px-3 py-1.5"><Badge variant="outline" className={cn(statusColor(d.status))}>{d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>

      {canManage && (
        <GlassCard className="p-4 space-y-2">
          <div className="text-sm font-semibold">Manager actions</div>
          <div className="text-xs text-muted-foreground">
            Re-engagement SMS, reassign manager, deactivate — wire these to existing edge functions.
          </div>
        </GlassCard>
      )}
    </div>
  );
}
