
# Plan: Admin Lead Center + Call Center Enhancements + Email Integration

## Summary

This plan addresses all the issues you've raised:
1. **Lead Center** - Add dedicated admin navigation item for full lead management with assignment capabilities
2. **Lead Assignment Fix** - Add assignment buttons in the AllLeadsPanel table so you can reassign leads away from Aisha
3. **Call Center Fixes** - Ensure all lead details display correctly (Instagram, email, notes)
4. **Email Integration** - Add quick email menu to Call Center for sending pre-made emails
5. **High-Tech UI** - Polish the interface with premium design elements

---

## What Will Be Fixed/Added

### 1. Add "Lead Center" to Admin Navigation

Add a new sidebar item for admins only:
- **Icon**: Database or Target icon
- **Label**: "Lead Center"
- **Route**: `/dashboard/leads`
- Appears after "Command Center" in the navigation

### 2. Create New Lead Center Page

A dedicated admin page (`/dashboard/leads`) for:
- **Viewing all leads** from both applications and aged_leads tables
- **Bulk assignment** - Dropdown to assign/reassign leads to any manager
- **Filter by manager** - See only leads assigned to a specific person
- **Filter by status** - New, Contacted, Qualified, etc.
- **Filter by license** - Licensed vs Unlicensed
- **Quick actions** - Call, Email, View Profile

Key feature: **Assign button on EVERY lead row** so you can fix the Aisha situation immediately.

### 3. Enhance AllLeadsPanel with Assignment

Update the existing `AllLeadsPanel.tsx` to add an "Assign" button in each row:
- Uses existing `QuickAssignMenu` component
- Allows admin to reassign leads to any manager
- Immediately updates the lead's `assigned_agent_id`

### 4. Call Center Enhancements

Fix and enhance the Call Center lead card to show:
- Phone (tap to call) - Already works
- Email - Already displays but will enhance
- Instagram handle - Already displays
- Notes/Motivation - Already displays
- **NEW: Quick Email Menu** - Add the same email menu from Pipeline
- Keep Record Call button and Analysis features

Add to `CallCenterLeadCard.tsx`:
- Integrate `QuickEmailMenu` component
- Add email templates dropdown
- Keep voice recorder prominent

### 5. Trigger Follow-Up Emails on All Actions

Currently, follow-up emails only send when "Contacted" is clicked. Update to:
- Send follow-up email on **ANY action** (Contacted, Hired, Contracted, Licensing, etc.)
- Each action type can have a slightly customized email message

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/LeadCenter.tsx` | New admin-only lead management hub |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/layout/GlobalSidebar.tsx` | Add "Lead Center" nav item for admins |
| `src/App.tsx` | Add route for `/dashboard/leads` |
| `src/components/dashboard/AllLeadsPanel.tsx` | Add assignment button to each lead row |
| `src/components/callcenter/CallCenterLeadCard.tsx` | Add QuickEmailMenu and ensure all info displays |
| `src/pages/CallCenter.tsx` | Send follow-up emails on all action types (not just "contacted") |

---

## Lead Center Page Design

```text
+----------------------------------------------------------+
|  Lead Center                          [Refresh] [Export] |
+----------------------------------------------------------+
| [Search leads...]  [Filter: Manager ▼] [Status ▼] [License ▼] |
+----------------------------------------------------------+
|                                                          |
|  Stats Cards:                                            |
|  [Total: 234] [Unassigned: 45] [Licensed: 89] [New: 67]  |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  Lead Table with Assignment:                             |
|  +------+-------+--------+--------+----------+---------+ |
|  | Name | Phone | Status | License| Assigned | Actions | |
|  +------+-------+--------+--------+----------+---------+ |
|  | John | 555.. | New    | Yes    | Aisha    | [Assign]| |
|  |      |       |        |        |          | [Call]  | |
|  |      |       |        |        |          | [Email] | |
|  +------+-------+--------+--------+----------+---------+ |
|                                                          |
+----------------------------------------------------------+
```

### Assignment Dropdown

When clicking "Assign", shows all active managers:
- Samuel James
- Aisha (current)
- Other Manager
- **Unassign** - Sets `assigned_agent_id` to NULL

---

## Call Center Lead Card Updates

Current card already shows:
- Name, phone (tap to call), email, Instagram, notes, source badge, license badge

Will add:
- **Quick Email button** - Opens dropdown with email templates
- Keep voice recorder section prominent
- Enhanced styling for a premium feel

```text
+----------------------------------------------------------+
|  [Aged Lead] [Unlicensed]                                |
|                                                          |
|  John Smith                              [Stage: ▼ New]  |
|  Added 3 days ago • Last contact: Feb 1                  |
|                                                          |
|  +----------------------------------------------------+  |
|  | 📞 (555) 123-4567           [TAP TO CALL]         |  |
|  +----------------------------------------------------+  |
|  | ✉️  john@email.com                                  |  |
|  | 📷 @johnsmith                                      |  |
|  +----------------------------------------------------+  |
|                                                          |
|  Notes: Interested in financial career, has sales exp... |
|                                                          |
|  +----------------------------------------------------+  |
|  | 🎤 Record Call               📧 Quick Email        |  |
|  |    [Start Recording]          [Select Template ▼] |  |
|  +----------------------------------------------------+  |
|                                                          |
+----------------------------------------------------------+
|  [Contacted] [Hired] [Contracted] [Licensing] [Not Qual] |
|                    [Skip to Next →]                      |
+----------------------------------------------------------+
```

---

## Follow-Up Email on All Actions

Update `CallCenter.tsx` to send follow-up emails when ANY action is clicked:

```text
Action Clicked → Update Lead Status → Send Follow-Up Email → Next Lead

Email content varies by action:
- Contacted: "Great talking to you! Here's the calendar link..."
- Hired: "Welcome to the team! Next steps..."
- Contracted: "Congratulations on getting contracted!..."
- Licensing: "Here are your licensing resources..."
- Not Qualified: No email (they're disqualified)
- No Pickup: No email (will retry later)
```

---

## Technical Details

### Lead Center Query Logic

```typescript
// Fetch ALL applications (admin sees everything)
const { data: applications } = await supabase
  .from("applications")
  .select("*")
  .is("terminated_at", null)
  .order("created_at", { ascending: false });

// Also fetch aged_leads for unified view
const { data: agedLeads } = await supabase
  .from("aged_leads")
  .select("*")
  .order("created_at", { ascending: false });
```

### Assignment Update

```typescript
// Reassign lead to different manager
const handleAssign = async (leadId: string, newAgentId: string | null) => {
  await supabase
    .from("applications")
    .update({ assigned_agent_id: newAgentId })
    .eq("id", leadId);
  
  // Notify new manager
  if (newAgentId) {
    await supabase.functions.invoke("notify-lead-assigned", {
      body: { applicationId: leadId, agentId: newAgentId }
    });
  }
  
  toast.success("Lead reassigned successfully");
  refetch();
};
```

### Enhanced Follow-Up Trigger

```typescript
// In CallCenter.tsx handleAction function
const shouldSendEmail = ["contacted", "hired", "contracted", "licensing"].includes(actionId);

if (shouldSendEmail) {
  await supabase.functions.invoke("send-post-call-followup", {
    body: {
      firstName: currentLead.firstName,
      email: currentLead.email,
      licenseStatus: currentLead.licenseStatus,
      actionType: actionId, // Pass action type for customized email
    },
  });
}
```

---

## Expected Outcomes

After implementation:
1. **Lead Center** - Admin-only page in sidebar for full lead management
2. **Easy Reassignment** - Click "Assign" on any lead to move it to a different manager
3. **Aisha Fix** - You can immediately reassign all leads assigned to Aisha back to yourself or others
4. **Call Center Emails** - Quick email button to send pre-made templates from Call Center
5. **Auto Follow-Ups** - Emails sent on Contacted, Hired, Contracted, and Licensing actions
6. **Premium UI** - Clean, high-tech design throughout

---

## UI Styling Notes

All components will feature:
- Glass morphism cards with subtle borders
- Gradient accent colors (teal for primary actions)
- Smooth hover transitions
- Consistent spacing and typography
- Mobile-responsive layouts
- Dark theme optimized colors
