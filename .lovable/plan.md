

# Format Phone Numbers with Dashes in Call Center

## What Changes
Add a `formatPhoneDisplay` helper function that converts raw phone numbers (e.g., `5551234567` or `15551234567`) into a dash-separated format (e.g., `555-123-4567`) for easier reading and typing.

Apply this formatting in two places:
1. **CallCenterLeadCard.tsx** (line 292) -- the main lead card phone display
2. **CallModeInterface.tsx** (line 229) -- the call mode phone display

## Technical Details

### New helper function (added to each file, or a shared utility)
A simple inline formatter that extracts digits and formats as `XXX-XXX-XXXX`:

```typescript
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Handle 11-digit (1XXXXXXXXXX) or 10-digit numbers
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return phone; // fallback: return as-is
}
```

### File: `src/components/callcenter/CallCenterLeadCard.tsx`
- Add the `formatPhoneDisplay` function
- Line 292: Change `{lead.phone}` to `{formatPhoneDisplay(lead.phone)}`

### File: `src/components/dashboard/CallModeInterface.tsx`
- Add the same `formatPhoneDisplay` function
- Line 229 area: Change `{currentLead.phone}` to `{formatPhoneDisplay(currentLead.phone)}`
- Also format the phone in the "Tap to Call" button display

## Files to Modify
- `src/components/callcenter/CallCenterLeadCard.tsx`
- `src/components/dashboard/CallModeInterface.tsx`
