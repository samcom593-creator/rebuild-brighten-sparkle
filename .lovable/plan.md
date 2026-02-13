

# Fix Dashboard Accuracy, Website Submission, and Goals

## Problems Found

### 1. Unlicensed People Not Showing on Dashboard
The "Your Team" section (ManagerTeamView) only pulls data from the `agents` table. There is **only 1 active unlicensed agent** in that table, but there are **54 unlicensed applicants** in the `applications` table (21 new, 21 reviewing, 8 no-pickup, 2 approved, 2 rejected). When you mark someone as "Hired" in the Call Center, it changes the application status to "reviewing" but does NOT create an agent record. These people are invisible to the dashboard.

**Fix:** Update the ManagerTeamView to also query the `applications` table for unlicensed applicants and merge them into the team roster as "Pipeline" members. The stat cards (Team Members, Licensed, Unlicensed, In Training) will include application counts so the numbers match what you see in the Call Center.

### 2. Recruiting Stats Still Undercounting
The AgencyGrowthCard counts "New Hires" using contracted/approved applications only. Most hired people have status "reviewing" (not "contracted" or "approved"), so they are missed. 

**Fix:** Count all non-terminated applications created in the period (regardless of status) as new hires, combined with new agent records. This captures everyone who applied or was added.

### 3. Website Submission "Failing"
The person trying to apply (wyattearp07@outlook.com) already has an existing application from Feb 11. The duplicate check is correctly blocking a double submission. The error toast says "An application with this email or phone already exists" but may not be prominent enough.

**Fix:** Make the duplicate error message more prominent and user-friendly with a longer-duration toast that explains what to do. Also add a visible inline error banner so the user doesn't miss it on mobile.

### 4. Goals Failing to Save
The Income Goal Tracker queries the `agent_goals` table. The RLS policies look correct, but will add better error logging to surface exactly what fails. Will also ensure the admin's deactivated agent record doesn't cause issues.

---

## Technical Changes

### File 1: `src/components/dashboard/ManagerTeamView.tsx`
- After fetching agents, also query `applications` table for non-terminated applicants
- Merge unlicensed applications into the team member list as "pipeline" entries with license status "unlicensed"
- Update the stat card counts: `unlicensedCount` = unlicensed agents + unlicensed applications not yet in agents table
- Deduplicate by email to avoid counting someone who exists in both tables

### File 2: `src/components/dashboard/AgencyGrowthCard.tsx`
- Change the "New Hires" query to count ALL non-terminated applications created in the period (not just contracted/approved)
- Keep the `Math.max(apps, agents)` logic but with the broader application filter
- This should show the true number of people who came in during each period

### File 3: `src/pages/Apply.tsx`
- Improve the duplicate error handling: show a larger, more visible inline error banner (not just a toast) when a 409 duplicate response is received
- Add "Contact us at info@apex-financial.org" to the duplicate message so the person knows what to do
- Increase toast duration to 8 seconds for duplicate errors

### File 4: `src/components/dashboard/IncomeGoalTracker.tsx`
- Add detailed console logging for the save operation to capture exactly what error occurs
- Add a fallback: if `current_agent_id()` returns null (no agent record), show an informative message instead of silently failing
- Ensure the error toast shows the actual error message for debugging

