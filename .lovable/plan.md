

# Comprehensive Fix Plan: UI, Performance, and Features

## Issues Identified

Based on my analysis of the codebase and your feedback, here are the specific issues and their fixes:

---

## 1. Team Hierarchy: Missing Bulk Selection Checkboxes

**Current State:** The Team Hierarchy Manager table has no checkboxes for multi-select. Users cannot select multiple agents to delete at once.

**Files to Modify:** `src/components/dashboard/TeamHierarchyManager.tsx`

**Fix:**
- Add a `selectedAgents` state using `Set<string>`
- Add a header checkbox for "Select All"
- Add a checkbox column to each row
- Add a floating action bar at bottom when agents are selected
- The action bar will offer "Soft Remove" (deactivate) or "Permanent Delete" options

---

## 2. Sidebar Navigation Glitch (Expand/Contract on Click)

**Current State:** When clicking sidebar links, the sidebar visibly glitches - expanding and contracting before settling.

**Root Cause:** The `SidebarLayout.tsx` uses `AnimatePresence` and framer-motion transitions that conflict with React's re-render cycle during route changes.

**Files to Modify:** `src/components/layout/SidebarLayout.tsx`

**Fix:**
- Remove the page animation wrapper entirely (the sidebar is stable, only content should transition)
- Use CSS transitions instead of framer-motion for the main content area
- Simplify the mobile sidebar toggle logic to prevent re-renders

---

## 3. Command Center Loading Speed

**Current State:** Command Center shows "Loading hierarchy..." for several seconds.

**Files to Modify:** 
- `src/pages/DashboardCommandCenter.tsx`
- `src/components/dashboard/TeamHierarchyManager.tsx`

**Fix:**
- Increase `staleTime` from 60s to 120s
- Add `gcTime` of 600s (10 min cache)
- Use skeleton placeholders instead of spinners for perceived speed
- Defer non-critical components (Recognition Queue, Inactive sections) with React.lazy

---

## 4. Pipeline (Applications) Page Glitch

**Current State:** When tapping "Pipeline" in the sidebar, there's a noticeable glitch/flicker.

**Root Cause:** `DashboardApplicants.tsx` has multiple `AnimatePresence mode="wait"` blocks causing sequential animation queuing.

**Files to Modify:** `src/pages/DashboardApplicants.tsx`

**Fix:**
- Remove or replace `AnimatePresence mode="wait"` with `initial={false}`
- Simplify motion transitions

---

## 5. Course Progress: Add Full Screen Course Viewer + Remove Agents

**Current State:** "View Course Content" opens a dialog/modal. User wants a full-screen experience with ability to delete/unenroll agents.

**Files to Modify:**
- `src/pages/CourseProgress.tsx` 
- `src/components/admin/CourseContentViewer.tsx`

**Fix:**
- Create a new full-page route `/course-progress/content` that renders the course modules/videos/questions in a browsable format
- Add "View Full Course" button that navigates to this route
- Add "Unenroll" action in the agent dropdown (removes progress, sets stage to "onboarding", keeps agent record)

---

## 6. Team Hierarchy: "Edit Profile" Button in Actions Menu

**Current State:** The Edit Profile button already exists in the three-dot dropdown menu (line 603-606). This is working.

**Verification:** No change needed - already implemented.

---

## 7. Dashboard "Your Team" Should Show ALL Agents (Collapsible Hierarchy)

**Current State:** `ManagerTeamView` only shows direct reports. User wants to see ALL agents in a collapsible hierarchy.

**Files to Modify:** `src/components/dashboard/ManagerTeamView.tsx`

**Fix:**
- For admins: Fetch ALL agents and group by manager
- Display as collapsible tree: Admin at top, then managers with their teams as collapsible sub-sections
- Each manager section shows their direct reports (can expand/collapse)
- Add production numbers (week/month ALP, deals) like Command Center

---

## 8. Light Mode Theme: Hybrid (Cool Gray Background + Warm Cards)

**Current State:** Light mode uses warm beige/cream (HSL 40) throughout. User finds it too bright.

**Reference:** The screenshot shows a cooler gray-blue background with slightly warmer card surfaces.

**Files to Modify:** `src/index.css`

**Fix:**
- Change `:root` and `.light` background from `40 18% 88%` to `215 25% 90%` (cool gray-blue)
- Keep cards at warm cream `40 16% 97%` for contrast
- Reduce muted brightness
- Lower overall saturation to feel more professional

---

## 9. Hurry-Up Emails: Already Implemented Correctly

**Current State:** The `send-course-hurry-emails` edge function sends emails at 4h, 24h, and 48h intervals. This matches user preference.

**Verification:** No change needed.

---

## 10. Admin Should Always See Their Name in Team Hierarchy

**Current State:** Admin's name (Samuel James) is already prepended to the `filteredAgents` array with a "You" badge (lines 336-351).

**Potential Issue:** If admin has no production, they might be sorted low. Fix: Ensure admin is ALWAYS at the top regardless of sorting.

**Files to Modify:** `src/components/dashboard/TeamHierarchyManager.tsx` (line 336-351)

**Fix:** Already implemented - verify it's working correctly in the filtered logic.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add bulk selection checkboxes, floating action bar with soft/hard delete, ensure admin always at top |
| `src/components/layout/SidebarLayout.tsx` | Simplify transitions to eliminate glitch on navigation |
| `src/pages/DashboardCommandCenter.tsx` | Increase cache times, add skeletons |
| `src/pages/DashboardApplicants.tsx` | Remove `AnimatePresence mode="wait"` for faster transitions |
| `src/pages/CourseProgress.tsx` | Add unenroll action, link to full course view |
| `src/components/admin/CourseContentViewer.tsx` | Convert to full-page route instead of modal |
| `src/components/dashboard/ManagerTeamView.tsx` | Show ALL agents in collapsible hierarchy for admin |
| `src/index.css` | Hybrid light mode: cool gray background + warm cream cards |

## New Files to Create

| File | Purpose |
|------|---------|
| None | All changes are modifications to existing files |

## Expected Results

1. **Bulk selection in Team Hierarchy** - Checkboxes appear, can select multiple agents and soft remove or permanently delete
2. **No sidebar glitch** - Clicking navigation items transitions smoothly without expand/contract effect
3. **Faster Command Center** - Loads instantly with skeletons, data cached longer
4. **No Pipeline glitch** - Smooth transition when opening Pipeline page
5. **Full-screen Course Viewer** - Navigate to dedicated page showing all modules and questions
6. **Unenroll from Course** - Remove agents from course without deleting them
7. **Collapsible Team Hierarchy on Dashboard** - See all agents organized by manager
8. **Softer Light Mode** - Cool gray background with warm cards for premium, easy-on-eyes aesthetic

