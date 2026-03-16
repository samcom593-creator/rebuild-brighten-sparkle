

# Add "Bought Course on the Phone" Checkbox to Hire Action

## What Changes

When clicking "Hired" in the Call Center, a confirmation dialog will appear with a checkbox asking "Did they buy the course on the phone?" before proceeding. This applies to both licensed and unlicensed leads.

## Technical Approach

### 1. Update `LicenseConfirmModal` → Create new `HireConfirmModal`
Create a new modal component `src/components/callcenter/HireConfirmModal.tsx` that:
- Shows for ALL hire actions (not just unlicensed)
- Has a checkbox: "Bought the course on the phone"
- For unlicensed leads, also shows the existing warning about licensing
- Passes `boughtCourse: boolean` back to the confirm handler

### 2. Update `CallCenter.tsx` hire flow
- Replace the `showLicenseConfirm` state with a new `showHireConfirm` state
- When "hired" is clicked, always show the new `HireConfirmModal` (regardless of license status)
- Pass `boughtCourse` boolean into `executeAction` so it can be stored
- Store the `bought_course` value in the application/aged_lead notes or a dedicated field

### 3. Data storage
- Add `bought_course_on_phone` as a key in the notes or save it in the existing `notes` field as a prefix like `[BOUGHT COURSE] ...`
- Alternatively, store in the lead_activity log as a `course_purchased_on_call` activity entry — this is cleaner and queryable

### Files to modify
- **New**: `src/components/callcenter/HireConfirmModal.tsx` — modal with checkbox
- **Edit**: `src/pages/CallCenter.tsx` — replace license confirm with hire confirm, pass `boughtCourse` to executeAction, log activity
- **Edit**: `src/components/callcenter/index.ts` — export new component
- **Remove usage of**: `LicenseConfirmModal` from CallCenter (replaced by new modal)

