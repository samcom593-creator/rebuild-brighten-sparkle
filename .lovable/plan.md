

# Fix All Dashboard Production Numbers — Accurate Agency-Wide Data

## Problems Found

### 1. ProductionForecast shows only admin's personal numbers
The 30-Day AOP Forecast on AgentPortal queries `daily_production` filtered by `agentId` (the admin's own ID). It shows only the admin's personal production instead of agency-wide totals.

### 2. EstimatedEarningsCard excludes most agents
Filters agents by `is_deactivated: false` AND `status: 'active'` — this misses all inactive/deactivated agents who have real production data (Bryan Ross, Codey Salazar, Joseph Sebasco, etc.).

### 3. TeamSnapshotCard (Dashboard "Agency Production") excludes deactivated agents
Filters `.eq("is_deactivated", false)` when fetching agent IDs, so deactivated agents' production is invisible.

### 4. PersonalStatsCard ("Agency Performance") same issue
Also filters `.eq("is_deactivated", false)` for admin view — missing production data.

### 5. ManagerProductionStats excludes deactivated team members
Same `is_deactivated: false` filter on team agents.

### 6. Labels say "ALP" instead of "AOP"
Multiple components display "ALP" when the database column is `aop` and the user wants "AOP":
- PersonalStatsCard: line 247 `${periodLabels[timePeriod]} ALP` and line 389 `Avg ALP`
- TeamSnapshotCard: line 354 `Total ALP` and line 294 `ALP Breakdown`
- ManagerProductionStats: lines 178/186 `Today ALP` / `Week ALP`
- EstimatedEarningsCard: lines 84/89 `ALP:` / `Team ALP:`

---

## Changes

### File: `src/components/dashboard/ProductionForecast.tsx`
- Remove `.eq("agent_id", agentId)` filter — query ALL production for last 30 days
- Aggregate rows by date (sum all agents per day) for the linear regression forecast
- Change queryKey to `"production-forecast-agency"` (no longer per-agent)

### File: `src/components/dashboard/EstimatedEarningsCard.tsx`
- Remove `.eq("is_deactivated", false).eq("status", "active")` — include all agents
- Fix labels: "ALP:" → "AOP:" and "Team ALP:" → "Team AOP:"

### File: `src/components/dashboard/TeamSnapshotCard.tsx`
- Remove `.eq("is_deactivated", false)` from admin agent query (line 74)
- Fix labels: "Total ALP" → "Total AOP", "ALP Breakdown" → "AOP Breakdown"

### File: `src/components/dashboard/PersonalStatsCard.tsx`
- Remove `.eq("is_deactivated", false)` from admin agent query (line 79)
- Fix labels: `${periodLabels[timePeriod]} ALP` → `AOP`, `Avg ALP` → `Avg AOP`

### File: `src/components/dashboard/ManagerProductionStats.tsx`
- Remove `.eq("is_deactivated", false)` from team agent query (line 41)
- Fix labels: "Today ALP" → "Today AOP", "Week ALP" → "Week AOP"

---

## Technical Details

| File | Line(s) | Change |
|------|---------|--------|
| `ProductionForecast.tsx` | 14-28 | Remove agent_id filter, aggregate all production by date |
| `EstimatedEarningsCard.tsx` | 22-24 | Remove `is_deactivated` and `status` filters |
| `EstimatedEarningsCard.tsx` | 84, 89 | "ALP" → "AOP" |
| `TeamSnapshotCard.tsx` | 71-74 | Remove `is_deactivated` filter |
| `TeamSnapshotCard.tsx` | 294, 354 | "ALP" → "AOP" |
| `PersonalStatsCard.tsx` | 76-79 | Remove `is_deactivated` filter |
| `PersonalStatsCard.tsx` | 247, 389 | "ALP" → "AOP" |
| `ManagerProductionStats.tsx` | 37-41 | Remove `is_deactivated` filter |
| `ManagerProductionStats.tsx` | 178, 186 | "ALP" → "AOP" |

All changes are label fixes and filter removals — no schema changes needed.

