

# Fix: Increase Rate Limit Delay for Bulk Outreach Emails

## What Happened
- **Manager Daily Digest**: Sent successfully (5 emails to managers).
- **Bulk Unlicensed Outreach**: Hit Resend's rate limit (max 2 requests/second). The current 300ms delay between emails is too fast. Some emails were sent before rate limiting kicked in, but most failed.

## Fix
Update `supabase/functions/send-bulk-unlicensed-outreach/index.ts`:
- Increase the delay between emails from **300ms to 600ms** (stays under 2 req/sec limit)
- Redeploy the function
- Re-trigger to send emails to all remaining unlicensed applicants

## File Changed
| File | Change |
|------|--------|
| `supabase/functions/send-bulk-unlicensed-outreach/index.ts` | Change `setTimeout` delay from 300 to 600 |

After deploying, the function will be re-invoked to send all the outreach emails successfully.
