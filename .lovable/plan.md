
# Data Import & Dynamic Team Totals Implementation

## Overview

This plan covers three main areas:
1. **Data Import**: Parse and add the January 2026 deals to the production database
2. **Terminated Agent Handling**: Add terminated agent production to manager's team totals without showing them on the leaderboard
3. **Dynamic Team Totals**: Make the admin's "Team Stats" section respond to Week/Month/All selection

---

## 1. Parse January 2026 Deals Data

### Agent Name Mapping

From the provided deals, here are the unique agents and their deal counts (Annual ALP):

| Agent Name | Total Deals | Total ALP |
|------------|-------------|-----------|
| Obiajulu Ifediora | 16 | $23,195.00 |
| Moody Imran | 17 | $22,175.44 |
| Aisha Kebbeh | 12 | $12,348.68 |
| Codey Salazar (TERMINATED) | 15 | $18,009.76 |
| Kaeden Vaughns | 11 | $15,661.28 |
| Samuel James | 4 | $9,942.40 |
| Bryan Ross | 6 | $6,757.40 |
| Joseph Sebasco | 6 | $5,900.64 |
| Chukwudi Ifediora | 5 | $5,878.92 |
| Josiah Darden | 4 | $6,612.68 |
| Michael Kayembe | 2 | $1,824.96 |
| Alex Wordu | 4 | $3,223.68 |
| Richard Hall | 1 | $1,178.76 |
| Joseph Intwan | 2 | $2,559.36 |

**Total January 2026**: ~105 deals | ~$148,269

### Missing Agents

Many agents from this list are not in the current database. The system needs to:
1. First create agent records for missing agents (or skip if not in system)
2. Group production by posted date
3. Insert/upsert daily_production records

### Recommended Approach

**Option A: Create a data import edge function**
Create `import-production-data` edge function that:
- Accepts agent name + date + annual ALP
- Matches agent by name to existing records
- Creates daily_production entries grouped by posted date

**Option B: Run SQL migration to bulk insert**
- Create a one-time SQL script that inserts the data directly
- Requires knowing agent IDs for each name

---

## 2. Terminated Agent Production Attribution

### Current Behavior
- Terminated agents (is_deactivated = true OR status = "terminated") are excluded from leaderboards
- Their production data still exists in daily_production

### Requested Behavior
- Terminated agents' numbers should be added to their manager's (Samuel James) team totals
- They should NOT appear on the leaderboard

### Implementation

**File: `src/pages/AgentPortal.tsx`**

Modify `fetchTeamStats()` to include terminated agents' production when calculating admin team totals:

```typescript
const fetchTeamStats = async (currentAgentId: string | null) => {
  try {
    let agentIds: string[] = [];
    
    if (isAdmin) {
      // Admin sees ALL agents including terminated ones for team totals
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id");  // Remove is_deactivated filter for totals
      agentIds = allAgents?.map(a => a.id) || [];
    }
    // ... rest of logic
  }
};
```

The leaderboards already filter by `is_deactivated = false`, so terminated agents won't appear there.

---

## 3. Dynamic Week/Month/All Team Stats

### Current State
The admin's "Quick Stats" section shows only TODAY's stats - hardcoded to current date.

### Requested Behavior
When admin views the team stats, they should be able to toggle between:
- **This Week** (default)
- **This Month**
- **All Time**

### Implementation

**File: `src/pages/AgentPortal.tsx`**

Add a time range selector and modify the fetchTeamStats function:

```typescript
// Add state for time range
const [statsTimeRange, setStatsTimeRange] = useState<"week" | "month" | "all">("week");

// Modified fetchTeamStats with date range support
const fetchTeamStats = async (currentAgentId: string | null, timeRange: string) => {
  const { start, end } = getDateRange(timeRange); // Helper function
  
  const { data: teamProduction } = await supabase
    .from("daily_production")
    .select("aop, deals_closed, presentations, closing_rate")
    .in("agent_id", agentIds)
    .gte("production_date", start)
    .lte("production_date", end);
  
  // ... calculate totals
};

// Helper function
const getDateRange = (range: "week" | "month" | "all") => {
  const now = new Date();
  switch (range) {
    case "week":
      return {
        start: format(startOfWeek(now, { weekStartsOn: 0 }), "yyyy-MM-dd"),
        end: format(endOfWeek(now, { weekStartsOn: 0 }), "yyyy-MM-dd"),
      };
    case "month":
      return {
        start: format(startOfMonth(now), "yyyy-MM-dd"),
        end: format(endOfMonth(now), "yyyy-MM-dd"),
      };
    case "all":
      return { start: "2020-01-01", end: "2099-12-31" };
  }
};
```

**UI Changes**:
Add toggle buttons above the Quick Stats grid for admin only:

```tsx
{isAdmin && (
  <div className="flex gap-2 mb-3">
    {["week", "month", "all"].map((range) => (
      <Button
        key={range}
        variant={statsTimeRange === range ? "default" : "outline"}
        size="sm"
        onClick={() => setStatsTimeRange(range)}
      >
        {range === "week" ? "This Week" : range === "month" ? "This Month" : "All Time"}
      </Button>
    ))}
  </div>
)}
```

---

## 4. Data Import Action Required

Before the data can be added, I need to confirm:

1. **Should I create missing agent records?**
   - Many agents in the deals list don't exist yet (Moody Imran, Obiajulu Ifediora, etc.)
   - Either create them or provide me with existing agent IDs

2. **Which agents report to Samuel James?**
   - Needed to set `invited_by_manager_id` correctly
   - Especially for Cody Salazar's attribution

3. **Cody Salazar status?**
   - Confirm he should be marked as `is_deactivated = true` or `status = "terminated"`
   - His production will still count in admin team totals

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `src/pages/AgentPortal.tsx` | Add time range toggle for team stats, include terminated agents in totals |
| `supabase/functions/import-production-data/index.ts` | NEW - Handle bulk data import |

---

## Next Steps After Approval

1. Add the time range toggle UI for admin team stats
2. Modify fetchTeamStats to support week/month/all ranges
3. Include terminated agents in team totals calculation
4. Create import function or SQL migration for the deals data (once agent mapping is confirmed)
5. Send Muhammad (Moody) his $5,000 plaque for January 17, 2026
