
# Eliminate Number Update Delays — Instant Feedback Everywhere

## Root Cause

When numbers are submitted, there are two blocking delays:

1. **LogNumbers page (line 286-294)**: The submit handler `await`s the `notify-production-submitted` edge function AND `await`s `fetchLeaderboard()` before showing the confetti/success screen. Edge function calls take 1-3 seconds, making the user wait before seeing any feedback.

2. **CompactProductionEntry (Agent Portal)**: After saving, it fires 4 edge function notifications in a `setTimeout` (non-blocking, which is good), but the realtime subscription (`useProductionRealtime`) triggers ALL 10+ subscribed components to refetch simultaneously at 300ms debounce. This causes a cascade of database queries that saturates the browser and creates jank/delay in the form itself.

3. **Realtime cascade**: The `useProductionRealtime` singleton fires a `CustomEvent` to every subscriber (leaderboards, stats cards, rank badges, year performance, etc.) — all within 300ms of each other. When an admin submits numbers, this triggers 10+ parallel database queries on a single browser tab.

## Fix Strategy

### File 1: `src/pages/LogNumbers.tsx`

**Make edge function call non-blocking (fire-and-forget)**:
- Remove the `await` on `supabase.functions.invoke("notify-production-submitted")` — fire it without waiting
- Move `fetchLeaderboard()` to run in the background while showing confetti immediately
- Show confetti and transition to leaderboard step **instantly** after the upsert succeeds
- Fetch leaderboard data in parallel so it populates by the time the animation finishes

### File 2: `src/components/dashboard/CompactProductionEntry.tsx`

**Optimistic success + deferred notifications**:
- The current flow is already decent (notifications in setTimeout), but ensure the success toast and confetti fire immediately after the upsert returns — no waiting on any secondary operations
- No structural changes needed here, just verify the flow is clean

### File 3: `src/hooks/useProductionRealtime.ts`

**Stagger realtime callbacks to prevent cascade**:
- Increase the default debounce from 300ms to 800ms for the global event dispatcher
- This means when production is saved, the realtime update reaches all components over a longer window, preventing all 10+ queries from hitting the database in the same 300ms window
- The submitting component already has the latest data (it just saved it), so the slight delay for OTHER components is invisible to the user

### File 4: `src/hooks/useDebouncedRefetch.ts`

**Add jitter to prevent thundering herd**:
- Add a small random jitter (0-200ms) to each debounced refetch so components don't all fire at exactly the same time
- This spreads the database load and prevents main-thread saturation

## Summary

- LogNumbers submit becomes instant: confetti fires right after upsert, notifications are fire-and-forget, leaderboard loads in background
- Realtime debounce increased from 300ms to 800ms to prevent query storms
- Random jitter added to debounced refetch to spread out concurrent queries
- No visible delay for the user submitting — they see success immediately
