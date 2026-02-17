
# Fix Numbers Input + Kill Auto-Rendering Animations

## Problem 1: Can't Input Numbers

The `/apex-daily-numbers` page is inside `AuthenticatedShell`, which requires you to log in first. But this page is designed for quick name-search production entry -- you just type a name, pick the agent, and log numbers. Requiring a full login defeats the purpose.

Additionally, even after logging in, the page queries `agents` and `profiles` tables directly. For non-admin users, RLS blocks visibility of other agents' profiles, so the search returns no results.

**Fix**: Move `/apex-daily-numbers` outside `AuthenticatedShell` and create a backend function that handles agent search and production logging with service-level access. This way anyone with the link can quickly log numbers without needing to sign in.

### Changes:
1. **`src/App.tsx`** -- Move the `/apex-daily-numbers` route from inside `AuthenticatedShell` to the public routes section
2. **New edge function `log-production`** -- Handles:
   - Searching agents by name/email (using service role, bypasses RLS)
   - Creating new agents (delegates to existing `create-agent-from-leaderboard`)
   - Upserting daily production records
   - Fetching weekly leaderboard data
3. **`src/pages/LogNumbers.tsx`** -- Replace all direct Supabase client queries with calls to the new `log-production` edge function. Remove sidebar layout dependencies.

## Problem 2: Auto-Rendering / Infinite Animations

There are **146 instances** of `repeat: Infinity` animations across 12 files. These cause continuous DOM updates, which:
- Drain battery on mobile
- Make the browser sluggish, preventing input focus
- Cause the "auto-rendering" flickering behavior

**Fix**: Replace all `repeat: Infinity` framer-motion animations with static elements or single-play animations across these files:

| File | Instances |
|---|---|
| `src/components/landing/HeroSection.tsx` | 2 floating blobs |
| `src/components/landing/CTASection.tsx` | 2 floating blobs |
| `src/components/landing/VideoTestimonialCard.tsx` | 1 pulse ring |
| `src/components/callcenter/CallCenterFilters.tsx` | 5 sparkle/shimmer effects |
| `src/components/callcenter/CallCenterLeadCard.tsx` | Multiple pulse effects |
| `src/components/callcenter/CallCenterProgressRing.tsx` | 1 sparkle |
| `src/components/callcenter/LeadExpiryCountdown.tsx` | 2 pulse/shimmer |
| `src/components/dashboard/InterviewRecorder.tsx` | 2 recording indicators (keep -- only active during recording) |
| `src/components/dashboard/MyRankingChart.tsx` | 1 hover bounce |

All decorative infinite animations (floating blobs, shimmer effects, sparkles) will be converted to static elements. Recording indicators in InterviewRecorder will be kept since they only animate when actively recording.

## Technical Details

### New Edge Function: `supabase/functions/log-production/index.ts`

Accepts POST with an `action` field:
- `action: "search"` -- searches agents by name/email, returns matches
- `action: "create"` -- delegates to `create-agent-from-leaderboard`
- `action: "submit"` -- upserts daily_production record
- `action: "leaderboard"` -- returns weekly leaderboard with names

Uses service role key to bypass RLS, making the page work without user authentication.

### Route Change in App.tsx

```
// Move from inside AuthenticatedShell to public routes:
<Route path="/apex-daily-numbers" element={<LogNumbers />} />
```

### LogNumbers.tsx Refactor

- Remove all direct `supabase.from(...)` calls
- Replace with `supabase.functions.invoke("log-production", { body: { action, ... } })`
- Remove DashboardLayout/sidebar dependencies (already done)
- Page renders as standalone (no sidebar needed)

### Animation Cleanup

All `motion.div` elements with `repeat: Infinity` in landing/callcenter/dashboard components will be converted to plain `div` elements with static CSS classes, preserving the visual appearance without continuous repainting.

## Files Modified
1. `src/App.tsx` -- move route
2. `src/pages/LogNumbers.tsx` -- use edge function instead of direct DB queries
3. `supabase/functions/log-production/index.ts` -- new edge function
4. `src/components/landing/HeroSection.tsx` -- remove infinite animations
5. `src/components/landing/CTASection.tsx` -- remove infinite animations
6. `src/components/landing/VideoTestimonialCard.tsx` -- remove infinite animation
7. `src/components/callcenter/CallCenterFilters.tsx` -- remove infinite animations
8. `src/components/callcenter/CallCenterLeadCard.tsx` -- remove infinite animations
9. `src/components/callcenter/CallCenterProgressRing.tsx` -- remove infinite animation
10. `src/components/callcenter/LeadExpiryCountdown.tsx` -- remove infinite animations
11. `src/components/dashboard/MyRankingChart.tsx` -- remove infinite animation
