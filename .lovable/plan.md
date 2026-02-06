
# Plan: Lead Center Fixes - Delete/Vault, Manager Assignment, Source/Status Display, Aged Lead Import

## Summary

This plan addresses 7 key issues in the Lead Center:

1. **Add Delete Option** - Bulk delete leads with vault storage
2. **Create Deleted Leads Vault** - New database table + Settings page access
3. **Fix Zero Managers Bug** - Deploy `get-active-managers` edge function (NOT DEPLOYED!)
4. **Fix Source Display** - Show actual `referral_source` instead of "App"
5. **Fix Status Display** - Show pipeline stage or "Not Contacted" if no contact
6. **Aged Leads Import** - Add "unknown" license status option
7. **Email Blast Ready** - Already implemented (sends on import)

---

## Issue #1: Managers Showing Zero - ROOT CAUSE FOUND

**The Problem**: The `get-active-managers` edge function is **NOT DEPLOYED**. When I tested it:
- Returns 404: `{"code":"NOT_FOUND","message":"Requested function was not found"}`
- No logs exist for this function

**Fix**: The edge function code exists but was never deployed. I need to redeploy it.

**Files to Update**:
- `supabase/functions/get-active-managers/index.ts` - Update CORS headers for newer client

**Updated CORS Headers**:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
```

---

## Issue #2: Create Deleted Leads Vault

**Database Changes** (New Table):
```sql
CREATE TABLE public.deleted_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id UUID NOT NULL,
  source TEXT NOT NULL, -- 'applications' or 'aged_leads'
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  state TEXT,
  license_status TEXT,
  assigned_agent_id UUID,
  original_data JSONB, -- Full original record for potential restore
  deleted_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);

-- Enable RLS
ALTER TABLE public.deleted_leads ENABLE ROW LEVEL SECURITY;

-- Only admins can access deleted leads
CREATE POLICY "Admins can manage deleted leads"
  ON public.deleted_leads FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));
```

---

## Issue #3: Add Delete Button to Lead Center

**Files to Modify**:
- `src/pages/LeadCenter.tsx`

**Add to Floating Action Bar**:
```tsx
<Button
  variant="destructive"
  onClick={handleBulkDelete}
  disabled={bulkDeleting}
  size="sm"
>
  <Trash2 className="h-4 w-4 mr-2" />
  Delete
</Button>
```

**New Delete Handler**:
```typescript
const handleBulkDelete = async () => {
  if (selectedLeads.size === 0) return;
  
  const confirm = window.confirm(`Delete ${selectedLeads.size} leads? They will be moved to the vault.`);
  if (!confirm) return;
  
  setBulkDeleting(true);
  try {
    // Separate leads by source
    const applicationIds: string[] = [];
    const agedLeadIds: string[] = [];
    
    selectedLeads.forEach((key) => {
      const [source, id] = key.split("-");
      if (source === "applications") applicationIds.push(id);
      else if (source === "aged_leads") agedLeadIds.push(id);
    });
    
    // Move applications to vault
    if (applicationIds.length > 0) {
      const { data: apps } = await supabase
        .from("applications")
        .select("*")
        .in("id", applicationIds);
        
      if (apps?.length) {
        await supabase.from("deleted_leads").insert(
          apps.map(app => ({
            original_id: app.id,
            source: "applications",
            first_name: app.first_name,
            last_name: app.last_name,
            email: app.email,
            phone: app.phone,
            city: app.city,
            state: app.state,
            license_status: app.license_status,
            assigned_agent_id: app.assigned_agent_id,
            original_data: app,
          }))
        );
        
        await supabase.from("applications")
          .update({ terminated_at: new Date().toISOString() })
          .in("id", applicationIds);
      }
    }
    
    // Similar for aged_leads - hard delete after vaulting
    if (agedLeadIds.length > 0) {
      const { data: aged } = await supabase
        .from("aged_leads")
        .select("*")
        .in("id", agedLeadIds);
        
      if (aged?.length) {
        await supabase.from("deleted_leads").insert(
          aged.map(lead => ({
            original_id: lead.id,
            source: "aged_leads",
            first_name: lead.first_name,
            last_name: lead.last_name,
            email: lead.email,
            phone: lead.phone,
            license_status: lead.license_status,
            assigned_agent_id: lead.assigned_manager_id,
            original_data: lead,
          }))
        );
        
        await supabase.from("aged_leads")
          .delete()
          .in("id", agedLeadIds);
      }
    }
    
    toast.success(`${selectedLeads.size} leads moved to vault`);
    clearSelection();
    fetchLeads();
  } catch (error) {
    toast.error("Failed to delete leads");
  } finally {
    setBulkDeleting(false);
  }
};
```

---

## Issue #4: Deleted Leads Vault Page in Settings

**New File**: `src/pages/DeletedLeadsVault.tsx`

Creates a page accessible from Settings that shows:
- List of all deleted leads with original data
- Restore functionality (moves back to original table)
- Permanent delete option
- Filter by source (applications/aged_leads)

**Add Route**: In `App.tsx`:
```tsx
<Route path="/settings/deleted-leads" element={<DeletedLeadsVault />} />
```

**Link from Settings**: Add navigation to `ProfileSettings.tsx`:
```tsx
<Button variant="outline" onClick={() => navigate("/settings/deleted-leads")}>
  <Trash2 className="h-4 w-4 mr-2" />
  View Deleted Leads
</Button>
```

---

## Issue #5: Fix Source Display

**Current Behavior**: Shows "App" or "Aged" based on which table the lead came from

**Expected Behavior**: For applications, show the `referral_source` field (agent-referral, friend-referral, social-media, event, other)

**Files to Modify**:
- `src/pages/LeadCenter.tsx`

**Update Lead Interface**:
```typescript
interface Lead {
  // ... existing fields
  referralSource?: string; // NEW: actual source from applications
}
```

**Update Transform**:
```typescript
// Line 137-153 - when transforming applications
const appLeads: Lead[] = (applications || []).map((app) => ({
  // ... existing fields
  referralSource: app.referral_source || undefined, // ADD THIS
}));
```

**Update Display** (Line 634-644):
```tsx
<TableCell>
  <Badge variant="outline" className="...">
    {lead.source === "applications" 
      ? formatReferralSource(lead.referralSource) // Format nicely
      : "Aged Lead"}
  </Badge>
</TableCell>
```

**Add Helper Function**:
```typescript
const formatReferralSource = (source?: string): string => {
  if (!source) return "Direct Apply";
  const mapping: Record<string, string> = {
    "agent-referral": "Agent Referral",
    "friend-referral": "Friend Referral", 
    "social-media": "Social Media",
    "event": "Event",
    "other": "Other",
  };
  return mapping[source] || source;
};
```

---

## Issue #6: Fix Status Display

**Current Behavior**: Shows raw status like "new", "reviewing", etc.

**Expected Behavior**: 
- If `contacted_at` is null → "Not Contacted"
- Otherwise, show the working pipeline stage nicely formatted

**Files to Modify**:
- `src/pages/LeadCenter.tsx`

**Update Lead Interface**:
```typescript
interface Lead {
  // ... existing fields
  contactedAt?: string; // NEW: for determining if contacted
}
```

**Update Transform**:
```typescript
contactedAt: app.contacted_at || undefined,
```

**Update Status Display**:
```tsx
<TableCell>
  <Badge variant="outline" className={...}>
    {!lead.contactedAt ? "Not Contacted" : formatStatus(lead.status)}
  </Badge>
</TableCell>
```

**Add Status Colors for "Not Contacted"**:
```typescript
const statusColors: Record<string, string> = {
  // ... existing
  "not_contacted": "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
```

---

## Issue #7: Add "Unknown" License Status to Aged Lead Importer

**Files to Modify**:
- `src/components/dashboard/AgedLeadImporter.tsx`

**Update Default License Status Options** (Line 488-496):
```tsx
<Select value={defaultLicenseStatus} onValueChange={setDefaultLicenseStatus}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="unlicensed">Unlicensed</SelectItem>
    <SelectItem value="licensed">Licensed</SelectItem>
    <SelectItem value="unknown">Unknown</SelectItem> {/* ADD THIS */}
  </SelectContent>
</Select>
```

**Update License Status Detection** (Lines 293-303):
```typescript
// In the license status parsing logic
if (licenseStatus) {
  const lower = licenseStatus.toLowerCase();
  if (lower.includes("yes") || lower.includes("licensed") || lower === "true" || lower === "1" || lower === "y") {
    licenseStatus = "licensed";
  } else if (lower.includes("unknown") || lower.includes("?") || lower === "n/a" || lower === "na") {
    licenseStatus = "unknown"; // ADD THIS CASE
  } else {
    licenseStatus = "unlicensed";
  }
}
```

---

## Email Blast Confirmation

The Aged Lead Importer **already sends emails automatically** on import:
- Line 381-391 in `AgedLeadImporter.tsx` shows it calls `send-aged-lead-email` for each lead
- Toast shows: "Sending outreach emails to X leads..."
- The email preview feature is already implemented with `AgedLeadEmailPreview` component

**Status**: Ready for email blast on import ✅

---

## Implementation Order

1. **Deploy `get-active-managers`** - Fix zero managers immediately
2. **Create `deleted_leads` table** - Database migration
3. **Update `LeadCenter.tsx`** - Add delete button, fix source/status display
4. **Update `AgedLeadImporter.tsx`** - Add "unknown" license status
5. **Create `DeletedLeadsVault.tsx`** - New page for viewing deleted leads
6. **Update routing** - Add vault route and Settings link

---

## Files Summary

| File | Changes |
|------|---------|
| `supabase/functions/get-active-managers/index.ts` | Update CORS headers + redeploy |
| Database migration | Create `deleted_leads` table with RLS |
| `src/pages/LeadCenter.tsx` | Add delete button, fix source/status, add contactedAt/referralSource |
| `src/components/dashboard/AgedLeadImporter.tsx` | Add "unknown" license status option |
| `src/pages/DeletedLeadsVault.tsx` | NEW - Vault page with restore/delete |
| `src/App.tsx` | Add vault route |
| `src/components/dashboard/ProfileSettings.tsx` | Add link to vault |

---

## Expected Results

- **Managers Fixed**: Dropdown will show all active managers for assignment
- **Delete Works**: Bulk delete moves leads to vault, accessible from Settings
- **Source Accurate**: Shows "Agent Referral", "Social Media", etc. instead of "App"
- **Status Clear**: Shows "Not Contacted" for unworked leads
- **Aged Import**: Supports unknown license status
- **Email Blast**: Already working - sends on import
