
Goal
- Fix the “X” (Unenroll) button so when you click it, the agent is removed from the Course Progress list (the progress bar list) immediately and does not reappear.

Root cause (why it “does nothing” visually)
- The Unenroll logic in `src/pages/CourseProgress.tsx` currently:
  1) Deletes rows from `onboarding_progress`
  2) Sets the agent’s `onboarding_stage` back to `"onboarding"` and `has_training_course` to `false`
- BUT the list you’re looking at is built from agents where `onboarding_stage IN ("onboarding","training_online")`.
  - So after unenroll, the agent is still eligible for the list (because they’re still in `"onboarding"`), and you keep seeing them (often as 0% / not started), which feels like the X “didn’t work”.

What “remove them” should mean
- “Remove from the Course Progress progress-bar list” should mean: they are no longer considered “in course / being tracked for course progress”.
- That should be represented by: `onboarding_stage = "training_online"` (in course) vs anything else (not in course).
- Therefore, the Course Progress monitor should only display agents who are actually in the course stage (and optionally flagged with `has_training_course=true`).

Implementation plan (code changes)

1) Fix the data source for the Course Progress list (the actual cause)
A) Update the FULL Course Progress page query
- File: `src/pages/CourseProgress.tsx`
- Change the agents query from:
  - `.in("onboarding_stage", ["onboarding", "training_online"])`
  to:
  - `.eq("onboarding_stage", "training_online")`
- Optional additional safety filter (recommended):
  - also require `.eq("has_training_course", true)` so the definition of “in course” is consistent even if a stage is accidentally toggled.

Result:
- Once an agent is unenrolled and moved back to `"onboarding"`, they disappear from this list immediately after refetch.

B) Update the Command Center “Course Progress” sidebar card query
- File: `src/components/admin/CourseProgressPanel.tsx`
- Change the agents query from:
  - `.in("onboarding_stage", ["onboarding", "training_online"])`
  to:
  - `.eq("onboarding_stage", "training_online")`
- Optional: same additional filter `.eq("has_training_course", true)`.

Result:
- After unenroll, they also disappear from the small progress-bar card on `/dashboard/command`, preventing the “I still see them” confusion.

2) Make the X button behave like a true “remove”
A) Only show the X button when it makes sense
- File: `src/pages/CourseProgress.tsx`
- Right now the X button renders for every row.
- Update so the X button only shows for agents who are actually “in course”, e.g.:
  - `agent.onboardingStage === "training_online"` (and/or `agent.hasStarted` / `has_training_course` if we add it to the query response).
This prevents clicks that appear “broken” (like clicking X on someone not in course / no progress).

B) Add a confirmation (prevents accidental removals)
- Add a small confirm UI before executing the unenroll mutation:
  - Option 1: Simple `AlertDialog` (Radix UI exists in the project)
  - Option 2: A lightweight confirm toast action
- Label clearly: “Remove from Course (hide from progress list)”.

C) Make the UI update instantly (no waiting / no doubt)
- After successful unenroll:
  - Immediately remove the agent from the local `["course-progress-full"]` cache via `queryClient.setQueryData(...)` (optimistic UX).
  - Then also `invalidateQueries` to ensure the backend is the source of truth.

3) Ensure every place that shows “course progress bars” updates
A) Invalidate both relevant React Query caches after unenroll/enroll
- File: `src/pages/CourseProgress.tsx`
  - On unenroll success, invalidate:
    - `["course-progress-full"]`
    - `["course-progress-admin"]` (so the command-center card refreshes too)
- File: `src/components/dashboard/AddAgentToCourseDialog.tsx`
  - On enroll success, also invalidate:
    - `["course-progress-admin"]` (same reason)

(Other screens like Team Directory / Team Hierarchy may not use React Query; they typically refresh on navigation. If any do cache, we’ll add their keys too after we verify.)

4) (If needed) Verify the backend permission is not the blocker (quick sanity check)
Even though the RLS policy exists, we’ll confirm we’re not silently failing:
- Add explicit error logging/toast detail when `progressError` or `agentError` occurs (including the message).
- This way, if deletion is blocked for a specific user role, you’ll see “Permission denied” instead of a silent “nothing happened”.

Acceptance criteria (what you should see)
- On `/course-progress`: click X → the agent disappears from the list immediately.
- Navigate back to `/dashboard/command`: the Course Progress card no longer shows that agent.
- If you re-enroll them, they appear again under “training_online”.

Testing checklist (end-to-end)
1) Pick a test agent currently in course (`training_online`) with visible progress.
2) Go to `/course-progress`, click X, confirm:
   - agent disappears immediately
   - refresh page: still gone
3) Go to `/dashboard/command` and confirm:
   - agent is not in the Course Progress card
4) Re-enroll the same agent via “Add to Course”:
   - agent shows again in `/course-progress`
   - agent shows again in the command-center card

Files that will be changed
- `src/pages/CourseProgress.tsx` (fix query stage filter, improve X button behavior, invalidate both caches, optional optimistic removal + confirm)
- `src/components/admin/CourseProgressPanel.tsx` (fix query stage filter)
- `src/components/dashboard/AddAgentToCourseDialog.tsx` (invalidate the admin course progress cache after enroll)

Notes / why this is the correct fix
- The backend delete/update is likely already working; the UI logic is what keeps the agent visible because “onboarding” is still included in the “in course” list.
- Restricting the progress monitor to `training_online` makes the progress-bar list represent “currently in course,” which aligns with your intent: remove = stop tracking in this course progress monitor.
