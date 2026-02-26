

# Fix: Log Numbers, Leaderboards, and Aggressive Push Prompts

## Issues Identified

### 1. Log Numbers public page (`/apex-daily-numbers`) -- leaderboard shows everyone at $0
The `log-production` edge function's `leaderboard` action pre-loads ALL 30 active agents into the map, then overlays production data. Agents with zero production still appear as entries with `weeklyALP: 0`, making the leaderboard look broken with 25+ agents showing $0. The fix is to filter out zero-ALP entries before returning.

### 2. Authenticated leaderboard not updating after save
The `CompactProductionEntry` (used on `/numbers`) calls `onSaved` after submit, which triggers `fetchAgentData()` in `AgentPortal` -- but `CompactLeaderboard` only updates via realtime subscription (300ms debounce). After saving, the leaderboard should explicitly refetch. The `CompactLeaderboard` component doesn't expose a refresh mechanism and isn't connected to the save callback.

Fix: Add a `refreshKey` prop to `CompactLeaderboard` that forces refetch when incremented after save.

### 3. `ProductionEntry` (used on Agent Portal for managers/admins) -- same leaderboard disconnect
When managers save numbers for team members via `ProductionEntry`, the `LeaderboardTabs` only updates via realtime. The realtime subscription works but has 300ms debounce + potential RLS latency. Production Entry does call `onSaved` which triggers `fetchAgentData` and increments `refreshKey`, but `LeaderboardTabs` doesn't consume `refreshKey`.

Fix: Pass `refreshKey` to `LeaderboardTabs` so it refetches immediately after save.

### 4. Push notification prompt shows once then waits 7 days
User wants it on EVERY page load until they accept. Current behavior: show once, store timestamp in localStorage, don't show again for 7 days.

Fix: Remove the 7-day cooldown entirely. Show the prompt on every page load (after 5s delay) until the user either grants or denies permission. Only stop prompting when `permission !== "default"` (meaning they made a choice) or `isSubscribed === true`.

### 5. `LogNumbers` leaderboard only shows weekly data
The public page leaderboard uses `getWeekStartPST()` for the start date, which is correct, but the data shown after save is the WEEKLY leaderboard -- not daily. This is fine but should be clearly labeled.

---

## Implementation Plan

### 1. Fix `log-production` edge function -- filter zero-ALP entries

**File: `supabase/functions/log-production/index.ts`**

In the `leaderboard` action, after building the entries array, filter out agents with `weeklyALP === 0` AND `weeklyDeals === 0` before sorting/ranking. This removes the noise of 25+ zero-production entries.

### 2. Add `refreshKey` to `CompactLeaderboard`

**File: `src/components/dashboard/CompactLeaderboard.tsx`**

- Add optional `refreshKey?: number` prop
- Add `refreshKey` to the `fetchLeaderboard` dependency array so it refetches when the parent increments it

**File: `src/pages/Numbers.tsx`**

- Add `refreshKey` state, pass it to `CompactLeaderboard`
- Pass an `onSaved` callback to `CompactProductionEntry` that increments `refreshKey`

### 3. Pass `refreshKey` to `LeaderboardTabs` in Agent Portal

**File: `src/components/dashboard/LeaderboardTabs.tsx`**

- Add optional `refreshKey?: number` prop
- Include it in the `fetchLeaderboard` dependency array

**File: `src/pages/AgentPortal.tsx`**

- Already has `refreshKey` state and `handleSaved` incrementing it
- Pass `refreshKey` to `LeaderboardTabs` component

### 4. Make push prompt show on EVERY visit until accepted

**File: `src/components/layout/PushNotificationPrompt.tsx`**

- Remove the 7-day cooldown check entirely
- Only skip if `permission !== "default"` (user already chose) or `isSubscribed === true`
- On dismiss, do NOT store anything in localStorage -- just hide for this session (use session state only)
- On enable (accept/deny), store the timestamp so we know they made a choice
- This means: every time they open the site in a new tab/session, they see the prompt until they accept or deny via the browser

### 5. Deploy updated edge function

The `log-production` edge function will be auto-deployed after the code change.

---

## Technical Details

### LeaderboardTabs refreshKey integration
```text
AgentPortal
  handleSaved() → refreshKey++
  └── LeaderboardTabs refreshKey={refreshKey}
        └── useEffect([fetchLeaderboard]) depends on refreshKey
              → immediate refetch after save
```

### CompactLeaderboard refreshKey integration
```text
Numbers page
  onSaved() → refreshKey++
  └── CompactLeaderboard refreshKey={refreshKey}
        └── fetchLeaderboard re-runs
```

### Push prompt behavior change
```text
Before: Show once → store timestamp → wait 7 days
After:  Show every session → hide on dismiss (session only) → never show again once permission !== "default"
```

### Edge function leaderboard fix
```text
Before: Returns 30 entries (25 with $0)
After:  Returns only entries with weeklyALP > 0 OR weeklyDeals > 0
```

