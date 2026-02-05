

# Implementation Plan: Admin Lead Center + Call Center Enhancements + Email Integration

## Overview

This plan implements a comprehensive lead management system including:
1. A new Admin Lead Center page with full assignment capabilities
2. Assignment buttons in existing AllLeadsPanel
3. Quick Email Menu integration in Call Center
4. Enhanced follow-up email triggers for all actions

---

## Files to Create

### 1. `src/pages/LeadCenter.tsx` (New File)

A dedicated admin-only page for full lead management with:
- Unified view of all leads from `applications` and `aged_leads` tables
- Search, filter by manager, status, and license type
- Stats cards showing totals, unassigned, licensed, and new counts
- Table with Assign button on every row using `QuickAssignMenu`
- Quick actions for call, email, and view
- Premium glass-morphism styling

---

## Files to Modify

### 2. `src/components/layout/GlobalSidebar.tsx`

**Changes:**
- Add "Lead Center" navigation item with `Target` icon
- Place after "Command Center" for admins only
- Route: `/dashboard/leads`

**Location:** After line 75 (after Command Center item)

```typescript
items.push({ 
  icon: Target, 
  label: "Lead Center", 
  href: "/dashboard/leads",
});
```

### 3. `src/App.tsx`

**Changes:**
- Add lazy import for LeadCenter page
- Add route inside AuthenticatedShell for `/dashboard/leads`

**Location:** Line ~45 (lazy imports) and line ~110 (routes)

### 4. `src/components/dashboard/AllLeadsPanel.tsx`

**Changes:**
- Import `QuickAssignMenu` component
- Add "Assign" column to table header
- Add `QuickAssignMenu` button in each lead row
- Add `fetchAllLeads` to refresh after assignment

**Key Addition (in renderLeadRow function):**
```typescript
<TableCell>
  <QuickAssignMenu
    applicationId={lead.id}
    currentAgentId={lead.assignedAgentId || null}
    onAssigned={fetchAllLeads}
  />
</TableCell>
```

### 5. `src/components/callcenter/CallCenterLeadCard.tsx`

**Changes:**
- Import `QuickEmailMenu` component
- Add Quick Email button alongside voice recorder
- Ensure all lead info (Instagram, email, notes) displays prominently

**Key Addition (after voice recorder section):**
```typescript
<QuickEmailMenu
  applicationId={lead.id}
  agentId={null}
  licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
  recipientEmail={lead.email}
  recipientName={lead.firstName + (lead.lastName ? ` ${lead.lastName}` : "")}
/>
```

### 6. `src/pages/CallCenter.tsx`

**Changes:**
- Update `sendFollowUpEmail` to accept `actionType` parameter
- Trigger follow-up email on multiple actions: `contacted`, `hired`, `contracted`, `licensing`
- Pass actionType to edge function for customized emails

**Key Update (in handleAction function):**
```typescript
const emailActions = ["contacted", "hired", "contracted", "licensing"];
if (emailActions.includes(actionId)) {
  await sendFollowUpEmail(currentLead, actionId);
  toast.success(`Lead marked as ${actionId} - follow-up email sent!`);
} else {
  toast.success(`Lead marked as ${actionId.replace("_", " ")}`);
}
```

### 7. `supabase/functions/send-post-call-followup/index.ts`

**Changes:**
- Accept optional `actionType` parameter in request body
- Customize email subject and opening based on action type
- Keep existing licensed/unlicensed branching for content

**Updated Interface:**
```typescript
interface PostCallFollowupRequest {
  firstName: string;
  email: string;
  licenseStatus: string;
  actionType?: string; // "contacted" | "hired" | "contracted" | "licensing"
  calendarLink?: string;
}
```

**Custom Subject Lines:**
- `contacted`: "Great Talking to You, {name}!"
- `hired`: "Welcome to the APEX Team, {name}!"
- `contracted`: "Congratulations on Getting Contracted, {name}!"
- `licensing`: "Your Licensing Journey Starts Now, {name}!"

---

## Technical Details

### Lead Center Page Structure

```text
LeadCenter.tsx
├── Header: "Lead Center" + Refresh/Export buttons
├── Stats Row: [Total] [Unassigned] [Licensed] [New]
├── Filters: Search | Manager | Status | License
└── Table
    ├── Name (+ email)
    ├── Phone
    ├── Location
    ├── Status (badge)
    ├── License (badge)
    ├── Assigned (name or "Unassigned")
    ├── Applied Date
    └── Actions: [Assign] [Call] [Email]
```

### Data Flow for Assignment

```text
Admin clicks [Assign] → QuickAssignMenu opens
→ Selects new manager
→ Updates applications.assigned_agent_id
→ Invokes notify-lead-assigned function
→ Refreshes lead list
```

### Email Trigger Flow

```text
Call Center Action clicked
→ Update lead status in DB
→ Check if action is in emailActions array
→ Send follow-up email with actionType
→ Edge function customizes subject/content
→ Show success toast
```

---

## QuickAssignMenu Integration

The existing `QuickAssignMenu` component already:
- Fetches all managers with the `manager` role
- Handles the assignment update to `applications.assigned_agent_id`
- Sends notification to the assigned manager
- Shows loading states and success/error toasts

We'll reuse this component in:
1. LeadCenter page (every row)
2. AllLeadsPanel (every row)
3. Optionally in CallCenterLeadCard

---

## UI/UX Enhancements

### Call Center Lead Card
- Instagram handle with direct link to profile
- Email with mailto link
- Phone with tap-to-call
- Notes/Motivation in clear section
- Voice recorder kept prominent
- New Quick Email dropdown

### Lead Center
- Glass-morphism card container
- Gradient accents (teal/primary)
- Responsive table with horizontal scroll on mobile
- Filter pills for quick status filtering
- Export button for CSV download

---

## Implementation Order

1. **GlobalSidebar.tsx** - Add navigation item (quick)
2. **App.tsx** - Add route (quick)
3. **LeadCenter.tsx** - Create new page (main work)
4. **AllLeadsPanel.tsx** - Add Assign column (moderate)
5. **CallCenterLeadCard.tsx** - Add QuickEmailMenu (moderate)
6. **CallCenter.tsx** - Update email triggers (moderate)
7. **send-post-call-followup Edge Function** - Add actionType support (moderate)

---

## Expected Outcomes

After implementation:
1. **Lead Center in sidebar** - Admins see "Lead Center" after "Command Center"
2. **Full lead visibility** - View all applications and aged leads in one place
3. **One-click assignment** - Click Assign on any lead to reassign to any manager
4. **Aisha fix** - Immediately reassign leads from Aisha back to yourself
5. **Call Center emails** - Quick email templates available during calls
6. **Auto follow-ups** - Emails sent on Contacted, Hired, Contracted, and Licensing
7. **Customized emails** - Subject lines vary based on action taken

