
# Fix Application Submission Flow -- 3 Critical Issues

## Issue 1: Partial Applications Failing with 401 (CRITICAL)

**Root Cause**: All RLS policies on `partial_applications` are set as **RESTRICTIVE** (not PERMISSIVE). In PostgreSQL, if there are zero PERMISSIVE policies, access is denied by default -- RESTRICTIVE policies only narrow access, they don't grant it. This means every client-side `upsert` to `partial_applications` silently fails with a 401 error.

**Evidence**: Browser console shows:
```
Failed to load resource: the server responded with a status of 401 ()
(partial_applications?on_conflict=session_id)
```

**Fix**: Database migration to drop and recreate the INSERT and UPDATE policies as PERMISSIVE:
```sql
DROP POLICY "Anyone can insert partial applications" ON partial_applications;
CREATE POLICY "Anyone can insert partial applications" 
  ON partial_applications FOR INSERT 
  WITH CHECK (true);

DROP POLICY "Anyone can update their own session" ON partial_applications;
CREATE POLICY "Anyone can update their own session" 
  ON partial_applications FOR UPDATE 
  USING (true) WITH CHECK (true);
```

## Issue 2: SMS Consent Checkbox Easily Missed

**Root Cause**: On step 4, the SMS consent checkbox is below the fold. Users fill in Availability, click "Continue", and get a small toast error that disappears in ~4 seconds. On mobile this is even worse -- the toast may be partially hidden.

**Fix** in `src/pages/Apply.tsx`:
- Add a prominent inline error banner at the TOP of step 4 when the SMS consent fails validation (similar to the existing duplicate error banner)
- Auto-scroll to the SMS consent checkbox when validation fails
- Change the error toast text to be clearer: "Please scroll down and check the SMS consent box to continue"

## Issue 3: Step 4 Button Says "Continue" Instead of "Submit"

**Root Cause**: The button on step 4 (line 1098-1124) says "Continue" with an arrow icon. Users don't realize this is the actual submit action, and may not take the consent checkbox seriously.

**Fix** in `src/pages/Apply.tsx`:
- Change button text from "Continue" to "Submit Application"
- Change icon from ArrowRight to CheckCircle2
- This makes it clear that clicking submits the form, prompting users to ensure everything is filled out

## Issue 4: Lost Lead Recovery

**Problem**: Since partial_applications were silently failing, any lead who abandoned the form was never logged. I cannot identify the specific lost lead from the database since no partial record was saved.

**Fix**: Once the RLS policies are fixed, future partial applications will be saved correctly. For the specific lead, I cannot recover their data -- the user would need to know their name/email/phone to send them a resubmit request manually.

## Files to Modify

1. **Database migration** -- Fix partial_applications RLS policies (RESTRICTIVE to PERMISSIVE)
2. **`src/pages/Apply.tsx`** -- Improve SMS consent error visibility, change button text, add auto-scroll to error

## Technical Details

### RLS Policy Fix (Migration SQL)
```sql
-- Fix INSERT policy: change from RESTRICTIVE to PERMISSIVE
DROP POLICY "Anyone can insert partial applications" ON public.partial_applications;
CREATE POLICY "Anyone can insert partial applications" 
  ON public.partial_applications FOR INSERT 
  TO public
  WITH CHECK (true);

-- Fix UPDATE policy: change from RESTRICTIVE to PERMISSIVE  
DROP POLICY "Anyone can update their own session" ON public.partial_applications;
CREATE POLICY "Anyone can update their own session" 
  ON public.partial_applications FOR UPDATE 
  TO public
  USING (true) WITH CHECK (true);
```

### Apply.tsx Changes
- Line 1098-1124: Change "Continue" button to "Submit Application" with CheckCircle2 icon
- Line 1101-1111: Add ref-based auto-scroll to SMS consent on validation failure
- Add state for inline step 4 validation error banner (below the "Your Goals" heading)
