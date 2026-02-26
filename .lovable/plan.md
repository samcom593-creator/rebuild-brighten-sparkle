

# 8:40 PM Auto-Reminder + "Paying for Leads" Auto-Mark

## What Will Be Done

### 1. Update `notify-fill-numbers` edge function
**File: `supabase/functions/notify-fill-numbers/index.ts`**

- Add `"840pm"` as a new `reminderType` with:
  - Subject: `"🚨 LOG YOUR NUMBERS NOW — or you're marked as paying for leads!"`
  - Urgency message warning about the "paying for leads" consequence
  - Red urgency color (`#ef4444`)
  - A prominent red warning box in the email body explaining the consequence
- Send **push notifications** alongside emails by calling the existing `send-push-notification` edge function for each agent who has a push subscription
- For `"840pm"` and `"9pm"` reminders: **auto-upsert** into `lead_payment_tracking` table with `paid: false` for agents who haven't logged numbers, marking them as "paying for leads" for the current week

### 2. Set up 8:40 PM CST cron job
**Database insert (cron.schedule)**

Schedule: `40 2 * * *` (2:40 AM UTC = 8:40 PM CST)

Calls `notify-fill-numbers` with `{"reminderType": "840pm"}`.

This fires every single day at 8:40 PM CST. Any live agent who hasn't logged their daily production numbers by that time will:
1. Receive a push notification (if subscribed)
2. Receive a red-urgency email with a warning about being marked as paying for leads
3. Be automatically marked as `paid: false` in `lead_payment_tracking` for the current week

### 3. No schema changes needed
The `lead_payment_tracking` table already exists with the right structure (`agent_id`, `week_start`, `tier`, `paid`).

---

## Technical Details

```text
8:40 PM CST Daily Flow:
┌─────────────────────────────────────────┐
│ cron fires at 2:40 AM UTC (8:40PM CST)  │
│ → POST notify-fill-numbers              │
│   body: {"reminderType": "840pm"}       │
└──────────────┬──────────────────────────┘
               │
     ┌─────────▼──────────┐
     │ Get live agents    │
     │ Check daily_prod   │
     │ Filter: no entry   │
     └─────────┬──────────┘
               │
     ┌─────────▼──────────────────────┐
     │ 1. Auto-mark in                │
     │    lead_payment_tracking       │
     │    (paid=false, tier=standard) │
     │ 2. Send push notification      │
     │ 3. Send urgent email           │
     └────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `supabase/functions/notify-fill-numbers/index.ts` | Add "840pm" type, push notifications, auto-mark paying for leads |
| Database (cron insert) | Schedule `40 2 * * *` cron job |

