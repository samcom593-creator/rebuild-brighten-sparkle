

# Fix: Auto-Create Agent Record When Course Page Detects Missing Agent

## Problem
Cooper Ubert is logged in (auth user `41818231`), has a profile, and his application is marked as `licensed` — but no agent record exists. The Pipeline's `add-agent` call was added recently but Cooper was marked licensed before that fix. The course page shows "Course Access Required" because it requires an agent record.

This will happen again for any agent whose record wasn't properly provisioned.

## Fix

### 1. `src/pages/OnboardingCourse.tsx` — Auto-provision agent when missing
Replace the "Course Access Required" dead-end with automatic agent creation:
- When `agentNotFound` is true (no agent record for this user), check the `applications` table for a matching email with `license_status = 'licensed'`
- If found, call the `add-agent` edge function automatically to create the agent record
- Then retry fetching the agent ID and proceed to the course
- If no licensed application found, show a friendlier message: "Your manager hasn't marked you as licensed yet. Contact them for help."
- Keep the "Sign In Manually" button as a fallback

### 2. Immediate data fix for Cooper Ubert
Invoke `add-agent` via the edge function for Cooper Ubert specifically:
- firstName: Cooper, lastName: Ubert, email: cooperubert@gmail.com
- managerId: `7c3c5581-3544-437f-bfe2-91391afb217d` (from his application's assigned_agent_id)
- licenseStatus: licensed, hasTrainingCourse: true

### Files Modified
- **`src/pages/OnboardingCourse.tsx`** — Replace dead-end with auto-provisioning logic

### Technical Details
- The auto-provision uses the user's profile email to find their application
- Only triggers for `license_status = 'licensed'` applications to avoid creating agent records for unlicensed applicants
- Falls back gracefully if no matching application exists

