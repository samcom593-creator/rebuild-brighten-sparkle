import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertCircle, RefreshCw, Loader2, Cloud, CheckCircle2, Users } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { format } from "date-fns";

export function InsuraCloudOutbox() {
  const [autoPush, setAutoPush] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  // Load setting
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "insuracloud_autopush_enabled")
        .maybeSingle();
      if (data) setAutoPush(data.value === "true");
    })();
  }, []);

  const toggleAutoPush = async (v: boolean) => {
    setSavingToggle(true);
    setAutoPush(v);
    const { error } = await supabase
      .from("system_settings")
      .upsert({ key: "insuracloud_autopush_enabled", value: v ? "true" : "false" });
    setSavingToggle(false);
    if (error) toast.error(error.message); else toast.success(`Auto-push ${v ? "enabled" : "disabled"}`);
  };

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["insuracloud-outbox-stats"],
    queryFn: async () => {
      const [pendingRes, errorsRes, syncedRes, mapping] = await Promise.all([
        supabase.from("deals" as any).select("id", { count: "exact", head: true })
          .is("synced_to_insuracloud_at", null).neq("status", "draft"),
        supabase.from("deals" as any).select("id", { count: "exact", head: true })
          .not("insuracloud_sync_error", "is", null).is("synced_to_insuracloud_at", null),
        supabase.from("deals" as any).select("id", { count: "exact", head: true })
          .not("synced_to_insuracloud_at", "is", null),
        supabase.from("agents").select("id", { count: "exact", head: true })
          .eq("is_deactivated", false).is("insuracloud_user_id", null),
      ]);
      const carriersRes = await supabase.from("carriers" as any).select("id", { count: "exact", head: true })
        .eq("is_active", true).is("insuracloud_carrier_id", null);
      return {
        pending: pendingRes.count ?? 0,
        errors: errorsRes.count ?? 0,
        synced: syncedRes.count ?? 0,
        unmappedAgents: mapping.count ?? 0,
        unmappedCarriers: carriersRes.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const { data: recentErrors = [], refetch: refetchErrors } = useQuery({
    queryKey: ["insuracloud-recent-errors"],
    queryFn: async () => {
      const { data } = await supabase.from("deals" as any)
        .select("id, policy_number, client_first_name, client_last_name, insuracloud_sync_error, created_at, agent_id")
        .not("insuracloud_sync_error", "is", null)
        .is("synced_to_insuracloud_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data as any) || [];
    },
  });

  const { data: backfillHistory = [] } = useQuery({
    queryKey: ["insuracloud-backfill-history"],
    queryFn: async () => {
      const { data } = await supabase.from("insuracloud_backfill_log" as any)
        .select("*").order("ran_at", { ascending: false }).limit(5);
      return (data as any) || [];
    },
  });

  const sweepNow = async () => {
    setSweeping(true);
    try {
      const { data, error } = await supabase.functions.invoke("insuracloud-outbox", { body: { sweep: true } });
      if (error) throw error;
      toast.success(`Sweep done — processed ${data?.processed ?? 0}, ✓${data?.succeeded ?? 0}, ✗${data?.failed ?? 0}`);
      refetchStats(); refetchErrors();
    } catch (e: any) { toast.error(e.message ?? "Sweep failed"); }
    finally { setSweeping(false); }
  };

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("mirror-agents-backfill", { body: {} });
      if (error) throw error;
      toast.success(`Mapped ${data?.agents_matched ?? 0} agents, ${data?.carriers_matched ?? 0} carriers`);
      refetchStats();
    } catch (e: any) { toast.error(e.message ?? "Backfill failed"); }
    finally { setBackfilling(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Synced", value: stats?.synced ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Pending", value: stats?.pending ?? 0, icon: Cloud, color: "text-primary" },
          { label: "Errored", value: stats?.errors ?? 0, icon: AlertCircle, color: "text-orange-400" },
          { label: "Agents unmapped", value: stats?.unmappedAgents ?? 0, icon: Users, color: "text-yellow-400" },
          { label: "Carriers unmapped", value: stats?.unmappedCarriers ?? 0, icon: Users, color: "text-yellow-400" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <div className="text-xl font-bold mt-1">{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Auto-push controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-push deals to InsuraCloud on submit</Label>
              <p className="text-xs text-muted-foreground">Disable to pause all syncing. Sweeper still queues retries.</p>
            </div>
            <Switch checked={autoPush} onCheckedChange={toggleAutoPush} disabled={savingToggle} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
            <Button size="sm" variant="outline" onClick={sweepNow} disabled={sweeping}>
              {sweeping ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sweep pending now
            </Button>
            <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling}>
              {backfilling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
              Backfill agent + carrier IDs
            </Button>
          </div>
        </CardContent>
      </Card>

      {recentErrors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-400">
              <AlertCircle className="h-4 w-4" /> Recent sync errors
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentErrors.map((d: any) => (
                <div key={d.id} className="p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{d.client_first_name} {d.client_last_name} — #{d.policy_number}</span>
                    <Badge variant="outline" className="text-[10px]">{format(new Date(d.created_at), "MMM d HH:mm")}</Badge>
                  </div>
                  <div className="text-orange-400 font-mono text-[11px]">{d.insuracloud_sync_error}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {backfillHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent backfills</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border text-xs">
              {backfillHistory.map((b: any) => (
                <div key={b.id} className="p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">{format(new Date(b.ran_at), "MMM d, yyyy HH:mm")}</span>
                  <span>
                    Agents <strong className="text-emerald-400">{b.agents_matched}</strong>
                    /{b.agents_matched + b.agents_unmatched} ·{" "}
                    Carriers <strong className="text-emerald-400">{b.carriers_matched}</strong>
                    /{b.carriers_matched + b.carriers_unmatched}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
