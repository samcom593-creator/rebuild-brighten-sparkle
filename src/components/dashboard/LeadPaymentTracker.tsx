import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  Check,
  RefreshCw,
  Loader2,
  CreditCard,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PAYMENT_LINKS = {
  gold: "https://buy.stripe.com/dRm28q56XbDN7uH8w97ss02",
  platinum: "https://buy.stripe.com/28E8wOfLB7nx8yLcMp7ss03",
};

interface AgentPayment {
  agentId: string;
  name: string;
  email: string;
  goldPaid: boolean;
  platinumPaid: boolean;
  goldChargedAt: string | null;
  platinumChargedAt: string | null;
  totalThisWeekCents: number;
}

function getWeekRange(): { startISO: string; label: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return {
    startISO: monday.toISOString(),
    label: monday.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

const SKU_TO_TIER: Record<string, "gold" | "platinum"> = {
  gold: "gold",
  platinum: "platinum",
  standard: "gold",
  premium: "platinum",
  "gold leads": "gold",
  "platinum vet leads": "platinum",
};

function classifyTier(description: string | null | undefined): "gold" | "platinum" | null {
  if (!description) return null;
  const k = description.toLowerCase().trim();
  return SKU_TO_TIER[k] ?? null;
}

export function LeadPaymentTracker() {
  const { user, isAdmin } = useAuth();
  const [agents, setAgents] = useState<AgentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [overriding, setOverriding] = useState<string | null>(null);
  const week = getWeekRange();

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
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

      const userIds = liveAgents.map((a) => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      // Real Stripe charges this week (canonical source)
      const { data: charges } = await supabase
        .from("lead_purchases")
        .select("agent_id, description, charged_at, amount_cents")
        .gte("charged_at", week.startISO)
        .order("charged_at", { ascending: false });

      // Manual override (admin-marked paid for off-platform payments)
      const { data: manuals } = await supabase
        .from("lead_payment_tracking")
        .select("agent_id, tier, paid")
        .eq("week_start", week.startISO.slice(0, 10));

      const agentList: AgentPayment[] = liveAgents.map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        const myCharges = (charges ?? []).filter((c: any) => c.agent_id === agent.id);
        let goldPaid = false;
        let platinumPaid = false;
        let goldAt: string | null = null;
        let platinumAt: string | null = null;
        let total = 0;
        for (const c of myCharges as any[]) {
          const tier = classifyTier(c.description);
          if (tier === "gold") { goldPaid = true; goldAt = goldAt ?? c.charged_at; }
          if (tier === "platinum") { platinumPaid = true; platinumAt = platinumAt ?? c.charged_at; }
          total += Number(c.amount_cents ?? 0);
        }
        // Apply manual overrides on top
        for (const m of (manuals ?? []) as any[]) {
          if (m.agent_id !== agent.id) continue;
          if (m.tier === "gold" || m.tier === "standard") goldPaid = goldPaid || !!m.paid;
          if (m.tier === "platinum" || m.tier === "premium") platinumPaid = platinumPaid || !!m.paid;
        }
        return {
          agentId: agent.id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
          goldPaid,
          platinumPaid,
          goldChargedAt: goldAt,
          platinumChargedAt: platinumAt,
          totalThisWeekCents: total,
        };
      });

      agentList.sort((a, b) => {
        // Unpaid first (these need follow-up), then by name
        const aPaid = a.goldPaid || a.platinumPaid ? 1 : 0;
        const bPaid = b.goldPaid || b.platinumPaid ? 1 : 0;
        if (aPaid !== bPaid) return aPaid - bPaid;
        return a.name.localeCompare(b.name);
      });
      setAgents(agentList);
    } catch (error) {
      console.error("Error fetching payment data:", error);
      toast.error("Failed to load payment data");
    } finally {
      setLoading(false);
    }
  }, [week.startISO]);

  useEffect(() => {
    if (isAdmin) fetchAgents();
  }, [isAdmin, fetchAgents]);

  // Live updates: refetch when a new charge lands
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("lead-purchases-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_purchases" },
        () => fetchAgents(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin, fetchAgents]);

  const overridePaid = async (agentId: string, tier: "gold" | "platinum", currentPaid: boolean) => {
    setOverriding(`${agentId}-${tier}`);
    try {
      const newPaid = !currentPaid;
      const { error } = await supabase
        .from("lead_payment_tracking")
        .upsert(
          {
            agent_id: agentId,
            week_start: week.startISO.slice(0, 10),
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
                goldPaid: tier === "gold" ? newPaid : a.goldPaid,
                platinumPaid: tier === "platinum" ? newPaid : a.platinumPaid,
              }
            : a
        )
      );
      toast.success(newPaid ? "Manually marked paid" : "Override removed");
    } catch (error) {
      console.error("Override failed", error);
      toast.error("Override failed");
    } finally {
      setOverriding(null);
    }
  };

  const sendReminder = async (agent: AgentPayment) => {
    if (!agent.email) return toast.error("No email on file");
    try {
      const { error } = await supabase.functions.invoke("apex-alert-dispatch", {
        body: {
          to: agent.email,
          subject: "🚨 Activate your dialer + leads for this week",
          html: `<p>Hi ${agent.name.split(" ")[0]},</p>
                 <p>Your APEX dialer + leads for the week of ${week.label} aren't activated yet. To keep your dialer on:</p>
                 <p><a href="${PAYMENT_LINKS.gold}">Activate Gold ($250/wk)</a> · <a href="${PAYMENT_LINKS.platinum}">Activate Platinum ($500/wk)</a></p>
                 <p>— APEX</p>`,
        },
      });
      if (error) throw error;
      toast.success(`Reminder sent to ${agent.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Reminder failed");
    }
  };

  if (!isAdmin) return null;

  const paidCount = agents.filter((a) => a.goldPaid || a.platinumPaid).length;
  const goldRevenue = agents.filter((a) => a.goldPaid).length * 25000;
  const platinumRevenue = agents.filter((a) => a.platinumPaid).length * 50000;
  const totalCents = goldRevenue + platinumRevenue;

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-500/30">
            <DollarSign className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Stripe Payment Tracker
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">LIVE</Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              Week of {week.label} · {paidCount}/{agents.length} paid · ${(totalCents / 100).toLocaleString()} collected
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
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border/50">
            <span>Agent</span>
            <span className="text-center">Gold</span>
            <span className="text-center">Platinum</span>
            <span className="text-center">Action</span>
          </div>

          {agents.map((agent, i) => {
            const anyPaid = agent.goldPaid || agent.platinumPaid;
            return (
              <motion.div
                key={agent.agentId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i, 30) * 0.015 }}
                className={cn(
                  "grid grid-cols-[1fr_90px_90px_90px] gap-2 items-center px-3 py-3 rounded-lg border transition-colors",
                  anyPaid
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-rose-500/5 border-rose-500/20"
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate text-sm flex items-center gap-1.5">
                    {agent.name}
                    {!anyPaid && <AlertCircle className="h-3 w-3 text-rose-400 flex-shrink-0" />}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{agent.email}</p>
                </div>

                <PaidPill
                  paid={agent.goldPaid}
                  busy={overriding === `${agent.agentId}-gold`}
                  onClick={() => overridePaid(agent.agentId, "gold", agent.goldPaid)}
                  amount="$250"
                  color="amber"
                />
                <PaidPill
                  paid={agent.platinumPaid}
                  busy={overriding === `${agent.agentId}-platinum`}
                  onClick={() => overridePaid(agent.agentId, "platinum", agent.platinumPaid)}
                  amount="$500"
                  color="violet"
                />

                <div className="flex justify-center">
                  {anyPaid ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 gap-1">
                      <CreditCard className="h-3 w-3" />
                      Stripe
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => sendReminder(agent)}
                      title="Send activation reminder"
                    >
                      Remind
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-border/40 grid grid-cols-2 gap-3 text-xs">
        <a
          href={PAYMENT_LINKS.gold}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 hover:bg-amber-500/10 transition-colors"
        >
          <span className="font-medium">Gold link · $250/wk</span>
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={PAYMENT_LINKS.platinum}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 hover:bg-violet-500/10 transition-colors"
        >
          <span className="font-medium">Platinum link · $500/wk</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </GlassCard>
  );
}

function PaidPill({
  paid, busy, onClick, amount, color,
}: {
  paid: boolean; busy: boolean; onClick: () => void; amount: string; color: "amber" | "violet";
}) {
  const palette =
    color === "amber"
      ? paid ? "bg-amber-500 border-amber-500 text-black" : "border-amber-500/30 text-amber-400/60 hover:border-amber-500/60"
      : paid ? "bg-violet-500 border-violet-500 text-white" : "border-violet-500/30 text-violet-400/60 hover:border-violet-500/60";
  return (
    <div className="flex justify-center">
      <button
        onClick={onClick}
        disabled={busy}
        title={paid ? "Click to remove override" : "Manual override (off-platform payment)"}
        className={cn(
          "h-8 px-3 rounded-lg border-2 flex items-center gap-1 text-xs font-bold transition-all",
          palette,
        )}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : paid ? <Check className="h-3.5 w-3.5" /> : amount}
      </button>
    </div>
  );
}
