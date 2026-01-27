
# Fix Leaderboard Unknown Agents & Add Inline Edit/Merge

## Problem Summary

1. **12 agents have production data but show as "Unknown Agent"** because they have no `user_id` linked to a profile
2. **Builders can't see your name** on the Building leaderboard due to RLS policy restrictions
3. **No way to edit agent names** or merge records directly from the leaderboard
4. **SMS notifications require Twilio** which is not yet configured

---

## Solution Overview

### 1. Add `display_name` Column to Agents Table

Store names directly on the agents table as a fallback when no profile exists.

**Database Migration:**
```sql
ALTER TABLE public.agents 
ADD COLUMN display_name TEXT;
```

This allows imported agents (without auth accounts) to have visible names.

---

### 2. Update Leaderboards to Use Fallback Name

Modify the leaderboard components to check for name in this order:
1. `profiles.full_name` (if user_id exists)
2. `agents.display_name` (fallback for imported agents)
3. "Unknown Agent" (last resort)

**Files to modify:**
- `src/components/dashboard/LeaderboardTabs.tsx`
- `src/components/dashboard/BuildingLeaderboard.tsx`
- `src/components/dashboard/LiveLeaderboard.tsx`

---

### 3. Add RLS Policy for Leaderboard Profile Visibility

Allow all authenticated users to see basic profile info for leaderboard display.

**Database Migration:**
```sql
CREATE POLICY "Authenticated users can view profile names for leaderboards"
ON public.profiles FOR SELECT
USING (auth.uid() IS NOT NULL);
```

This ensures builders can see your name on leaderboards.

---

### 4. Add Inline Edit/Merge on Leaderboard Rows

Make leaderboard entries clickable to open an edit/merge dialog.

**New Dialog Features:**
- Edit agent `display_name` directly
- View matching records (same email, phone, or similar name)
- Merge with existing agent if duplicate detected
- Quick "Set Name" for unknown agents

**New Component:** `AgentQuickEditDialog.tsx`

```text
┌────────────────────────────────────────────┐
│  Edit Agent: Unknown Agent                 │
│  ──────────────────────────────────────    │
│  Display Name: [___________________]       │
│  Agent ID: 5e9e0bf4...                     │
│  Total ALP: $6,952 | Deals: 6              │
│  ──────────────────────────────────────    │
│  🔍 Possible Matches:                      │
│  ○ John Smith (john@email.com) - $3,420    │
│  ○ Jane Doe (jane@email.com) - $1,200      │
│  ──────────────────────────────────────    │
│  [ Save Name ]  [ Merge With Selected ]    │
└────────────────────────────────────────────┘
```

---

### 5. SMS Notifications (Twilio Setup Required)

To send text messages with schedule updates, Twilio integration is needed:

1. **Twilio Account Required** - Need Account SID, Auth Token, and Phone Number
2. **New Edge Function:** `send-leaderboard-sms`
3. **Only send to known contacts** - Skip agents without phone numbers

**Note:** This requires you to provide Twilio credentials. Would you like to set this up?

---

### 6. Fix Daily Leaderboard Email Schedule

The existing `send-daily-leaderboard-summary` function sends emails to managers. Need to verify cron schedule and add it if missing.

**Cron Schedule:** Run daily at 8:00 AM CST (14:00 UTC)
```sql
SELECT cron.schedule(
  'daily-leaderboard-email',
  '0 14 * * *',
  -- 8 AM CST = 14:00 UTC
  ...
);
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Inline edit/merge dialog for leaderboard entries |
| `supabase/functions/send-leaderboard-sms/index.ts` | SMS notifications (requires Twilio) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/LeaderboardTabs.tsx` | Add click-to-edit, use display_name fallback |
| `src/components/dashboard/BuildingLeaderboard.tsx` | Add click-to-edit, use display_name fallback |
| `src/components/dashboard/LiveLeaderboard.tsx` | Add click-to-edit, use display_name fallback |
| `src/components/admin/DuplicateMergeTool.tsx` | Include agents with no profile in detection |

## Database Changes

| Change | Purpose |
|--------|---------|
| Add `display_name` column to `agents` | Fallback name for imported agents |
| Add RLS policy on `profiles` | Allow leaderboard name visibility |
| Schedule daily email cron | Automate 8 AM leaderboard emails |

---

## Implementation Order

1. **Database changes** - Add column and RLS policy
2. **Update leaderboard queries** - Use display_name fallback
3. **Create AgentQuickEditDialog** - Enable inline editing
4. **Add click handlers** - Make leaderboard rows interactive
5. **Schedule cron job** - Automate daily emails
6. **Twilio setup** (optional) - If you provide credentials

---

## Expected Result

After implementation:
- All agents show names on leaderboards (no more "Unknown Agent")
- You can tap any entry to edit the name or merge with existing records
- Builders can see your name on the Building leaderboard
- Daily leaderboard emails go out automatically at 8 AM CST
- SMS notifications ready once Twilio is configured
