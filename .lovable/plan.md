

# Fix "Add to Course" Dialog Filtering

## Problem
The dialog filters out agents who already have `has_training_course = true` or who have any `onboarding_progress` records. This means most agents in the "onboarding" stage are excluded, making it appear empty even when there are eligible agents.

**Current data confirms this:** 4 agents are in "onboarding" stage, but the filter eliminates 3 of them (2 have `has_training_course=true`, 1 has progress records), leaving only 1 visible.

## Fix (in `src/components/dashboard/AddAgentToCourseDialog.tsx`)

**Loosen the eligibility filter on line 70:**
- Remove the `!a.has_training_course` check — users should be able to re-enroll or enroll agents who were previously flagged
- Remove the `!agentsWithProgress.has(a.id)` check — agents with partial progress should still be enrollable
- This means we can also remove the entire `onboarding_progress` sub-query (lines 60-66) since it's no longer needed

**Result:** All non-deactivated agents in "onboarding" stage will appear in the dialog, regardless of prior course flags or progress.

The enrollment mutation (which sets `has_training_course = true` and moves stage to `training_online`) remains unchanged and correct.

