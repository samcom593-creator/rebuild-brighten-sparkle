

# Plan: Manager Login Link Forwarding + Agent Login Management in CRM

## Feature 1: Send Agent Sign-In Link to Manager

Currently, `send-agent-portal-login` sends the magic link email to the **agent** and CCs the manager. The request is for a dedicated flow that sends the sign-in link **directly to the manager** when an agent hasn't signed up — so managers can hand-deliver access.

### Changes

**New Edge Function: `send-login-to-manager/index.ts`**
- Accepts `agentId` parameter
- Looks up the agent's profile, checks `portal_password_set` status
- Finds the agent's manager via `invited_by_manager_id`
- Generates a magic link for the agent (reuses existing token pattern)
- Sends an email **to the manager** with the agent's sign-in link, the agent's name, and instructions to forward/share with the agent
- CC's admin as usual
- Email template: "Hey [Manager], here's a direct login link for [Agent Name]. Share this with them if they haven't been checking their inbox."

**UI: Add "Send Link to Manager" button in `AgentQuickEditDialog.tsx`**
- New button in the Account Management section (alongside existing "Send Portal Login")
- Label: "Send Login to Manager"
- Only shows when agent has an `invited_by_manager_id`
- Calls the new edge function

**UI: Add same button in `ApplicationDetailSheet.tsx`**
- Add an admin-only section at the bottom of the detail sheet with a "Send Login to Manager" action for agents who have an `assigned_agent_id` linked to a real agent record

## Feature 2: Change Agent Login Info from CRM/Dashboard Detail Sheets

The `AgentQuickEditDialog` already has email update + password reset for admins. The `ApplicationDetailSheet` (used in CRM, Pipeline, Call Center) does **not** have this capability.

### Changes

**Enhance `ApplicationDetailSheet.tsx`**
- After the existing "Notes" section, add an admin-only "Account Management" panel (similar to the one in AgentQuickEditDialog)
- Look up the agent record via `assigned_agent_id` to get `user_id`
- If agent has a login (`user_id` exists), show:
  - Current email display
  - Change email input + button (calls `update-user-email` edge function)
  - Reset password input + button (calls `reset-agent-password` edge function)
  - "Send Portal Login" button (calls `send-agent-portal-login`)
  - "Send Login to Manager" button (calls new `send-login-to-manager`)
- If no login exists, show a "Create & Send Login" flow

## Files to Create/Edit

1. **Create** `supabase/functions/send-login-to-manager/index.ts` — new edge function
2. **Edit** `src/components/dashboard/AgentQuickEditDialog.tsx` — add "Send Login to Manager" button
3. **Edit** `src/components/dashboard/ApplicationDetailSheet.tsx` — add Account Management section for admins
4. **Edit** `supabase/config.toml` — register new edge function with `verify_jwt = false`

## Scope
- 1 new edge function
- 3 files edited
- No database changes
- No new dependencies

