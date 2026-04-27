import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/StatCard";
import { Users, DollarSign, TrendingUp, Target } from "lucide-react";

export default function MyTeam() {
  const { isManager } = useAuth();
  const { data: downlineIds = [] } = useMyDownline();

  const { data: teamStats } = useQuery({
    queryKey: ["my-team-stats", downlineIds.join(",")],
    queryFn: async () => {
      if (downlineIds.length === 0) return null;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

      const [prodRes, agentsRes] = await Promise.all([
        // Pull from deals (effective_date + valid status) so MyTeam totals
        // line up with the agency dashboard.
        supabase.from("deals").select("agent_id, annual_premium")
          .in("agent_id", downlineIds)
          .gte("effective_date", monthStart)
          .in("status", ["submitted", "active"]),
        supabase.from("agents").select("id, display_name, profile:profiles!agents_profile_id_fkey(full_name, avatar_url)").in("id", downlineIds).eq("is_deactivated", false),
      ]);

      const byAgent = new Map<string, { alp: number; deals: number }>();
      for (const p of (prodRes.data || []) as any[]) {
        if (!p.agent_id) continue;
        const existing = byAgent.get(p.agent_id) || { alp: 0, deals: 0 };
        existing.alp += Number(p.annual_premium) || 0;
        existing.deals += 1;
        byAgent.set(p.agent_id, existing);
      }

      const agents = ((agentsRes.data || []) as any[]).map((a: any) => ({
        id: a.id,
        name: (a.profile as any)?.full_name || a.display_name || "Agent",
        avatarUrl: (a.profile as any)?.avatar_url,
        ...(byAgent.get(a.id) || { alp: 0, deals: 0 }),
      })).sort((a, b) => b.alp - a.alp);

      const totalALP = agents.reduce((s, a) => s + a.alp, 0);
      const totalDeals = agents.reduce((s, a) => s + a.deals, 0);
      const activeThisMonth = agents.filter(a => a.alp > 0).length;

      return {
        teamSize: agents.length,
        activeThisMonth,
        totalALP,
        totalDeals,
        avgALP: activeThisMonth > 0 ? totalALP / activeThisMonth : 0,
        agents,
      };
    },
    enabled: isManager && downlineIds.length > 0,
  });

  if (!isManager) return <div className="p-6 text-muted-foreground">Manager access required</div>;
  if (!teamStats) return <div className="p-6 text-muted-foreground">Loading your team...</div>;

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <div>
        <h1 className="text-2xl font-bold">My Team</h1>
        <p className="text-sm text-muted-foreground">Your hierarchy only</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Team Size" value={teamStats.teamSize} icon={Users} />
        <StatCard title="Active This Month" value={teamStats.activeThisMonth} icon={TrendingUp} variant="success" />
        <StatCard title="Team MTD ALP" value={`$${teamStats.totalALP.toLocaleString()}`} icon={DollarSign} variant="success" />
        <StatCard title="Avg ALP/Active" value={`$${Math.round(teamStats.avgALP).toLocaleString()}`} icon={Target} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {teamStats.agents.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 hover:bg-muted/20">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.deals} deals this month</p>
                </div>
                <p className="text-sm font-semibold">${a.alp.toLocaleString()}</p>
              </div>
            ))}
            {teamStats.agents.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No agents in your downline yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
