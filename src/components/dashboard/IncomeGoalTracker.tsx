import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useProducerProductionMetrics } from "@/hooks/useProducerProductionMetrics";
import { toast } from "sonner";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** User-entered goal assumptions are separate from actual posted production and cash. */
export function IncomeGoalTracker({ agentId }: { agentId: string }) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const month = today.slice(0, 7);
  const production = useProducerProductionMetrics(agentId);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [incomeInput, setIncomeInput] = useState("");
  const [compInput, setCompInput] = useState("");
  const goal = useQuery({
    queryKey: ["producer-income-goal", user?.id, agentId, month],
    enabled: Boolean(user?.id && agentId), staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_goals").select("income_goal, comp_percentage")
        .eq("agent_id", agentId).eq("month_year", month).maybeSingle();
      if (error) throw error;
      if (data && (!(data.income_goal > 0) || !(data.comp_percentage > 0))) {
        throw new Error("The saved goal assumptions are invalid.");
      }
      return data;
    },
  });
  useEffect(() => {
    setIncomeInput(goal.data?.income_goal?.toString() ?? "");
    setCompInput(goal.data?.comp_percentage?.toString() ?? "");
    setEditing(false);
  }, [goal.data, agentId, user?.id, month]);
  const save = async () => {
    const income = Number(incomeInput);
    const comp = Number(compInput);
    if (!Number.isFinite(income) || income <= 0 || !Number.isFinite(comp) || comp <= 0) {
      toast.error("Enter a positive income goal and a positive assumed commission percentage.");
      return;
    }
    if (!user?.id || !agentId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("agent_goals").upsert({ agent_id: agentId, month_year: month,
        income_goal: income, comp_percentage: comp, updated_at: new Date().toISOString() }, { onConflict: "agent_id,month_year" });
      if (error) throw error;
      await goal.refetch();
      setEditing(false);
      toast.success("Goal assumptions saved");
    } catch { toast.error("The goal could not be saved. Retry after the connection recovers."); }
    finally { setSaving(false); }
  };
  const requiredAP = goal.data ? goal.data.income_goal / (goal.data.comp_percentage / 100) : null;
  const progress = requiredAP && production.data ? Math.min(100, production.data.mtd_ap / requiredAP * 100) : null;
  const averageAP = production.data && production.data.lifetime_policies > 0
    ? production.data.lifetime_ap / production.data.lifetime_policies : null;
  return <GlassCard className="overflow-hidden">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-6">
      <div><h3 className="flex items-center gap-2 text-lg font-semibold"><Target className="h-5 w-5 text-primary" />Income goal · planning assumptions</h3><p className="mt-1 text-xs text-muted-foreground">{month} · personal production</p></div>
      {goal.data && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit goal</Button>}
    </header>
    <div className="space-y-4 p-4 sm:p-6">
      {goal.isLoading ? <p className="text-sm text-muted-foreground">Loading goal…</p> : goal.isError && !goal.data ? <p role="status" className="text-sm text-muted-foreground">The saved goal could not be verified.</p> : !goal.data || editing ? <>
        <p className="text-sm text-muted-foreground">Enter the income target and commission percentage you want to model. The percentage is your assumption, not a verified carrier payout rate.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="income-goal">Income goal ($)</Label><Input id="income-goal" type="number" min="1" value={incomeInput} onChange={e => setIncomeInput(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="comp-percent">Assumed commission (%)</Label><Input id="comp-percent" type="number" min="0.01" step="0.01" value={compInput} onChange={e => setCompInput(e.target.value)} /></div>
        </div>
        <div className="flex gap-2"><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save goal assumptions"}</Button>{editing && <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>}</div>
      </> : <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Income goal", money(goal.data.income_goal)],
            ["Assumed commission", `${goal.data.comp_percentage}%`],
            ["AP target under assumption", money(requiredAP!)],
            ["Personal posted AP", production.data ? money(production.data.mtd_ap) : "Unavailable"],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-background/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>)}
        </div>
        {progress !== null && <div className="space-y-2"><p className="text-xs text-muted-foreground">Posted AP toward the assumed target · {progress.toFixed(0)}%</p><Progress value={progress} /></div>}
        <p className="text-xs text-muted-foreground">Target AP = income goal ÷ your assumed commission percentage. Posted AP is submitted production; it is not earned or paid income. Placement, advances, carrier terms and chargebacks change actual cash.</p>
        {averageAP !== null && <p className="text-xs text-muted-foreground">Historical average posted AP: {money(averageAP)} across {production.data!.lifetime_policies} policies. Presentation-to-sale conversion is unavailable because those records are not linked into one cohort.</p>}
        {production.isError && <p role="status" className="text-xs text-destructive">Production refresh failed. {production.data ? "Showing the last verified read." : "Actual progress is unavailable."}</p>}
      </>}
    </div>
  </GlassCard>;
}
