

# Remove the X (Delete) Button from Recent Invitations

## Problem
The Recent Invitations tracker on the Dashboard has an X button next to each agent that deactivates them. This is dangerous -- it lets managers accidentally remove agents from the system with a single tap, right from a tracker that should be informational only. Agent removal should only happen through the dedicated admin tools (Command Center, Accounts page).

## Fix
Remove the X button and its `handleRemove` function entirely from `InvitationTracker.tsx`. The Send Login button for pending invitations will remain.

## Technical Details

### File: `src/components/dashboard/InvitationTracker.tsx`
- Remove the `removingId` state variable and its setter
- Remove the `handleRemove` function (lines 139-161)
- Remove the X button JSX (lines 246-259)
- Remove the unused `X` icon import from lucide-react

The Send invite button (green paper plane icon) stays for pending agents who haven't set their password yet. The refresh button at the top also stays. This keeps the tracker read-only with only the helpful "resend login" action available.

