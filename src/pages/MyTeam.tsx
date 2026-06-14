import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/StatCard";
import { PageHeader } from "@/components/ui/page-header";
import { Users, DollarSign, TrendingUp, Target, Lock } from "lucide-react";
import { getBusinessMonthBounds } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";

// Section 2 · Dashboard visibility gate:
// Managers see their full per-agent hierarchy ONLY when their team has posted
// >= $50k ALP MTD (matches v_manager_hierarchy_mtd.team_alp_mtd which is the
// canonical agency MTD truth — see migration 20260614084200_canonical_agent_dedup
// _production_views.sql). Below that threshold they see roll-up stats + a
// "scope locked" explainer instead of the per-agent breakdown. The aggregate
// MTD stat cards (team size, total ALP, etc.) remain visible at all production
// levels because they're a motivational signal, not a privacy concern.
const FULL_HIERARCHY_UNLOCK_THRESHOLD = 50_000;

export default function MyTeam() {
  const { isManager, isAdmin, user } = useAuth();
  const { data: downlineIds = [] } = useMyDownline();

  // Resolve the current user's agent row so we can look up v_manager_hierarchy_mtd
  // by manager_id (which is agents.id, not auth.user_id — verified against the
  // public view definition).
  const { data: managerAgentId } = useQuery({
    queryKey: ["my-agent-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
    enabled: !!user?.id && isManager,
    staleTime: 5 * 60_000,
  });

  // Pull the canonical team_alp_mtd for the gate. Admins are exempt
  // (see hasFullHierarchyAccess below).
  const { data: hierarchyRow } = useQuery({
    queryKey: ["my-team-hierarchy-row", managerAgentId],
    queryFn: async () => {
      if (!managerAgentId) return null;
      const { data, error } = await supabase
        .from("v_manager_hierarchy_mtd" as any)
        .select("team_alp_mtd, team_size, producing_team_mtd")
        .eq("manager_id", managerAgentId)
        .maybeSingle();
      if (error) throw error;
      return data as { team_alp_mtd: number | null; team_size: number | null; producing_team_mtd: number | null } | null;
    },
    enabled: !!managerAgentId,
    staleTime: 60_000,
  });

  const canonicalTeamAlpMtd = Number(hierarchyRow?.team_alp_mtd ?? 0);
  const hasFullHierarchyAccess = isAdmin || canonicalTeamAlpMtd >= FULL_HIERARCHY_UNLOCK_THRESHOLD;
  const amountToUnlock = Math.max(0, FULL_HIERARCHY_UNLOCK_THRESHOLD - canonicalTeamAlpMtd);

  const { data: teamStats } = useQuery({
    queryKey: ["my-team-stats", downlineIds.join(",")],
    queryFn: async () => {
      if (downlineIds.length === 0) return null;
      const monthBounds = getBusinessMonthBounds();

      const [prodRes, agentsRes] = await Promise.all([
        // Pull from posted deals so manager month totals match the same
        // calendar MTD truth layer used across the dashboard.
        supabase.from("deals").select("agent_id, annual_premium")
          .in("agent_id", downlineIds)
          .gte("posted_at", monthBounds.startIso)
          .lt("posted_at", monthBounds.endIso)
          .in("status", DEAL_TRUTH_STATUS_FILTER),
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

  if (!isManager && !isAdmin) return <div className="p-6 text-muted-foreground">Manager access required</div>;
  // Explicit empty state for managers with no invitees — otherwise the page
  // was stuck showing "Loading…" forever because the query was disabled.
  if (downlineIds.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-bold">My Team</h1>
          <p className="text-sm text-muted-foreground">Your hierarchy only</p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          You don't have any direct recruits yet.
          <div className="mt-3">
            <a href="/dashboard/agent-management" className="underline">Add an agent</a>
            <span className="mx-2">·</span>
            <a href="/dashboard/referrals/new" className="underline">Submit a referral</a>
          </div>
        </div>
      </div>
    );
  }
  if (!teamStats) return <div className="p-6 text-muted-foreground">Loading your team...</div>;

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <PageHeader
        accent="blue"
        eyebrow="Manager · Team"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="My Team"
        subtitle="Your hierarchy at a glance — team size, monthly ALP, who's active, who needs help."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Team Size" value={teamStats.teamSize} icon={Users} />
        <StatCard title="Active This Month" value={teamStats.activeThisMonth} icon={TrendingUp} variant="success" />
        <StatCard title="Team MTD ALP" value={`$${teamStats.totalALP.toLocaleString()}`} icon={DollarSign} variant="success" />
        <StatCard title="Avg ALP/Active" value={`$${Math.round(teamStats.avgALP).toLocaleString()}`} icon={Target} />
      </div>

      {hasFullHierarchyAccess ? (
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
      ) : (
        <Card className="border-amber-400/30 bg-amber-400/[0.04]">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-amber-400/15 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
                <Lock className="h-4 w-4 text-amber-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-amber-300" style={{ fontFamily: "'Syne', sans-serif", letterSpacing: "0.04em" }}>
                  Scope locked · full hierarchy hidden
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Per-agent breakdowns unlock when your team posts <span className="font-semibold text-amber-300">${FULL_HIERARCHY_UNLOCK_THRESHOLD.toLocaleString()}</span> in ALP this month.
                </p>
                <p className="text-xs text-slate-400">
                  Your team is at <span className="font-semibold text-slate-200">${canonicalTeamAlpMtd.toLocaleString()}</span> MTD.
                  {amountToUnlock > 0 && (
                    <> Need <span className="font-semibold text-amber-300">${amountToUnlock.toLocaleString()}</span> more to unlock.</>
                  )}
                </p>
              </div>
            </div>
            <div className="pt-1 border-t border-amber-400/15">
              <p className="text-[11px] uppercase tracking-[2px] text-slate-500 mb-1" style={{ fontFamily: "'Syne', sans-serif" }}>
                What unlocks at ${FULL_HIERARCHY_UNLOCK_THRESHOLD.toLocaleString()} team MTD
              </p>
              <ul className="text-xs text-slate-400 space-y-0.5 list-disc list-inside">
                <li>Per-agent ALP + deal counts for every downline agent</li>
                <li>Sortable hierarchy roster with full activity signal</li>
                <li>Cross-agent comparison + coaching surfaces</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
