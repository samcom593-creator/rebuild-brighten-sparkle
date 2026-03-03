

# Add Visible Email & Notification Buttons to Recruiter Lead Cards

## Problem
The email button (QuickEmailMenu) exists but is buried among 9 tiny `h-6 w-6` icon buttons with `gap-0.5` — nearly impossible to find or tap. There's also no push/SMS notification button on lead cards.

## Changes (all in `src/pages/RecruiterDashboard.tsx`)

### 1. Make Email Button Stand Out
- Give `QuickEmailMenu` a colored border like the Phone button has (`border-amber-500/30 text-amber-400`) so it's visually distinct instead of blending in with ghost buttons.

### 2. Add Send Notification Button
- Add a `Bell` icon button to the action row that invokes `send-push-notification` or `send-sms-auto-detect` edge function for that lead.
- On click, show a small popover with options: "Send Push", "Send SMS", "Send Both".
- Uses existing edge functions (`send-push-notification`, `send-sms-auto-detect`) — no new backend needed.

### 3. Improve Button Visibility
- Increase action row gap from `gap-0.5` to `gap-1` so buttons don't blur together.
- Group related buttons visually: Contact group (Phone, Email, Bell) with colored borders vs utility group (Brain, Activity, Mic, Notes) as ghost buttons — separated by a thin divider.

