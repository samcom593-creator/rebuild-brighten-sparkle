

# System Audit: Fix `.single()` Crashes, Remove Dummy Data, Harden Logic

## Issues Found

### 1. Dangerous `.single()` calls that can crash (13+ locations)
`.single()` throws a PostgREST error when 0 or 2+ rows are returned. Several places use it where `maybeSingle()` should be used instead:

- **`src/pages/RecruiterDashboard.tsx` ~line 926** — agent lookup with `.single()` will crash if user has no agent record
- **`src/pages/DashboardCRM.tsx` ~line 447** — agent lookup `.single()` crashes for non-agent admins
- **`src/pages/DashboardCRM.tsx` ~line 633** — `handleOptimisticStageUpdate` uses `.single()` on agent by ID (safe but inconsistent)
- **`src/pages/AgentPortal.tsx` ~lines 230, 241, 298** — 3 uses of `.single()` for agent/production lookups
- **`src/components/dashboard/ManagerTeamView.tsx` ~line 86** — agent lookup `.single()` for current user
- **`src/components/dashboard/InviteTeamModal.tsx` ~lines 69, 81, 114, 158, 204** — 5 `.single()` calls
- **`src/components/dashboard/PersonalStatsCard.tsx` ~line 172** — `.limit(1).single()` on production data (crashes when agent has no data)
- **`src/components/dashboard/ManagerInviteLinks.tsx` ~lines 75, 83, 118** — nested lookups
- **`src/components/dashboard/DeactivateAgentDialog.tsx` ~line 183** — profile lookup
- **`src/components/dashboard/InstagramPromptDialog.tsx` ~line 47** — agent lookup
- **`src/components/dashboard/LeadReassignment.tsx` ~lines 119, 126** — agent/profile lookups
- **`src/components/dashboard/QuickInviteLink.tsx` ~line 58** — insert `.single()`
- **`src/components/dashboard/InviteManagerCard.tsx` ~line 64** — insert `.single()`

### 2. Landing page dummy data (DealsTicker.tsx)
Lines 4-17: Hardcoded fake deal names/amounts (`"John M." $45,000`, `"Sarah K." $62,000`, etc.) scrolling across the top of the landing page. These should either pull real data or be removed/replaced with carrier-only ticker.

### 3. Landing page earnings projections (EarningsSection.tsx)
Lines 8-25: Hardcoded earnings projections ($250K full-time, $504K top producer). These are marketing numbers — acceptable for a landing page, but the copy says "real numbers from agents just like you" which is misleading if not backed by data. Mark as aspirational.

### 4. QuickEmailMenu sample templates (QuickEmailMenu.tsx)
Line 57: Comment says "Sample email content for preview (would ideally come from backend)". These are functional email templates used for outreach — they work correctly but the comment is misleading. Clean up the comment.

## Plan

### Step 1: Replace all dangerous `.single()` with `.maybeSingle()` (13 files)
For every file listed above, replace `.single()` with `.maybeSingle()` and add null-check guards where the result is used. This prevents runtime PostgREST 406 errors that silently break pages.

### Step 2: Replace DealsTicker dummy data with carrier-only rotation
Remove the fake deal entries (lines 4-17 in `DealsTicker.tsx`). Keep only the carrier name rotation banner which is already there and uses real carrier names. This eliminates fake names and amounts from the public landing page.

### Step 3: Update EarningsSection copy
Change "These are real numbers from agents just like you" to "See what's possible at APEX" to avoid misleading claims.

### Step 4: Clean up QuickEmailMenu comment
Remove the "Sample email content" comment — these templates are production email content.

## Files Modified
- `src/pages/RecruiterDashboard.tsx` — `.single()` → `.maybeSingle()`
- `src/pages/DashboardCRM.tsx` — 2x `.single()` → `.maybeSingle()`
- `src/pages/AgentPortal.tsx` — 3x `.single()` → `.maybeSingle()`
- `src/components/dashboard/ManagerTeamView.tsx` — `.single()` → `.maybeSingle()`
- `src/components/dashboard/InviteTeamModal.tsx` — 5x fixes
- `src/components/dashboard/PersonalStatsCard.tsx` — `.single()` → `.maybeSingle()`
- `src/components/dashboard/ManagerInviteLinks.tsx` — 3x fixes
- `src/components/dashboard/DeactivateAgentDialog.tsx` — 1x fix
- `src/components/dashboard/InstagramPromptDialog.tsx` — 1x fix
- `src/components/dashboard/LeadReassignment.tsx` — 2x fixes
- `src/components/dashboard/QuickInviteLink.tsx` — 1x fix (insert `.select().single()` is fine for inserts, keep)
- `src/components/dashboard/InviteManagerCard.tsx` — 1x fix (insert, keep)
- `src/components/landing/DealsTicker.tsx` — Remove fake deals, keep carrier rotation
- `src/components/landing/EarningsSection.tsx` — Update marketing copy
- `src/components/dashboard/QuickEmailMenu.tsx` — Clean comment

