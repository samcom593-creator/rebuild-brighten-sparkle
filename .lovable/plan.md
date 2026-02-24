

# Full Implementation: Batch Blast Deploy + Dashboard Inactive Management + Sound Effects + Site Polish

## Status of Previous Work

Everything from the approved plan has already been implemented in code:
- Batch blast edge function (`send-batch-blast/index.ts`) -- created and registered in config.toml
- NotificationHub rewrite with batch orchestration, live progress bar, confetti -- done
- Fragment key fix -- done
- Login sound effects -- done
- GlobalSidebar click sounds -- done
- ScheduleBar pulse + sounds -- done
- partial_applications GRANT migration -- done

The edge function needs to be deployed to start working.

## What Still Needs to Be Done

### 1. Deploy `send-batch-blast` Edge Function
The function code exists but hasn't been deployed yet. This is why the blast appears frozen -- it's calling a function that doesn't exist on the server.

### 2. Dashboard Inactive Agent Management -- Simplified Flow
The `ActivationRiskBanner` on the Dashboard already lets admins move agents to inactive one-by-one or in bulk. The Command Center has a 3-dot menu with Reactivate. But there's no quick "Mark Active" toggle directly from the Dashboard risk banner, and inactive agents still show in various views (leaderboards, team views) causing confusion.

**Changes to `ActivationRiskBanner.tsx`:**
- Add a "Reactivate" button alongside the existing "Inactive" button on each agent row
- Add sound effects (success on inactive/reactivate, error on failure)
- When an agent is marked inactive, they're automatically hidden from all leaderboards and team views (this already works via the `is_inactive` flag -- just need to confirm filtering)

**Changes to `DashboardCommandCenter.tsx`:**
- Add an "Inactive" quick filter tab so admins can see and manage all inactive agents in one view
- Add sound effects on filter switches, agent actions, and reactivation

### 3. Sound Effects on Dashboard.tsx
- Add `useSoundEffects` hook
- Play "click" on quick action card taps
- Play "whoosh" on tab/filter switches

### 4. Verify All Filtering is Consistent
Confirm that inactive agents (`is_inactive = true`) are properly excluded from:
- LeaderboardTabs (production leaderboard)
- ManagerTeamView
- TeamSnapshotCard
- ClosingRateLeaderboard / ReferralLeaderboard

---

## Technical Details

### Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/send-batch-blast/index.ts` | Deploy only (no code changes) |
| `src/components/dashboard/ActivationRiskBanner.tsx` | Add "Reactivate" button per row, add sound effects on all actions |
| `src/pages/Dashboard.tsx` | Add `useSoundEffects`, play sounds on quick action clicks |
| `src/pages/DashboardCommandCenter.tsx` | Add "inactive" filter option to QuickFilters, add sound effects on actions |
| `src/components/admin/QuickFilters.tsx` | Add "Inactive" filter option |

### ActivationRiskBanner Enhancement

Each at-risk agent row currently has: **Inactive** | **Settings** | **Dismiss**

Updated to: **Inactive** | **Reactivate** | **Settings** | **Dismiss**

The Reactivate button is shown for agents that are currently inactive (visible if they were previously marked inactive from this banner). It performs the same atomic reactivation as the Command Center: sets `status = active`, clears `is_deactivated`, `is_inactive`, and `deactivation_reason`.

### QuickFilters Update

Current filter tabs: `Producers` | `Needs Attention` | `Zero Production` | `Course Purchased` | `All`

Updated to: `Producers` | `Needs Attention` | `Zero Production` | `Inactive` | `All`

The "Inactive" filter shows agents where `isInactive = true` or `isDeactivated = true`, giving admins a single view to manage and reactivate dormant agents without navigating away from the Command Center.

### Sound Effects Integration

- **Dashboard.tsx**: `playSound("click")` on quick action card clicks
- **DashboardCommandCenter.tsx**: `playSound("click")` on filter changes, `playSound("success")` on reactivation/deactivation, `playSound("error")` on failures
- **ActivationRiskBanner.tsx**: `playSound("success")` on move-to-inactive, `playSound("celebrate")` on bulk inactive, `playSound("error")` on failures

