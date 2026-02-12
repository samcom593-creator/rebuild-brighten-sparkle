

# Assign All Existing Unassigned Leads to You

## What's Already Done

The previous changes already ensure:
- All **new** leads are auto-assigned to you (admin agent ID) when submitted
- The RLS policy no longer shows unassigned leads to other managers
- New agents created from the leaderboard start at Step 1 ("Onboarding")

## What's Left

There are **6 existing leads** in the database that were created before the auto-assignment change. They still have no `assigned_agent_id`, meaning they're invisible to everyone (since the new RLS policy no longer shows unassigned leads to managers).

## The Fix

Run a one-time data update to assign those 6 orphaned leads to your admin agent ID (`7c3c5581-...`).

## Technical Details

| Action | Detail |
|--------|--------|
| Data update (not a migration) | `UPDATE applications SET assigned_agent_id = '7c3c5581-3544-437f-bfe2-91391afb217d' WHERE assigned_agent_id IS NULL AND terminated_at IS NULL` |

This is a data operation, not a schema change -- it simply fills in the missing assignment on the 6 existing leads so they show up under your account.

No code files need to change. Everything else (auto-assignment for new leads, RLS lockdown, onboarding stage fix) is already deployed from the previous plan.
