

# Fix: Allow Any Agent to Be Added to Course

## Problem
The query on line 54 of `AddAgentToCourseDialog.tsx` filters agents to only those with `onboarding_stage = "onboarding"`. This excludes agents in any other stage (`training_online`, `contracted`, `live_field`, etc.), preventing you from enrolling anyone who isn't specifically in that one stage.

The empty-state message on line 198 also says "Agents must be in 'onboarding' stage", reinforcing this restriction.

## Fix

1. **Remove the `.eq("onboarding_stage", "onboarding")` filter** (line 54) — show all non-deactivated agents regardless of stage
2. **Update empty-state text** (line 198) — change to "No agents found"

This will let you enroll any active agent in the course, regardless of their current onboarding stage.

