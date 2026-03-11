

# Fix: Admin CC Emails Not Delivering

## Root Cause

The backend logs confirm Resend **accepts** every email (returns success IDs like `ef02ad29...`). However, Resend can accept requests but silently fail to deliver if the sending domain (`notifications@apex-financial.org`) isn't fully verified in the Resend dashboard.

The code is correct — `sam@apex-financial.org` is set as the `to` recipient on admin notifications and as `cc` on applicant confirmations. This is a **Resend configuration issue**, not a code issue.

## Required Action (Manual — Outside Lovable)

You need to check your **Resend dashboard** (https://resend.com/domains):

1. **Verify Domain Status**: Confirm `apex-financial.org` shows as "Verified" under Domains. If it shows "Pending" or has warnings, the DNS records (SPF, DKIM, DMARC) need to be added/fixed at your domain registrar.

2. **Check API Key Scope**: Under API Keys, confirm your `RESEND_API_KEY` is scoped to `apex-financial.org` (not a different domain or "all domains" with restrictions).

3. **Send a Test Email**: Use Resend's dashboard "Send Test Email" feature to `sam@apex-financial.org` from `notifications@apex-financial.org`. If this fails, the domain isn't properly verified.

4. **Check Spam/Junk**: The emails may be landing in your spam folder at `sam@apex-financial.org`.

## What I Can Do (Code Side)

If the Resend domain is verified and emails still aren't arriving, I can:
- Add the admin as a direct `to` recipient (not just CC) on the applicant confirmation email as a fallback
- Add detailed delivery logging that captures Resend's full response including any warnings
- Set up the Lovable email domain system for `apex-financial.org` which handles verification automatically

## No Code Changes Needed Yet

The email-sending code is correctly implemented. The fix is in your Resend dashboard configuration.

