import { useState, useEffect } from "react";
import { Zap, Play, RefreshCw, Clock, CheckCircle2, XCircle, ToggleLeft, ToggleRight, Cloud, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { InsuraCloudOutbox } from "@/components/admin/InsuraCloudOutbox";
import { CronJobsPanel } from "@/components/admin/CronJobsPanel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AutomationSetting {
  id: string;
  name: string;
  description: string | null;
  schedule: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_affected_count: number;
  created_at: string;
}

const FUNCTION_MAP: Record<string, string> = {
  "Daily Churn Check": "check-churn-risk",
  "Weekly Coaching": "send-proactive-coaching",
  "Licensing Sequence": "send-licensing-sequence",
  "Streak Milestones": "check-streak-milestones",
  "Weekly Milestones": "check-weekly-milestones",
  "Monthly Milestones": "check-monthly-milestones",
  "No Deal Today": "notify-no-deal-today",
  "Manager Digest": "manager-daily-digest",
  "Seminar Reminders": "notify-attendance-reminder",
  "Low Close Rate": "notify-low-close-rate",
  "Abandoned Check-in": "check-abandoned-applications",
};

export default function AutomationHub() {
  const { isAdmin } = useAuth();
  const [automations, setAutomations] = useState<AutomationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [outboxOpen, setOutboxOpen] = useState(true);
  const [cronOpen, setCronOpen] = useState(false);

  const fetchAutomations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("automation_settings" as any)
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setAutomations(data as unknown as AutomationSetting[]);
    setLoading(false);
  };

  useEffect(() => { fetchAutomations(); }, []);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await (supabase.from("automation_settings" as any) as any).update({ enabled: !enabled }).eq("id", id);
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled: !enabled } : a));
    toast.success(`Automation ${!enabled ? "enabled" : "disabled"}`);
  };

  const runNow = async (automation: AutomationSetting) => {
    const fnName = FUNCTION_MAP[automation.name];
    if (!fnName) {
      toast.error("No edge function mapped for this automation");
      return;
    }
    setRunning(automation.id);
    try {
      const { error } = await supabase.functions.invoke(fnName, { body: {} });
      if (error) throw error;
      await (supabase.from("automation_settings" as any) as any).update({
        last_run_at: new Date().toISOString(),
        last_status: "success",
      }).eq("id", automation.id);
      toast.success(`${automation.name} ran successfully`);
      fetchAutomations();
    } catch (err: any) {
      await (supabase.from("automation_settings" as any) as any).update({
        last_run_at: new Date().toISOString(),
        last_status: "failed",
      }).eq("id", automation.id);
      toast.error(`Failed: ${err.message}`);
      fetchAutomations();
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6 page-enter p-4 md:p-6">
      <PageHeader
        accent="purple"
        eyebrow="Admin · Automation"
        eyebrowIcon={<Zap className="h-3 w-3" />}
        title="Automation Hub"
        subtitle="Self-running workflows that keep your team on track — leads routing, follow-up nudges, daily reports."
        actions={
          <Button variant="outline" size="sm" onClick={fetchAutomations} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {isAdmin && (
        <Collapsible open={outboxOpen} onOpenChange={setOutboxOpen}>
          <div className="bg-card border border-border rounded-md">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-muted/30 rounded-md transition-colors">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm" style={{ fontFamily: "Syne" }}>InsuraCloud Outbox</span>
                <span className="text-xs text-muted-foreground">— deal sync, mapping, retries</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-base", outboxOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="p-4 pt-0">
              <InsuraCloudOutbox />
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {isAdmin && (
        <Collapsible open={cronOpen} onOpenChange={setCronOpen}>
          <div className="bg-card border border-border rounded-md">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-muted/30 rounded-md transition-colors">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm" style={{ fontFamily: "Syne" }}>Cron Jobs</span>
                <span className="text-xs text-muted-foreground">— scheduled tasks running on the database</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-base", cronOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="p-4 pt-0">
              <CronJobsPanel />
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-md p-3">
          <p className="text-2xl font-bold text-primary" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.enabled).length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Active</p>
        </div>
        <div className="bg-card border border-border rounded-md p-3">
          <p className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.last_status === "success").length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Succeeded</p>
        </div>
        <div className="bg-card border border-border rounded-md p-3">
          <p className="text-2xl font-bold text-destructive" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.last_status === "failed").length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Failed</p>
        </div>
      </div>

      {/* Automation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {automations.map(auto => (
          <div key={auto.id} className={cn(
            "bg-card border rounded-md p-4 space-y-3 transition-all",
            auto.enabled ? "border-border" : "border-border/50 opacity-60"
          )}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Zap className={cn("h-4 w-4", auto.enabled ? "text-primary" : "text-muted-foreground")} />
                <h3 className="font-semibold text-sm" style={{ fontFamily: "Syne" }}>{auto.name}</h3>
              </div>
              <button onClick={() => toggleEnabled(auto.id, auto.enabled)} className="text-muted-foreground hover:text-foreground transition-colors">
                {auto.enabled ? <ToggleRight className="h-6 w-6 text-primary" /> : <ToggleLeft className="h-6 w-6" />}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">{auto.description}</p>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{auto.schedule}</span>
            </div>

            {auto.last_run_at && (
              <div className="flex items-center gap-2">
                {auto.last_status === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className="text-xs text-muted-foreground">
                  Last: {format(new Date(auto.last_run_at), "MMM d 'at' h:mm a")}
                </span>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={running === auto.id || !auto.enabled}
              onClick={() => runNow(auto)}
            >
              {running === auto.id ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              Run Now
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
