

# Fix Aged Lead Importer Validation + Email Template Sync

## Problem

Two issues are happening:

1. **Validation errors rejecting valid leads**: Your CSV has leads with phone numbers and Instagram handles but no email, and they're being rejected with "Missing email, Missing phone" errors. The validation should accept any lead that has at least ONE contact method (email, phone, OR Instagram).

2. **Old email template still showing**: The email preview and outreach emails are displaying the old "A new remote sales position just opened up" template instead of the updated high-converting version with the $20K+ production and $10K+ deposit stats.

## Root Cause

The previous code changes may not have fully compiled into the running preview. The fix will ensure the validation and email template are correctly applied and working.

## Your CSV Format

Your CSV uses column names like `Full_Name`, `Phone_10`, `Phone_E164`, `Instagram`, and `Email`. The importer's column auto-detection already supports these mappings:
- `Full_Name` maps to full name (split into first/last automatically)
- `Phone_10` maps to phone
- `Instagram` maps to instagram handle
- `Email` maps to email

With the fix, all 56 leads in your CSV should import successfully since every row has at least a first name plus one contact method (phone, Instagram, or email).

## Changes

### 1. AgedLeadImporter.tsx -- Harden validation logic

- Ensure the validation accepts leads with first name + any ONE of: email, phone, or Instagram handle
- Add explicit phone column mapping for `phone_10` and `phone_e164` variations to the column detection
- Clean up error messages to be clear: "Need at least one contact method (email, phone, or Instagram)"
- Handle the `Full_Name` column properly when there's no space (single-word names like "Kero" become first name only)

### 2. AgedLeadEmailPreview.tsx -- Confirm updated template

- Ensure the preview component shows the redesigned email with the performance stats ($20K+ production, $10K+ deposits), updated subject line, and tracked CTA button
- The preview must match exactly what `send-aged-lead-email` sends

### 3. send-aged-lead-email Edge Function -- Confirm updated template

- Verify the deployed function uses the new high-converting email template (not the old "remote sales position" template)
- Re-deploy the function to ensure the latest version is live

## Technical Details

### Validation fix in AgedLeadImporter.tsx

The validation block will be updated to:

```typescript
// Add phone_10, phone_e164 to phone column mappings
phone: [
  "phone", "phone number", "phone_10", "phone_e164", 
  "phonenumber", "phone_number", "mobile", "cell", ...
],

// Validation: accept any single contact method
const instagramHandle = getValue("instagram_handle") || "";
if (!email && !phone && !instagramHandle) {
  errors.push("Need at least one contact method (email, phone, or Instagram)");
} else if (email && !isValidEmail(email)) {
  errors.push("Invalid email format");
}
```

### Column mapping additions

Adding explicit support for common CRM export column names:
- `phone_10` and `phone_e164` for phone columns
- `prospect_name` and `contact_name` for full name columns
- `contact_methods` will NOT be mapped to avoid conflicts

### Expected result with your CSV

After the fix, all 56 rows should import:
- Row 2 (Kero): Instagram only -- valid
- Row 3 (Nicky): Phone + Instagram -- valid
- Row 32 (David Centrella): Instagram only -- valid
- Row 50 (Clay Sumner): Email + Instagram -- valid
- All other rows: Phone + Instagram (and some with email too) -- valid

### Files to modify

| File | Change |
|------|--------|
| `src/components/dashboard/AgedLeadImporter.tsx` | Add phone_10/phone_e164 to column mappings, harden validation |
| `src/components/dashboard/AgedLeadEmailPreview.tsx` | Ensure updated template with stats is showing |
| `supabase/functions/send-aged-lead-email/index.ts` | Re-deploy to ensure latest template is live |

