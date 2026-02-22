

# Finish Remaining Items -- Sidebar Cleanup, Merge Fix, System Integrity Auto-Fix, CRM Tweaks, Course Progress Compaction, Data Fixes

This plan covers all the remaining items from the original plans that have not yet been implemented.

---

## 1. Remove "Accounts" from Sidebar

The "Accounts" nav item in `GlobalSidebar.tsx` (line 102) points to `/dashboard/accounts` but serves no purpose. It will be removed.

**File:** `src/components/layout/GlobalSidebar.tsx` -- delete line 102.

---

## 2. Fix Duplicate Merge Edge Function

The `merge-agent-records` edge function uses `userClient.auth.getClaims(token)` which is not a valid Supabase JS method. This causes silent failures when merging.

**Fix:** Replace `getClaims(token)` with `getUser()` (which uses the Authorization header already set on the client). Extract user ID from the result.

**File:** `supabase/functions/merge-agent-records/index.ts` -- lines 39-50, replace the `getClaims` block with `getUser()` and extract `data.user.id`.

---

## 3. System Integrity -- "Fix All" Buttons

Currently the `SystemIntegrityCard` only shows issues but offers no way to resolve them. Add a "Fix" button next to each issue type:

- **Orphan agents** (active agents without user accounts): Button sets their `status` to `inactive`
- **Invalid status** (terminated leads with non-rejected status): Button sets their `status` to `rejected`
- **Duplicate emails**: Button links to the existing Merge Tool (navigates to it)

Each fix shows a toast confirmation and refetches the integrity data.

**File:** `src/components/admin/SystemIntegrityCard.tsx` -- add fix handler functions and "Fix" buttons per issue row.

---

## 4. Course Progress -- Compact Layout

Reduce vertical spacing to show more agents per screen without scrolling:

- Reduce header padding from `p-2.5` to `p-2`, icon from `h-5 w-5` to `h-4 w-4`
- Title from `text-2xl` to `text-xl`
- Stats cards padding from `p-3` to `p-2`, icon containers from `h-8 w-8` to `h-6 w-6`, numbers from `text-xl` to `text-lg`
- Table row padding reduced
- Progress Ring size from 40 to 32

**File:** `src/pages/CourseProgress.tsx` -- multiple small spacing/size reductions.

---

## 5. Fix Phone Number Data

The 3 placeholder leads inserted with `0000000000` phone numbers need correction. Run a database update to set those phones to `NULL`.

**Action:** SQL update on `applications` table where `phone = '0000000000'` to set `phone = NULL`.

---

## 6. CRM Hide Inactive Labels Fix

The CRM already has the toggle buttons, but the labels are misleading -- "Show Inactive" button is labeled "Showing Inactive" when toggled (it actually shows deactivated agents). Fix the label text to match the actual behavior:

- First button (showDeactivated): "Show Deactivated" / "Hiding Deactivated"
- Second button (showInactive): "Show Inactive" / "Hiding Inactive"

**File:** `src/pages/DashboardCRM.tsx` -- fix label text on lines 1405 and 1415.

---

## Technical Summary

| File | Change |
|------|--------|
| `src/components/layout/GlobalSidebar.tsx` | Remove Accounts nav item |
| `supabase/functions/merge-agent-records/index.ts` | Fix auth from `getClaims` to `getUser` |
| `src/components/admin/SystemIntegrityCard.tsx` | Add "Fix" buttons for each issue type |
| `src/pages/CourseProgress.tsx` | Compact layout (smaller padding, fonts, icons) |
| `src/pages/DashboardCRM.tsx` | Fix toggle button labels |
| Database | Set `phone = NULL` where `phone = '0000000000'` in applications |

