

# Comprehensive Fix: Data Accuracy, Dashboard Integrity, and UX Improvements

## Issues Found and Fixes

### 1. Doubled Production Numbers (DATA REPAIR - CRITICAL)

The production import on Feb 16 ADDED values on top of data agents had already entered themselves. Every record that existed before the import and was updated on Feb 16 needs its imported amount subtracted back out.

**Records to fix** (subtract the import amounts):

| Agent | Date | Current AOP/Deals | Correct AOP/Deals | Action |
|---|---|---|---|---|
| Moody Imran | Feb 9 | $2,472 / 2 | $1,236 / 1 | Subtract $1,236 / 1 |
| Moody Imran | Feb 10 | $2,688 / 2 | $1,284+$1,404=$2,688 / 2 | No change (was new, not doubled) |
| Obiajulu Ifediora | Feb 9 | $5,390.13 / 3 | $2,697 / 2 | Subtract $2,693.13 / 1 |
| Obiajulu Ifediora | Feb 11 | $6,761.52 / 1 | $3,380.52 / 1 | Set to $3,380.52 (was doubled) |
| KJ Vaughns | Feb 9 | $4,043.52 / 3 | $2,021.52 / 2 | Subtract $2,022 / 1 |
| KJ Vaughns | Feb 10 | $1,066.56 / 2 | $533.28 / 1 | Subtract $533.28 / 1 |
| Aisha Kebbeh | Feb 9 | $1,100.40 / 2 | $560.40 / 1 | Subtract $540 / 1 |
| Aisha Kebbeh | Feb 12 | $2,038.44 / 1 | $1,019.40 / 1 | Set to $1,019.40 |
| Chukwudi Ifediora | Feb 9 | $3,856.40 / 2 | $1,928.40 / 1 | Subtract $1,928 / 1 |
| Chukwudi Ifediora | Feb 11 | $2,590.76 / 2 | $1,295.76 / 1 | Subtract $1,295 / 1 |
| Chukwudi Ifediora | Feb 12 | $4,209.84 / 4 | $2,104.92 / 2 | Subtract $2,104.92 / 2 |
| Leslie Patino Galeana | Feb 9 | $3,291.92 / 1 | $1,645.92 / 1 | Set to $1,645.92 |
| Michael Kayembe | Feb 10 | $902.80 / 1 | $451.80 / 1 | Set to $451.80 |

Also fix the `import-production-data` edge function to use UPSERT with SET (not ADD) to prevent future doubling.

---

### 2. Aged Leads "49 Duplicates" Bug

**Root cause**: 97 aged leads have NULL email addresses. The duplicate detection groups by email, and all NULL-email records get grouped together by phone. The merge function skips records without a key (email or phone), so clicking "merge" finds nothing to delete and reports "all done."

**Fix**: Update the `duplicateMap` logic in `DashboardAgedLeads.tsx` to skip leads with empty/null emails from email-based grouping (they're not duplicates just because they both lack an email). Only group by phone if both records have a valid 10-digit phone.

---

### 3. Dashboard "In Training" Sub-filter

**Current**: The "In Training" stat card on the Dashboard roster filters for agents in `training_online` OR `in_field_training` stages as a single group.

**Fix**: Split the "In Training" card into a clickable filter with two sub-options:
- "In Course" -- agents in `training_online` stage
- "In Field" -- agents in `in_field_training` stage

This will be implemented as a dropdown or toggle when the "In Training" stat card is clicked.

---

### 4. CRM Pipeline Stat Cards Reorder

**Current order**: In Course, In-Field Training, Live, Meeting Eligible, Unlicensed, Paid Agents, Total Deals

**New order** (per your request):
1. **Total Leads** -- count of all active agents in the pipeline
2. **Hired (Unlicensed)** -- agents with `license_status = unlicensed` who are active
3. **Contracted (Hired)** -- agents in `contracting` / recently contracted status
4. **Hired (Course Purchased)** -- agents with `has_training_course = true`

Each card will be clickable and filter the pipeline view accordingly.

---

### 5. Contracted/Hired Status Flow Fix

**Issue**: When you click "Contracted" on an applicant, it should:
1. Create the agent record (already works)
2. Show them as "Hired" in the dashboard roster
3. Show them as "Contracted" in the Lead Center
4. Auto-enroll in course (already works)

**Fix**: Ensure the application `status` is set to `"contracting"` (already fixed in previous update). Verify the dashboard roster includes these records in the "Unlicensed" section. The Lead Center already has a "Contracted" status filter -- verify it maps correctly.

---

### 6. Hide Users Button in CRM

**Fix**: Add a "Hide" action to each agent card in the CRM pipeline. This will set `is_inactive = true` on the agent, removing them from the default view. A toggle at the top ("Show Hidden") will reveal them again. This uses the existing `is_inactive` field.

---

### 7. Default Password Confirmation

Already implemented: new agents get password `123456` and are forced to change it on first login. No changes needed here.

---

### 8. Recruiting Stats Accuracy

The `AgencyGrowthCard` currently:
- Counts "New Hires" as the higher of applications or new agent records in the period
- Uses `created_at` to determine period membership

**Fix**: Verify the date boundary functions (`getTodayPST`, `getWeekStartPST`, `getMonthStartPST`) are correct and that the query filters match the selected period. Ensure the "Licensed vs Unlicensed" sub-label accurately reflects the breakdown.

---

## Files to Modify

1. **Data repair** -- SQL updates to fix 13 doubled production records
2. **`supabase/functions/import-production-data/index.ts`** -- Fix upsert logic to SET values instead of ADD
3. **`src/pages/DashboardAgedLeads.tsx`** -- Fix duplicate detection to skip NULL emails
4. **`src/components/dashboard/ManagerTeamView.tsx`** -- Split "In Training" into sub-filters (In Course / In Field)
5. **`src/pages/DashboardCRM.tsx`** -- Reorder stat cards, add "Hide User" action button
6. **`src/components/dashboard/AgencyGrowthCard.tsx`** -- Audit and verify recruiting stat accuracy

