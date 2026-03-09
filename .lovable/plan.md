

# Problem: Emails Not Sending — Domain Not Verified

## Root Cause Found

The edge function logs show a clear **403 error from Resend**:

```
"The tx.apex-financial.org domain is not verified. Please, add and verify your domain on https://resend.com/domains"
```

All your edge functions are trying to send from `notifications@tx.apex-financial.org`, but **this domain is not configured or verified in Resend**. Every email fails silently.

## Secondary Bug Found

In `notify-agent-live-field/index.ts`, there's a code ordering bug:
- Line 156 uses `adminEmail` **before** it's declared on line 176
- This causes a runtime reference error, breaking the function entirely

---

## Fix Plan

### Step 1: Verify the `tx.apex-financial.org` Domain in Resend

You need to verify this subdomain in the Resend dashboard:

1. Go to [Resend Domains](https://resend.com/domains)
2. Add `tx.apex-financial.org` as a new domain
3. Configure the DNS records Resend provides (SPF, DKIM, DMARC)
4. Wait for DNS propagation (can take 5-60 minutes)
5. Click "Verify" in Resend once records are live

This is the **only** fix for the 403 errors — no code change will help until the domain is verified.

### Step 2: Fix the Bug in `notify-agent-live-field`

Move the `adminEmail` declaration **before** it's used:

**File:** `supabase/functions/notify-agent-live-field/index.ts`

Move `const adminEmail = "sam@apex-financial.org";` to the top of the function (around line 50), so it's defined before being used in the CC list (line 156).

---

## Summary

| Issue | Cause | Fix |
|-------|-------|-----|
| All emails failing | `tx.apex-financial.org` not verified in Resend | Verify domain in Resend dashboard |
| `notify-agent-live-field` crashes | `adminEmail` used before declaration | Move declaration to top of function |

Once the domain is verified, all existing CC logic will work correctly.

