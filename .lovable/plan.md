
# Platform Refinement Plan

This plan addresses the user's specific feedback to polish the CRM, Applicants page, Dashboard, and Agent Portal systems.

---

## Issues Identified from User Feedback

1. **CRM Attendance Grid**: The 7-day grid is too cramped - need a compact view with hover popup to show detailed dates
2. **Agent Portal Login Flow**: Confirm that login emails direct to the production logging interface
3. **Team Directory**: Shows managers but NOT their agents underneath (hierarchy not displaying)
4. **Dashboard Layout**: Too much blank space, not sales-focused enough
5. **Applicants Page**: Contracted button should automatically transfer leads to CRM
6. **Overall UX**: Site needs to run more smoothly with better space utilization

---

## Technical Implementation

### 1. Compact Attendance Grid with Hover Popup

**File**: `src/components/dashboard/AttendanceGrid.tsx`

**Changes**:
- Reduce the grid to ultra-compact mode (5px smaller cells, minimal spacing)
- Wrap each day's button in a `HoverCard` (Radix UI) that shows:
  - Full date (e.g., "Sunday, January 26")
  - Current status with icon
  - Click instruction
- Keep the core toggle functionality intact
- Use the existing `HoverCard` component from `src/components/ui/hover-card.tsx`

**Before**: 7 boxes inline taking too much space
**After**: 7 tiny dots/squares that expand on hover to show full details

---

### 2. Agent Portal Login Confirmation

**Current State**: The `send-agent-portal-login` edge function sends an email with:
- Link to `/agent-portal`
- Instructions to log in with their email
- Information about logging daily numbers

**Issue**: Agents may not have accounts set up yet

**Solution**: Update the welcome email to include BOTH:
1. Link to `/agent-portal` (for logged-in access)
2. Link to `/log-numbers` (for quick number entry without login)

**File**: `supabase/functions/send-agent-portal-login/index.ts`

**Changes**:
- Add a secondary link for `/log-numbers` with explanation
- Clarify that they can log numbers immediately without account setup
- Include manager's Discord link for onboarding support

---

### 3. Team Directory Agent Display Fix

**File**: `src/components/dashboard/ManagersPanel.tsx`

**Current Issue**: The `teamMembers` array is populated but appears to be empty in the UI because:
- The query filters by `invited_by_manager_id` correctly
- However, agents may not have `invited_by_manager_id` set properly

**Verification**: Check if agents have the correct `invited_by_manager_id` linking to their manager

**Changes**:
1. Add debug logging to verify agents are being fetched
2. Ensure the Collapsible component expands properly
3. Add a fallback message if no team members exist
4. Auto-expand managers with team members for better visibility

---

### 4. Dashboard Sales-Pro Focus + Space Optimization

**File**: `src/pages/Dashboard.tsx`

**Changes**:
1. **Tighten layout**:
   - Reduce `mb-6` to `mb-4` between sections
   - Reduce `gap-4` to `gap-3` in grids
   - Remove redundant spacing around section headers

2. **Sales Section Priority**:
   - Move Sales Performance section above Growth section
   - Make sales leaderboards more prominent
   - Add personal production stats inline with leaderboards

3. **Remove dead space**:
   - Condense the AI Features section (currently takes full width)
   - Move License Distribution charts to a collapsible section
   - Combine redundant stat cards

4. **Grid optimization**:
   - Use `lg:grid-cols-3` for leaderboards instead of 2
   - Stack mobile views more efficiently

---

### 5. Contracted Button Auto-Transfer to CRM

**Current Flow**: 
1. Click "Contracted" button on Applicants page
2. `ContractedModal` opens and marks `contracted_at`
3. Sends email with CRM setup link
4. **MISSING**: Does NOT create agent record in CRM

**Required Changes**:

**File**: `src/components/dashboard/ContractedModal.tsx`

**Changes**:
1. After marking as contracted, automatically:
   - Create a new `agents` table record for the applicant
   - Link to the manager via `invited_by_manager_id`
   - Set `onboarding_stage` to "onboarding" (they start fresh in CRM)
   - Copy profile data from application

2. Show success message: "Agent added to CRM - they'll appear in 'In Course' column"

**File**: `supabase/functions/notify-agent-contracted/index.ts`

**Changes**:
1. After sending the email, create the agent record in the database
2. Link to the referring manager
3. Log the creation in contact_history

---

### 6. Overall UX Smoothness

**Files**: Various pages

**Changes**:
1. **Consistent loading states**: Add skeleton loaders matching content dimensions
2. **Transition animations**: Use `AnimatePresence mode="wait"` consistently
3. **Pre-fetch data**: On Dashboard mount, prefetch leaderboard data in background
4. **Reduce layout shift**: Set explicit min-heights on dynamic content areas

---

## Implementation Order

### Phase 1: Core Workflow Fixes (High Priority)
1. Fix Contracted button to auto-create CRM agent record
2. Fix Team Directory to show agents under managers
3. Update portal login email with /log-numbers link

### Phase 2: UI Compactness (Medium Priority)
4. Implement compact attendance grid with hover
5. Tighten Dashboard layout and remove dead space
6. Make Dashboard more sales-focused

### Phase 3: Polish (Enhancement)
7. Add skeleton loaders for smooth loading
8. Optimize transition animations

---

## Files to be Modified

| File | Changes |
|------|---------|
| `src/components/dashboard/AttendanceGrid.tsx` | Add HoverCard wrapper for compact view with hover details |
| `src/components/dashboard/ContractedModal.tsx` | Auto-create agent record in CRM after contracting |
| `src/components/dashboard/ManagersPanel.tsx` | Debug and fix team member display |
| `src/pages/Dashboard.tsx` | Tighten spacing, sales-focus layout |
| `supabase/functions/send-agent-portal-login/index.ts` | Add /log-numbers link to email |
| `supabase/functions/notify-agent-contracted/index.ts` | Auto-create agent in CRM |

---

## Expected Outcomes

1. **CRM Grid**: Compact day indicators that expand on hover to show full date/status
2. **Agent Login**: Clear path to both full portal and quick number entry
3. **Team Directory**: Managers show their agents underneath in expandable list
4. **Dashboard**: Denser, sales-focused layout with minimal blank space
5. **Contracted Flow**: One-click from Applicants → CRM with automated record creation
6. **Overall**: Smoother transitions, less layout jank, professional feel
