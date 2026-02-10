
# Fix All Email Templates for Mobile

## The Problem

Multiple email templates have content overflowing on mobile devices. The root causes are:

1. **Fixed-width tables**: `send-manual-followup` and `send-followup-emails` use `width="600"` on inner tables -- these don't shrink on mobile screens
2. **Oversized button padding**: CTA buttons with `padding: 18px 52px` overflow narrow screens
3. **No word-break rules**: Long email addresses and URLs can force horizontal scrolling
4. **Tracking URL bug in `send-aged-lead-email`**: The template uses `\${trackingClickUrl}` (escaped dollar sign) which outputs the literal text `${trackingClickUrl}` instead of the actual URL -- so tracking links and the CTA button are broken

## Fixes Per File

### 1. `supabase/functions/send-aged-lead-email/index.ts`
- **Fix tracking URL bug**: Change `\${trackingClickUrl}` to `${trackingClickUrl}` and `\${trackingPixelUrl}` to `${trackingPixelUrl}` (remove backslash escapes)
- **Mobile-safe CTA button**: Reduce padding from `18px 52px` to `16px 32px`, add `max-width: 100%; box-sizing: border-box;`
- **Stats block**: Add `font-size: 22px` instead of `28px` for stat numbers on the mobile-friendly side
- **Add word-break**: `word-break: break-word;` on the outer body/container

### 2. `supabase/functions/send-manual-followup/index.ts`
- **Replace fixed `width="600"` tables** with `width="100%" style="max-width:600px;"` -- this is the main cause of overflow
- Both licensed and unlicensed templates have this issue (lines 117-131 and 140-155)

### 3. `supabase/functions/send-followup-emails/index.ts`
- The `sendUnlicensedFollowup` and `sendUnlicensedFollowup2` and `sendLicensedFollowup` functions all use `max-width: 600px` divs which are fine
- But the button padding `16px 32px` can still overflow on very narrow screens -- add `max-width: 100%; box-sizing: border-box;` to all CTA anchor tags

### 4. `supabase/functions/send-post-call-followup/index.ts`
- Uses `max-width: 600px` div which is good
- CTA buttons need `max-width: 100%; box-sizing: border-box;` for safety
- The inline resource cards (Watch Video, View Guide, Start Course) have fixed padding that could overflow -- make them stack-friendly

### 5. `supabase/functions/send-abandoned-followup/index.ts`
- Uses `max-width: 600px` div which is good
- Two CTA buttons side-by-side could overflow -- add `max-width: 100%; box-sizing: border-box;`

### 6. `supabase/functions/send-outreach-email/index.ts`
- All templates use `max-width: 600px` divs, which is good
- Button padding `16px 32px` is safe but add `max-width: 100%; box-sizing: border-box;` for consistency

### 7. `supabase/functions/notify-lead-assigned/index.ts`
- Uses `max-width: 600px` div, which is good
- The "View Lead & Call Now" button has `14px 28px` which is fine
- Add word-break for long email/name values in the lead info table

### 8. `src/components/dashboard/AgedLeadEmailPreview.tsx`
- Sync the preview template to match the fixed `send-aged-lead-email` template (with working CTA link, correct stats, mobile-safe padding)

## Universal Mobile-Safe Pattern Applied to All Templates

Every email template will get these additions:
- `word-break: break-word;` on the body or outer container
- All CTA buttons: `max-width: 100%; box-sizing: border-box;` to prevent overflow
- No fixed `width="600"` tables -- always `width="100%" style="max-width:600px;"`
- Button padding capped at `16px 32px` maximum

## Files to Modify

| File | Key Fix |
|------|---------|
| `supabase/functions/send-aged-lead-email/index.ts` | Fix broken tracking URLs (backslash escape bug), mobile-safe buttons |
| `supabase/functions/send-manual-followup/index.ts` | Replace fixed `width="600"` tables with responsive `max-width:600px` |
| `supabase/functions/send-followup-emails/index.ts` | Add `max-width:100%` to all CTA buttons |
| `supabase/functions/send-post-call-followup/index.ts` | Mobile-safe resource cards and buttons |
| `supabase/functions/send-abandoned-followup/index.ts` | Mobile-safe CTA buttons |
| `supabase/functions/send-outreach-email/index.ts` | Add `max-width:100%` to all CTA buttons |
| `supabase/functions/notify-lead-assigned/index.ts` | Add word-break for long values |
| `src/components/dashboard/AgedLeadEmailPreview.tsx` | Sync preview with fixed template |
