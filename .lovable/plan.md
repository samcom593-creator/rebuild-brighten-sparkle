

# Fix Non-Clickable Buttons in Call Center

## Problem
Two button click issues:

1. **CopyPhoneButton** is nested **inside** a `<motion.button>` (the phone row, lines 335-371). Nesting `<button>` inside `<button>` is invalid HTML — browsers ignore inner button clicks or route them to the outer button.

2. **ResendLicensingButton** (green hat) wraps in a `<TooltipProvider>` + `<Tooltip>` which intercepts touch events on mobile, preventing the actual button `onClick` from firing.

## Fix

### 1. Phone row: Change outer `motion.button` → `motion.div`
In `CallCenterLeadCard.tsx` (line 335), change `<motion.button>` to `<motion.div` with `role="button"` and `onClick={handleCall}`. Then wrap the CopyPhoneButton area to stop propagation properly. This makes the nested copy button valid HTML.

### 2. ResendLicensingButton: Remove Tooltip on touch devices
In `ResendLicensingButton.tsx`, conditionally skip the `TooltipProvider`/`Tooltip` wrapper on touch devices (using the existing `useIsTouchDevice` hook). On touch, render just the `<Button>` directly. This prevents the tooltip from swallowing tap events.

### 3. CallModeInterface CopyButton
The `CallModeCopyButton` in `CallModeInterface.tsx` (line 62) is a plain `<button>` outside the call button — this one should work fine. No change needed.

### Files changed
- `src/components/callcenter/CallCenterLeadCard.tsx` — change phone row from `motion.button` to `motion.div`
- `src/components/callcenter/ResendLicensingButton.tsx` — skip tooltip on touch devices

