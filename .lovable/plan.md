

# Emergency: Restore All Agents + Remove Invitation Tracker

## What Happened
The "Recent Invitations" X button terminated **12 agents** in a 40-second window (21:39 UTC today). Each click set `is_deactivated: true` and `status: "terminated"`, which removed them from the Dashboard, CRM, Command Center, and destroyed their close rate visibility.

## Agents to Restore (12 total)
Aisha Kebbeh, Samuel James, Brennan Barker, Chukwudi Ifediora, Bryan Ross, Moody Imran, Jacob Causer, Mitchell Urewuji, Ashton McPhaul, deondric williams, Wayne Price, KJ Vaughns

## Changes

### 1. Database: Restore all 12 terminated agents
Run a single UPDATE to reactivate all agents that were terminated during the 21:39 UTC window:

```sql
UPDATE agents
SET is_deactivated = false, status = 'active', deactivation_reason = NULL
WHERE id IN (
  'bc2216a9-e269-4202-bba0-5fc25b87da1c',
  '11213154-5d01-4522-8019-fb3cc7c9672b',
  '61c4e8ca-1895-45ba-856b-f5ad98a5400e',
  'a60e70c5-f2d4-4a3d-bcdb-0002327f8e3f',
  'e4babe59-9c35-41bf-b6ed-4d5cd3968e1f',
  'af13f7f5-789e-4d92-81dc-1511efcc8fab',
  '4fdb2e83-e66c-465e-8df4-076174e70b82',
  'ca03724a-6a9a-41e6-8ee6-f3045134960c',
  'f01e9127-0d0f-4881-9468-5fc933f59afa',
  'a067eb8d-8df0-4319-befc-316bcdad03ff',
  '414c1d1c-1a11-477c-ada4-0c30ac35a835',
  '431dff0d-7c82-4134-a85e-457e5226fc7f'
);
```

This will immediately bring back all 12 agents across Dashboard, CRM, Command Center, and restore their close rates.

### 2. Remove the InvitationTracker component entirely
**File: `src/pages/Dashboard.tsx`**
- Remove the import of `InvitationTracker`
- Remove the line `{(isManager || isAdmin) && <InvitationTracker />}`

**File: `src/components/dashboard/InvitationTracker.tsx`**
- Delete this file entirely -- it is too dangerous to keep since its X button terminates real agents

### 3. Verify merge tool works for all agents
The `DuplicateMergeTool.tsx` already has the `user_id` fallback and includes all agents (active, inactive, terminated). No code change needed -- once the 12 agents are restored, they will appear in the merge list immediately.

## Technical Details

| Action | Detail |
|--------|--------|
| Database UPDATE | Restore 12 agents: set `is_deactivated = false`, `status = 'active'` |
| `src/pages/Dashboard.tsx` | Remove InvitationTracker import and usage |
| `src/components/dashboard/InvitationTracker.tsx` | Delete file |
| Merge tool | No change needed -- already includes all agents with fallback |

