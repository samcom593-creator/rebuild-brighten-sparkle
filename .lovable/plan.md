

# Revamp Aged Lead Email with Performance Stats and Click Tracking

## Overview

Three changes:
1. Redesign the aged lead email to highlight real performance stats ($20K+ production, $10K+ deposits) as social proof
2. Track CTA button clicks and notify the admin via email when a lead clicks "Reapply"
3. Confirm abandoned application notifications are working

---

## 1. Redesign the Email (High-Converting with Stats)

**Files: `supabase/functions/send-aged-lead-email/index.ts` and `src/components/dashboard/AgedLeadEmailPreview.tsx`**

The email will be completely rewritten with:

- **Subject line**: "We've Grown Since You Applied -- See What's Changed"
- **Hero stat block**: Two bold stats side by side:
  - "Every agent produced $20,000+ last month"
  - "Every agent deposited $10,000+ last month"
- **Personalized opener**: "Hey [Name], you applied to Apex Financial before. A lot has changed since then -- and the results speak for themselves."
- **Bullet benefits** (kept but reordered for impact):
  - Every active agent produced $20K+ last month
  - Every agent deposited over $10K last month
  - Start at 70% commission (up to 145%)
  - Unlimited warm leads provided daily
  - Complete training + mentorship included
  - No cold calling, work from anywhere
- **CTA button**: "REAPPLY NOW" -- links to a tracking URL (see section 2) that redirects to `/apply`
- **Urgency line**: "We're only accepting a limited number of new agents this month."
- **Footer**: "Powered by Apex Financial"

The `AgedLeadEmailPreview.tsx` component will be updated to match the new email design exactly, plus the updated subject line.

---

## 2. Track CTA Clicks and Notify Admin

**New edge function: `supabase/functions/track-email-click/index.ts`**

This function handles the CTA redirect flow:
1. Lead clicks "REAPPLY NOW" in the email
2. The link points to the edge function URL with query params: `?email=lead@email.com&name=FirstName&source=aged_lead_email`
3. The function:
   - Logs the click in the `email_tracking` table (creates a record or updates existing)
   - Sends an instant notification email to `info@apex-financial.org` with the lead's name, email, and phone (fetched from `aged_leads` table)
   - Redirects the user to `https://apex-financial.org/apply` with a `302` response

The notification email to the admin will include:
- Lead name and contact info
- "This lead clicked 'Reapply' from the aged lead outreach email"
- Direct links to call/email the lead

**Email link format in `send-aged-lead-email`**:
```
https://<project-id>.supabase.co/functions/v1/track-email-click?email={email}&name={firstName}&source=aged_lead
```

**Config update**: Add to `supabase/config.toml`:
```toml
[functions.track-email-click]
verify_jwt = false
```

---

## 3. Abandoned Application Notifications

The `check-abandoned-applications` edge function is already fully implemented. It:
- Finds partial applications older than 15 minutes that were not completed or already notified
- Sends a detailed email to `info@apex-financial.org` with the lead's name, email, phone, location, and step progress
- Marks them as notified to prevent duplicates

This function needs to be invoked on a schedule (via cron or manual trigger). It is already deployed and functional -- no code changes needed here.

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/send-aged-lead-email/index.ts` | Complete email redesign with stats, new subject, tracking CTA link |
| `supabase/functions/track-email-click/index.ts` | **New** -- handles click tracking, admin notification, and redirect |
| `src/components/dashboard/AgedLeadEmailPreview.tsx` | Update preview to match redesigned email |
| `supabase/config.toml` | Add `verify_jwt = false` for `track-email-click` |

## Technical Details

- The click tracking uses a redirect-based approach (no JavaScript required in email) -- the CTA href points to the edge function which logs the click and issues a 302 redirect to `/apply`
- Admin notification emails are sent from `APEX Alerts <alerts@apex-financial.org>` for consistency
- The `email_tracking` table already exists and will be reused for click tracking with `email_type = 'aged_lead_click'`
- No database migration needed -- all existing tables support this flow
