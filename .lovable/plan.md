

# Add "Send Follow-Up Email" Button to Call Summary

## Overview
After a call is transcribed and the AI summary is displayed, add a "Send Follow-Up Email" button directly in the summary panel. This lets you send a personalized follow-up email (with a calendar/scheduling link) to the lead with one click -- right from the AI summary results.

## What Changes

### 1. Add Follow-Up Email Button to Voice Recorder Summary (`src/components/callcenter/CallCenterVoiceRecorder.tsx`)

After the AI summary's "Recommendation" and "Brief Summary" sections (around line 441), add a new section:

- A "Send Follow-Up Email" button (Mail icon, primary color)
- When clicked, it calls a new `onSendFollowUp` callback prop
- The button shows a loading state while sending and a success checkmark after
- Optionally include a small text input for a custom calendar link (pre-filled with the default Calendly URL)

### 2. Wire Up the Callback in Lead Card (`src/components/callcenter/CallCenterLeadCard.tsx`)

- Pass a new `onSendFollowUp` prop through the `CallCenterVoiceRecorder`
- The lead card already has access to the lead's email, name, and license status -- it will pass these to the callback

### 3. Handle Follow-Up Email Sending in CallCenter.tsx (`src/pages/CallCenter.tsx`)

- Add a `handleSendFollowUp` function that calls the existing `send-post-call-followup` edge function with `actionType: "contacted"` and the optional calendar link
- Pass it down through `CallCenterLeadCard` to `CallCenterVoiceRecorder`
- Show a toast on success ("Follow-up email sent!")

## Technical Details

**CallCenterVoiceRecorder.tsx** -- New prop + UI:
- Add `onSendFollowUp?: (calendarLink?: string) => Promise<void>` to props
- Add `sendingFollowUp` and `followUpSent` state booleans
- Add a button after the recommendation section that triggers the callback
- Include a collapsible input for custom calendar link

**CallCenterLeadCard.tsx** -- Pass-through prop:
- Add `onSendFollowUp?: () => Promise<void>` to `CallCenterLeadCardProps`
- Forward it to `CallCenterVoiceRecorder`

**CallCenter.tsx** -- Handler:
- Create `handleSendFollowUp` using existing `sendFollowUpEmail` with `actionType: "contacted"`
- Pass to `CallCenterLeadCard`

## Existing Infrastructure Used
The `send-post-call-followup` edge function already supports:
- `actionType: "contacted"` for follow-up emails
- `calendarLink` parameter for custom scheduling URLs
- Automatic CC to admin and manager
- License-status-aware email content (different templates for licensed vs unlicensed)

No edge function changes needed -- this is purely a UI addition.

## Files to Modify
- `src/components/callcenter/CallCenterVoiceRecorder.tsx` -- Add button UI after summary
- `src/components/callcenter/CallCenterLeadCard.tsx` -- Pass through callback prop
- `src/pages/CallCenter.tsx` -- Create handler and wire it up
