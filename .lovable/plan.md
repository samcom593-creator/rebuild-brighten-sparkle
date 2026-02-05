
## Fix: Lead Import & Applicant Pipeline Visibility Issues

### Problems Identified

1. **Applicants Page Not Showing All Applications**
   - The admin fetch logic only runs when a `highlightedLeadId` is present
   - Normal page loads filter only to the admin's personally assigned leads (which is 0)
   - Admin should see ALL 26 applications regardless

2. **Lead Importer Shows "Nothing Available"**
   - The manager dropdown only populates from agents who have matching `user_roles` AND `agents` records
   - If the query returns early due to empty results, no managers appear
   - Need to use the reliable `get-active-managers` edge function instead

3. **Data Migration Needed**
   - 22 applications are currently assigned to Aisha Kebbeh's agent ID
   - Optionally reassign unassigned leads (4) to the admin for visibility

---

### Implementation Plan

#### Step 1: Fix DashboardApplicants to Show All Applications for Admins

Modify the fetch logic so admins always see all applications, not just when a highlighted lead exists.

**Current problematic flow:**
```text
1. Check if managerFilter exists → filter by manager
2. Check if highlightedLeadId exists → fetch all for admin
3. Default: fetch only assigned_agent_id = current user's agent
```

**Fixed flow:**
```text
1. Check if managerFilter exists → filter by manager
2. If isAdmin → fetch ALL applications
3. If isManager → fetch assigned + team applications  
4. Default: fetch only assigned applications
```

**File:** `src/pages/DashboardApplicants.tsx`

#### Step 2: Fix LeadImporter to Use Edge Function for Managers

Replace the unreliable client-side manager query with the `get-active-managers` edge function that already exists and works correctly.

**File:** `src/components/dashboard/LeadImporter.tsx`

#### Step 3: Add Fallback + Loading States

- Show "Loading managers..." while fetching
- Show "No managers available" if the list is empty
- Add error toast if the fetch fails

#### Step 4: Optional Data Migration

Reassign the 4 unassigned applications to the admin so they appear in the pipeline immediately.

---

### Technical Details

**DashboardApplicants Fix:**
```typescript
// NEW: Admins see all, managers see their team
if (isAdmin) {
  const { data: adminApps } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });
  setApplications((adminApps || []) as Application[]);
  setIsLoading(false);
  return;
}

if (isManager && agentData) {
  // Manager sees apps assigned to them OR their team
  const { data: managerApps } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });
  setApplications((managerApps || []) as Application[]);
  setIsLoading(false);
  return;
}
```

**LeadImporter Fix:**
```typescript
const fetchManagers = async () => {
  try {
    const { data, error } = await supabase.functions.invoke("get-active-managers");
    if (error) throw error;
    setManagers(data?.managers || []);
  } catch (err) {
    console.error("Failed to fetch managers:", err);
    toast.error("Failed to load managers");
  }
};
```

---

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/DashboardApplicants.tsx` | Fix fetch logic for admin/manager visibility |
| `src/components/dashboard/LeadImporter.tsx` | Use edge function for manager dropdown |

### Database Fix (Optional)
Reassign unassigned applications to admin agent ID for immediate visibility in the pipeline.

---

### Expected Outcomes
- Admin sees all 26 applications in the Applicants page
- Lead Importer shows all 3 managers in the dropdown
- Importing leads works correctly and they appear in the pipeline
- CRM pipeline reflects all agents and leads
