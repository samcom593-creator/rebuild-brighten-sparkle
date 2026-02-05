
# Plan: Email Flows Verification + "Resend Licensing Instructions" Button

## Summary

This plan addresses three issues:
1. **Applicant emails not being received** after applying - verify the submit-application email flow
2. **Proper licensing instruction emails** for licensed vs unlicensed applicants
3. **Add "Resend Licensing Instructions" button** to Call Center and Pipeline for quick resends

---

## Issue Analysis

### Current Email Flow After Application Submit

The `submit-application` edge function at lines 906-909 calls `sendEmailNotifications()` which:
- **Admin notification** - Sent to `info@apex-financial.org`
- **Applicant confirmation** - Sent with conditional content:
  - **Licensed applicants** (lines 516-589): Get Calendly link, testimonials video, onboarding steps
  - **Unlicensed applicants** (lines 591-680): Get 3-step licensing guide:
    1. Video: `https://youtu.be/i1e5p-GEfAU`
    2. Doc: `https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg`
    3. Course: `https://partners.xcelsolutions.com/afe`

**Potential Issue**: The edge function is using the correct Resend setup, but there's no dedicated "send licensing instructions" template that can be resent on demand.

### What's Needed

1. **New "Send Licensing Instructions" template** - A dedicated email template specifically for resending licensing resources
2. **Quick access button** - "Resend Licensing" button in Call Center and Pipeline
3. **Verification** - Ensure the existing application email is working (deploy check)

---

## Solution Design

### 1. Create New Edge Function: `send-licensing-instructions`

A dedicated function to resend the comprehensive licensing email with:
- YouTube video link
- Google Doc licensing guide
- Pre-licensing course link
- Clear step-by-step instructions

This mirrors the unlicensed applicant welcome email but can be triggered on demand.

### 2. Add "Resend Licensing" Button Component

Create a reusable `ResendLicensingButton` component that:
- Shows only for unlicensed leads
- Calls the `send-licensing-instructions` edge function
- Shows loading/success/error states
- Has tooltip explaining what it does

### 3. Integrate into Call Center & Pipeline

| Location | Component to Modify |
|----------|---------------------|
| Call Center | `CallCenterLeadCard.tsx` - Add button next to Email menu |
| CRM/Pipeline | `DashboardCRM.tsx` or applicant row actions |

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `supabase/functions/send-licensing-instructions/index.ts` | Edge function to send licensing email |
| `src/components/callcenter/ResendLicensingButton.tsx` | Reusable button component |

### Modified Files

| File | Changes |
|------|---------|
| `supabase/config.toml` | Register `send-licensing-instructions` function |
| `src/components/callcenter/CallCenterLeadCard.tsx` | Add ResendLicensingButton for unlicensed leads |
| `src/components/callcenter/index.ts` | Export new component |

---

## Technical Implementation

### Edge Function: `send-licensing-instructions`

```typescript
interface LicensingEmailRequest {
  email: string;
  firstName: string;
  licenseStatus: "licensed" | "unlicensed" | "pending";
}

// For unlicensed leads:
// - YouTube video: How to get licensed
// - Google Doc: Step-by-step licensing guide
// - Xcel Solutions course link
// - "We cover the costs" messaging

// For licensed leads:
// - Calendly link for onboarding call
// - Testimonials video
// - Next steps for getting started
```

### Button Component Logic

```typescript
interface ResendLicensingButtonProps {
  recipientEmail: string;
  recipientName: string;
  licenseStatus: "licensed" | "unlicensed" | "pending";
}

// Only show for unlicensed/pending leads
// Loading spinner while sending
// Toast notification on success/failure
```

### Call Center Integration

In `CallCenterLeadCard.tsx`, add the button next to the existing Email menu:

```typescript
<div className="flex items-center gap-2 shrink-0">
  {/* Existing QuickEmailMenu */}
  <QuickEmailMenu ... />
  
  {/* New: Resend Licensing for unlicensed leads */}
  {lead.licenseStatus !== "licensed" && (
    <ResendLicensingButton
      recipientEmail={lead.email}
      recipientName={lead.firstName}
      licenseStatus={lead.licenseStatus}
    />
  )}
  
  {/* Existing Admin Reassign */}
  {isAdmin && <LeadReassignButton ... />}
</div>
```

---

## Email Content for Licensing Instructions

### Subject Line
"Your Licensing Resources – Let's Get You Started! 🚀"

### Email Body Structure
1. **Header**: APEX Financial branding
2. **Greeting**: Personalized with first name
3. **Intro**: "Here are the resources you need to get your life insurance license"
4. **Step 1**: Watch the licensing overview video (YouTube embed/link)
5. **Step 2**: Review the licensing guide (Google Doc link)
6. **Step 3**: Start the pre-licensing course (Xcel Solutions link)
7. **Benefits box**: "We cover licensing costs", "Takes about 7 days", "Full support"
8. **CTA**: Schedule a help call (Calendly)
9. **Footer**: Powered by Apex Financial

---

## Verification Steps

After implementation:
1. **Test application flow**: Submit a test application and verify email is received
2. **Test resend button**: Click "Resend Licensing" in Call Center and verify email arrives
3. **Check edge function logs**: Verify no errors in `send-licensing-instructions` logs
4. **Test both license types**: Ensure licensed leads get appropriate content vs unlicensed

---

## Summary of Changes

| Category | Action |
|----------|--------|
| **New Edge Function** | `send-licensing-instructions` - Dedicated licensing email resend |
| **New Component** | `ResendLicensingButton` - One-click licensing email resend |
| **Call Center** | Add resend button for unlicensed leads |
| **Email Templates** | Comprehensive 3-step licensing guide with video, doc, and course links |
| **Deploy** | Register and deploy new edge function |

This ensures applicants always have access to licensing resources, whether through the initial application email or through manual resends from the Call Center.
