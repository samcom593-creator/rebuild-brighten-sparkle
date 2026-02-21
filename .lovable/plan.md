

# Phase 4 — Central Config + Feature Flags + Self-Healing + Global Schedule Bar

Phases 1-3 are complete. This phase delivers the foundational infrastructure items that future-proof the system and add the universal scheduling layer.

---

## 4A. Central Configuration File

Create `src/lib/apexConfig.ts` — a single source of truth for all tunable thresholds.

**Contents:**
- Follow-up timing (initial outreach delay, no-answer retry, course check-in interval, test reminder lead time)
- Lead scoring weights (licensed, test scheduled, recent contact, stale penalty, notes bonus, referral bonus)
- XP values (contact, stage update, test scheduled, licensed, note added)
- Rank levels (min XP, label, color, emoji)
- Stage rules (column definitions, progress values)
- Overdue thresholds (hours before overdue, dormant days)
- Animation thresholds (disable hover above N cards)

All currently hardcoded values in `RecruiterDashboard.tsx` will be imported from this config. No logic changes, just extraction.

**File created:** `src/lib/apexConfig.ts`
**File modified:** `src/pages/RecruiterDashboard.tsx` (import config instead of inline constants)

---

## 4B. Feature Flag System

Create `src/lib/featureFlags.ts` — a simple client-side feature flag system.

**Implementation:**
- Object mapping feature names to boolean defaults
- Reads overrides from `localStorage` (key: `apex_feature_flags`)
- Helper: `isFeatureEnabled(flagName): boolean`
- Flags for: `focusMode`, `soundEffects`, `activityTimeline`, `leadScoring`, `performanceMetrics`, `xpSystem`, `callOutcomes`
- All currently enabled by default (existing behavior preserved)

**Admin override:** In Settings page, add a "Feature Flags" section (admin-only) with toggles for each flag.

**Files created:** `src/lib/featureFlags.ts`
**Files modified:** `src/pages/RecruiterDashboard.tsx` (wrap features in flag checks), `src/components/dashboard/ProfileSettings.tsx` (add admin feature flag toggles)

---

## 4C. Enhanced Self-Healing ErrorBoundary

Upgrade the existing `ErrorBoundary.tsx`:

- On error: attempt automatic component re-mount (retry count up to 2) before showing fallback
- Log error to a new `error_logs` table in the database (fire-and-forget)
- Add a `ComponentErrorBoundary` wrapper for individual sections (sidebar, main content, cards) so one section crashing doesn't take down the whole page
- Add to `AuthenticatedShell.tsx`: wrap `<Outlet />` in a `ComponentErrorBoundary`

**Database:** New `error_logs` table with columns: `id`, `user_id`, `error_message`, `component_stack`, `url`, `created_at`. RLS: insert for authenticated users, select for admins only.

**Files modified:** `src/components/ErrorBoundary.tsx` (add retry logic + error logging)
**Files created:** `src/components/ComponentErrorBoundary.tsx`
**Files modified:** `src/components/layout/AuthenticatedShell.tsx` (wrap Outlet)

---

## 4D. Global Schedule Bar

Add a slim, collapsible bar pinned at the top of all authenticated pages (inside `AuthenticatedShell`).

**Data sources (existing tables):**
- `scheduled_interviews` — upcoming meetings
- `applications` with computed `next_action` — overdue follow-ups
- Leads with no contact 48h+ — attention needed

**UI:**
- Horizontal scrollable row of compact pill cards
- Each pill shows: time, lead/agent name, action type, one-click action button
- Color coding: Red = Overdue, Orange = Due today, Blue = Scheduled, Green = Completed
- Collapsed by default on mobile, shows count badge
- Click on pill opens a small drawer with details + action buttons

**Data fetching:** TanStack Query, 120s stale time, polls every 60s when tab is active.

**Files created:** `src/components/layout/ScheduleBar.tsx`
**Files modified:** `src/components/layout/AuthenticatedShell.tsx` (add ScheduleBar above Outlet)

---

## 4E. Auto-Stage Suggestion Chips

When certain conditions are detected on a lead, show a small suggestion chip on the card:

**Rules (computed client-side from existing data):**
- Lead has `license_progress = passed_test` and no stage change in 3+ days -> "Suggested: Move to Final Steps"
- Lead has `license_progress = waiting_on_license` and 7+ days in stage -> "Suggested: Move to Licensed"
- Lead has no activity in 7+ days and score < 40 -> "Suggested: Mark as Cold"

**UI:** Small amber chip below the action row with one-click "Apply" button that:
1. Updates `license_progress`
2. Logs `stage_changed` activity
3. Logs `suggestion_applied` activity

**File modified:** `src/pages/RecruiterDashboard.tsx` (add suggestion logic + chip to LeadCard)

---

## 4F. Sound System Settings Toggle

The sound system exists but has no user toggle. Add to ProfileSettings:

- "Sound Effects" switch (on/off)
- Store preference in `localStorage` key `apex_sound_enabled`
- Read in `useSoundEffects` hook — if disabled, `playSound` becomes a no-op

**Files modified:** `src/hooks/useSoundEffects.ts` (check localStorage), `src/components/dashboard/ProfileSettings.tsx` (add toggle)

---

## Summary of Changes

| File | Action |
|---|---|
| `src/lib/apexConfig.ts` | New — central config for all thresholds |
| `src/lib/featureFlags.ts` | New — feature flag system |
| `src/components/ComponentErrorBoundary.tsx` | New — section-level error boundary with retry |
| `src/components/layout/ScheduleBar.tsx` | New — global schedule bar component |
| `supabase/migrations/XXXX_create_error_logs.sql` | New — error_logs table |
| `src/components/ErrorBoundary.tsx` | Modified — add retry logic + DB logging |
| `src/components/layout/AuthenticatedShell.tsx` | Modified — add ScheduleBar + ComponentErrorBoundary |
| `src/pages/RecruiterDashboard.tsx` | Modified — import from config, feature flags, auto-stage suggestions |
| `src/components/dashboard/ProfileSettings.tsx` | Modified — add sound toggle + feature flags section |
| `src/hooks/useSoundEffects.ts` | Modified — respect sound preference |

**Database:** 1 new table (`error_logs`), no changes to existing tables.

