
# Fix Contracted People Not Appearing in CRM, Course, or Dashboard

## Root Cause Found

After investigating the database and code, I found **3 people** who were marked as "contracted" but have **no agent record created** -- meaning they're invisible to the CRM, course progress page, and dashboard roster:

1. **Donovan Robinson** (drobinson.2019@icloud.com) - contracted Feb 15
2. **Gabrielle Bannister** (bannigab000@gmail.com) - contracted Feb 6
3. **Gavin Charles** (06gman08@gmail.com) - contracted Feb 6

## Bugs Identified

### Bug 1: "Already Contracted" toggle silently fails
When the "Already contracted" toggle is ON in the Contract modal, the code tries to look up an existing agent by email. If none exists, it sets `newAgentId = null` and **proceeds anyway** -- marking the application as contracted but creating no agent record and skipping course enrollment entirely. This is the primary cause.

### Bug 2: Application status never updated
The ContractedModal sets `contracted_at` and `closed_at` timestamps but never updates the `status` field. The application stays as "new" or "approved", creating data inconsistency.

### Bug 3: Course enrollment is fire-and-forget
The `has_training_course = true` update and course enrollment email are called with `.then()` instead of being awaited. If they fail silently, the agent won't appear in course progress.

### Bug 4: Agent created with wrong onboarding stage
The `add-agent` function sets `onboarding_stage: "onboarding"` instead of `"training_online"` -- but contracted agents should be in the training stage.

## Fixes

### 1. Fix ContractedModal.tsx
- When "Already contracted" is ON and no existing agent is found: show an error toast and abort (don't mark application as contracted)
- Update application `status` to `"contracting"` alongside `contracted_at`
- Pass `hasTrainingCourse: true` to the `add-agent` function so it's set atomically in the initial insert
- Await the training course update instead of fire-and-forget
- Remove the redundant client-side `has_training_course` update since it'll be handled by add-agent

### 2. Fix add-agent Edge Function
- Accept new parameter `hasTrainingCourse` (boolean)
- When true, include `has_training_course: true` and `onboarding_stage: "training_online"` in the agent record insert
- This ensures the agent is created with the correct state in a single atomic operation

### 3. Repair Orphaned Data
- Use the `create-new-agent-account` edge function to create auth users, profiles, and agent records for the 3 orphaned contracted people
- Set `has_training_course: true` and `onboarding_stage: "training_online"` on each
- Link them to their assigned managers

## Files to Modify
1. `src/components/dashboard/ContractedModal.tsx` -- Fix all 4 bugs
2. `supabase/functions/add-agent/index.ts` -- Accept hasTrainingCourse param
3. Deploy both functions and repair the 3 orphaned records
