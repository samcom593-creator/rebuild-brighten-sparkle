

# 🚨 Team-Wide Deal Alerts & Competitive Streak Notifications

## Summary

Transform the notification system into a high-energy, competitive machine that fires off emails **instantly** when deals are closed and celebrates winning streaks to keep agents motivated and competitive.

---

## New Email Notifications to Build

### 1. 🚨 INSTANT DEAL ALERT (Team-Wide)
**When:** Every time a deal is logged (deals_closed > 0)
**Who gets it:** ALL live agents
**Styling:** RED URGENT ALARM design

**Email Preview:**
```
Subject: 🚨🔥 DEAL ALERT! Samuel James just closed! 🔥🚨

[RED URGENT BANNER]
   🚨 DEAL DROPPED! 🚨
   
   SAMUEL JAMES
   Just closed a $1,200 ALP deal!
   
   Time: 2:45 PM CST
   
   "Can you keep up? Log YOUR numbers now!"
   
   [🎯 Log My Numbers Button]
```

### 2. 👑 FIRST PLACE STREAK ALERT
**When:** Agent is #1 on the leaderboard for 2+ consecutive days
**Who gets it:** ALL live agents
**Trigger:** Check after each production submission

**Email Preview:**
```
Subject: 👑 Sarah J. is on a 3-DAY REIGN at #1!

   👑 LEADERBOARD DOMINATION 👑
   
   Sarah Johnson has been #1 for 3 DAYS STRAIGHT!
   
   Current Lead: $4,200 ahead of #2
   
   "Are you going to let this continue?"
   
   [📊 Check the Leaderboard]
```

### 3. 🔥 HOT STREAK ALERT (Deals)
**When:** Agent closes deals on 3+ consecutive days
**Who gets it:** ALL live agents

**Email Preview:**
```
Subject: 🔥 Mike R. is on a 5-DAY DEAL STREAK!

   🔥 STREAK ALERT 🔥
   
   Mike Rodriguez has closed deals 5 DAYS IN A ROW!
   
   [Day 1: 2 deals] [Day 2: 1 deal] [Day 3: 3 deals]
   [Day 4: 2 deals] [Day 5: 1 deal]
   
   Total: 9 deals this streak!
   
   "Start YOUR winning streak today!"
```

### 4. 🏆 WEEKLY CHAMPION ALERT
**When:** Sunday night, announce who won the week
**Who gets it:** ALL live agents

**Email Preview:**
```
Subject: 🏆 This Week's Champion: David K. with $8,400 ALP!

   🏆 WEEKLY WINNER 🏆
   
   David Kim dominated this week!
   
   Week Total: $8,400 ALP | 7 Deals | 58% Close Rate
   
   "New week, new chance to be #1!"
```

### 5. ⚡ COMEBACK ALERT
**When:** Someone who was outside top 5 jumps into top 3
**Who gets it:** ALL live agents

**Email Preview:**
```
Subject: ⚡ COMEBACK! Lisa M. just jumped from #8 to #2!

   ⚡ WATCH OUT! ⚡
   
   Lisa Martinez just made a BIG move!
   
   Was: #8 → Now: #2
   
   "The leaderboard is shaking up!"
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/notify-deal-alert/index.ts` | **NEW** - Instant team-wide deal notification |
| `supabase/functions/notify-streak-alert/index.ts` | **NEW** - Streak detection & notification (deal streaks + #1 streaks) |
| `supabase/functions/notify-weekly-champion/index.ts` | **NEW** - Weekly winner announcement |
| `supabase/functions/notify-comeback-alert/index.ts` | **NEW** - Big rank jumps |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/ProductionEntry.tsx` | Call `notify-deal-alert` when deals > 0 are submitted |
| `supabase/config.toml` | Add new function configurations |

---

## Technical Implementation

### Deal Alert Flow

```
Agent submits numbers with deals_closed > 0
         ↓
    ProductionEntry.tsx
         ↓
    supabase.functions.invoke("notify-deal-alert", {
      body: { agentId, agentName, deals, aop }
    })
         ↓
    Edge function fetches ALL live agent emails
         ↓
    Send RED URGENT email to everyone
```

### Streak Detection Logic

```typescript
// In notify-streak-alert

// 1. Get last 7 days of production for submitting agent
const { data: recentProduction } = await supabase
  .from("daily_production")
  .select("production_date, deals_closed, aop")
  .eq("agent_id", agentId)
  .gte("production_date", sevenDaysAgo)
  .order("production_date", { ascending: false });

// 2. Count consecutive deal days
let dealStreak = 0;
for (const day of recentProduction) {
  if (day.deals_closed > 0) dealStreak++;
  else break;
}

// 3. If streak >= 3, send alert!
if (dealStreak >= 3) {
  sendStreakAlert(agent, dealStreak, recentProduction);
}

// 4. Check #1 streak
// Get current #1 from today's leaderboard
// Check if same person was #1 yesterday, day before, etc.
```

### Email Styling - RED URGENT Design

```css
/* Deal Alert Styling */
.urgent-header {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  color: white;
  font-size: 32px;
  text-align: center;
  padding: 24px;
  border-radius: 16px;
  animation: pulse;
}

.alert-emoji {
  font-size: 48px;
  animation: shake;
}

.cta-button {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  font-size: 18px;
  font-weight: bold;
  padding: 16px 40px;
  border-radius: 12px;
}
```

---

## Database Considerations

No new tables needed. Streak detection will query `daily_production` in real-time:

```sql
-- Get consecutive deal days
SELECT production_date, deals_closed
FROM daily_production
WHERE agent_id = $1
  AND production_date <= CURRENT_DATE
ORDER BY production_date DESC
LIMIT 7;
```

---

## Notification Triggers Summary

| Trigger | Notification | Recipients |
|---------|--------------|------------|
| Deal closed (deals > 0) | 🚨 Deal Alert | ALL agents |
| 3+ day deal streak | 🔥 Streak Alert | ALL agents |
| #1 for 2+ days | 👑 Reign Alert | ALL agents |
| Jump into top 3 from outside top 5 | ⚡ Comeback Alert | ALL agents |
| Sunday 9 PM | 🏆 Weekly Champion | ALL agents |
| Someone passes you | 🏃 Passed Alert | Just the passed agent |

---

## Rate Limiting / Smart Sending

To avoid email overload:
- **Deal alerts**: Max 1 per agent per hour (aggregate if multiple deals)
- **Streak alerts**: Once per streak milestone (3 days, 5 days, 7 days, 10 days)
- **Comeback alerts**: Only for jumps of 3+ positions into top 3

---

## Success Criteria

1. ✅ Every deal triggers an immediate team-wide RED URGENT email
2. ✅ Deal streaks (3+, 5+, 7+ days) trigger celebration emails
3. ✅ #1 position streaks (2+, 3+, 5+ days) trigger "reign" emails  
4. ✅ Big comeback moves trigger hype emails
5. ✅ Weekly champion announced every Sunday
6. ✅ All emails have competitive, motivational language
7. ✅ Emails are mobile-optimized and screenshot-worthy

---

## Future SMS Integration (Placeholder)

The architecture will support easy SMS addition later:
- Each notification function will have a `sendSMS` boolean parameter
- When Twilio is connected, flip the switch to enable SMS
- SMS will use shorter, punchier versions of the same messages

```typescript
// Future SMS format
"🚨 DEAL! Samuel James just closed $1,200! Can you keep up? Log numbers → apex-financial.org/numbers"
```

