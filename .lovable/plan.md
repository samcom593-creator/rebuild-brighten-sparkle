

## Comprehensive Plan: Aged Leads System + Call Mode + Purchase Lead Notifications

This plan addresses all your requirements for the aged leads system, call mode feature, purchase lead notifications, and overall performance optimization.

---

## Summary of Features

| Feature | Description |
|---------|-------------|
| Licensed/Unlicensed Filters | Filter buttons to toggle between licensed and unlicensed aged leads |
| Role-Based Access | Admin sees all + can add/move leads; Managers see only their assigned leads |
| Enhanced Lead Importer | CSV upload with first_name, last_name, email, phone, instagram, motivation/notes |
| Call Mode | High-performance one-lead-at-a-time calling interface with action buttons |
| Purchase Notifications | Email alerts to admin, manager, and purchaser when leads are bought |
| Performance Optimizations | Faster loading, optimized queries, and reduced re-renders |

---

## 1. Database Schema Enhancement

### Add columns to `aged_leads` table:
```sql
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS instagram_handle text;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS motivation text;
```

**Why**: These columns support the new import fields (Instagram handle and motivation/notes that get summarized).

---

## 2. Enhanced Aged Leads Page

### A) License Status Filter Buttons

Add toggle buttons at the top of the aged leads page:
- **Show Licensed** - Only appears if there are licensed leads
- **Show Unlicensed** - Only appears if there are unlicensed leads
- Buttons are hidden if that category is empty

### B) Role-Based Visibility (Already Partially Implemented)
- **Admin**: Full access - sees all leads, can import, assign, and move leads
- **Manager**: Only sees leads assigned to them via `assigned_manager_id`
- **Agents**: No access (already blocked in sidebar navigation)

### C) Updated Stats Display
- Admin sees total counts across all leads
- Managers see counts only for their assigned leads

---

## 3. Enhanced Lead Importer

### Improved CSV Parser with New Fields

**Supported columns:**
- `first_name` (required)
- `last_name` (required)
- `email` (required)
- `phone` (required)
- `instagram` or `instagram_handle` (optional)
- `motivation` or `notes` or `about_me` (optional - gets summarized into notes)
- `license_status` (optional - defaults to "unlicensed")

**Logic:**
1. Parse CSV headers intelligently (handle variations like "first name" vs "first_name")
2. Detect motivation-related columns and summarize into the `notes` field
3. Validate required fields before import
4. Show preview with license status breakdown
5. Admin selects manager to assign leads to

**New UI Elements:**
- File upload with drag-and-drop
- Auto-detect license status from CSV or let admin set default
- Preview shows: First 10 leads, counts by license status
- Clear error messages for validation issues

---

## 4. Call Mode Feature

### A) Entry Point
Add a prominent "Call Mode" button at the top of the Aged Leads page.

### B) Mode Selection Dialog
When tapped, shows:
- **Licensed Leads** button (only if licensed leads exist for this user)
- **Unlicensed Leads** button (only if unlicensed leads exist for this user)
- If either category is empty, that button doesn't appear
- If both are empty, show "No leads available" message

### C) Call Mode Interface

**Design Goals:**
- High-performance, minimal distractions
- One lead at a time with large, tappable action buttons
- Keyboard shortcuts for power users
- Progress indicator (e.g., "Lead 5 of 32")

**Layout:**
```
+------------------------------------------+
|  CALL MODE: Licensed Leads     [X Close] |
|  Progress: 5 / 32 remaining              |
+------------------------------------------+

+------------------------------------------+
|                                          |
|        [Lead Card - Full Width]          |
|                                          |
|   👤 John Smith                          |
|   📧 john@email.com                      |
|   📱 555-123-4567  [Tap to Call]         |
|   📸 @johnsmith_ig                       |
|                                          |
|   Notes:                                 |
|   "Looking to start a new career..."    |
|                                          |
+------------------------------------------+

+------------------------------------------+
|            ACTION BUTTONS                |
|                                          |
|  [✓ Hired]  [📄 Contracted]  [🎓 Lic.]   |
|                                          |
|  [❌ Not Qualified]    [📵 No Pickup]    |
|                                          |
+------------------------------------------+
```

**Actions and Outcomes:**
| Action | Status Set | Effect |
|--------|------------|--------|
| Hired | `hired` | Lead marked as successful, moves to next |
| Contracted | `contracted` | Lead marked as contracted, moves to next |
| Licensing (only for unlicensed) | `licensing` | Lead starting licensing process |
| Not Qualified | `not_qualified` | Lead rejected, moves to next |
| No Pickup | `no_pickup` | No answer, moves to next (can retry later) |

**Performance Optimizations:**
- Pre-fetch next 5 leads in background
- Instant UI updates (optimistic updates)
- Minimal animations to feel snappy
- Session persists across page refreshes

---

## 5. Purchase Lead Notifications

### When a user clicks "Continue to Venmo/Cash App" in the payment dialog:

**A) Capture the purchase intent:**
Store a pending purchase record before opening the payment link.

**B) Create new edge function: `notify-lead-purchase`**

Sends email notifications to:
1. **Admin** - "New lead purchase: [Package Name] from [User Name]"
2. **Manager (if user has one assigned)** - Same notification
3. **Purchaser** - Confirmation: "You've initiated a purchase for [Package Name]"

**Email Content:**
- Package name and price
- Purchaser name and email
- Payment method selected (Venmo/Cash App)
- Timestamp
- Note that payment confirmation is pending manual verification

**C) Update PurchaseLeads.tsx:**
- Call `notify-lead-purchase` edge function when user clicks "Continue to Payment"
- Store the user's intent in database (optional for tracking)
- Show toast: "Payment link opened - we've notified your manager"

---

## 6. Performance Optimizations

### A) Already Implemented (from previous work):
- AuthProvider singleton (single subscription)
- Route shell architecture (sidebar doesn't re-render)
- Removed blocking animations

### B) Additional Optimizations for Aged Leads:

1. **Pagination**: Load leads in batches of 50 instead of all at once
2. **Virtualized List**: Use virtual scrolling for large lead lists
3. **Optimistic Updates**: Update UI immediately, sync in background
4. **Debounced Search**: Prevent excessive re-renders while typing
5. **Memoized Filters**: Cache filtered results to avoid recalculation

### C) Query Optimizations:
- Add database indexes on `aged_leads.license_status` and `aged_leads.assigned_manager_id`
- Use `.select()` with only needed columns instead of `*`
- Implement cursor-based pagination for large datasets

---

## Technical Implementation Details

### Files to Create:
1. `src/components/dashboard/CallModeInterface.tsx` - The one-by-one lead calling UI
2. `src/components/dashboard/AgedLeadImporter.tsx` - Enhanced CSV importer
3. `supabase/functions/notify-lead-purchase/index.ts` - Email notification function

### Files to Modify:
1. `src/pages/DashboardAgedLeads.tsx` - Add filters, Call Mode button, update stats
2. `src/pages/PurchaseLeads.tsx` - Trigger notification on payment
3. `src/components/layout/GlobalSidebar.tsx` - Make Aged Leads visible to managers too

### Database Changes:
```sql
-- Add new columns to aged_leads
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS instagram_handle text;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS motivation text;

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_aged_leads_license_status 
ON aged_leads(license_status);

CREATE INDEX IF NOT EXISTS idx_aged_leads_manager_status 
ON aged_leads(assigned_manager_id, status);
```

---

## Access Control Summary

| Role | Aged Leads Access | Call Mode | Import Leads | Move/Assign Leads |
|------|-------------------|-----------|--------------|-------------------|
| Admin | All leads | Yes | Yes | Yes |
| Manager | Only assigned | Yes | No | No |
| Agent | None | No | No | No |

---

## Website Speed Notes

The previous changes (AuthProvider, route shell, animation fixes) should significantly improve navigation speed. Additional suggestions:

1. **Current hosting is adequate** - Lovable's hosting is optimized for React apps
2. **No additional purchases needed** - The performance issues were code-related, not infrastructure
3. **If still slow after these changes**, we can:
   - Implement service worker caching for static assets
   - Add React Query's `staleTime` optimization (already set to 2 minutes)
   - Lazy-load heavy components on demand

