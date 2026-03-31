

# CRM Meeting Attendance Tab + Duplicate Auto-Merge + WhatsApp Funnel Confirmation

## 1. New "Meeting Attendance" Tab (First Tab in CRM)

Add a new first tab called **"Meeting Attendance"** before Onboarding in the `SECTIONS` array.

**Layout**: Clean, single-purpose daily attendance view:
- **Columns**: Agent Name (with manager badge below), Present (tappable circle icon), Homework (circle — only shown for agents in `in_field_training`), Week ALP (for `evaluated`/live agents), Month ALP (for `evaluated`/live agents)
- Tapping the circle toggles present/absent for today's date, saving to `agent_attendance` table with type `agency_meeting`
- Green filled circle = present, empty/red circle = absent
- Sort alphabetically by agent name
- Show ALL active agents (not filtered by stage) since meeting attendance applies to everyone

**Changes to `DashboardCRM.tsx`**:
- Add `meeting_attendance` as first entry in `SECTIONS` array
- Add `getAgentsForSection` logic: return all active agents sorted by name
- Add `getTableHeaders` case with columns: Agent, Mentor, Present, Homework, Week ALP, Month ALP
- Add `getTableCells` case: render tappable attendance circles using `agent_attendance` table, conditionally show homework/ALP columns based on stage
- Attendance toggle: upsert to `agent_attendance` with `attendance_type: 'agency_meeting'` and `attendance_date: today`
- Add new status card for Meeting Attendance count (agents marked present today)

## 2. Auto-Merge Duplicate Samuel James Applications

When a person reapplies and their previous application is assigned to Samuel James, merge them automatically.

**Changes to `submit-application` edge function**:
- After inserting the new application, check for existing applications with the same email
- If any prior applications exist assigned to Samuel James (ID: `7c3c5581-3544-437f-bfe2-91391afb217d`), mark those older ones as `terminated_at = now()` with `termination_reason = 'reapplied_merged'`
- Keep only the newest application active
- Log the merge in `lead_activity`

## 3. Add WhatsApp Group Link to Success Pages

Currently the WhatsApp link is only in the confirmation **email** but NOT on the success pages the user sees after applying.

**Changes to `ApplySuccess.tsx`, `ApplySuccessLicensed.tsx`, `ApplySuccessUnlicensed.tsx`**:
- Add a prominent "Join the APEX Hiring Chat" WhatsApp button with the green WhatsApp brand color
- Link pulls from the `WHATSAPP_GROUP_LINK` env var — but since these are client-side pages, we'll need to either:
  - Hardcode the link (simplest, since it rarely changes), OR
  - Fetch it via a lightweight edge function call
- Use hardcoded approach with the link stored as a constant in a shared file

## 4. Production Data Import (03/28–03/30 new deals)

Import via `import-production-data` edge function with all deals from the pasted dataset. Key new entries:
- 03/30: Alyjah Rowland $600, Kaeden Vaughns $754.44, Chukwudi Ifediora $1,224, Obiajulu Ifediora $855.84, Mahmod Imran $2,832
- 03/28: Mahmod Imran $1,452
- Plus full historical re-sync

## Files Modified
- **`src/pages/DashboardCRM.tsx`** — New Meeting Attendance tab (first tab), attendance toggle logic, conditional homework/ALP columns
- **`supabase/functions/submit-application/index.ts`** — Auto-merge duplicate Samuel James applications on reapply
- **`src/pages/ApplySuccess.tsx`** — Add WhatsApp group button
- **`src/pages/ApplySuccessLicensed.tsx`** — Add WhatsApp group button
- **`src/pages/ApplySuccessUnlicensed.tsx`** — Add WhatsApp group button
- **Data import** via `import-production-data` edge function

