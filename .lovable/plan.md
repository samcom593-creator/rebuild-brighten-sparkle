
# Replace Deal Alerts with Daily Sales Leaderboard

## Overview
Replace the real-time "DEAL DROPPED!" email alerts with a consolidated **Daily Sales Leaderboard** email sent once at end of day to all active agents. This reduces email noise while keeping agents motivated with competitive rankings.

## Current State
- **`notify-deal-alert`**: Triggers immediately when any agent logs a deal, sending emails to ALL agents
- **`send-daily-leaderboard-summary`**: Exists but only sends to managers with recruiting stats (not sales)

## Changes Required

### 1. Create New Edge Function: `send-daily-sales-leaderboard`

A new edge function that:
- Runs once daily at **9 PM CST** (after most agents finish for the day)
- Fetches today's production data from `daily_production` table
- Ranks agents by ALP (total dollar amount closed)
- Sends personalized email to each active agent showing:
  - Full leaderboard with rankings
  - Their position highlighted
  - Top 3 agents with trophy/medal icons
  - Total team ALP for the day
  - Motivational "gap to next rank" message
  - CTA to log tomorrow's numbers

Email design:
- Clean, professional gold/black APEX branding
- Table format showing: Rank | Agent | Deals | ALP
- Whole dollars only (no cents per project guidelines)
- "Powered by APEX Financial" footer
- Screenshot-ready for social media posting

### 2. Remove Real-Time Deal Alert Triggers

Update these files to stop calling `notify-deal-alert`:
- `src/components/dashboard/CompactProductionEntry.tsx`
- `src/components/dashboard/ProductionEntry.tsx`

Remove the `notify-deal-alert` invocation from the notification batch that runs after saving production data.

### 3. Set Up Daily Cron Job

Add a cron job to trigger `send-daily-sales-leaderboard` at 9 PM CST daily:
```sql
select cron.schedule(
  'send-daily-sales-leaderboard',
  '0 3 * * *',  -- 3 AM UTC = 9 PM CST
  $$ SELECT net.http_post(...) $$
);
```

### 4. Keep `notify-deal-alert` Function

Keep the function code in case you want to revert later, but it won't be triggered from the frontend anymore.

## Email Template Design

```
╔════════════════════════════════════════════════╗
║      🏆 APEX DAILY SALES LEADERBOARD           ║
║          Wednesday, January 29, 2026            ║
╠════════════════════════════════════════════════╣
║                                                 ║
║   Hey [First Name],                             ║
║                                                 ║
║   Here's how the team performed today:          ║
║                                                 ║
║   ┌────────────────────────────────────────┐   ║
║   │ Rank │ Agent         │ Deals │   ALP   │   ║
║   ├──────┼───────────────┼───────┼─────────┤   ║
║   │ 🥇 1 │ John Smith    │   3   │ $12,450 │   ║
║   │ 🥈 2 │ Jane Doe      │   2   │  $8,200 │   ║
║   │ 🥉 3 │ ⭐ YOU        │   2   │  $7,800 │   ║
║   │   4  │ Mike Johnson  │   1   │  $4,500 │   ║
║   │   5  │ Sarah Wilson  │   1   │  $3,200 │   ║
║   └──────┴───────────────┴───────┴─────────┘   ║
║                                                 ║
║   📊 TEAM TOTAL: $36,150                        ║
║                                                 ║
║   💡 You're just $400 away from #2!             ║
║                                                 ║
║           [🎯 LOG TOMORROW'S NUMBERS]           ║
║                                                 ║
╠════════════════════════════════════════════════╣
║          Powered by APEX Financial              ║
╚════════════════════════════════════════════════╝
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/send-daily-sales-leaderboard/index.ts` | **CREATE** - New edge function |
| `src/components/dashboard/CompactProductionEntry.tsx` | **MODIFY** - Remove deal alert call |
| `src/components/dashboard/ProductionEntry.tsx` | **MODIFY** - Remove deal alert call |

## Bonus: Fix Link Account Error

The screenshot shows an error for phone `9788047212`. This phone number doesn't exist in the database. The user needs to:
1. Use the "Create Account" flow on `/numbers` instead of "Link Account"
2. Or have their manager add them to the CRM first

This is expected behavior - the Link Account feature is for existing CRM records only.

## Technical Details

### Edge Function Logic
```typescript
// 1. Get today's date in PST
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// 2. Fetch all production for today
const { data: production } = await supabase
  .from('daily_production')
  .select('agent_id, deals_closed, aop')
  .eq('production_date', today)
  .gt('deals_closed', 0);  // Only agents with deals

// 3. Get agent names and emails
// 4. Sort by ALP descending
// 5. Send personalized email to each agent
```

### Timing Rationale
- 9 PM CST catches most evening closers
- Avoids peak cron hours (6-7 PM CST per project guidelines)
- Gives agents overnight to see results
