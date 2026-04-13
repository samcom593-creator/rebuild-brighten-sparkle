import { useState, useEffect } from "react";
import { Link2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompactProductionEntry } from "@/components/dashboard/CompactProductionEntry";
import { CompactLeaderboard } from "@/components/dashboard/CompactLeaderboard";
import { AgentRankBadge } from "@/components/dashboard/AgentRankBadge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/hooks/useAuth";

export default function Numbers() {
  const { user, isLoading: authLoading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [noAgent, setNoAgent] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [weeklyStats, setWeeklyStats] = useState({ alp: 0, deals: 0, rank: 0 });

  useEffect(() => {
    if (authLoading || !user) return;

    const loadAgentData = async () => {
      try {
        const { data: agent, error } = await supabase
          .from("agents")
          .select("id, profile_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error || !agent) {
          setNoAgent(true);
          setLoading(false);
          return;
        }

        setAgentId(agent.id);

        let name = "Agent";
        if (agent.profile_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", agent.profile_id)
            .maybeSingle();
          name = profile?.full_name || "Agent";
        } else {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .maybeSingle();
          name = profile?.full_name || "Agent";
        }

        setAgentName(name);
      } catch (err) {
        console.error("Error loading agent data:", err);
        setNoAgent(true);
      } finally {
        setLoading(false);
      }
    };

    loadAgentData();
  }, [user, authLoading]);

  useEffect(() => {
    if (!agentId) return;
    let mounted = true;

    const loadWeekly = async () => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      const { data: myProd } = await supabase
        .from("daily_production")
        .select("aop, deals_closed")
        .eq("agent_id", agentId)
        .gte("production_date", weekStartStr);

      const alp = myProd?.reduce((s, r) => s + Number(r.aop || 0), 0) || 0;
      const deals = myProd?.reduce((s, r) => s + Number(r.deals_closed || 0), 0) || 0;

      const { data: allProd } = await supabase
        .from("daily_production")
        .select("agent_id, aop")
        .gte("production_date", weekStartStr);

      const agentTotals: Record<string, number> = {};
      (allProd || []).forEach((r: any) => {
        agentTotals[r.agent_id] = (agentTotals[r.agent_id] || 0) + Number(r.aop || 0);
      });

      const sorted = Object.entries(agentTotals).sort(([, a], [, b]) => b - a);
      const rank = sorted.findIndex(([id]) => id === agentId) + 1;

      if (mounted) setWeeklyStats({ alp, deals, rank: rank || 0 });
    };

    loadWeekly();
    return () => { mounted = false; };
  }, [agentId, refreshKey]);

  if (authLoading || loading) {
    return <SkeletonLoader variant="page" />;
  }

  if (noAgent || !agentId) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold">No Agent Record Found</h2>
          <p className="text-sm text-muted-foreground">
            Your account doesn't have an agent profile linked. Please contact your manager to get set up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="space-y-4">
        <div className="text-center py-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
            APEX Daily Numbers
          </h1>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground">Welcome, {agentName}</p>
            <AgentRankBadge agentId={agentId} size="sm" />
          </div>
        </div>

        <CompactProductionEntry 
          agentId={agentId} 
          agentName={agentName}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />

        {/* Weekly Summary */}
        <GlassCard className="p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">This Week</div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-primary">
                ${(weeklyStats.alp / 1000).toFixed(1)}k
              </div>
              <div className="text-[10px] text-muted-foreground">ALP</div>
              {weeklyStats.alp > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ~${Math.round(weeklyStats.alp * 0.55).toLocaleString()} est.
                </div>
              )}
            </div>
            <div>
              <div className="text-xl font-bold">{weeklyStats.deals}</div>
              <div className="text-[10px] text-muted-foreground">Deals</div>
            </div>
            <div>
              <div className="text-xl font-bold">
                {weeklyStats.rank > 0 ? `#${weeklyStats.rank}` : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">Rank</div>
            </div>
          </div>
        </GlassCard>

        <CompactLeaderboard currentAgentId={agentId} refreshKey={refreshKey} />

        <div className="text-center text-xs text-muted-foreground py-4 flex items-center justify-center gap-2">
          <Link2 className="h-3 w-3" />
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/numbers`);
              toast.success("Link copied to clipboard!");
            }}
            className="underline hover:text-primary transition-colors"
          >
            Share this page with your team
          </button>
        </div>
      </div>
    </div>
  );
}
