
# Plan: Add "Couldn't Reach You" Pre-Call Email Template

## Summary

Add a new email template for when you try to call a lead but their phone number doesn't work. This will be available in both the Call Center and Pipeline (QuickEmailMenu).

---

## New Email Template Details

### Template ID
`couldnt_reach_you`

### Label
"Couldn't Reach You"

### Subject Line
"We tried to call you! 📞"

### Email Content
- Friendly message explaining that you tried to reach them but the call didn't go through
- Ask them to confirm/update their contact info
- Provide Calendly link so they can schedule at their convenience
- Keep the Apex branding consistent with other emails

---

## Files to Modify

### 1. `src/components/dashboard/QuickEmailMenu.tsx`

**Changes:**
- Add `"couldnt_reach_you"` to the `EmailTemplate` type union
- Add label: `"Couldn't Reach You"`
- Add preview content for the template in `getEmailContent()`
- Add to contextual templates (shown for both licensed and unlicensed leads)

**Code Changes:**
```typescript
// Line 26-36: Add to EmailTemplate type
type EmailTemplate = 
  | "cold_licensed" 
  | ...
  | "couldnt_reach_you";  // NEW

// Line 38-49: Add label
const emailTemplateLabels: Record<EmailTemplate, string> = {
  ...
  couldnt_reach_you: "Couldn't Reach You",
};

// Line 52-99: Add preview content
couldnt_reach_you: {
  subject: `${firstName}, We Tried to Call You!`,
  html: `...preview HTML...`,
},

// Lines 155-157: Add to contextual templates for BOTH license statuses
```

### 2. `supabase/functions/send-outreach-email/index.ts`

**Changes:**
- Add `couldnt_reach_you` template to the `emailTemplates` object
- Professional HTML email with:
  - "We tried to reach you but couldn't get through"
  - Request to update contact info or reply with best number
  - Calendly link for scheduling a call
  - Consistent Apex branding

**Email Content:**
```text
Subject: We tried to call you! 📞

Hey [Name]!

We tried reaching out to you today about the opportunity at Apex Financial, 
but we couldn't get through to your number.

No worries—we still want to connect! Here's what you can do:

✓ Reply to this email with your best phone number
✓ Or schedule a time that works for you: [Schedule a Call button]

We're excited to chat with you about how you can start building 
a high-income career in financial services.

Talk soon,
Apex Financial Team
```

---

## Visual Preview (Call Center / Pipeline)

The new template will appear in the Email dropdown menu:

```text
┌────────────────────────────────────┐
│ Quick Email Templates              │
├────────────────────────────────────┤
│ 👁️ Cold Outreach (Unlicensed)      │
│ 👁️ Licensing Progress Check        │
│ 👁️ Opportunity Reminder            │
│ 👁️ Couldn't Reach You          ← NEW│
│ 👁️ License Reminder                │
│ 👁️ Check-in (Need Help?)           │
├────────────────────────────────────┤
│ ▼ Show all templates               │
└────────────────────────────────────┘
```

---

## Template Placement

**For Unlicensed Leads:**
- Cold Outreach (Unlicensed)
- Licensing Progress Check
- Opportunity Reminder
- **Couldn't Reach You** ← New
- License Reminder
- Check-in (Need Help?)

**For Licensed Leads:**
- Cold Outreach (Licensed)
- Post-call Follow-up #1
- Post-call Follow-up #2
- **Couldn't Reach You** ← New

This template is relevant for BOTH licensed and unlicensed leads since phone issues can happen regardless of license status.

---

## Implementation Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/QuickEmailMenu.tsx` | Add template type, label, preview content, and add to contextual templates |
| `supabase/functions/send-outreach-email/index.ts` | Add full HTML email template for backend sending |

---

## Expected Outcome

After implementation:
1. New "Couldn't Reach You" option appears in Email dropdown (Call Center + Pipeline)
2. Clicking it opens preview modal with editable subject/body
3. Email sent has consistent Apex branding
4. Works for both licensed and unlicensed leads
