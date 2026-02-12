
# Fix Course Login, Manager Password Reset, and Pipeline Manager Badges

## Issues Identified

### 1. No "Resend Course Login" button for already-enrolled agents
The "Add to Course" button only works for unenrolled agents. Once enrolled, there's no way to resend the course login email. Agents who miss or lose their initial email are stuck. A dedicated "Resend Course Login" button will be added to CRM cards for agents in the course stage.

### 2. Managers cannot reset passwords for their downline
The `reset-agent-password` edge function currently only allows admins (line 45-51: `if (!isAdmin)`). Managers need the same ability for their direct reports. The edge function will be updated to also allow managers, but only for agents in their downline.

### 3. Manager name badges too subtle / not showing for all agents
The badge code exists (line 714-718) but uses `bg-muted/50 text-muted-foreground` which is nearly invisible on the dark theme. The styling will be made more prominent with a teal/cyan color scheme so it stands out.

---

## Changes

### File 1: `src/pages/DashboardCRM.tsx`
- Add a "Resend Course Login" button next to the existing "View Training Course" link for agents in the `onboarding` or `training_online` stage. This button calls `send-course-enrollment-email` to send a fresh magic link.
- Make the manager badge more visible: change from `bg-muted/50 text-muted-foreground` to `bg-sky-500/10 text-sky-400 border-sky-500/30` so it clearly stands out.
- Only show the manager badge when the agent's manager is different from the current user's agent (to avoid showing "Under Sam" for Sam's own direct reports).

### File 2: `supabase/functions/reset-agent-password/index.ts`
- Allow managers (not just admins) to reset passwords, but only for agents where `invited_by_manager_id` matches the manager's agent ID.
- Logic: check if user has admin OR manager role. If manager, verify the target user's agent record has `invited_by_manager_id` matching the caller's agent ID.

### File 3: `src/components/dashboard/AgentQuickEditDialog.tsx`
- No code changes needed here -- the UI for password reset already exists. Once the edge function accepts managers, this will work automatically.

---

## Technical Details

### Resend Course Login Button
A small button will be added in the CRM card's "In Course" section that:
1. Calls `send-course-enrollment-email` with the agent's ID
2. Shows a loading spinner while sending
3. Toasts success/failure

### Manager Password Reset (Edge Function)
```
Current: Only admin role allowed
New:     Admin OR (manager role + target agent is in their downline)
```

The edge function will:
1. Check if caller has admin or manager role
2. If manager, query `agents` table to verify `targetUserId`'s agent record has `invited_by_manager_id` matching the caller's agent ID
3. If neither condition met, return 403

### Manager Badge Visibility Fix
- Change color from muted gray to sky blue for contrast
- Add the current user's agent ID tracking (already fetched at line 256-260) and filter out badges for agents directly under the current user
