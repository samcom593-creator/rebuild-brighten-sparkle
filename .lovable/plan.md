

# Comprehensive Fix: Notifications, Pipeline, and CRM Overhaul

## What I Found

### Notifications
The "Resend All Failed" logic is technically correct -- it deduplicates and skips already-delivered targets. The issue is that when ALL failures are already resolved (which is the current state), the user sees a confusing "zero sent" result. The messaging needs to be even clearer, and the button itself needs better labeling so you understand what will happen before clicking.

### Pipeline (`/agent-pipeline`)
The Pipeline page only fetches applications where `assigned_agent_id` matches the current user's agent ID. For managers/admins, it does NOT show recruits assigned to agents under them -- only their direct assignments. There is also no way to toggle visibility of people assigned under other managers, and no category-based collapsible columns.

### CRM (`/dashboard/crm`)
The CRM already has a solid table + expanded card view. But:
- The default table view dumps all agents into one flat list with no category grouping
- Stat cards expand to card grids, not into grouped/collapsible sections
- No manager-assignment toggle ("show mine vs show all")
- Missing sound effects on key actions (stage changes, hide agent)
- The expanded view uses a card grid instead of the row-based table standard

---

## Implementation Plan

### 1. Pipeline: Add collapsible category columns with full-screen expand

**File: `src/pages/AgentPipeline.tsx`**

Replace the flat list/kanban toggle with a **category-column layout** inspired by the CRM but tailored for the pipeline:

- Add collapsible sections: **Needs Outreach**, **Course Started**, **Test Phase**, **Final Steps**, **Licensed**
- Each section shows a count badge and collapses/expands with animation + sound effect
- Tapping a section header uncollapses it to show all agents in that license_progress stage
- Only one section can be expanded at a time (accordion-style) for full-screen use
- Each row within a section shows: name, email, phone, contact freshness, license progress, and quick actions (call, email, schedule)

**Data changes:**
- For managers: Also fetch applications assigned to agents under them (`invited_by_manager_id`), with a toggle "My Recruits Only" vs "All Team Recruits"
- For admins: Show all, with a manager filter dropdown
- Add a "Hide Assigned to Others" toggle that filters out agents assigned to managers other than the current user

### 2. Pipeline: Add manager filter + visibility toggles

**File: `src/pages/AgentPipeline.tsx`**

- Add a toggle button: "My Recruits" (default) / "Full Team" 
- When "Full Team" is selected, fetch applications where `assigned_agent_id IN (current_agent_id, agents under current manager)`
- Add a "Show Licensed" toggle (default off) to declutter the active pipeline
- Add sound effects (whoosh on section expand, click on filter toggle, success on stage change)

### 3. CRM: Upgrade default view with grouped collapsible table sections

**File: `src/pages/DashboardCRM.tsx`**

Replace the flat table with **grouped table sections** that work like collapsible category panels:

- Group rows by: **Onboarding** | **In-Field Training** | **Live**
- Each group has a colored header bar with icon, label, count, and expand/collapse chevron
- Clicking a group header expands that section in-place (no page navigation), showing the full table rows
- Multiple sections can be open simultaneously
- Add framer-motion slide animations on expand/collapse
- Play "whoosh" sound on expand, "click" on collapse
- Color-code the group headers: primary for Onboarding, amber for Training, emerald for Live
- The existing stat cards at the top remain, but clicking them now scrolls to and expands the relevant section instead of navigating to a card grid

### 4. CRM: Add "Assigned Under Me" visibility control

**File: `src/pages/DashboardCRM.tsx`**

- For managers: Add a prominent toggle "Show agents under other managers" (default: off for managers, on for admins)
- When off, only shows agents where `managerId === currentAgentId`
- The "Under [Manager Name]" badge already exists on cards; this just controls filtering
- Sound effect on toggle

### 5. CRM: Upgrade expanded view from cards to table rows

**File: `src/pages/DashboardCRM.tsx`**

- When a stat card or group header is clicked, the expanded view should use a **high-density table** (matching the default table format) instead of the card grid
- This preserves information density and aligns with the row-based CRM standard
- Keep the staggered entrance animation and spring transitions
- Add inline expand for each row (click row to show agent details, notes, attendance in a collapsible sub-row)

### 6. Sound effects + visual polish across both pages

**Files: `src/pages/AgentPipeline.tsx`, `src/pages/DashboardCRM.tsx`**

- Whoosh on section expand/collapse
- Click on filter button presses
- Success on stage changes, mark contacted
- Celebrate on licensed milestone
- Color-coded section borders with subtle glow on hover
- Staggered row entrance animations (existing pattern from framer-motion)

### 7. Notification Hub: Improve "Resend All Failed" button clarity

**File: `src/pages/NotificationHub.tsx`**

- Rename button from "Retry Failed" to "Retry Unresolved Failures"
- Add a subtitle under the button showing today's failed count + unique target count so you know what to expect before clicking
- When result is "all resolved," show a green success banner inline (not just a toast) that persists on the page
- Add a "Last retry: X minutes ago" timestamp so you know if you already ran it

---

## Technical Details

```text
Pipeline Category Layout:
┌─────────────────────────────────────────┐
│ 📣 Needs Outreach (12)          [▼]    │
├─────────────────────────────────────────┤
│ Name    │ Email   │ Contact │ Actions   │
│ Jane D  │ j@...   │ Never   │ 📞📧📅  │
│ ...     │         │         │           │
├─────────────────────────────────────────┤
│ 📚 Course Started (5)           [▶]    │  ← collapsed
├─────────────────────────────────────────┤
│ 📝 Test Phase (3)               [▶]    │  ← collapsed
├─────────────────────────────────────────┤
│ 🔑 Final Steps (2)              [▶]    │  ← collapsed
├─────────────────────────────────────────┤
│ 🏆 Licensed (8)                 [▶]    │  ← collapsed
└─────────────────────────────────────────┘

Toggle: [My Recruits ●] [Full Team ○]
Filter: [All Stages ▼] [Search... 🔍]
```

```text
CRM Grouped Table:
┌─────────────────────────────────────────┐
│ 📖 Onboarding (15)              [▼]    │
├─────────────────────────────────────────┤
│ Agent │ Stage │ License │ Course │ ...  │
│ rows...                                 │
├─────────────────────────────────────────┤
│ 🎓 In-Field Training (8)       [▶]    │
├─────────────────────────────────────────┤
│ 💼 Live (22)                    [▶]    │
└─────────────────────────────────────────┘
```

### No database changes needed
All data is already available through existing queries and RLS policies. The pipeline just needs to expand its query to include `invited_by_manager_id` chain for team visibility.

