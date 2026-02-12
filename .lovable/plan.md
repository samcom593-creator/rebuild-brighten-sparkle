

# Differentiate New Drip-Ins from Aged Leads + Fix Filters

## Problem

1. **Lead Center "New Leads" stat card** shows ALL leads with status "new" -- including aged leads. It should only show new drip-in applications (from the `applications` table), not aged leads.

2. **Lead Center table** shows "Aged Lead" in the Source column but has no way to filter by source type (applications vs aged leads). Users need a source filter dropdown.

3. **Call Center** has a "Lead Source" filter with options "All Sources", "Aged Leads Only", and "New Applicants Only" -- but the labels don't clearly say "New Drip-Ins". This needs clearer labeling to match the user's mental model.

## Changes

### 1. Lead Center -- Fix "New Leads" stat card

- Change the "New Leads" stat card count to only count leads where `source === "applications"` AND `status === "new"`. Aged leads are excluded from this count.
- When clicked, it will set a new `filterSource` state to `"applications"` in addition to `filterStatus = "new"`, so only new drip-in applications are shown.

### 2. Lead Center -- Add Source filter dropdown

- Add a new `filterSource` state with values: `"all"`, `"applications"`, `"aged_leads"`
- Add a new Select dropdown in the filters bar labeled "Lead Source" with options: "All Sources", "New Drip-Ins", "Aged Leads"
- Apply the filter in the `filteredLeads` memo: `lead.source === filterSource` when not "all"

### 3. Lead Center -- Better source badge labels

- Change the Source column badge text from `"Aged Lead"` to `"Aged Lead"` (keep) and from the referral source format to `"New Drip-In"` (instead of showing "Direct Apply", "Social Media", etc. which is confusing). The referral source detail can stay as a subtitle or tooltip.

### 4. Call Center -- Clearer source filter labels

- Change the "Lead Source" filter options from:
  - "All Sources" -> "All Sources"
  - "Aged Leads Only" -> "Aged Leads"  
  - "New Applicants Only" -> "New Drip-Ins"
- This makes it crystal clear what each option does

## Technical Details

### File: `src/pages/LeadCenter.tsx`

1. Add `filterSource` state: `useState<"all" | "applications" | "aged_leads">("all")`
2. Update `stats.new` calculation: `leads.filter(l => l.source === "applications" && l.status === "new").length`
3. Update "New Leads" card onClick to also set `setFilterSource("applications")`
4. Add source filter to `filteredLeads` memo: check `filterSource`
5. Add a new Select dropdown for source filtering in the filters bar
6. Update the Source column badge to show "New Drip-In" for applications and "Aged Lead" for aged_leads

### File: `src/components/callcenter/CallCenterFilters.tsx`

1. Change label for "Aged Leads Only" to "Aged Leads"
2. Change label for "New Applicants Only" to "New Drip-Ins"

