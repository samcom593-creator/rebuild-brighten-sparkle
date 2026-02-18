

# Send Licensing Emails to All Unlicensed Applicants

## What Will Happen
Send the licensing instructions email (with video, step-by-step guide, XcelSolutions course link, and Calendly link) to every applicant in your pipeline who is not licensed, ordered oldest-first.

## Fix Required
The `bulk-send-licensing` function has a broken import that prevents it from deploying. One line needs to change:

| File | Change |
|------|--------|
| `supabase/functions/bulk-send-licensing/index.ts` | Line 2: change `esm.sh` import to `npm:@supabase/supabase-js@2`; Line 92: increase delay from 500ms to 1000ms to stay within rate limits; Add `.order("created_at", { ascending: true })` to send oldest leads first |

## Execution Steps
1. Fix the import and deploy the function
2. Verify deployment succeeded
3. Trigger the function -- it will query all applications where `license_status` is "unlicensed" or "pending" and `terminated_at` is null
4. Each person receives the full licensing resources email with admin + manager CC'd
5. Confirm results via logs (sent count vs failed count)

## Expected Volume
~70 emails based on current pipeline data, sent at 1 per second (oldest first).

