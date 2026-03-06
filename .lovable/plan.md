

# Go-Live Remediation — Implementation Plan

## Problem
10 pages inside `AuthenticatedShell` (which already provides `SidebarLayout`) redundantly wrap content in `DashboardLayout`, causing double sidebar rendering. Additionally, 4 key pages lack sound effect feedback on critical actions, and the PWA config is missing an OAuth denylist.

## Changes

### 1. Remove DashboardLayout double-wrap from 10 pages
Each page: remove the `DashboardLayout` import line, replace `<DashboardLayout>` opening tag with a fragment `<>`, replace `</DashboardLayout>` closing tag with `</>`.

| Page | Lines to fix |
|------|-------------|
| `DashboardCommandCenter.tsx` | import line 26, wraps at ~510, ~523, ~1087 |
| `AgentPortal.tsx` | import line 36, wrap in return |
| `OnboardingCourse.tsx` | import line 14, wrap in return |
| `CourseProgress.tsx` | import line 23, wrap in return |
| `CourseContent.tsx` | import line 15, wrap in return |
| `AdminCalendar.tsx` | import line 15, wrap in return |
| `SeminarAdmin.tsx` | import line 8, wraps at 89/204 |
| `AgentPipeline.tsx` | import line 23, wrap in return |
| `TeamDirectory.tsx` | import line 15, wrap in return |
| `DashboardAccounts.tsx` | import line 24, wrap in return |

### 2. Add sound effects to 4 pages
Import `useSoundEffects` and call `playSound("success")` / `playSound("error")` on key action handlers:

- **CalendarPage.tsx**: on schedule interview success/error, no-show toggle, interview deletion
- **DashboardAgedLeads.tsx**: on bulk assign success/error, bulk delete, single actions
- **LeadCenter.tsx**: on bulk assign, delete, ban actions
- **DashboardApplicants.tsx**: on hire, terminate, restore, stage change actions

### 3. PWA OAuth denylist
In `vite.config.ts`, add `navigateFallbackDenylist: [/^\/~oauth/]` inside the `workbox` config object.

### Files modified
- 10 page files (remove DashboardLayout wrapper)
- 4 page files (add sound effects)
- `vite.config.ts` (PWA fix)
- Total: 15 file edits, no database changes

