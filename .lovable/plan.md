

# Fix: Restore Full Admin Controls on Dashboard

## Root Cause
Your account (`bowmangrey296@gmail.com`) only has the **agent** role in the database. It is missing the **admin** and **manager** roles. This is why you cannot see the Command Center, promote managers, send login links, change license statuses, or do any admin actions --- all those features are gated behind `isAdmin` checks.

The admin features themselves still exist in the codebase (Command Center has promote/demote, login links, reassign, stage changes, etc.). The issue is purely that your account lost its elevated roles, and the Dashboard team view (`ManagerTeamView`) only shows minimal info when expanded --- no inline admin actions.

## Plan

### 1. Restore admin + manager roles to your account
- Database migration: INSERT `admin` and `manager` roles for your user ID into `user_roles`
- This immediately unlocks: Command Center, Lead Center, Notifications, CRM admin controls, Pipeline, Aged Leads, sidebar admin nav items

### 2. Add full inline actions to Dashboard team rows (ManagerTeamView)
Currently the expanded section only shows stats, license/stage info, "View in CRM", and "Email". We will add:

- **Send Portal Login** button (calls `send-agent-portal-login`)
- **Copy Login Link** button (calls `generate-magic-link`, copies to clipboard)
- **License Status toggle** (inline `LicenseProgressSelector` for agents with an application)
- **Change license** (licensed ↔ unlicensed direct toggle for agent records)
- **Promote to Manager / Remove Manager Role** button
- **Change Onboarding Stage** dropdown (onboarding → training → in field → evaluated)
- **Reassign to Manager** dropdown
- **Deactivate / Reactivate** button
- **Resend Licensing Instructions** button (for unlicensed agents)

All actions admin-only (hidden for non-admin users).

### 3. Add Dashboard shortcut buttons
- Add a "Command Center" quick-action card in the Dashboard top row (admin-only)
- Add an "Accounts" quick-action card (admin-only) linking to `/dashboard/accounts`

## Files

| File | Change |
|------|--------|
| DB migration | Insert admin + manager roles for your user |
| `src/components/dashboard/ManagerTeamView.tsx` | Add full admin action buttons in expanded section |
| `src/pages/Dashboard.tsx` | Add admin quick-action shortcuts (Command Center, Accounts) |

