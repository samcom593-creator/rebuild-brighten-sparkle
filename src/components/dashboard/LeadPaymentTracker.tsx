import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { DollarSign, Check, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AgentPayment {
  agentId: string;
  name: string;
  email: string;
  standardPaid: boolean;
  premiumPaid: boolean;
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  const sunday = new Date(now.setDate(diff));
  return sunday.toISOString().split("T")[0];
}

export function LeadPaymentTracker() {
  const { user, isAdmin } = useAuth();
  const [agents, setAgents] = useState<AgentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const weekStart = getWeekStart();

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      // Get all evaluated (live) agents
      const { data: liveAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("status", "active")
        .eq("onboarding_stage", "evaluated")
        .eq("is_deactivated", false);

      if (!liveAgents?.length) {
        setAgents([]);
        setLoading(false);
        return;
      }

      // Get profiles
      const userIds = liveAgents.map((a) => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      // Get payment tracking for this week
      const { data: payments } = await supabase
        .from("lead_payment_tracking")
        .select("*")
        .eq("week_start", weekStart);

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      payments?.forEach((p: any) => {
        const existing = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") existing.standard = p.paid;
        if (p.tier === "premium") existing.premium = p.paid;
        paymentMap.set(p.agent_id, existing);
      });

      const agentList: AgentPayment[] = liveAgents.map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };
        return {
          agentId: agent.id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
          standardPaid: pay.standard,
          premiumPaid: pay.premium,
        };
      });

      agentList.sort((a, b) => a.name.localeCompare(b.name));
      setAgents(agentList);
    } catch (error) {
      console.error("Error fetching payment data:", error);
      toast.error("Failed to load payment data");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    if (isAdmin) fetchAgents();
  }, [isAdmin, fetchAgents]);

  const togglePayment = async (agentId: string, tier: "standard" | "premium", currentPaid: boolean) => {
    setSaving(`${agentId}-${tier}`);
    try {
      const newPaid = !currentPaid;

      const { error } = await supabase
        .from("lead_payment_tracking")
        .upsert(
          {
            agent_id: agentId,
            week_start: weekStart,
            tier,
            paid: newPaid,
            marked_by: user?.id,
            marked_at: new Date().toISOString(),
          },
          { onConflict: "agent_id,week_start,tier" }
        );

      if (error) throw error;

      setAgents((prev) =>
        prev.map((a) =>
          a.agentId === agentId
            ? {
                ...a,
                standardPaid: tier === "standard" ? newPaid : a.standardPaid,
                premiumPaid: tier === "premium" ? newPaid : a.premiumPaid,
              }
            : a
        )
      );

      toast.success(newPaid ? "Marked as paid" : "Unmarked payment");
    } catch (error) {
      console.error("Error toggling payment:", error);
      toast.error("Failed to update payment");
    } finally {
      setSaving(null);
    }
  };

  if (!isAdmin) return null;

  const paidCount = agents.filter((a) => a.standardPaid || a.premiumPaid).length;

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-500/30">
            <DollarSign className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Payment Tracker</h3>
            <p className="text-xs text-muted-foreground">
              Week of {new Date(weekStart).toLocaleDateString()} • {paidCount}/{agents.length} paid
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAgents} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">No live agents found</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border/50">
            <span>Agent</span>
            <span className="text-center">$250</span>
            <span className="text-center">$1,000</span>
          </div>

          {agents.map((agent, i) => (
            <motion.div
              key={agent.agentId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className={cn(
                "grid grid-cols-[1fr_100px_100px] gap-2 items-center px-3 py-3 rounded-lg border transition-colors",
                (agent.standardPaid || agent.premiumPaid)
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-background/50 border-border/50 hover:bg-muted/30"
              )}
            >
              <div className="min-w-0">
                <p className="font-medium truncate text-sm">{agent.name}</p>
                <p className="text-xs text-muted-foreground truncate">{agent.email}</p>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => togglePayment(agent.agentId, "standard", agent.standardPaid)}
                  disabled={saving === `${agent.agentId}-standard`}
                  className={cn(
                    "w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all",
                    agent.standardPaid
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {saving === `${agent.agentId}-standard` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : agent.standardPaid ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                </button>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => togglePayment(agent.agentId, "premium", agent.premiumPaid)}
                  disabled={saving === `${agent.agentId}-premium`}
                  className={cn(
                    "w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all",
                    agent.premiumPaid
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {saving === `${agent.agentId}-premium` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : agent.premiumPaid ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
