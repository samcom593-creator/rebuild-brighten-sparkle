
# Fix Plan: Admin "Your Performance" Should Show Whole Team Stats

## Problem

The `PersonalStatsCard` component always shows the logged-in user's **personal stats only**, regardless of their role. As an admin, you want "Your Performance" to reflect your **entire team's aggregated metrics**.

Currently:
- Admin sees: Their own closing rate, presentations, deals, ALP
- Admin expects: Agency-wide closing rate, total presentations, total deals, total ALP

## Solution

Update `PersonalStatsCard` to be **role-aware**:
- **Agents**: Show personal stats only (current behavior)
- **Managers**: Show aggregated team stats (manager + their downline)
- **Admins**: Show aggregated agency-wide stats (all active agents)

### File to Modify

**`src/components/dashboard/PersonalStatsCard.tsx`**

### Changes Required

1. **Import `useAuth` hook** to detect user role:
```tsx
import { useAuth } from "@/hooks/useAuth";
```

2. **Update the component** to use role-based data fetching:
```tsx
export function PersonalStatsCard({ agentId, todayProduction }: PersonalStatsCardProps) {
  const { user, isAdmin, isManager } = useAuth();
  // ...
```

3. **Modify `fetchStats` function** to fetch team/agency data when admin/manager:

```tsx
const fetchStats = useCallback(async () => {
  try {
    setLoading(true);
    
    // Determine which agents to include based on role
    let targetAgentIds: string[] = [agentId];
    
    if (isAdmin) {
      // Admin sees all active agents
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id")
        .eq("is_deactivated", false);
      targetAgentIds = allAgents?.map(a => a.id) || [];
    } else if (isManager) {
      // Manager sees self + downline
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user?.id)
        .maybeSingle();

      if (currentAgent) {
        const { data: downlineAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", currentAgent.id)
          .eq("is_deactivated", false);

        targetAgentIds = [currentAgent.id, ...(downlineAgents?.map(a => a.id) || [])];
      }
    }
    
    // Fetch production for ALL target agents
    const { data: allProduction } = await supabase
      .from("daily_production")
      .select("agent_id, closing_rate, presentations, aop, deals_closed")
      .in("agent_id", targetAgentIds)  // Changed from .eq to .in
      .gte("production_date", dateRange.start)
      .lte("production_date", dateRange.end);
    
    // ... rest of aggregation logic stays the same
  }
}, [..., isAdmin, isManager, user]);
```

4. **Update the title dynamically** based on role:
```tsx
// Line 219 - Update header title
<h3 className="text-lg font-semibold gradient-text">
  {isAdmin ? "Agency Performance" : isManager ? "Team Performance" : "Your Performance"}
</h3>
```

5. **Update stat labels** to reflect scope:
```tsx
const stats = [
  {
    label: isAdmin || isManager ? "Close Rate" : "Your Closing Rate",
    // ...
  },
  {
    label: isAdmin || isManager ? "Total Presentations" : "Presentations",
    // ...
  },
  // ...
];
```

6. **Update comparison labels** - For admin/manager, compare to individual agent average:
```tsx
comparisonLabel: isAdmin || isManager ? "Per Agent Avg" : "Agency Avg",
```

## Summary

| Change | Description |
|--------|-------------|
| Import `useAuth` | Get role context (isAdmin, isManager) |
| Role-based agent selection | Admin gets all agents, Manager gets downline, Agent gets self |
| Update query from `.eq()` to `.in()` | Fetch production for multiple agents |
| Dynamic header title | "Agency Performance" / "Team Performance" / "Your Performance" |
| Updated stat labels | Reflect team vs personal scope |

## Result

- **Admins** see aggregated agency-wide stats (total ALP, total deals, agency close rate)
- **Managers** see aggregated team stats (self + downline)
- **Agents** continue to see only personal stats
- All stats remain live with real-time subscriptions
