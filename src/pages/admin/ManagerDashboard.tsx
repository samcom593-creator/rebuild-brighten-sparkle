import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, GraduationCap, TrendingUp, AlertOctagon, CheckCircle2, Clock, DollarSign, Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

/* ------- types ------- */
type AppRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  state: string | null;
  status: string;
  assigned_agent_id: string | null;
  created_at: string;
  contacted_at: string | null;
};

type HireRow = {
  id?: string;
  full_name?: string | null;
  first_name?: string | null;
  state?: string | null;
  hired_at?: string | null;
  created_at?: string | null;
};

type DealRow = {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  amount: number | null;
  carrier: string | null;
  status: string;
  closed_at: string | null;
  created_at: string;
};

type AgentLite = { id: string; display_name: string | null };

/* ============================================================ */
function RecruitingTab() {
  const { data: pipeline } = useQuery({
    queryKey: ["mgr_pipeline_30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, state, status, assigned_agent_id, created_at, contacted_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AppRow[];
    },
  });

  const { data: agents } = useQuery({
    queryKey: ["agents_lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id, display_name").order("display_name");
      if (error) throw error;
      return data as AgentLite[];
    },
    staleTime: 5 * 60_000,
  });

  const agentMap = new Map((agents ?? []).map(a => [a.id, a.display_name]));
  const rows = pipeline ?? [];
  const byStage: Record<string, AppRow[]> = {};
  rows.forEach(r => { (byStage[r.status] = byStage[r.status] || []).push(r); });

  const last24h = rows.filter(r => Date.now() - new Date(r.created_at).getTime() < 24 * 3600 * 1000).length;
  const noContact = rows.filter(r => r.status === "new" && !r.contacted_at).length;
  const interviewing = (byStage["interview"] ?? []).length;
  const contracting = (byStage["contracting"] ?? []).length;
  const approved = (byStage["approved"] ?? []).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label="Apps last 24h" value={last24h} color="text-emerald-300" />
        <StatTile label="Stage=new no contact" value={noContact} color="text-rose-300" />
        <StatTile label="In interview" value={interviewing} color="text-amber-300" />
        <StatTile label="In contracting" value={contracting} color="text-info" />
        <StatTile label="Approved (30d)" value={approved} color="text-emerald-300" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Last 50 applications (30 days)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!pipeline ? <div className="p-6"><Skeleton className="h-40 w-full" /></div> :
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-muted-foreground text-xs"><tr>
                <th className="text-left p-3">Applicant</th>
                <th className="text-left p-3">State</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Routed</th>
                <th className="text-left p-3">Applied</th>
                <th className="text-left p-3">Last contact</th>
              </tr></thead>
              <tbody>{rows.slice(0, 50).map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td className="p-3">{r.state ?? "—"}</td>
                  <td className="p-3"><Badge variant="secondary">{r.status}</Badge></td>
                  <td className="p-3 text-xs">{r.assigned_agent_id ? agentMap.get(r.assigned_agent_id) ?? "—" : <span className="text-rose-400">unassigned</span>}</td>
                  <td className="p-3 text-xs text-slate-600 dark:text-slate-300">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</td>
                  <td className="p-3 text-xs text-slate-600 dark:text-slate-300">{r.contacted_at ? formatDistanceToNow(new Date(r.contacted_at), { addSuffix: true }) : <span className="text-rose-400">never</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
function LicensingTab() {
  const { data: hires } = useQuery({
    queryKey: ["mgr_recent_hires"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_recent_hires").select("*").limit(20);
      if (error) throw error;
      return data as HireRow[];
    },
  });

  const { data: pre } = useQuery({
    queryKey: ["mgr_prelicense_pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("status")
        .in("status", ["paid","onboarding","registered","attended"]);
      if (error) throw error;
      return data as Array<{ status: string }>;
    },
  });

  const stageCount = (s: string) => (pre ?? []).filter(r => r.status === s).length;

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Full Licensing Tracker (8-stage Enrolled→Quit kanban + per-student readiness rollup + study-gap timeline) ships in P1-6.</strong> Until then, this tab shows the coarse-grained view backed by application stage. Detailed per-student exam-readiness arrives with the licensing_students schema.
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Paid / enrolled" value={stageCount("paid")} color="text-emerald-300" />
        <StatTile label="In onboarding" value={stageCount("onboarding")} color="text-info" />
        <StatTile label="Registered for exam" value={stageCount("registered")} color="text-amber-300" />
        <StatTile label="Attended seminar" value={stageCount("attended")} color="text-emerald-300" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Recent hires (last 20)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!hires ? <div className="p-6"><Skeleton className="h-40 w-full" /></div> :
            <ul className="divide-y divide-white/5">{hires.map((h, i) => (
              <li key={`${h.hired_at ?? h.created_at ?? i}-${h.full_name ?? h.first_name ?? "unknown"}`} className="flex items-center justify-between p-3 text-sm">
                <span>{h.full_name ?? h.first_name ?? "—"}{h.state ? <span className="text-slate-600 dark:text-slate-300 ml-2">· {h.state}</span> : null}</span>
                <span className="text-xs text-slate-600 dark:text-slate-300">{h.hired_at || h.created_at ? formatDistanceToNow(new Date(h.hired_at ?? h.created_at!), { addSuffix: true }) : ""}</span>
              </li>
            ))}</ul>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
function ProductionTab() {
  const { data: deals } = useQuery({
    queryKey: ["mgr_deals_30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, agent_id, amount, carrier, status, closed_at, created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as DealRow[];
    },
  });

  const closed = (deals ?? []).filter(d => d.status === "closed_won" || d.status === "submitted" || d.status === "paid");
  const monthAmt = closed.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const byAgent: Record<string, { count: number; amount: number }> = {};
  closed.forEach(d => {
    if (!d.agent_id) return;
    if (!byAgent[d.agent_id]) byAgent[d.agent_id] = { count: 0, amount: 0 };
    byAgent[d.agent_id].count += 1;
    byAgent[d.agent_id].amount += Number(d.amount) || 0;
  });
  const top = Object.entries(byAgent).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10);

  const { data: agents } = useQuery({
    queryKey: ["agents_lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id, display_name").order("display_name");
      if (error) throw error;
      return data as AgentLite[];
    },
    staleTime: 5 * 60_000,
  });
  const agentMap = new Map((agents ?? []).map(a => [a.id, a.display_name]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Deals closed (30d)" value={closed.length} color="text-emerald-300" />
        <StatTile label="$ ALP submitted (30d)" value={`$${Math.round(monthAmt).toLocaleString()}`} color="text-emerald-300" />
        <StatTile label="Active producers (30d)" value={Object.keys(byAgent).length} color="text-info" />
        <StatTile label="Avg deal" value={closed.length ? `$${Math.round(monthAmt / closed.length).toLocaleString()}` : "—"} color="text-slate-600 dark:text-slate-300" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Crown className="w-4 h-4 text-amber-400" /> Top 10 producers (last 30d ALP)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!deals ? <div className="p-6"><Skeleton className="h-40 w-full" /></div> :
            <ul className="divide-y divide-white/5">{top.map(([agentId, agg], i) => (
              <li key={agentId} className="flex items-center justify-between p-3 text-sm">
                <span><span className="text-slate-600 dark:text-slate-300 mr-2 tabular-nums">{i + 1}.</span>{agentMap.get(agentId) ?? agentId.slice(0, 8)}</span>
                <span className="text-xs"><span className="text-slate-600 dark:text-slate-300 mr-3">{agg.count} deals</span><span className="text-emerald-300 font-medium tabular-nums">${Math.round(agg.amount).toLocaleString()}</span></span>
              </li>
            ))}</ul>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="w-4 h-4" /> Last 20 deals (any stage)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!deals ? <div className="p-6"><Skeleton className="h-40 w-full" /></div> :
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-muted-foreground text-xs"><tr>
                <th className="text-left p-3">Agent</th>
                <th className="text-left p-3">Carrier</th>
                <th className="text-left p-3 tabular-nums">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Created</th>
              </tr></thead>
              <tbody>{(deals ?? []).slice(0, 20).map(d => (
                <tr key={d.id} className="border-t border-border">
                  <td className="p-3">{d.agent_id ? agentMap.get(d.agent_id) ?? "—" : "—"}</td>
                  <td className="p-3">{d.carrier ?? "—"}</td>
                  <td className="p-3 tabular-nums text-emerald-300">${Math.round(Number(d.amount) || 0).toLocaleString()}</td>
                  <td className="p-3"><Badge variant="secondary">{d.status}</Badge></td>
                  <td className="p-3 text-xs text-slate-600 dark:text-slate-300">{formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}</td>
                </tr>
              ))}</tbody>
            </table></div>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
function StatTile({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-2xl lg:text-3xl font-bold tabular-nums leading-tight", color)}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
export default function ManagerDashboard() {
  const [tab, setTab] = useState("recruiting");
  return (
    <div className="min-h-screen p-4 lg:p-6 max-w-7xl mx-auto space-y-4 ops-surface ops-fade-in">
      <PageHeader
        accent="amber"
        eyebrow="Admin · Manager"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Manager Command"
        subtitle="One screen for the manager who runs the room. Recruiting (new apps + contact gaps), Licensing (paid → exam-ready), Production (deals + leaderboard)."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="recruiting"><Users className="w-3.5 h-3.5 mr-1.5" /> Recruiting</TabsTrigger>
          <TabsTrigger value="licensing"><GraduationCap className="w-3.5 h-3.5 mr-1.5" /> Licensing</TabsTrigger>
          <TabsTrigger value="production"><TrendingUp className="w-3.5 h-3.5 mr-1.5" /> Production</TabsTrigger>
        </TabsList>
        <TabsContent value="recruiting" className="mt-4"><RecruitingTab /></TabsContent>
        <TabsContent value="licensing" className="mt-4"><LicensingTab /></TabsContent>
        <TabsContent value="production" className="mt-4"><ProductionTab /></TabsContent>
      </Tabs>

      <div className="text-center text-xs text-muted-foreground pt-4 pb-8 italic">Hold the Standard. Average is the disease.</div>
    </div>
  );
}
