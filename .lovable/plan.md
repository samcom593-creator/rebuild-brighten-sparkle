

# Remove All Invitation Tracking

Strip out every invitation-related component, import, and UI section across the entire app.

## Components to Delete (files removed entirely)

- `src/components/dashboard/QuickInviteLink.tsx`
- `src/components/dashboard/InviteManagerCard.tsx`
- `src/components/dashboard/AdminManagerInvites.tsx`
- `src/components/dashboard/ManagerInviteLinks.tsx`
- `src/components/dashboard/InviteTeamModal.tsx`

## Files to Edit

### Dashboard (`src/pages/Dashboard.tsx`)
- Remove imports for `InviteManagerCard` and `QuickInviteLink`
- Remove the `QuickInviteLink` render block (around line 371)
- Remove the `InviteManagerCard` render block (around lines 405-409)

### Command Center (`src/pages/DashboardCommandCenter.tsx`)
- Remove imports for `AdminManagerInvites`, `InviteTeamModal`, `ManagerInviteLinks`
- Remove the `AdminManagerInvites` grid section (around lines 943-947)
- Remove the `ManagerInviteLinks` usage inside the collapsible section (around line 963)
- Remove the `InviteTeamModal` render and its `showInviteModal` state + any "Invite" button that opens it

### Accounts Page (`src/pages/DashboardAccounts.tsx`)
- Remove import for `AdminManagerInvites`
- Remove the `AdminManagerInvites` render block (around lines 405-408)

### Global Sidebar (`src/components/layout/GlobalSidebar.tsx`)
- Remove import for `InviteTeamModal`
- Remove the `InviteTeamModal` render (around line 423) and its associated state (`showInviteModal`)
- Remove whatever sidebar button triggers the invite modal

No database tables are deleted -- only the UI references are removed. The underlying `manager_signup_tokens` and `manager_invite_links` tables stay in the database in case they're ever needed again.

i only mean the tracker dashborf inside the dashbboard thats it 
