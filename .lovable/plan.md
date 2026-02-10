

# Fix Application Stability, Add Motivation Requirement, and Display Motivation on Lead Cards

## Overview

Three focused changes to address the user's core requests:

1. **Prevent page reloads / preserve form progress** on the Apply page
2. **Require motivation from unlicensed applicants** before redirecting to the success page
3. **Show motivation on lead cards** in both Applicants and Call Center views

---

## 1. Prevent Apply Page Reloads and Preserve Progress

**Problem**: When the user switches browser tabs and returns, the Apply form can lose its state. The form data lives only in React state — if the component re-mounts (e.g., due to a hot-reload, PWA update, or visibility-triggered re-render), all input is lost.

**Fix (File: `src/pages/Apply.tsx`)**:

- **Persist form data to `sessionStorage`** on every field change using a `useEffect` that watches all form values via `watch()`. On mount, restore saved form data from `sessionStorage` into the form using `setValue()` for each field.
- **Persist `currentStep`** to `sessionStorage` so returning to the page resumes at the same step.
- **Persist `selectedStates`** array to `sessionStorage`.
- **Add `beforeunload` handler** to warn users if they have unsaved progress (steps 1-4 only, not after submission).
- **Clear sessionStorage** only on successful final submission (already done in `markAsConverted`).

This ensures that tab-switching, accidental refreshes, or background PWA updates never lose the applicant's progress.

---

## 2. Require Motivation for Unlicensed Applicants

**Problem**: Unlicensed applicants submit and immediately redirect to the success page. The admin wants to capture their "motivation" (why they want to join) before they leave.

**Database Change**:
- Add a `motivation` column (text, nullable) to the `applications` table via migration.

**Flow Change (File: `src/pages/Apply.tsx`)**:

- After the referral step (Step 5), when the user clicks "Complete Application" and `savedLicenseStatus` is `"unlicensed"` or `"pending"`:
  - Instead of immediately navigating to `/apply/success/unlicensed`, show a **motivation modal/step** (inline within the same card).
  - The modal will display: "What is your motivation for joining APEX Financial?" with a required Textarea (minimum 10 characters).
  - A "Submit & Continue" button saves the motivation to the `applications` table (`UPDATE applications SET notes = motivation WHERE id = applicationId`) and then navigates to the success page.
  - Licensed applicants skip this step entirely and go straight to `/apply/success/licensed`.

**Edge function update (File: `supabase/functions/submit-application/index.ts`)**: No change needed -- we update the motivation via a direct Supabase client call after submission since the application ID is already known.

**Implementation detail**: Add a new state `showMotivationStep` (boolean). In `handleReferralSubmit`, if unlicensed, set `showMotivationStep = true` instead of navigating. Render a motivation input UI when `showMotivationStep` is true. On motivation submit, update the application's `notes` field (since `applications` already has a `notes` column) with the motivation text, then navigate.

---

## 3. Display Motivation on Lead Cards

### Applicants Page (File: `src/pages/DashboardApplicants.tsx`)

- The `notes` field is already displayed on applicant cards (lines 541-546). Since we're saving motivation into the `notes` field, it will automatically appear.
- No additional code changes needed here -- the existing "Notes Preview" section already renders `app.notes`.

### Call Center (File: `src/pages/CallCenter.tsx`)

- Line 180 currently sets `motivation: undefined` for application-sourced leads. Change this to `motivation: app.notes || undefined` so that the CallCenterLeadCard (which already renders motivation in its "Lead Notes" section) displays it.

### CallCenterLeadCard (already handled)

- The component at `src/components/callcenter/CallCenterLeadCard.tsx` already renders `lead.motivation || lead.notes` in the "Lead Notes" section (lines 232-241). No changes needed.

---

## Summary of Files to Modify

| File | Change |
|------|--------|
| `src/pages/Apply.tsx` | Persist form to sessionStorage; add motivation step for unlicensed applicants |
| `src/pages/CallCenter.tsx` | Map `app.notes` to `motivation` for application-sourced leads |

## Database Migration

```sql
-- No migration needed: the `applications` table already has a `notes` column
-- We will store motivation text in the existing `notes` field
```

## Technical Details

- Form persistence uses `sessionStorage` (not `localStorage`) to avoid stale data across sessions
- The motivation step reuses the existing GlassCard layout for visual consistency
- Minimum 10 character validation on motivation text to ensure meaningful input
- The `watch()` subscription is debounced (300ms) to avoid excessive sessionStorage writes

