

# Display Motivation in Lead Center

## Current Status

The motivation step in the apply flow is already working correctly:
- Unlicensed/pending applicants are prompted for motivation before reaching the success page
- The motivation text is saved to the `notes` field in the `applications` table
- **Call Center**: Already shows motivation on lead cards
- **Applicants page**: Already shows notes/motivation with a preview and edit modal

## The Gap

The **Lead Center** (`/dashboard/leads`) does not fetch or display the `notes` field. The `Lead` interface is missing it entirely, so motivation text is invisible on that page.

## Fix

### File: `src/pages/LeadCenter.tsx`

1. Add `notes?: string` to the `Lead` interface (around line 62)
2. Update the Supabase query for applications to include `notes` in the select fields
3. Update the Supabase query for aged leads to include `notes` in the select fields
4. Map the `notes` field when constructing Lead objects from query results
5. Display the notes/motivation as a preview snippet in the lead table row (similar to how the Applicants page shows it -- a subtle bordered text block beneath the lead info)

This is a small, targeted change -- the data already exists in the database and flows correctly everywhere else.

