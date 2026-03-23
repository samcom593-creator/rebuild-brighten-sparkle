

# Fix: Auto-Create Agent When Marked Licensed in Pipeline

## Problem
When someone like "Cooper" is marked as **licensed** in the Pipeline (`AgentPipeline.tsx`), the code only updates the `applications` table fields (`license_status`, `license_progress`). It does **NOT** call `add-agent` to create an actual agent record. Without an agent record, the person never appears in the Dashboard, CRM, or Course.

The `DashboardApplicants.tsx` page already has this logic — when you hire someone who is licensed there, it calls `add-agent` automatically. But the Pipeline page skips this entirely.

## Fix

### 1. `src/pages/AgentPipeline.tsx` — Trigger agent creation when stage changes to "licensed"
In the `handleStageChange` function (line 151), after successfully updating the application to "licensed":
- Look up the full application data from the local state
- Call `supabase.functions.invoke("add-agent")` with firstName, lastName, email, phone, managerId (the current user's agent ID), licenseStatus "licensed", hasTrainingCourse true
- Show a toast confirming the agent was created and enrolled in the course
- This mirrors the exact same logic already in `DashboardApplicants.tsx` lines 334-356

### 2. No database changes needed
The `add-agent` edge function already handles everything: creates the agent record, provisions auth, sets onboarding stage, and sends the course enrollment email.

### Files Modified
- **`src/pages/AgentPipeline.tsx`** — Add `add-agent` edge function call when `newStage === "licensed"`

