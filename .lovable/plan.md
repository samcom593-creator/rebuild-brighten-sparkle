

# Make Leaderboard Visible to All Agents + Daily Top 5 Four-Week Email

## Problem
1. **LeaderboardTabs** (used in Agent Portal and Dashboard) queries `agents` and `profiles` tables directly. RLS on `agents` only lets regular agents see their own record, so the leaderboard only shows the logged-in agent — not the full team. The `CompactLeaderboard` (Numbers page) already works because it uses `get_leaderboard_profiles()` RPC, but the main `LeaderboardTabs` does not.
2. No daily email exists that shows the top 5 agents with their rolling 4-week production numbers.

## Changes

### 1. Add RLS policy on `agents` for leaderboard visibility
Add a SELECT policy allowing all authenticated users to view basic agent info (id, user_id, profile_id, display_name, is_deactivated, is_inactive, invited_by_manager_id). This mirrors the existing `daily_production` policy "Authenticated agents can view all production for leaderboard".

**Migration SQL:**
```sql
CREATE POLICY "Authenticated users can view agents for leaderboard"
ON public.agents FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
```

Also add a profiles policy so agents can resolve names:
```sql
CREATE POLICY "Authenticated users can view profiles for leaderboard"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
```

This is safe because profiles only contain full_name, avatar_url, email — and the leaderboard only reads full_name and avatar_url. The `get_leaderboard_profiles()` function already exposes this data.

### 2. Fix `LeaderboardTabs.tsx` — use `get_leaderboard_profiles()` RPC
Update the name resolution in `LeaderboardTabs` to use the `get_leaderboard_profiles()` RPC function (like `CompactLeaderboard` already does) as a fallback, ensuring all agents resolve properly regardless of RLS.

### 3. Create `send-top5-four-week-email` edge function
New edge function that:
- Calculates rolling 4-week production totals (AOP, deals) for all agents
- Ranks them and picks top 5
- Sends a premium branded email to each of those 5 agents with their rank, total AOP, total deals, and the full top-5 list
- Runs daily via pg_cron at 9 AM CST

### Files
- **Migration**: New RLS policies on `agents` and `profiles`
- **`src/components/dashboard/LeaderboardTabs.tsx`**: Use `get_leaderboard_profiles()` RPC for name resolution
- **`supabase/functions/send-top5-four-week-email/index.ts`**: New edge function
- **pg_cron**: Schedule daily at 9 AM CST

