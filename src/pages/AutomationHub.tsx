import { useState, useEffect } from "react";
import { Zap, Play, RefreshCw, Clock, CheckCircle2, XCircle, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";

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
  const [automations, setAutomations] = useState<AutomationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const fetchAutomations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("automation_settings")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setAutomations(data as AutomationSetting[]);
    setLoading(false);
  };

  useEffect(() => { fetchAutomations(); }, []);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await supabase.from("automation_settings").update({ enabled: !enabled }).eq("id", id);
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
      await supabase.from("automation_settings").update({
        last_run_at: new Date().toISOString(),
        last_status: "success",
      }).eq("id", automation.id);
      toast.success(`${automation.name} ran successfully`);
      fetchAutomations();
    } catch (err: any) {
      await supabase.from("automation_settings").update({
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
    <div className="space-y-6 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1" style={{ fontFamily: "Syne" }}>APEX Financial</div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>Automation Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">Self-running workflows that keep your team on track</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAutomations} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-2xl font-bold text-primary" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.enabled).length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Active</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.last_status === "success").length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Succeeded</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-2xl font-bold text-destructive" style={{ fontFamily: "Syne" }}>{automations.filter(a => a.last_status === "failed").length}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Failed</p>
        </div>
      </div>

      {/* Automation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {automations.map(auto => (
          <div key={auto.id} className={cn(
            "bg-card border rounded-xl p-4 space-y-3 transition-all",
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
