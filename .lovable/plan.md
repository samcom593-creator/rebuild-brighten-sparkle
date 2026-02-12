
# URGENT FIX: Application Form Blocked on Step 4

## The Bug

When applicants reach Step 4 ("Your Goals"), check the SMS consent checkbox, and click "Continue," nothing happens. The form silently fails.

**Root cause**: The "Continue" button on Step 4 has `type="submit"`, which triggers validation on ALL form fields across all 4 steps. If any field from a previous step is in an invalid state (common after sessionStorage restore or browser autofill), the form silently refuses to submit -- no error is shown because those fields are on hidden steps.

Additionally, the `availability` and `referralSource` Select components are **uncontrolled** -- they have no `value` prop. This means:
- When form data is restored from sessionStorage, the Select visually shows "Select availability" even though the form value might be set (or vice versa)
- The user sees a filled-looking form but the internal state is empty, causing validation to fail silently

## The Fix

**File**: `src/pages/Apply.tsx`

### Change 1: Make Step 4 button validate-then-submit (not raw submit)
- Change the Step 4 button from `type="submit"` to `type="button"`
- Add an `onClick` handler that first validates only Step 4 fields (`availability`, `smsConsent`)
- If valid, manually trigger form submission via `handleSubmit(onSubmit)()`
- If invalid, show a toast error so users see clear feedback

### Change 2: Add controlled `value` props to Select components
- Add `value={watch("availability")}` to the Availability Select (line 847)
- Add `value={watch("referralSource") || ""}` to the Referral Source Select (line 866)
- This ensures sessionStorage restoration and the visual Select state stay in sync

### Change 3: Add fallback error feedback
- If `handleSubmit` still fails due to hidden step errors, catch the validation errors and show a toast listing which fields need attention, so the user is never silently stuck

## Technical Details

```text
Step 4 "Continue" button flow (BEFORE fix):
  Click -> type="submit" -> handleSubmit(onSubmit) -> validates ALL fields -> silent fail

Step 4 "Continue" button flow (AFTER fix):
  Click -> type="button" -> validate step 4 only -> if OK -> handleSubmit(onSubmit)()
       -> if full validation fails -> toast("Please go back and check [field]")
```

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Apply.tsx` | Fix Step 4 button to validate-then-submit; add controlled value props to Selects; add error feedback |
