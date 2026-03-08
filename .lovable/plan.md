

# Plan: Show Manager Name on Call Center Lead Cards

## Problem
When an admin is in the Call Center calling leads that belong to other managers, the current `referredBy` badge just shows a name with a generic user icon. There's no label clarifying this is the **manager** who owns the lead.

## Changes

### 1. Add `assignedManagerName` field to the UnifiedLead interface
**Files**: `src/pages/CallCenter.tsx`, `src/components/callcenter/CallCenterLeadCard.tsx`

- Add `assignedManagerName?: string` to the `UnifiedLead` interface in both files
- For **aged leads**: the existing `agents!aged_leads_assigned_manager_id_fkey(display_name)` join already fetches the manager name — map it to `assignedManagerName` (currently mapped to `referredBy`, which is semantically wrong for aged leads since the manager IS the assignee, not a referrer)
- For **applications**: join through the agent's `invited_by_manager_id` to get the manager name, OR use the existing `assigned_agent_id` join — the agent IS the manager in this context, so map `agentData?.display_name` to `assignedManagerName`

### 2. Display a distinct "Manager: [Name]" badge on the lead card
**File**: `src/components/callcenter/CallCenterLeadCard.tsx`

- Add a new badge below the existing `referredBy` badge (or replace it for aged leads):
  - Blue/indigo colored badge with a `Building2` or `User` icon
  - Label: **"Manager: {lead.assignedManagerName}"**
  - Only shown when `assignedManagerName` exists and differs from the current user's name

### 3. Same change in CallModeInterface
**File**: `src/components/dashboard/CallModeInterface.tsx`

- Add `assignedManagerName` to the `Lead` interface
- Fetch it from the existing `agents!aged_leads_assigned_manager_id_fkey(display_name)` join (already in the query)
- Display "Manager: [Name]" badge below the "Referred by" line

### Files to Edit
1. `src/pages/CallCenter.tsx` — add `assignedManagerName` to interface + mapping
2. `src/components/callcenter/CallCenterLeadCard.tsx` — add interface field + manager badge
3. `src/components/dashboard/CallModeInterface.tsx` — add interface field + manager badge

