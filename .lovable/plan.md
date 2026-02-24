

# Remaining Fixes Not Yet Applied

After reviewing every line of code, the major structural changes (accordion pipeline, CRM grouped table, notification resend logic) **are already in place and working**. The app requires login to see them -- the landing page (`/`) was not changed.

However, I found these specific items from the approved plan that were NOT implemented:

## 1. Notification Hub: Button still says "Resend All Failed" (should be "Retry Unresolved Failures")

**File: `src/pages/NotificationHub.tsx` (line 797-798)**

The action card title is still `"Resend All Failed"` and description is `"Retry unresolved failures (deduped)"`. Per the plan, it should be:
- Title: `"Retry Unresolved Failures"`
- Description: `"Deduplicates & skips resolved"`

## 2. CRM Expanded View still uses card grid instead of table rows

**File: `src/pages/DashboardCRM.tsx` (lines 1838-1864)**

When you click a stat card (e.g. "Total Leads"), the expanded view renders a card grid (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`) with `renderAgentCard`. Per the plan, this should use a high-density table (matching the grouped table format) for information density.

I will:
- Replace the card grid with a `<Table>` matching the CRMGroupedTable format
- Keep the staggered entrance animations
- Add inline row expansion for agent details

## 3. No inline success banner on NotificationHub when all failures are resolved

The resend function shows a toast, but the plan called for a **persistent inline green banner** on the page itself showing the last retry result. I will add a `lastRetryResult` state that renders a dismissible banner above the action cards.

## Summary of Changes

| File | Change |
|------|--------|
| `NotificationHub.tsx` | Rename button, add inline retry result banner |
| `DashboardCRM.tsx` | Replace expanded card grid with table rows |

No database or edge function changes needed.

