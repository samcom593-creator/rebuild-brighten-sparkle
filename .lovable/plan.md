

# Fix Lead Contact Status — Data Accuracy Plan

## Problem Identified

After investigating the database, I found leads that clearly have been contacted (notes added, status changed, license progress updated) but have `contacted_at = NULL`, making them show up as "not contacted" in the Lead Center.

### Applications with missing `contacted_at` (7 records):

| Name | Evidence of Contact | Status |
|------|-------------------|--------|
| Gavin Charles | license_progress = finished_course | contracting |
| Jordan McClendon | XCEL course 100% complete notes | new |
| Malik Tobias | XCEL course 100% complete notes | new |
| Pierre Auguste | XCEL course 100% complete notes | new |
| Marko Thompson | Has referral notes | rejected |
| Johnivan Bush | Has referral notes | new |
| Joshua Auguste | Has course progress notes | new |

### What happened

When notes were added (course progress updates, referral tags) or statuses were changed, the system did not automatically set `contacted_at`. The Lead Center filter logic already accounts for `hasContactHistory` and `status != 'new'`, but these leads slipped through because they have notes/license progress but still show `status = 'new'` with no `contacted_at`.

## Fix

### 1. Bulk data fix — Set `contacted_at` for all applications with evidence of contact

Run a data UPDATE on the `applications` table:
- WHERE `contacted_at IS NULL` AND any of: `status != 'new'`, `notes IS NOT NULL`, `last_contacted_at IS NOT NULL`, or `license_progress` not `'unlicensed'`
- SET `contacted_at = COALESCE(last_contacted_at, updated_at)`

This fixes 7 application records.

### 2. Prevent future drift — Add defensive logic

In `src/pages/LeadCenter.tsx`, the stat and filter logic already handles `hasContactHistory`. But additionally, strengthen the "contacted" detection to include:
- `license_progress` beyond `'unlicensed'` (e.g., `finished_course`, `test_scheduled`, `waiting_on_license`)
- Presence of notes (as a signal of interaction)

Update the Lead interface to include `licenseProgress` and `hasNotes`, and incorporate them into the contacted stat/filter logic.

### 3. Aged leads

The aged leads table has many records with notes but status `'new'` — these notes appear to be auto-imported data, not evidence of manual contact. These will NOT be bulk-updated to avoid false positives. The Recruiter HQ already filters aged leads correctly (only showing those marked as `contacted`).

### Files to modify

| File | Change |
|------|--------|
| Database (data update) | SET `contacted_at` for 7 application records with clear contact evidence |
| `src/pages/LeadCenter.tsx` | Add `licenseProgress` and `hasNotes` to Lead interface; strengthen contacted detection in stats and filters |

