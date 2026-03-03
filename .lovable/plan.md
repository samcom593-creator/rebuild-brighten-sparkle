

# Make ApplicationDetailSheet Editable Everywhere

## Problem
The `ApplicationDetailSheet` component (used in CRM, Pipeline, Call Center, and Recruiting Quick View) is entirely read-only. When you click a name anywhere in the app, you can only view info — not edit it. The `LeadDetailSheet` (Recruiter HQ only) already has edit mode, but `ApplicationDetailSheet` does not.

## Changes (all in `src/components/dashboard/ApplicationDetailSheet.tsx`)

### 1. Add Edit Mode State
- Add `isEditing`, `editForm`, `savingEdit` states
- Initialize `editForm` from fetched `application` data whenever it changes
- Editable fields: `first_name`, `last_name`, `email`, `phone`, `city`, `state`, `instagram_handle`, `referral_source`, `license_progress`, `test_scheduled_date`, `notes`, `carrier`, `nipr_number`

### 2. Add Edit/Cancel Toggle
- Add an "Edit" button in the sheet header (next to the title)
- Toggles to "Cancel" when editing; resets form on cancel

### 3. Replace Read-Only Sections with Inputs When Editing
- Contact section: replace static text with compact input fields for email, phone, instagram, city/state
- Experience section: keep read-only (rarely changes)
- Notes section: replace static `<p>` with a `<Textarea>`
- License progress: add a `<select>` dropdown
- Test scheduled: add `<input type="date">`
- NIPR/carrier: add text inputs

### 4. Save Handler
- Update `applications` table with edited fields
- Log activity via `logLeadActivity` (type: `note_added`, title: "Lead info updated")
- Toast success/error, invalidate the query, exit edit mode

### 5. Add `onRefresh` Callback
- Add optional `onRefresh` prop so parent pages (CRM, Pipeline, etc.) can refresh their lists after edits
- Call `queryClient.invalidateQueries` for the detail query + call `onRefresh` on save

No database changes needed — existing RLS policies already allow agents/managers to update their assigned applications.

