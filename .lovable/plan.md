

# Plan: Fix Contracted Status Display Across All Dashboards

## Problem
When clicking "Contract" on a lead, some dashboards don't properly reflect the contracted status. The root cause is inconsistent update logic and status derivation across pages.

## Root Causes Found

1. **Lead Center contracted action** (line 965) only sets `contracted_at` — it does NOT set `status` or `closed_at`, so the status badge stays stale (shows old status like "Reviewing" or "New").

2. **ContractedModal** sets `status: "contracting"` (not `"contracted"`) — but dashboards check for different things:
   - `DashboardApplicants.getApplicationStatus()` checks `contracted_at` timestamp → works correctly
   - `LeadCenter` checks `lead.status` string from DB → shows stale value since Lead Center's contracted action doesn't update `status`
   - `RecruiterDashboard` filters out `contracted_at IS NOT NULL` → lead disappears (correct)

3. **No optimistic UI update** after contracting — the Pipeline waits for a full refetch, causing a visual delay.

## Changes

### 1. Fix Lead Center contracted action (`src/pages/LeadCenter.tsx`)
- Line ~965: Add `status: "contracting"` and `closed_at` to the `.update()` call, matching what `ContractedModal` does.

### 2. Unify status derivation in Lead Center (`src/pages/LeadCenter.tsx`)
- Update the Lead Center's status display logic to check `contracted_at` timestamp (like Pipeline does) so that regardless of the `status` column value, a lead with `contracted_at` set always shows as "Contracted."

### 3. Add optimistic UI in Pipeline after contracting (`src/pages/DashboardApplicants.tsx`)
- In the `ContractedModal`'s `onSuccess` callback area, immediately update the local `applications` state to set `contracted_at` and `closed_at` on the contracted app before the refetch completes. This gives instant visual feedback.

### 4. Standardize contracted display in Lead Center status colors
- Ensure `statusColors` in Lead Center has a "contracting" entry mapped to the same violet color as "contracted."

**No database or backend changes needed.** All fixes are UI-side logic alignment.

