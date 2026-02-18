

# Fix: Email Buttons Not Working (Deploy Failures + Mobile Button Layout)

## Root Causes

### Issue 1: Edge functions fail to deploy (bundle timeout)
`send-outreach-email/index.ts` and `send-post-call-followup/index.ts` use `esm.sh` imports for `@supabase/supabase-js` and `resend`. This causes "Bundle generation timed out" errors, meaning these functions never deploy successfully. When someone taps the graduation hat button or QuickEmailMenu send button, the function call silently fails because no deployed function exists to handle it.

### Issue 2: Email CTA buttons untappable on mobile
All 11 outreach email templates use `<div>` wrappers with `display:inline-block` for CTA buttons. Many mobile email clients (Gmail app, Outlook, Apple Mail) do not reliably render these -- recipients tap the button and nothing happens. Per the project's established standard, all email buttons must use table-based layout with `display:block`.

---

## Fix Plan

### Step 1: Fix `send-outreach-email/index.ts` imports
Change lines 2-3 from `esm.sh` to `npm:` specifiers so the function deploys successfully:
- `import { createClient } from "npm:@supabase/supabase-js@2";`
- `import { Resend } from "npm:resend@2.0.0";`

### Step 2: Fix `send-post-call-followup/index.ts` imports
Same change -- line 2 from `esm.sh` to `npm:` specifier.

### Step 3: Fix `send-licensing-instructions/index.ts` imports
Line 2 uses `esm.sh` for Resend initialization at top level -- standardize to `npm:`.

### Step 4: Convert all 11 email template CTA buttons to table-based layout
Replace every `<div style="text-align:center"><a style="display:inline-block...">` pattern with:
```html
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr>
    <td align="center" style="padding:32px 0;">
      <a href="..." style="display:block;background:...;color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;text-align:center;max-width:100%;box-sizing:border-box;">
        Button Text
      </a>
    </td>
  </tr>
</table>
```

This affects all 11 templates in `send-outreach-email`: cold_licensed, cold_unlicensed, followup1_licensed, followup2_licensed, followup1_unlicensed, followup2_unlicensed, licensing_reminder, licensing_checkin, course_help, schedule_consultation, and couldnt_reach_you.

### Step 5: Verify all Calendly links are correct
Current links found in templates:
- `calendly.com/apexlifeadvisors/15-minute-discovery` (licensed templates)
- `calendly.com/apexlifeadvisors/15min` (cold unlicensed + couldnt_reach_you)
- `calendly.com/sam-com593/licensed-prospect-call-clone` (unlicensed followups, licensing, course, schedule)
- `calendly.com/apexfinancialmarketing/apex-financial-onboarding` (licensed welcome in send-licensing-instructions)
- `calendly.com/apexfinancialmarketing/apex-interview` (unlicensed welcome in send-licensing-instructions)

All links will be preserved as-is (they are working Calendly links).

---

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/send-outreach-email/index.ts` | Fix `esm.sh` to `npm:` imports; convert all 11 template CTA buttons from `div/inline-block` to `table/block` layout |
| `supabase/functions/send-post-call-followup/index.ts` | Fix `esm.sh` to `npm:` import for supabase |
| `supabase/functions/send-licensing-instructions/index.ts` | Already uses `npm:` for Resend -- no change needed |

## Expected Result
- Graduation hat button and QuickEmailMenu will successfully send emails (functions will deploy)
- All CTA buttons in received emails will be tappable on every mobile email client
- All Calendly and resource links will work correctly
