

# Add Licensing Button Everywhere and Fix "Terminated" Label

## Changes

### 1. Add ResendLicensingButton to DashboardApplicants (Lead Center)

The graduation hat button already exists in Call Center, CRM Pipeline, and CallCenterLeadCard -- but it's missing from the applicant cards in `DashboardApplicants.tsx`.

**File: `src/pages/DashboardApplicants.tsx`**
- Import `ResendLicensingButton` from `@/components/callcenter/ResendLicensingButton`
- Add the graduation hat icon button in the Actions Row (line ~589) next to the existing email/notes/record buttons
- Only show for non-licensed applicants (`app.license_status !== "licensed"`)

### 2. Add ResendLicensingButton to Aged Leads

The aged leads cards also lack the button.

**File: `src/pages/DashboardAgedLeads.tsx`**
- Import `ResendLicensingButton`
- Add the graduation hat button to each aged lead card's action area
- Only show for leads that have an email address (can't send without email)

### 3. Change "Inactive" Label to "Pass Pre-License Course" in CRM Pipeline

In `DashboardCRM.tsx`, when an agent has `isDeactivated = true`, the badge currently reads "Inactive". The user wants this to say "Pass Pre-License Course" instead, indicating the agent needs to complete their pre-licensing course.

**File: `src/pages/DashboardCRM.tsx`**
- Change the badge text on line ~772 from `Inactive` to `Pass Pre-License Course`
- Update the badge color from destructive red to amber/warning to better reflect it's a pending action, not a termination

## Technical Details

### ResendLicensingButton Props (already built)
```typescript
interface ResendLicensingButtonProps {
  recipientEmail: string;
  recipientName: string;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  managerEmail?: string;
}
```

### Files Modified
1. `src/pages/DashboardApplicants.tsx` -- add import + button in actions row
2. `src/pages/DashboardAgedLeads.tsx` -- add import + button in lead card actions
3. `src/pages/DashboardCRM.tsx` -- change "Inactive" badge text to "Pass Pre-License Course"

No database changes needed. No new components needed -- reuses existing `ResendLicensingButton`.

