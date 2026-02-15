
# Agency Roster: Search Bar + Accurate Unlicensed Counting + Licensed/Unlicensed Hire Breakdown

## What's Changing

### 1. Add Search Bar to Agency Roster
A search input field will be added next to the sort dropdown in the Agency Roster header. It will filter agents by name or email in real-time as you type, working across all sections (Licensed, Unlicensed Pipeline, Terminated).

### 2. Fix Unlicensed Pipeline Counting
**Current problem:** The "Unlicensed Pipeline" section pulls in ALL unlicensed applications (new, reviewing, no_pickup, etc.) -- currently 62 people. This inflates the roster with people who haven't even been hired yet.

**Fix:** Only include unlicensed applicants whose status is `approved` (hired) or `contracting` (in contracting process). People still in "new", "reviewing", or "no_pickup" status are leads, not team members, and should NOT appear in the Agency Roster.

This will drop the unlicensed count from ~62 to the actual hired/contracted unlicensed people only.

### 3. Show Licensed vs Unlicensed Hire Counts in Recruiting Stats
The "Recruiting Stats" card (AgencyGrowthCard) will break down the "New Hires" number into two sub-labels showing how many are licensed hires vs unlicensed hires for the selected period.

## Technical Details

### File: `src/components/dashboard/ManagerTeamView.tsx`

**Search bar addition (around line 940-958):**
- Add a `searchQuery` state variable
- Add an `Input` component with a search icon next to the sort dropdown
- Filter `filteredMembers`, `licensedMembers`, `unlicensedMembers`, and `terminatedMembers` through the search query (matching on name or email, case-insensitive)

**Pipeline applicant filter fix (lines 273-287):**
- Change the applications query to only include statuses that represent "hired" people:
  ```
  .in("status", ["approved", "contracting"])
  ```
- This ensures only people the team has actually marked as hired show up in the roster

### File: `src/components/dashboard/AgencyGrowthCard.tsx`

**Licensed/Unlicensed hire breakdown (around line 150-170):**
- Split the "New Hires" stat card into showing a breakdown: e.g., "3 Licensed / 5 Unlicensed"
- Query the `license_status` field on applications to separate the counts
- Display both numbers in the stat card subtitle

## Files to Modify
1. `src/components/dashboard/ManagerTeamView.tsx` -- Add search bar, fix pipeline query filter
2. `src/components/dashboard/AgencyGrowthCard.tsx` -- Add licensed/unlicensed hire breakdown
