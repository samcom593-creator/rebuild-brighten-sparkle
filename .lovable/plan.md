

# Plan: Lead Center Bulk Actions, Email Fixes, Call Center UI Optimization & Team Hierarchy Enhancements

## Summary

Comprehensive update addressing multiple areas:
1. **Lead Center Bulk Selection** - Add checkbox selection with floating action bar for bulk manager assignment
2. **Email System Audit & Fix** - Investigate why emails aren't sending, fix any issues
3. **Call Center UI Optimization** - Better screen utilization, polish animations
4. **Team Hierarchy Enhancements** - Add "Send Login" button, clickable submanager count, coursework email notifications
5. **Add Agent Flow Simplification** - Cleaner licensed/unlicensed options

---

## Changes Overview

### 1. Lead Center - Bulk Selection & Assignment

**Current State**: Individual row-level QuickAssignMenu only

**New Features**:
- Add checkbox column to table header and each row
- Circular selection indicators (tap to select)
- "Select All" toggle in header
- Floating action bar when items selected:
  - Shows count: "5 selected"
  - Manager dropdown for bulk assignment
  - "Assign to Manager" button
  - "Clear Selection" button
- Support both applications and aged_leads bulk reassignment

**Files to Modify**:
- `src/pages/LeadCenter.tsx`

**New State Variables**:
```typescript
const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
const [bulkAssigning, setBulkAssigning] = useState(false);
const [bulkManagerId, setBulkManagerId] = useState<string>("");
```

**New Table Header**:
```tsx
<TableHead className="w-10">
  <Checkbox
    checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
    onCheckedChange={toggleSelectAll}
  />
</TableHead>
```

**Floating Action Bar** (similar to TeamHierarchyManager pattern):
```tsx
<AnimatePresence>
  {selectedLeads.size > 0 && (
    <motion.div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border shadow-lg">
        <span>{selectedLeads.size} selected</span>
        <Select value={bulkManagerId} onValueChange={setBulkManagerId}>
          {/* Manager options */}
        </Select>
        <Button onClick={handleBulkAssign}>
          Assign to Manager
        </Button>
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

---

### 2. Email System Fix

**Investigation Findings**:
- RESEND_API_KEY is configured (confirmed via secrets check)
- No recent logs for `send-outreach-email` or `send-licensing-instructions` (unusual)
- The edge functions look correct but may have deployment issues

**Actions**:
1. Verify edge functions are properly deployed
2. Add better error logging with explicit console output
3. Ensure all edge functions have proper CORS headers for newer Supabase client versions
4. Update CORS headers to match the standard pattern used in working functions

**Files to Modify**:
- `supabase/functions/send-outreach-email/index.ts` - Update CORS headers
- `supabase/functions/send-licensing-instructions/index.ts` - Already has correct headers

**CORS Header Fix** (standardize across all email functions):
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
```

The current `send-outreach-email` has minimal CORS headers - this may be causing silent failures.

---

### 3. Call Center UI Optimization

**Current Issues**:
- Content area could use more screen space
- Layout feels cramped

**Improvements**:
- Increase max-width from `max-w-5xl` to `max-w-6xl` for better screen utilization
- Add subtle background gradient for premium feel
- Improve card spacing and visual hierarchy
- Make the lead card take more vertical space
- Ensure action buttons are well-spaced

**Files to Modify**:
- `src/pages/CallCenter.tsx`

**Layout Changes**:
```tsx
// Current: max-w-5xl
// New: max-w-6xl with better padding
<div className="flex flex-col h-full w-full max-w-6xl mx-auto p-4 md:p-8">
```

---

### 4. Team Hierarchy Enhancements

#### 4a. "Send Login" Button

**Add to each agent row's action menu**:
- New dropdown item: "Send Portal Login"
- Triggers `send-agent-portal-login` edge function
- Shows loading state while sending
- Toast notification on success/failure

**Files to Modify**:
- `src/components/dashboard/TeamHierarchyManager.tsx`

**New Dropdown Item**:
```tsx
<DropdownMenuItem onClick={() => handleSendLogin(agent.id, agent.email)}>
  <Mail className="h-3 w-3 mr-2" />
  Send Portal Login
</DropdownMenuItem>
```

**Handler Function**:
```typescript
const handleSendLogin = async (agentId: string, email: string) => {
  try {
    const { error } = await supabase.functions.invoke("send-agent-portal-login", {
      body: { agentId }
    });
    if (error) throw error;
    toast.success(`Login email sent to ${email}`);
  } catch (error) {
    toast.error("Failed to send login email");
  }
};
```

#### 4b. Clickable Submanager Count

**Current**: Shows "X under sub-managers" as static badge

**New**: Make it clickable to show a popover/sheet with list of those agents

**Implementation**:
- Wrap the badge in a button/popover trigger
- On click, filter and show agents whose `managerId` is not the admin
- Show agent name, manager name, and quick actions

**New Component**:
```tsx
<Popover>
  <PopoverTrigger asChild>
    <button className="flex items-center gap-1.5 px-2 py-1 rounded ...">
      <Users className="h-3 w-3" />
      <span>{indirectReports} under sub-managers</span>
    </button>
  </PopoverTrigger>
  <PopoverContent className="w-80">
    <div className="space-y-2">
      <h4 className="font-medium text-sm">Agents Under Sub-Managers</h4>
      {indirectAgents.map(agent => (
        <div key={agent.id} className="flex items-center justify-between p-2 rounded border">
          <div>
            <span className="font-medium text-sm">{agent.name}</span>
            <span className="text-xs text-muted-foreground block">Manager: {agent.managerName}</span>
          </div>
          <Select value={agent.managerId} onValueChange={(v) => handleReassign(agent.id, v)}>
            {/* Reassign dropdown */}
          </Select>
        </div>
      ))}
    </div>
  </PopoverContent>
</Popover>
```

#### 4c. Coursework Email Notification

**When agent starts coursework, notify admin**:
- Create new edge function `notify-course-started` 
- Trigger when first `onboarding_progress` record is inserted for an agent
- Could also be a database trigger or called from the course UI

**Files to Create**:
- `supabase/functions/notify-course-started/index.ts`

**Trigger Point**:
- Add call when agent first accesses course content
- Or use database trigger on `onboarding_progress` insert

---

### 5. Add Agent Flow - Already Has License Status

**Current State**: AddAgentModal already has license status selector with:
- Unlicensed
- In Progress  
- Licensed

**Improvements**:
- Make the license status more prominent with visual indicators
- Add helper text explaining each option:
  - **Unlicensed**: "New recruit, needs to complete licensing"
  - **In Progress**: "Currently working on getting licensed"
  - **Licensed**: "Already has their insurance license"

**Files to Modify**:
- `src/components/dashboard/AddAgentModal.tsx`

**Enhanced License Status UI**:
```tsx
<div className="space-y-2">
  <Label htmlFor="licenseStatus">License Status</Label>
  <Select value={licenseStatus} onValueChange={...}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="unlicensed">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          Unlicensed - Needs licensing
        </div>
      </SelectItem>
      <SelectItem value="in_progress">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          In Progress - Getting licensed
        </div>
      </SelectItem>
      <SelectItem value="licensed">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          Licensed - Ready to sell
        </div>
      </SelectItem>
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground">
    {licenseStatus === "licensed" 
      ? "Agent already has their insurance license"
      : licenseStatus === "in_progress"
      ? "Agent is currently working on getting licensed"
      : "Agent needs to complete the licensing process"}
  </p>
</div>
```

---

## Implementation Order

1. **Email Fix** - Fix CORS headers in `send-outreach-email` and deploy
2. **Lead Center Bulk Actions** - Add selection and floating action bar
3. **Team Hierarchy Send Login** - Add button to action menu
4. **Team Hierarchy Submanager Popover** - Make count clickable
5. **Call Center UI Polish** - Increase screen usage
6. **Add Agent Modal Enhancement** - Improve license status UI
7. **Coursework Start Notification** - Create edge function

---

## Files Summary

| File | Changes |
|------|---------|
| `supabase/functions/send-outreach-email/index.ts` | Fix CORS headers |
| `src/pages/LeadCenter.tsx` | Add bulk selection, floating action bar |
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add Send Login, clickable submanager count |
| `src/pages/CallCenter.tsx` | Increase max-width, improve spacing |
| `src/components/dashboard/AddAgentModal.tsx` | Enhance license status UI |
| `supabase/functions/notify-course-started/index.ts` | NEW - Email when course started |

---

## Expected Results

- **Bulk Lead Assignment**: Select multiple leads with checkboxes, assign all to one manager with one click
- **Emails Working**: Fixed CORS headers should resolve silent email failures
- **Call Center**: Better screen utilization, more polished feel
- **Team Hierarchy**: Quick "Send Login" action, see all agents under sub-managers in one click
- **Add Agent**: Clearer visual indicators for license status options
- **Coursework Tracking**: Admin gets notified when agents begin their training

