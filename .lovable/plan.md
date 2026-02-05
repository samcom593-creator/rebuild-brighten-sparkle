

## Fix: Aged Lead Email Not Sending

### Problem Identified

The `send-aged-lead-email` edge function is failing with the error:

> **"The updates.apexlifeadvisors.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"**

This means the email sender address `team@updates.apexlifeadvisors.com` cannot be used until the domain is verified in your Resend account.

---

## Two Options to Fix This

### Option A: Verify the Domain in Resend (Recommended)

1. Log into your Resend dashboard at https://resend.com/domains
2. Add and verify `updates.apexlifeadvisors.com`
3. Follow the DNS verification steps Resend provides
4. Once verified, emails will start working automatically

No code changes needed if you verify the domain.

---

### Option B: Change the Sender Domain to an Already-Verified One

If you have another verified domain (like `apexlifeadvisors.com` without the subdomain, or a different sending domain), I can update the edge function to use that instead.

**File to update:** `supabase/functions/send-aged-lead-email/index.ts`

Change line 116 from:
```typescript
from: "Apex Financial <team@updates.apexlifeadvisors.com>",
```

To use a verified domain, for example:
```typescript
from: "Apex Financial <team@apex-financial.org>",
```
or
```typescript
from: "Apex Financial <noreply@apexlifeadvisors.com>",
```

---

## Additionally: Fix the React Ref Warning (Minor)

The console shows a warning about refs on `AgedLeadImporter`. While this doesn't break functionality, I'll fix it by wrapping the component with `forwardRef` to eliminate the warning.

**File:** `src/components/dashboard/AgedLeadImporter.tsx`

---

## Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Emails not sending | Unverified sender domain in Resend | Verify domain OR change to verified domain |
| React ref warning | Dialog passing ref to function component | Add `forwardRef` wrapper |

**Which domain would you like me to use for sending aged lead emails?** Or would you prefer to verify the `updates.apexlifeadvisors.com` domain in Resend?

