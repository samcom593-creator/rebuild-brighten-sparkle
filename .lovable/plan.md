

# Fix: Email Sender Domain Mismatch

## Problem
Resend has `apex-financial.org` verified, but all edge functions send from `notifications@tx.apex-financial.org`. Resend treats subdomains separately — `tx.apex-financial.org` is NOT verified, causing 403 errors on every email.

## Recommended Fix: Option 2 — Update All Edge Functions

Change the `from` address in every edge function from:
```
"APEX Financial <notifications@tx.apex-financial.org>"
```
to:
```
"APEX Financial <notifications@apex-financial.org>"
```

This uses the domain already verified in Resend and requires no DNS changes.

## Files to Update (~60+ edge functions)

Every file under `supabase/functions/` that contains `tx.apex-financial.org` needs the `from` field updated. A search-and-replace of `tx.apex-financial.org` → `apex-financial.org` across all edge functions.

## Alternative: Option 1
If you prefer keeping the `tx.` subdomain (e.g., to separate transactional emails from other mail), you'd need to add `tx.apex-financial.org` as a new domain in Resend and verify its DNS records separately. No code changes needed in that case.

