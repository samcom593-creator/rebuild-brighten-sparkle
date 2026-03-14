

# Remove Agent Count from Agency Performance + Rename AOP → ALP

## Changes

### 1. Remove agent count from PersonalStatsCard agency summary
In `src/components/dashboard/PersonalStatsCard.tsx` (line 384-388), remove the `{agencyStats.totalAgents} agents •` portion so it only shows Avg Close and Avg ALP.

### 2. Remove agent count from DownlineStatsCard
In `src/components/dashboard/DownlineStatsCard.tsx` (lines 199-201), remove the entire agent count row.

### 3. Rename all UI-facing "AOP" labels → "ALP" across 6 files
- `src/components/dashboard/PersonalStatsCard.tsx` — "Avg AOP" → "Avg ALP"
- `src/components/dashboard/TeamSnapshotCard.tsx` — "Total AOP", "AOP Breakdown" → "Total ALP", "ALP Breakdown"
- `src/components/dashboard/MobileLeaderboardCard.tsx` — "AOP" → "ALP"
- `src/components/dashboard/LeaderboardTabs.tsx` — "AOP" → "ALP"
- `src/components/dashboard/TeamPerformanceBreakdown.tsx` — "AOP" → "ALP"
- `src/components/admin/AgentProfileEditor.tsx` — "AOP" → "ALP"

No database column changes needed — `aop` column stays as-is, only UI labels change.

