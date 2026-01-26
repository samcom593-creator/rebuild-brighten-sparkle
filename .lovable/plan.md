
## Plan: Comprehensive Agent Portal Enhancement & Automated Notifications

### Overview
This plan implements: scheduled email notifications (9 PM admin summary, 9 AM top performers, 8 PM "no deal" alerts), an income goal calculator dashboard, monthly leaderboard emails, refined light mode styling, and UX improvements to make the portal an agent's "best friend."

---

## Part 1: Scheduled Email Notifications

### 1.1 Daily Admin Summary at 9 PM CST (for Admin + Managers)

**File: `supabase/functions/notify-admin-daily-summary/index.ts`**

**Modifications:**
- Update to send to BOTH admin (info@kingofsales.net) AND all managers
- Add manager-specific filtering (show their team's data)
- Schedule via pg_cron at 9 PM CST (3 AM UTC)

```text
New pg_cron schedule:
schedule: '0 3 * * *'  -- 9 PM CST = 3 AM UTC
jobname: 'admin-daily-summary-9pm-cst'
```

### 1.2 Top 3 Performers Email at 9 AM CST

**File: `supabase/functions/notify-top-performers-morning/index.ts` (NEW)**

Sends to ALL agents every morning with:
- Top 3 performers from previous day
- Their ALP, deals, and closing rate
- Motivational message
- Clean, visually appealing design with medal icons

```text
pg_cron schedule:
schedule: '0 15 * * *'  -- 9 AM CST = 3 PM UTC
jobname: 'top-performers-morning-9am'
```

### 1.3 Monthly Leaderboard Email at 9 AM on 1st of Month

**File: `supabase/functions/notify-monthly-leaderboard/index.ts` (NEW)**

Sends on the 1st of each month:
- Full monthly rankings (all agents)
- Total ALP, deals, closing rate for the month
- "Start fresh" motivational message
- Link to set income goal for new month

```text
pg_cron schedule:
schedule: '0 15 1 * *'  -- 9 AM CST on 1st = 3 PM UTC
jobname: 'monthly-leaderboard-1st'
```

### 1.4 "No Deal Today" Alert at 8 PM CST

**File: `supabase/functions/notify-no-deal-today/index.ts` (NEW)**

At 8 PM, agents with 0 deals get:
- "Below Standard" alert (tactful, not harsh)
- Reminder that ONE day can change the week
- Calendly booking link for 1-on-1 support call
- Motivational but direct message

```text
pg_cron schedule:
schedule: '0 2 * * *'  -- 8 PM CST = 2 AM UTC next day
jobname: 'no-deal-alert-8pm'
```

---

## Part 2: Income Goal Calculator & Dashboard

### 2.1 New Database Table: `agent_goals`

```sql
CREATE TABLE public.agent_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,  -- e.g., "2026-02"
  income_goal NUMERIC NOT NULL,
  comp_percentage NUMERIC DEFAULT 75,  -- 9-month advance default
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, month_year)
);

ALTER TABLE public.agent_goals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Agents can manage own goals"
ON public.agent_goals FOR ALL
USING (agent_id = current_agent_id())
WITH CHECK (agent_id = current_agent_id());

CREATE POLICY "Admins can view all goals"
ON public.agent_goals FOR SELECT
USING (has_role(auth.uid(), 'admin'));
```

### 2.2 New Component: `IncomeGoalTracker.tsx`

**File: `src/components/dashboard/IncomeGoalTracker.tsx` (NEW)**

Features:
- Income goal input (monthly target earnings)
- 9-month advance comp calculator (default 75%)
- "Locked" state until 7 days of production data exists
- Progress bar showing current vs goal
- Presentations/deals needed calculation based on:
  - Agent's average closing rate (from their 7+ days of data)
  - Average premium per deal
- Clean, visually appealing card with gradient styling

**Calculation Logic:**
```
Required ALP = Income Goal / (Comp Percentage / 100)
Deals Needed = Required ALP / Agent's Avg Deal Size
Presentations Needed = Deals Needed / Agent's Closing Rate
```

**Locked State Logic:**
- Query `daily_production` for this agent
- If < 7 records exist, show locked state with countdown
- Once unlocked, calculate using their personal averages

### 2.3 Integrate into AgentPortal

**File: `src/pages/AgentPortal.tsx`**

Add IncomeGoalTracker component:
- Place prominently after Quick Stats section
- Show in both mobile and desktop views
- Add tab option for mobile: "Goals"

---

## Part 3: Enhanced Light Mode

### 3.1 Refine Light Mode CSS

**File: `src/index.css`**

Light mode improvements:
- Warmer background: slight cream tint (not pure white)
- Softer shadows with warm undertones
- Better card contrast without harsh borders
- Teal accent colors remain vibrant
- Glass morphism with subtle warmth

```css
.light {
  --background: 40 20% 98%;        /* Warm cream instead of pure white */
  --card: 0 0% 100%;
  --glass-bg: hsl(40 20% 100% / 0.92);
  --glass-border: hsl(220 13% 80% / 0.4);
  --glass-shadow: 0 4px 20px hsl(220 15% 40% / 0.06);
}
```

- Add `.light` specific utility classes for softer shadows
- Ensure all gradients look good in light mode
- Test all dashboard components in light mode

---

## Part 4: UX Improvements (Make It Their Best Friend)

### 4.1 Dashboard Polish

**File: `src/pages/AgentPortal.tsx`**

Improvements:
- Larger, more prominent Quick Stats cards
- Subtle animations on hover (scale, glow)
- "Welcome back" message with first name
- Daily motivational quote (random from curated list)
- Progress celebration micro-animations

### 4.2 Clean Leaderboard Design

**File: `src/components/dashboard/LeaderboardTabs.tsx`**

Refinements:
- Cleaner table rows with more spacing
- Highlight current user's row prominently
- Smooth scroll behavior
- Medal icons for top 3 (🥇🥈🥉)
- Rank change indicators (+/- from yesterday)

### 4.3 Mobile-First Responsive

All components optimized for mobile access from group chat link:
- Touch-friendly tap targets
- Swipeable tabs
- Collapsible sections
- Fast loading (lazy load charts)

---

## Part 5: pg_cron Schedules to Add

The following cron jobs need to be scheduled:

| Job Name | Schedule | UTC | CST | Function |
|----------|----------|-----|-----|----------|
| admin-daily-summary-9pm | `0 3 * * *` | 3 AM | 9 PM | notify-admin-daily-summary |
| top-performers-morning | `0 15 * * *` | 3 PM | 9 AM | notify-top-performers-morning |
| monthly-leaderboard | `0 15 1 * *` | 3 PM 1st | 9 AM 1st | notify-monthly-leaderboard |
| no-deal-alert-8pm | `0 2 * * *` | 2 AM | 8 PM | notify-no-deal-today |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/notify-admin-daily-summary/index.ts` | MODIFY | Add managers as recipients |
| `supabase/functions/notify-top-performers-morning/index.ts` | CREATE | 9 AM top 3 performers email |
| `supabase/functions/notify-monthly-leaderboard/index.ts` | CREATE | Monthly leaderboard on 1st |
| `supabase/functions/notify-no-deal-today/index.ts` | CREATE | 8 PM no-deal alert with booking link |
| `src/components/dashboard/IncomeGoalTracker.tsx` | CREATE | Income goal calculator dashboard |
| `src/pages/AgentPortal.tsx` | MODIFY | Integrate goal tracker, UX polish |
| `src/index.css` | MODIFY | Enhanced light mode styling |
| `supabase/config.toml` | MODIFY | Add new function configs |
| Database Migration | CREATE | `agent_goals` table with RLS |

---

## Technical Details

### Calendly Link (for 8 PM alert)
```
https://calendly.com/sam-com593/licensed-prospect-call-clone-1
```

### Income Goal Calculation (9-month advance)
- Default comp: 75% of written premium
- Formula: `Required ALP = Goal / 0.75`
- Locked until 7 days of data for accurate personal averages

### Email Styling
All emails will use consistent APEX branding:
- Dark navy background (#0a0f1a)
- Teal accent (#14b8a6)
- Clean typography (Segoe UI)
- Mobile-responsive design

---

## Expected Outcomes

1. **9 PM Daily Summary**: Admin + all managers receive comprehensive EOD report
2. **9 AM Top Performers**: All agents see yesterday's top 3, inspiring competition
3. **8 PM No-Deal Alert**: Agents with 0 deals get supportive nudge + booking link
4. **Monthly Leaderboard**: Fresh start motivation on the 1st
5. **Income Goal Tracker**: Personal goal setting with smart calculations
6. **Clean Light Mode**: Professional, warm light theme option
7. **Polished UX**: Dashboard agents WANT to check every day

---

## Shareable Links

- **Log Numbers**: `https://rebuild-brighten-sparkle.lovable.app/log-numbers`
- **Agent Portal**: `https://rebuild-brighten-sparkle.lovable.app/agent-portal`
- **Support Call**: `https://calendly.com/sam-com593/licensed-prospect-call-clone-1`
