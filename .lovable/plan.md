
# Plan: Create Dedicated Call Center + Fix Pipeline

## Summary

You want two distinct experiences:
1. **Pipeline** - Visual organization of leads by category, for seeing where leads are at different stages
2. **Call Center** - Dedicated page for processing leads one at a time with action buttons

Currently, there's a "Call Mode" popup that only works for aged leads. We'll create a proper standalone **Call Center page** that works with both aged leads AND new applicants, with filtering options.

---

## What Will Be Built

### 1. New Call Center Page (`/dashboard/call-center`)

A dedicated full-page experience for calling leads:

- **Pre-call filters**: Choose what to call
  - Source: Aged Leads, New Applicants, or All
  - License Status: Licensed, Unlicensed, or All
  
- **One lead at a time display** showing:
  - Name, phone (tap to call), email, Instagram
  - Notes and motivation
  - How long ago they applied
  
- **Quick action buttons**:
  - Hired (green)
  - Contracted (blue)
  - Licensing (purple) - unlicensed only
  - Not Qualified (red)
  - No Pickup (amber)
  - **Skip** (move to next without updating)
  
- **Progress tracker**: Shows X of Y leads processed
- **Keyboard shortcuts**: 1-5 for actions, N for next, ESC to exit

### 2. Sidebar Navigation Update

Add "Call Center" with a phone icon to the sidebar, visible to Admins and Managers.

### 3. Keep Pipeline Separate

The Pipeline page (`/dashboard/applicants`) stays focused on visual organization - seeing all leads categorized by status without the one-at-a-time calling flow.

---

## User Experience Flow

```text
Sidebar → Call Center → Select filters → Start Calling
          ↓
     [Lead Card]
     Name: John Smith
     Phone: (555) 123-4567 [Tap to Call]
     Email: john@email.com
     Instagram: @johnsmith
     Notes: Interested in financial career...
          ↓
     [Action Buttons]
     [Hired] [Contracted] [Licensing] [Not Qualified] [No Pickup]
                    [Skip to Next →]
          ↓
     Progress: 5/32 processed • 27 remaining
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/pages/CallCenter.tsx` | Create | New dedicated Call Center page |
| `src/components/layout/GlobalSidebar.tsx` | Modify | Add Call Center nav item |
| `src/App.tsx` | Modify | Add route for `/dashboard/call-center` |

---

## Technical Details

### Call Center Page Logic

1. **Data Sources**: Query both `aged_leads` and `applications` tables based on source filter
2. **Unified Lead Interface**: Normalize data from both tables into a common format
3. **Status Updates**: 
   - For aged_leads: Update `status` column
   - For applications: Update `status` column with matching values
4. **Skip Functionality**: Move to next lead without database update
5. **Role-based filtering**:
   - Admins see all leads
   - Managers see only their assigned leads

### Filter Options

```text
Source Filter:
- All Sources
- Aged Leads (from aged_leads table)
- New Applicants (from applications table)

License Filter:
- All
- Licensed
- Unlicensed

Status Filter (what to show):
- New / Uncontacted
- No Pickup (retry)
- Contacted
```

### Action Button Mappings

| Button | Status Value | Available For |
|--------|-------------|---------------|
| Hired | `hired` | All leads |
| Contracted | `contracted` | All leads |
| Licensing | `licensing` | Unlicensed only |
| Not Qualified | `not_qualified` | All leads |
| No Pickup | `no_pickup` | All leads |

---

## Expected Outcomes

After implementation:
- New "Call Center" link appears in sidebar for Admins/Managers
- Clicking it opens a full-page calling interface
- Users can filter by aged leads vs new applicants, and by license status
- Leads display one at a time with tap-to-call functionality
- Action buttons update lead status and automatically advance to the next lead
- Skip button allows moving to next without updating
- Progress bar shows calling progress
- Pipeline page remains unchanged for visual lead organization
