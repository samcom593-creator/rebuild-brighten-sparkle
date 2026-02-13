

# Auto-Send "We Tried Calling You" Email on No Pickup + Mobile UX Improvements

## Overview
Two changes: (1) Automatically send a "we tried to call you" email when a lead is marked as "No Pickup", and (2) Improve the Call Center mobile experience for hands-free/driving use.

---

## Part 1: Auto-Send Email on No Pickup

### Edge Function: `send-post-call-followup/index.ts`
Add a new `actionType: "no_pickup"` template to the existing edge function. This email will:
- Let the lead know "We tried to reach you"
- Include a Calendly link so they can call back at their convenience
- Follow the existing Apex branding and mobile-responsive email standards
- CC admin + manager per the system-wide CC policy

Add to the existing `subjectLines` and `greetingLines` maps:
```
no_pickup: "We Tried Reaching You, {firstName}! 📞"
```

Add a new email body section for `no_pickup` that says something like:
- "Hey {firstName}, we just tried giving you a call but couldn't get through!"
- "We'd love to connect with you about the opportunity at Apex Financial."
- "Book a time that works for you" with Calendly CTA button

### Frontend: `src/pages/CallCenter.tsx`
In the `executeAction` function (around line 401), where it currently handles `no_pickup`:
- Add a call to `sendFollowUpEmail(currentLead, "no_pickup")` so the email fires automatically
- Update the toast message to: "Marked as no pickup - follow-up email sent!"

---

## Part 2: Mobile UX Improvements for Call Center

### Goal
Make the Call Center usable while driving -- bigger tap targets, less scrolling, key info visible at a glance.

### File: `src/pages/CallCenter.tsx` (active calling layout)
- Reduce padding on mobile: `p-2 md:p-8` instead of `p-4 md:p-8`
- Tighten the header spacing on mobile

### File: `src/components/callcenter/CallCenterLeadCard.tsx`
- Reduce inner padding on mobile: `p-4 md:p-6` on header and body sections
- Make the phone "CALL NOW" button larger on mobile (min-height 60px) for easy tapping while driving
- Hide the Stage Selector on small screens (it's a detailed control not needed while driving) -- show it only on `md:` and above
- Collapse the applicant details section on mobile (keep it but make it a collapsible/accordion)
- Make the name text size responsive: `text-xl md:text-2xl`

### File: `src/components/callcenter/CallCenterActions.tsx`
- Increase button heights on mobile: primary actions `h-24 md:h-20`, secondary actions `h-20 md:h-16` -- bigger tap targets for driving
- Increase icon sizes on mobile for better visibility
- Hide keyboard hint section on mobile (already hidden via `hidden sm:block`)

---

## Files to Modify

1. **`supabase/functions/send-post-call-followup/index.ts`** -- Add `no_pickup` email template
2. **`src/pages/CallCenter.tsx`** -- Trigger email on no_pickup action + mobile padding
3. **`src/components/callcenter/CallCenterLeadCard.tsx`** -- Mobile-optimized layout with bigger call button
4. **`src/components/callcenter/CallCenterActions.tsx`** -- Bigger tap targets on mobile

