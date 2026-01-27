
# Fix Apex Daily Numbers Link - Complete Solution

## Root Cause Analysis

The link isn't working because:
1. **The site hasn't been published** - Your code changes only exist in preview mode
2. **Users are being sent to the wrong URL** - The published site still has old code without the `/apex-daily-numbers` route
3. **Edge functions have hardcoded Lovable URLs** - 15+ email templates use `rebuild-brighten-sparkle.lovable.app` instead of your custom domain

## What Users See Now vs What They Should See

| Currently | After Fix |
|-----------|-----------|
| Clicking link → redirects to homepage or random page | Clicking link → Apex branded login page |
| See "lovable.app" in URLs | See "apex-financial.org" everywhere |
| Emails link to Lovable URL | Emails link to apex-financial.org |

## Solution - 3 Parts

### Part 1: Publish the Site (Required!)
The `/apex-daily-numbers` route and `/agent-login` page only exist in preview. You MUST click **Publish** to make them live on your custom domain.

### Part 2: Update All Edge Functions to Use Custom Domain
Replace all instances of `rebuild-brighten-sparkle.lovable.app` with `apex-financial.org` in these files:

| Edge Function File | What It Does |
|-------------------|--------------|
| `send-followup-emails` | Follow-up emails to applicants |
| `test-email-flows` | Test email system |
| `notify-missed-dialer` | Missed call notifications |
| `send-agent-portal-login` | Agent portal login emails |
| `notify-lead-closed` | Lead closed notifications |
| `notify-top-performers-morning` | Morning performance emails |
| `send-aged-lead-email` | Aged lead outreach |
| `submit-application` | Application confirmation emails |
| `notify-daily-summary` | Daily summary emails |
| `check-abandoned-applications` | Abandoned application alerts |
| `send-abandoned-followup` | Abandoned follow-up emails |
| `notify-monthly-leaderboard` | Monthly leaderboard emails |
| `notify-manager-referral` | Manager referral notifications |
| + more... | |

### Part 3: Share the Correct Link
You need to share the FULL URL, not just the path:

**Correct Link to Share:**
```
https://apex-financial.org/apex-daily-numbers
```

**NOT:**
```
/apex-daily-numbers
apex-daily-numbers
```

## Technical Changes

### Files to Update (Edge Functions)
All edge function files that contain `rebuild-brighten-sparkle.lovable.app` will be updated to use `apex-financial.org`:

```text
supabase/functions/send-followup-emails/index.ts
supabase/functions/test-email-flows/index.ts
supabase/functions/notify-missed-dialer/index.ts
supabase/functions/send-agent-portal-login/index.ts
supabase/functions/notify-lead-closed/index.ts
supabase/functions/notify-top-performers-morning/index.ts
supabase/functions/send-aged-lead-email/index.ts
supabase/functions/submit-application/index.ts
supabase/functions/notify-daily-summary/index.ts
supabase/functions/check-abandoned-applications/index.ts
supabase/functions/send-abandoned-followup/index.ts
supabase/functions/notify-monthly-leaderboard/index.ts
supabase/functions/notify-manager-referral/index.ts
supabase/functions/notify-all-managers-leaderboard/index.ts
supabase/functions/welcome-new-agent/index.ts
```

### URL Updates
| Old URL | New URL |
|---------|---------|
| `https://rebuild-brighten-sparkle.lovable.app` | `https://apex-financial.org` |
| `https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants` | `https://apex-financial.org/dashboard/applicants` |
| `https://rebuild-brighten-sparkle.lovable.app/agent-portal` | `https://apex-financial.org/agent-portal` |
| `https://rebuild-brighten-sparkle.lovable.app/log-numbers` | `https://apex-financial.org/apex-daily-numbers` |
| `https://rebuild-brighten-sparkle.lovable.app/apply` | `https://apex-financial.org/apply` |

## After Implementation

1. All edge functions will use `apex-financial.org` - no more Lovable URLs
2. You **MUST publish the site** for changes to go live
3. Share this exact link with agents: **`https://apex-financial.org/apex-daily-numbers`**
4. They will see the branded Apex login page, log in, and be able to enter their numbers
