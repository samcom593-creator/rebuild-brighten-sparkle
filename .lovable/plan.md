

# Enroll Brandon Kenney & Luis Garcia in Course

## Current State
- **Luis Garcia** — Agent record exists (`f4daff0b`), stage: "onboarding", `has_training_course = false`. Ready to enroll.
- **Brandon Kenney** — Only exists as an application/lead (`cabbd7f7`, email: bkenney899@gmail.com). No agent account yet. Needs account creation first.

## Steps

### 1. Create Brandon Kenney's agent account
Call the existing `add-agent` edge function with his application data:
- Name: Brandon Kenney
- Email: bkenney899@gmail.com
- `hasTrainingCourse: true` (creates him directly in `training_online` stage)
- He'll get default password `123456` and a welcome email

### 2. Enroll Luis Garcia
Update his agent record:
- Set `onboarding_stage` → `training_online`
- Set `has_training_course` → `true`
- Create initial `onboarding_progress` record for the first module
- Send course enrollment email via `send-course-enrollment-email`

### 3. Create initial course progress for Brandon
After his agent account is created, insert an `onboarding_progress` record for the first active module so the course page loads correctly.

### Implementation
I'll add a small temporary handler in `DashboardCRM.tsx` or — more practically — I'll invoke the edge functions and DB updates directly from the existing `AddAgentToCourseDialog` enrollment mutation (which already handles step 2). For Brandon, I'll first call `add-agent`, then run the same enrollment flow.

No code changes needed — I'll execute these as database operations using the existing edge functions and direct updates.

