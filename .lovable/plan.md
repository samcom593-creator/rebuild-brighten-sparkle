
# Simple One-Tap Invite Link + Cleanup

## What's Happening with "Recent Invitations"
The InvitationTracker component was already deleted and removed from Dashboard.tsx in the last edit. You're likely seeing a cached version. The code change will force a fresh build, which should clear it.

## New Feature: Quick Invite Link Generator

A compact card placed directly below the "Highest Closing Rate" and "Top Referrals" leaderboards. It works like this:

1. You tap "Generate Link" -- it creates a one-time code and shows the link
2. You tap the link to copy it
3. You send it to someone
4. They open the link, land on the signup page, create their account (or if their email/phone matches an existing agent, they get routed to set/change their password)
5. Once used, the link auto-deletes from the database
6. You can generate a new one anytime

No dialogs, no forms to fill out. Just generate, copy, send.

## Changes

### 1. New Component: `QuickInviteLink.tsx`
**File: `src/components/dashboard/QuickInviteLink.tsx`**

A small card with:
- "Generate Link" button -- creates a row in `manager_invite_links` with a random code and the current manager's agent ID
- Shows the generated link with a copy button
- "Delete" button to manually remove it
- Displays status: Active / Used

### 2. Auto-Delete Used Links
**File: `src/pages/AgentSignup.tsx`**

After a successful signup via a `ref` code, delete the invite link from `manager_invite_links` so it can only be used once. Currently the link stays active forever -- this change makes it one-time-use.

### 3. Place the Component in Dashboard
**File: `src/pages/Dashboard.tsx`**

Add `QuickInviteLink` right after the closing rate and referral leaderboard grid (line 367), inside the left column, visible to managers and admins only.

### 4. Remove the old "Invite Links" section (lines 400-428)
The existing "Invite Team Member" card at the bottom that just navigates to CRM is redundant. Remove it and replace the entire invite section with just the new QuickInviteLink.

## Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/QuickInviteLink.tsx` | New component: generate, copy, delete one-time invite links |
| `src/pages/Dashboard.tsx` | Add QuickInviteLink below leaderboards; remove old invite section |
| `src/pages/AgentSignup.tsx` | After successful signup, delete the used invite link |
| `manager_invite_links` table | No schema change needed -- already has `invite_code`, `manager_agent_id`, `is_active` |
