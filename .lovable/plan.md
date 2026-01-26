
## Plan: Agent Production Quick-Entry Link & Enhanced Stats

### Overview
This plan creates a shareable direct link for agents to log their daily numbers, adds real-time animations/notifications when numbers are submitted, displays weekly stats on Live agent cards, and ensures comprehensive daily summaries are sent to admin and leaders.

---

## Part 1: Public Agent Production Entry Link

### 1.1 Create New Page: `/log-numbers`

**File: `src/pages/LogNumbers.tsx` (NEW)**

A standalone public page accessible via direct link that:
1. Shows a form asking for the agent's name/email
2. Looks up if they exist in the CRM as a Live agent
3. **If found:** Shows the production entry form directly
4. **If not found:** Asks qualifying questions to add them to the CRM first

**User Flow:**
```
User clicks link → Enter name/email →
  ├─ Agent found? → Show production entry form → Submit → Animated leaderboard reveal
  └─ Agent NOT found? → Show quick add form → Add to CRM → Show production entry
```

**Direct Link Format:**
```
https://rebuild-brighten-sparkle.lovable.app/log-numbers
```

### 1.2 Page Features

**Search/Match Logic:**
- Query `agents` table joined with `profiles` by name/email
- Match against `onboarding_stage = 'evaluated'` (Live agents only)
- If multiple matches, show list to select
- If no match, show "New Agent" form

**New Agent Form (if not found):**
- Full name
- Email
- Phone
- License status (licensed/unlicensed)
- Auto-creates agent record and profile

**Production Entry:**
- All 8 production fields (presentations, passed_price, hours_called, referrals_caught, booked_inhome, referral_presentations, deals_closed, aop)
- Submit button

### 1.3 Animated Leaderboard Reveal

**After submission:**
1. Trigger canvas-confetti celebration
2. Show animated "Your Numbers Are In!" message
3. Display leaderboard with their position highlighted
4. Animate their entry "flying in" to its rank position
5. Show comparison stats:
   - "You're #X of Y agents"
   - "Your closing rate: X%"
   - "Weekly total: $X,XXX"

---

## Part 2: Real-Time Notifications for Admin

### 2.1 Create Edge Function: `notify-production-submitted`

**File: `supabase/functions/notify-production-submitted/index.ts` (NEW)**

Triggered when production is saved, sends real-time notification to admin:

**Email content:**
- Agent name
- Today's numbers (ALP, deals, presentations, close rate)
- Weekly running total
- Timestamp

### 2.2 Update ProductionEntry to Trigger Notification

**File: `src/components/dashboard/ProductionEntry.tsx`**

After successful save, invoke the notification function:
```typescript
await supabase.functions.invoke("notify-production-submitted", {
  body: { agentId, productionData: formData }
});
```

---

## Part 3: Weekly Stats on Live Agent Cards

### 3.1 Update DashboardCRM to Fetch Weekly Production

**File: `src/pages/DashboardCRM.tsx`**

**New data fetch:**
- When loading agents, also query `daily_production` for the past 7 days
- Aggregate: weekly total ALP, total presentations, total deals, closing rate

**Update AgentCRM interface:**
```typescript
interface AgentCRM {
  // ... existing fields
  weeklyALP: number;
  weeklyPresentations: number;
  weeklyDeals: number;
  weeklyClosingRate: number;
}
```

### 3.2 Display Stats on Live Agent Cards

**In renderAgentCard(), for `evaluated` agents:**
```tsx
{isInFieldActive && (
  <div className="flex items-center gap-2 text-xs border-t border-border pt-1.5 mt-1.5">
    <span className="text-muted-foreground">Week:</span>
    <Badge variant="outline" className="text-[10px]">
      ${agent.weeklyALP.toLocaleString()} ALP
    </Badge>
    <Badge variant="outline" className="text-[10px]">
      {agent.weeklyPresentations} pres
    </Badge>
    <Badge variant="outline" className="text-[10px] text-emerald-400">
      {agent.weeklyClosingRate}% close
    </Badge>
  </div>
)}
```

---

## Part 4: Enhanced Daily Summary Emails

### 4.1 Create Admin Daily Summary

**File: `supabase/functions/notify-admin-daily-summary/index.ts` (NEW)**

Sends end-of-day summary to admin with:
- Total agency production for the day
- Breakdown by agent (who logged, who didn't)
- Top performers
- Overall close rate
- Comparison to previous day/week

### 4.2 Update Daily Leaderboard for All Leaders

**File: `supabase/functions/send-daily-leaderboard-summary/index.ts`**

Add production stats to the existing manager leaderboard email:
- Include team production numbers
- Show agents who haven't logged numbers

---

## Part 5: Email Reminders for Missing Numbers

### 5.1 Existing System Already in Place

The `notify-fill-numbers` Edge Function already handles this with reminders at:
- 7 PM - "Time to Log Your Numbers!"
- 9 PM - "Don't Forget Your Daily Numbers"
- 9 AM next day - "Yesterday's Numbers Still Missing"

**Verify pg_cron schedules are active:**
```sql
-- Check cron jobs
SELECT * FROM cron.job;
```

If not scheduled, add:
```sql
SELECT cron.schedule('fill-numbers-7pm', '0 0 * * *', -- 7 PM CST = 0 UTC
  $$SELECT net.http_post('...', ...)$$);
```

---

## Part 6: Add Route to App Router

**File: `src/App.tsx`**

Add the new public route:
```tsx
<Route path="/log-numbers" element={<LogNumbers />} />
```

---

## Summary of Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/LogNumbers.tsx` | CREATE | Public page for agents to log numbers via direct link |
| `src/App.tsx` | MODIFY | Add `/log-numbers` route |
| `src/components/dashboard/ProductionEntry.tsx` | MODIFY | Add notification trigger after save |
| `src/pages/DashboardCRM.tsx` | MODIFY | Add weekly production stats to agent cards |
| `supabase/functions/notify-production-submitted/index.ts` | CREATE | Real-time admin notification on submission |
| `supabase/functions/notify-admin-daily-summary/index.ts` | CREATE | End-of-day summary for admin |
| `supabase/config.toml` | MODIFY | Add new function configs |

---

## Direct Link for Group Chat

Once implemented, the shareable link will be:
```
https://rebuild-brighten-sparkle.lovable.app/log-numbers
```

This link:
- Works for any agent in your group chat
- Auto-matches them by name/email
- If new, adds them to CRM first
- Shows animated leaderboard after submission
- Notifies you (admin) in real-time

---

## Technical Considerations

1. **Authentication:** The `/log-numbers` page will be public but verify agent identity via name/email matching
2. **Duplicate Prevention:** Use upsert on `agent_id + production_date` to prevent duplicate entries
3. **Real-time Updates:** Use Supabase realtime subscriptions on `daily_production` table for live updates
4. **Animation:** Use framer-motion for the leaderboard reveal animation with staggered entry effects
5. **Mobile-First:** The quick entry page must be fully responsive for phone access from group chat

---

## Expected Outcomes

1. **Shareable Link:** Direct link to paste in group chat for agents to log numbers
2. **Auto-Recognition:** System recognizes existing agents or onboards new ones
3. **Animated Feedback:** Exciting leaderboard reveal after submission
4. **Real-Time Notifications:** Admin gets notified every time someone submits
5. **Weekly Stats on Cards:** Live agent cards show weekly performance at a glance
6. **Daily Summaries:** Comprehensive end-of-day reports to admin and leaders
