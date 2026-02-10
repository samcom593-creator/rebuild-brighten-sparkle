
# Fix Course Progress to Show All Agents (Including Completed)

## Problem

Both `CourseProgressPanel.tsx` and `CourseProgress.tsx` filter agents with `.eq("onboarding_stage", "training_online")`, which excludes agents who completed the course and moved to later stages like `in_field_training` or `evaluated`. Current data shows:

- 2 agents in `training_online` (visible)
- 3 agents in `in_field_training` (hidden -- completed course)
- 5 agents in `evaluated` (hidden -- completed course)
- 2 agents in `onboarding` (hidden -- enrolled but not started)

That means 10 out of 12 enrolled agents are invisible.

## Solution

Remove the `onboarding_stage` filter and instead query all agents where `has_training_course = true`. The existing filter badges (Not Started, In Progress, Stalled, Complete) will handle categorization.

## Technical Changes

### 1. `src/components/admin/CourseProgressPanel.tsx` (line 58)

Remove `.eq("onboarding_stage", "training_online")` from the agents query. Keep all other filters (`has_training_course = true`, `is_deactivated = false`).

### 2. `src/pages/CourseProgress.tsx` (line 127)

Same change -- remove `.eq("onboarding_stage", "training_online")` from the agents query.

Also update the stage badge display (line 573) to show more meaningful labels for agents in later stages (e.g., "Field Training", "Evaluated") instead of just "Course" vs "Onboard".

### 3. Sorting improvement

Currently sorted lowest-first. Add secondary sort so completed agents appear at the bottom (they need the least attention), and stalled/at-risk agents appear at the top.

## Files to Modify

- `src/components/admin/CourseProgressPanel.tsx` -- Remove stage filter (1 line change)
- `src/pages/CourseProgress.tsx` -- Remove stage filter, update stage badge labels, improve sort order
