

# Ban List and Duplicate Detection for Aged Leads and Lead Center

## Overview

Add a "banned_prospects" table that acts as a blocklist. When you ban a prospect from either Aged Leads or Lead Center, their name, email, and phone are stored. Any future application or aged lead import that matches a banned record is automatically rejected. Existing leads matching banned records are flagged in the UI.

## Database Changes

### New Table: `banned_prospects`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| email | text | Normalized, nullable |
| phone | text | Last 10 digits, nullable |
| first_name | text | Lowercase, nullable |
| last_name | text | Lowercase, nullable |
| reason | text | Optional note |
| banned_by | uuid | Auth user who banned |
| created_at | timestamptz | Default now() |

- RLS: Admin-only for all operations
- Unique constraint on email (when not null) to prevent duplicate bans

### Duplicate Detection in Aged Leads

Add a database function `check_banned_prospect(email text, phone text, first_name text, last_name text)` that returns true if any banned record matches on email OR normalized phone OR (first_name + last_name combo). This function will be called:

1. During aged lead import (AgedLeadImporter) -- skip/flag banned matches
2. In the submit-application edge function -- reject with 403 if banned
3. On the UI when rendering lead lists -- show a warning badge

## UI Changes

### Aged Leads Page (`DashboardAgedLeads.tsx`)

- Add a "Ban" option in the existing dropdown menu (the three-dot menu) for each lead row
- Clicking "Ban" shows a confirmation dialog, then inserts into `banned_prospects` and deletes/archives the lead from `aged_leads`
- Add duplicate detection: highlight leads that share email/phone with other leads in the list (client-side grouping)

### Lead Center Page (`LeadCenter.tsx`)

- Add a "Ban" option in the action area for each lead row
- Same flow: confirm, insert into `banned_prospects`, mark lead as terminated/deleted
- For applications, set `terminated_at` and `termination_reason = 'banned'`
- For aged leads, delete or update status to "banned"

### Submit Application Edge Function

- Add a check against `banned_prospects` table before inserting
- If match found, return 403 with message "This applicant has been blocked"

### Aged Lead Importer

- Cross-reference each imported row against `banned_prospects`
- Skip banned matches and report them in the import summary

## Technical Details

### Ban Flow (both pages)

```text
User clicks Ban -> Confirmation dialog -> 
  INSERT into banned_prospects (email, phone, first_name, last_name) ->
  For applications: UPDATE terminated_at, termination_reason = 'banned' ->
  For aged_leads: DELETE or UPDATE status = 'banned' ->
  Remove from local state -> Toast confirmation
```

### Matching Logic

- Email: exact match (case-insensitive, trimmed)
- Phone: last 10 digits match (strip non-digits)
- Name: exact match on lowercase first_name + last_name combo (supplementary check)

### Files to Create/Modify

1. **New migration**: Create `banned_prospects` table with RLS policies and `check_banned_prospect` function
2. **`src/pages/DashboardAgedLeads.tsx`**: Add Ban button in dropdown, confirmation dialog, ban handler
3. **`src/pages/LeadCenter.tsx`**: Add Ban button in actions, confirmation dialog, ban handler
4. **`supabase/functions/submit-application/index.ts`**: Add banned check before duplicate check
5. **`src/components/dashboard/AgedLeadImporter.tsx`**: Add banned prospect filtering during import

