

# Fix Course Access for All Agents

## Problem
1. **"My Course" link is hidden from managers/admins** — the sidebar only shows it to agents who are NOT admin/manager (line 144 in GlobalSidebar.tsx). So managers testing or viewing the course can't even see the link.
2. **No self-enrollment path** — when an agent is hired and their `has_training_course` flag isn't set, the course still works (the hook auto-creates progress records), but there's no visible affordance or confirmation that they're enrolled.
3. **Potential RLS silent failures** — if an agent's `user_id` isn't linked to their agent record (e.g., created via admin bulk action without auth account), `current_agent_id()` returns NULL, and all INSERT/UPDATE/SELECT on `onboarding_progress` silently return empty, making the course appear broken.

## Fix

### 1. GlobalSidebar.tsx — Show "My Course" to ALL authenticated users
Move the "My Course" link out of the agent-only block so managers and admins also see it. Add it to the manager/admin tools section as well.

### 2. OnboardingCourse.tsx — Auto-enroll on first visit
When an agent visits the course page and has no progress records yet, automatically set `has_training_course = true` on their agent record. This ensures the enrollment flag is always in sync with actual course usage — no manual enrollment step needed.

### 3. OnboardingCourse.tsx — Remove the "Course Access Required" gate
Instead of showing "Course Access Required" when `agentNotFound` is true, show a more helpful message. The `agentNotFound` state only triggers when there's no agent record linked to the user — which is a real auth/account issue, not a course access issue. Keep this error but improve the messaging.

### Files Modified
- **`src/components/layout/GlobalSidebar.tsx`** — Add "My Course" link for all roles (managers, admins, agents)
- **`src/pages/OnboardingCourse.tsx`** — Auto-set `has_training_course = true` when agent first loads the course
- **`src/hooks/useOnboardingCourse.ts`** — No changes needed (already handles auto-creating progress records)

