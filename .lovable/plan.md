

# Fix Manager Email CC + Add Status Change Button in Call Center

## Problem 1: Emails Not Going to Manager
The `send-post-call-followup` edge function already has a `getManagerEmail` helper and CC logic (line 84-89), but the Call Center **never passes `agentId`** to it. Without `agentId`, the manager email lookup is skipped and only the admin gets CC'd.

**Fix**: Pass the current user's `agentId` in the `sendFollowUpEmail` call body. The `agentId` is already available in `CallCenter.tsx` state.

### File: `src/pages/CallCenter.tsx`
- Update `sendFollowUpEmail` to include `agentId` in the request body to `send-post-call-followup`
- Also pass `agentId` in the `send-licensing-instructions` and `notify-hire-announcement` calls where applicable

## Problem 2: No Status Change Button in Call Center
Currently the Call Center card has action buttons (Hired, Contracted, Not a Fit, No Pickup) but no way to manually set a recruit's status to other values like "contacted", "reviewing", etc.

**Fix**: Add a status selector dropdown to the `CallCenterLeadCard` that lets you change the application/aged_lead status directly.

### File: `src/components/callcenter/CallCenterLeadCard.tsx`
- Add a new `onStatusChange` prop
- Add a dropdown/popover button with status options: `new`, `contacted`, `no_pickup`, `reviewing`, `hired`, `rejected`
- Style as a compact button near the existing stage selector

### File: `src/pages/CallCenter.tsx`
- Add `handleStatusChange` callback that updates the lead's status in the correct table (`aged_leads` or `applications`)
- Updates local state to reflect the change
- Pass it to `CallCenterLeadCard` as `onStatusChange`

### Status Options
For **applications**: new, contacted, no_pickup, reviewing, hired, rejected
For **aged_leads**: new, contacted, no_pickup, hired, bad_applicant

