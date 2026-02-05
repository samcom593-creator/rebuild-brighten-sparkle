
# Plan: Email Flows Verification + "Resend Licensing Instructions" Button

## Status: ✅ COMPLETED

### Implemented

1. **New Edge Function**: `send-licensing-instructions` - Sends licensing/onboarding emails on demand
   - Licensed: Calendly link + onboarding steps
   - Unlicensed: 3-step guide (video, doc, course link) + "we cover costs" messaging

2. **ResendLicensingButton Component**: Added to Call Center for quick resends
   - Shows graduation cap icon
   - Tooltip explains what it does
   - Success/loading states

3. **Call Center Integration**: Button appears next to QuickEmailMenu for unlicensed leads

### Email Domain
Using verified domain: `apex-financial.org`

