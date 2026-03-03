

# Make Lead Info Tab Editable

## Problem
The Info tab in LeadDetailSheet is read-only. Users need to edit lead details (name, email, phone, city, state, referral source, license progress, test date) directly from the sheet.

## Changes (all in `src/components/recruiter/LeadDetailSheet.tsx`)

### 1. Add Edit Mode Toggle
- Add `isEditing` state and an "Edit" / "Cancel" button at the top of the Info tab
- When editing, replace static `InfoRow` values with `Input` fields pre-filled with current values

### 2. Editable Fields State
- Add `editForm` state initialized from the lead prop, containing: `first_name`, `last_name`, `email`, `phone`, `city`, `state`, `referral_source`, `license_progress`, `test_scheduled_date`
- Reset `editForm` when lead changes (in the existing `useEffect`)

### 3. Save Handler
- On "Save", update the `applications` table with the edited fields
- Log a `note_added` activity: "Lead info updated"
- Toast success/error, call `onRefresh()`, exit edit mode

### 4. UI Layout
- Non-editable rows (Created, Last Contacted) stay as static `InfoRow`
- Editable rows become compact inputs: label on left, small input on right
- License Progress uses a `<select>` dropdown with the existing enum values (unlicensed, pre_licensing, studying, scheduled, licensed)
- Test Scheduled Date uses a date `<input type="date">`
- Save + Cancel buttons at bottom

### 5. InfoRow Component Update
- Add optional `editing` / `onChange` / `type` props to `InfoRow` so it can render an input when in edit mode, keeping the component reusable

No database changes needed -- the existing RLS policies already allow agents/managers to update their assigned applications.

