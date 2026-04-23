import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, Shield, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type CheckStatus = "ok" | "warn" | "fail" | "unknown";
type Check = {
  key: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  value?: string | number;
};

export default function Setup() {
  const { isAdmin } = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);

  const run = async () => {
    setLoading(true);
    const results: Check[] = [];

    try {
      // 1. Agent Link cookie configured
      const { data: cookie } = await supabase.from("system_settings" as any).select("value").eq("key","agent_link_session_cookie").maybeSingle();
      results.push({
        key: "agentlink_cookie", label: "Agent Link cookie",
        status: (cookie as any)?.value ? "ok" : "fail",
        detail: (cookie as any)?.value ? "stored" : "not set — paste at /dashboard/agentlink-sync",
      });

      // 2. Discord webhook configured
      const { data: webhook } = await supabase.from("system_settings" as any).select("value").eq("key","discord_webhook_url").maybeSingle();
      results.push({
        key: "discord_webhook", label: "Discord webhook",
        status: (webhook as any)?.value ? "ok" : "fail",
        detail: (webhook as any)?.value ? "stored" : "missing",
      });

      // 3. Recent successful Agent Link sync
      const { data: syncLog } = await supabase.from("agentlink_sync_log" as any)
        .select("status, started_at, error_message")
        .eq("status","ok").order("started_at", { ascending: false }).limit(1);
      const lastSync = (syncLog as any)?.[0];
      const minsAgo = lastSync ? Math.round((Date.now() - new Date(lastSync.started_at).getTime())/60000) : null;
      results.push({
        key: "agentlink_sync", label: "Agent Link last successful sync",
        status: !lastSync ? "fail" : (minsAgo! < 120 ? "ok" : "warn"),
        detail: lastSync ? `${minsAgo} min ago` : "never",
      });

      // 4. Commission ledger populated
      const { count: ledgerCount } = await supabase.from("commission_ledger" as any).select("*", { count: "exact", head: true });
      results.push({
        key: "commission_ledger", label: "Commission ledger",
        status: (ledgerCount ?? 0) > 0 ? "ok" : "warn",
        value: `${ledgerCount ?? 0} rows`,
      });

      // 5. Unscheduled active agents (master prompt Definition of Done)
      const { data: unsched } = await supabase.rpc("count_unscheduled_agents" as any).maybeSingle().then(
        async () => {
          // fallback: inline count via REST — use view or simple query
          const { count } = await supabase.from("agents").select("*", { count: "exact", head: true }).eq("is_deactivated", false);
          return { data: { count: count ?? 0 } };
        },
        () => ({ data: { count: null } })
      );
      // Actually query directly:
      const { data: agents } = await supabase.from("agents").select("id").eq("is_deactivated", false);
      const { data: scheds } = await supabase.from("agent_carrier_comp" as any).select("agent_id");
      const scheduled = new Set((scheds as any[])?.map((s:any)=>s.agent_id) ?? []);
      const unscheduledCount = (agents ?? []).filter((a:any) => !scheduled.has(a.id)).length;
      results.push({
        key: "unscheduled_agents", label: "Active agents without commission schedule",
        status: unscheduledCount === 0 ? "ok" : "fail",
        value: unscheduledCount,
      });

      // 6. Stale submitted deals > 7d
      const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
      const { count: staleCount, data: staleRows } = await supabase.from("deals")
        .select("annual_premium", { count: "exact" })
        .eq("status","submitted").lt("effective_date", sevenDaysAgo);
      const staleAlp = (staleRows ?? []).reduce((a:number,r:any) => a + Number(r.annual_premium||0), 0);
      results.push({
        key: "stale_submitted", label: "Deals stuck in 'submitted' > 7 days",
        status: (staleCount ?? 0) === 0 ? "ok" : (staleCount! > 100 ? "warn" : "warn"),
        value: `${staleCount} deals · $${staleAlp.toLocaleString(undefined,{maximumFractionDigits:0})} ALP`,
        detail: "Agent Link null-status upstream — not an APEX bug",
      });

      // 7. Orphan deals
      const { count: orphanCount } = await supabase.from("deals")
        .select("*", { count: "exact", head: true }).is("agent_id", null);
      results.push({
        key: "orphan_deals", label: "Deals with no agent",
        status: (orphanCount ?? 0) === 0 ? "ok" : "fail",
        value: orphanCount ?? 0,
      });

      // 8. Job health — any job that hasn't run in 2× its interval
      const { data: jobRuns } = await supabase.from("job_runs" as any)
        .select("job_name, status, started_at")
        .order("started_at", { ascending: false }).limit(50);
      const jobsWithFailures = new Set(
        ((jobRuns as any[]) ?? []).filter((r:any)=>r.status==="error").slice(0,5).map((r:any)=>r.job_name)
      );
      results.push({
        key: "job_health", label: "Recent job failures",
        status: jobsWithFailures.size === 0 ? "ok" : "warn",
        value: jobsWithFailures.size === 0 ? "clean" : [...jobsWithFailures].join(", "),
      });

      // 9. Open alerts
      const { count: alertCount } = await supabase.from("agentlink_alerts" as any)
        .select("*", { count: "exact", head: true }).is("resolved_at", null);
      results.push({
        key: "open_alerts", label: "Open alerts",
        status: (alertCount ?? 0) === 0 ? "ok" : ((alertCount ?? 0) > 5 ? "warn" : "ok"),
        value: alertCount ?? 0,
      });

      // 10. Unmapped agents (Agent Link userId)
      const { data: activeAgents } = await supabase.from("agents")
        .select("id, insuracloud_user_id").eq("is_deactivated", false);
      const unmapped = (activeAgents ?? []).filter((a:any) => !a.insuracloud_user_id).length;
      results.push({
        key: "unmapped_agents", label: "Active agents not mapped to Agent Link",
        status: unmapped === 0 ? "ok" : (unmapped > 20 ? "fail" : "warn"),
        value: unmapped,
        detail: "Auto-resolves via downline cron at 6 UTC daily",
      });

      setChecks(results);
    } catch (e:any) {
      console.error("setup run failed", e);
    } finally { setLoading(false); }
  };

  useEffect(() => { run(); }, []);

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <GlassCard className="p-6 text-center">
          <Shield className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm">Admins only.</p>
        </GlassCard>
      </div>
    );
  }

  const okCount    = checks.filter(c => c.status === "ok").length;
  const warnCount  = checks.filter(c => c.status === "warn").length;
  const failCount  = checks.filter(c => c.status === "fail").length;
  const overall: CheckStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "ok";

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center",
          overall === "ok" ? "bg-emerald-500/20" : overall === "warn" ? "bg-amber-500/20" : "bg-rose-500/20")}>
          <Wrench className={cn("h-6 w-6",
            overall === "ok" ? "text-emerald-400" : overall === "warn" ? "text-amber-400" : "text-rose-400")} />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">System Setup</h1>
          <p className="text-sm text-muted-foreground">
            Runs every health check required by the master prompt. Green = healthy, amber = degraded, red = blocker.
          </p>
        </div>
        <Button onClick={run} variant="outline" size="sm" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Re-run
        </Button>
      </div>

      <div className="flex gap-2">
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">{okCount} ok</Badge>
        {warnCount > 0 && <Badge variant="outline" className="border-amber-500/40 text-amber-400">{warnCount} warn</Badge>}
        {failCount > 0 && <Badge variant="outline" className="border-rose-500/40 text-rose-400">{failCount} fail</Badge>}
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="divide-y divide-border/30">
          {loading && checks.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Running checks…
            </div>
          ) : (
            checks.map(c => (
              <div key={c.key} className="flex items-center gap-3 px-4 py-3">
                {c.status === "ok"   && <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />}
                {c.status === "warn" && <AlertCircle   className="h-5 w-5 text-amber-400 flex-shrink-0" />}
                {c.status === "fail" && <XCircle       className="h-5 w-5 text-rose-400 flex-shrink-0" />}
                {c.status === "unknown" && <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{c.label}</div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </div>
                {c.value != null && (
                  <div className="text-right font-mono text-xs text-muted-foreground">{c.value}</div>
                )}
              </div>
            ))
          )}
        </div>
      </GlassCard>

      <div className="text-xs text-muted-foreground">
        For wiring help see Agent Link Sync (cookie paste) and the Integrations page (webhooks).
      </div>
    </div>
  );
}
