
# Critical Fix: Application Submission, Password Reset, Course Access, and Login Resend

## Problems Found

### 1. Application Submission Failing (CRITICAL)
**Root Cause:** The `years_experience` column in the `applications` table is type `integer`, but the form allows decimal input (e.g., "1.5"). The edge function's Zod validation accepts decimals via `NumOptional` but never rounds them to integers, so the database INSERT fails with: `invalid input syntax for type integer: "1.5"`.

**Fix (submit-application edge function):**
- In the `NumOptional` preprocessor, add `Math.floor()` to truncate decimals to integers before inserting
- Alternatively, add `step="1"` to the HTML number input for `yearsExperience` in Apply.tsx to prevent decimal entry client-side
- Both fixes will be applied for defense-in-depth

### 2. Password Reset / Forgot Password Not Working (CRITICAL)
**Root Cause:** The `send-password-reset` edge function builds a recovery URL manually using `linkData.properties.access_token`:
```
const recoveryUrl = `${BASE_URL}/dashboard/settings#access_token=${linkData?.properties?.access_token}&type=recovery`;
```
This is incorrect. The `generateLink` API returns `properties.action_link` which is the proper Supabase recovery URL with the correct `hashed_token`. The manually constructed URL uses the wrong token format, so when users click it, Supabase cannot verify the recovery session and the password reset silently fails.

**Fix (send-password-reset edge function):**
- Use `linkData.properties.action_link` directly, which contains the proper Supabase recovery URL
- Override the redirect URL to point to `${BASE_URL}/dashboard/settings?recovery=true` so the existing recovery UX (banner + auto-scroll) works correctly
- Add a fallback: if `action_link` is somehow unavailable, use magic link login instead

### 3. Course Access Issues
**Root Cause:** The course itself works (modules load, quizzes submit, progress saves). The actual issue is agents cannot get into the course because:
- They cannot log in (password reset is broken, see #2 above)
- The magic login tokens in their course enrollment emails may have expired (24-hour expiry)

**Fix:** Once password reset is fixed, agents can recover access. Additionally, we will resend fresh magic login links to all agents currently in the course (16 agents).

### 4. Resend Login Links to All Course Agents
There are 16 agents currently with `has_training_course = true`. Each will receive a fresh magic login email with a working 24-hour link that takes them directly to the course.

**Agents to receive fresh logins:**
- braydenscott.bl@gmail.com, jbbush3736@gmail.com, jzbush3736@gmail.com, levhills24@gmail.com, josh@jsmediahub.com, traeyvon713@outlook.com, courapete@gmil.com, shavanna.equislife@gmail.com, teflonaio@gmail.com, wr.healthyinsurance@gmail.com, bam2sleeze@outlook.com, merissalueranasb@gmail.com, waynepricenew@gmail.com, deondric6@gmail.com, jcauser06@gmail.com, moodyimran04@gmail.com

### 5. Re-check "Contact" Status Applicants
All recent applications with status "new" need a follow-up. There are 25+ applicants from the last week still in "new" status. After fixing the submission bug, we will trigger the follow-up email function to re-engage these applicants.

---

## Technical Changes

### File 1: `supabase/functions/submit-application/index.ts`
- In the `NumOptional` function, add `Math.floor()` to the preprocessor so decimal values like 1.5 are truncated to 1 before the DB insert
- This prevents the `invalid input syntax for type integer` error that has been blocking submissions

### File 2: `src/pages/Apply.tsx`
- Add `step="1"` attribute to the `yearsExperience` number input to prevent decimal entry on the client side
- Add `min="0"` for safety

### File 3: `supabase/functions/send-password-reset/index.ts`
- Replace the manually constructed recovery URL with `linkData.properties.action_link`
- Parse and modify the action_link to redirect to `/dashboard/settings?recovery=true` instead of the default Supabase redirect
- This ensures the PASSWORD_RECOVERY auth event fires correctly when the user clicks the link

### File 4: Trigger bulk login resend
- After deploying fixes, invoke `send-bulk-portal-logins` to resend magic login links to all 16 agents currently in the course
- Each gets a fresh 24-hour magic link pointing to the course

### File 5: Trigger follow-up emails for new applicants
- After deploying the submission fix, invoke `send-followup-emails` for the recent "new" status applicants to re-engage them

---

## Files to Modify
1. `supabase/functions/submit-application/index.ts` -- Fix integer truncation for years_experience
2. `src/pages/Apply.tsx` -- Add step="1" to years input
3. `supabase/functions/send-password-reset/index.ts` -- Fix recovery URL to use action_link
4. Deploy + invoke bulk login resend for course agents
5. Deploy + invoke follow-up emails for new applicants
