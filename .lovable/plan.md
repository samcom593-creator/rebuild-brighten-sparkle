

# Fix Dashboard Accuracy + Daily Manager Leaderboard Email

## Problems Found

### 1. Recruiting Stats "In Pipeline" Always Shows 0
The AgencyGrowthCard uses incorrect onboarding stage enum values: `["onboarding", "field_training", "training"]`. The actual database enum values are `["onboarding", "in_field_training", "training_online"]`. This means 19 agents currently in training/field training are being missed entirely.

### 2. Recruiting Stats "New Hires" Undercounting
The card only counts applications with `contracted_at` or `status = approved` within the selected period. But most new team members are created directly as agent records (15 new agents since Feb 9th). The card needs to also count newly created agents, not just contracted applications.

### 3. Manager Daily Digest Email Uses Broken CSS
The existing `manager-daily-digest` edge function uses `display: flex` for layout -- the same issue we just fixed in the licensing emails. These won't render properly on mobile email clients.

### 4. No Daily Sales Leaderboard for Managers
The existing `send-daily-sales-leaderboard` function sends to all active agents, but managers want a personalized version showing their team's rankings and production numbers specifically.

---

## Fix 1: AgencyGrowthCard Pipeline Stages + New Hires

**File: `src/components/dashboard/AgencyGrowthCard.tsx`**

- Change pipeline stages from `["onboarding", "field_training", "training"]` to `["onboarding", "in_field_training", "training_online"]`
- Add a parallel query to the `agents` table to count agents created within the selected period (in addition to contracted applications)
- Combine both counts for a more accurate "New Hires" metric: agents created in period + contracted applications in period (deduplicated)

## Fix 2: Manager Daily Digest Email - Fix Layout

**File: `supabase/functions/manager-daily-digest/index.ts`**

- Replace all `display: flex` layouts with table-based layouts for mobile email compatibility (same pattern used in the licensing email fix)

## Fix 3: Daily Leaderboard Email to Managers

**File: `supabase/functions/send-daily-sales-leaderboard/index.ts`**

- After sending the standard leaderboard to all agents, also identify all managers
- For each manager, build a personalized "Your Team's Production" section showing only their direct reports' rankings
- Include team total ALP, team total deals, and the manager's team rank vs other teams
- Ensures managers see their numbers flexed in a dedicated section

---

## Files to Modify

1. `src/components/dashboard/AgencyGrowthCard.tsx` -- Fix pipeline enum values + new hires counting
2. `supabase/functions/manager-daily-digest/index.ts` -- Fix email layout (flex to tables)
3. `supabase/functions/send-daily-sales-leaderboard/index.ts` -- Add manager-specific team leaderboard section

