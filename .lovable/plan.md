

# Fix Payment Tracker, Add Paid Badge + Total Deals, Verify Merge Tool

## Issues Found

1. **Payment Tracker shows agents who shouldn't be there**: The tracker filters on `status=active`, `onboarding_stage=evaluated`, `is_deactivated=false` -- but does NOT exclude `is_inactive=true`. Bryan Ross has `is_inactive=true` and would still appear. Fix: add `.eq("is_inactive", false)` to the query.

2. **No "Paid" badge visible in CRM, Command Center, or Dashboard**: The payment tracker marks agents as paid in the `lead_payment_tracking` table, but no other page reads that data to show a badge. This needs to be added as a visible badge on agent cards in all three views.

3. **Total Deals not displayed as a top-level stat**: The Command Center shows Total ALP, Active Agents, Producers, and Needs Attention -- but not Total Deals. The CRM and Dashboard also lack a total deals stat. This needs to be added.

4. **Merge tool access**: The merge tool queries all agents without status filtering, so all agents (active, inactive, terminated) should already appear. If some agents are missing, it could be an RLS issue -- but since admins have an ALL policy, this should work. Will verify the edge function query works for all agents.

## Changes

### 1. Fix Payment Tracker filtering
**File: `src/components/dashboard/LeadPaymentTracker.tsx`**

Add `.eq("is_inactive", false)` to the agents query on line 45 so inactive agents (like Bryan Ross) are excluded from the payment tracker.

### 2. Add "Paid" badge to CRM agent cards
**File: `src/pages/DashboardCRM.tsx`**

- Fetch current week's `lead_payment_tracking` data during `fetchAgents()`
- Add `standardPaid` and `premiumPaid` boolean fields to the `AgentCRM` interface
- Display a green "Paid" badge (or "$250 Paid" / "$1K Paid") next to the agent name in the CRM card for agents with active payments this week
- Only show for agents in the "evaluated" (Live) stage

### 3. Add "Paid" badge to Command Center agent cards
**File: `src/pages/DashboardCommandCenter.tsx`**

- Fetch current week's `lead_payment_tracking` data in the main query
- Add payment status to the `AgentWithStats` interface
- Display the same "Paid" badge on agent rows in the Command Center list

### 4. Add "Paid" badge to Dashboard
**File: `src/pages/Dashboard.tsx`**

The Dashboard uses `ManagerTeamView` for team display. The payment badge will be added inside `ManagerTeamView` for evaluated agents.

**File: `src/components/dashboard/ManagerTeamView.tsx`**

- Fetch `lead_payment_tracking` for the current week during team data load
- Show "Paid" badge next to agent names who have an active payment record

### 5. Add "Total Deals" stat card to Command Center
**File: `src/pages/DashboardCommandCenter.tsx`**

- Add `totalDeals` to `summaryStats` by summing `agent.totalDeals` across all agents
- Add a 5th stat card (or replace one) showing "Total Deals" with a deal icon
- Make it clickable like the other stat cards

### 6. Add "Total Deals" stat to CRM top metrics
**File: `src/pages/DashboardCRM.tsx`**

- Calculate total deals from agent weekly/monthly stats
- Display in the existing stats area at the top of the CRM

### 7. Add "Total Deals" to Dashboard stats
**File: `src/pages/Dashboard.tsx`**

- The Dashboard already shows `stats.closed` (closed leads). Add a separate "Deals Submitted" stat from `daily_production` data to distinguish production deals from closed leads.

## Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/LeadPaymentTracker.tsx` | Add `.eq("is_inactive", false)` filter |
| `src/pages/DashboardCRM.tsx` | Fetch payment data, add Paid badge to cards, add Total Deals stat |
| `src/pages/DashboardCommandCenter.tsx` | Fetch payment data, add Paid badge to rows, add Total Deals stat card |
| `src/components/dashboard/ManagerTeamView.tsx` | Fetch payment data, show Paid badge on team members |
| `src/pages/Dashboard.tsx` | Add Total Deals stat from production data |

