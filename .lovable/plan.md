

# Plan: Show Agent Phone Numbers in CRM

## Problem
The CRM table rows show agent name + email, but **phone numbers are not visible** unless you expand the row (click to see the detail card). The phone icon in the main row is hover-only and tiny. Since you're in Mexico and can't call via laptop, you need phone numbers displayed as **visible, copyable text** — same standard already applied to Recruiter HQ and Pipeline.

## Changes

**File: `src/pages/DashboardCRM.tsx`**

1. **Main table rows (line ~1058):** Below the email line, add the agent's phone number as visible, selectable text (same `select-all cursor-text` pattern used in Recruiter HQ). Show it only when phone exists.

2. **Unlicensed columns section (line ~1162):** Below the email line in each column card, add the phone number as visible copyable text.

3. **Both locations:** Phone displayed as `text-[10px] text-muted-foreground select-all cursor-text` — consistent with the manual-dialing standard already in place on other dashboards.

No database or backend changes needed — phone data is already fetched from profiles (line 647) and stored on each agent object (line 714).

