

# CRM Overhaul: Simplify for Managers + Import New Data

## Problem
The CRM is overwhelming — too much info per agent, buried features, wrong filtering logic. Managers avoid using it. Each tab shows the same heavy expanded row with star ratings, checklists, production stats, evaluation buttons, etc. regardless of context.

## Changes

### 1. Rewrite `AgentExpandedRow` per-section context (`DashboardCRM.tsx`)

**Onboarding** expanded row shows ONLY:
- License status (Licensed / Unlicensed badge)
- Course progress bar (the 5-step dots already there)
- Contact info (phone, email, IG)
- Notes button
- Remove: star rating, checklist, production summary, evaluation, attendance, days counters, performance badges

**In-Field Training** expanded row shows ONLY:
- Attendance grids (Training + Meeting) — daily marking
- Homework grid (daily marking)
- Contact info
- Notes button
- Remove: star rating, checklist, production summary, license progress bar, evaluation

**Live** expanded row shows ONLY:
- Week ALP, Previous Week ALP, Weekly Deals (inline in table row, not just expanded)
- Contact info
- Attendance
- Notes button
- Remove: star rating, checklist, month ALP, closing rate %, days counters, performance badges, evaluation

**Needs Follow-Up**: Change threshold from 14 days to **6 days** with no progress update. Show contact info + last activity + notes.

### 2. Simplify table columns per section

- **Onboarding**: Agent | Licensed/Unlicensed | Course Progress | Contact | Notes icon
- **In-Field Training**: Agent | Attendance | Homework | Contact
- **Live**: Agent | Week ALP | Prev Week ALP | Deals | Attendance | Contact
- **Needs Follow-Up**: Agent | Last Activity | Days Stale | Contact

### 3. Unlicensed Pipeline — full-height scrollable
Remove `max-h-[300px]` from pipeline columns. Make the pipeline section use full viewport height with proper scrolling.

### 4. Add inline Notes button to every row
Show a small notes icon on each table row that opens the notes panel inline (not requiring full expand). Use the existing `AgentNotes` component.

### 5. Import production data (03/27–03/30)
**New deals:**
| Date | Agent | ALP | Deals |
|------|-------|-----|-------|
| 03/30 | Alyjah Rowland | $600.00 | 1 |
| 03/30 | Kaeden Vaughns | $754.44 | 1 |
| 03/30 | Chukwudi Ifediora | $1,224.00 | 1 |
| 03/30 | Obiajulu Ifediora | $855.84 | 1 |
| 03/30 | Mahmod Imran | $2,832.00 | 1 |
| 03/28 | Mahmod Imran | $1,452.00 | 1 |
| 03/27 | Jacob Causer | $756.00 | 1 |
| 03/27 | Chukwudi Ifediora | $1,559.88 | 1 |
| 03/27 | Kaeden Vaughns | $828.48 | 1 |
| 03/27 | Obiajulu Ifediora | $1,135.56 | 1 |

Plus all prior data re-synced with `skip_existing: false`.

## Files Modified
- **`src/pages/DashboardCRM.tsx`** — Major rewrite of `AgentExpandedRow`, table headers, section filtering logic, unlicensed pipeline height
- **Data import** via `import-production-data` edge function call

