
# Live Performance, Team Scoping, Fast Profile Creation & Merge System

## Overview

This is a comprehensive update to fix production data accuracy, implement proper metric scoping by role, and add the ability for admins to create new agent profiles + send magic login links directly from the leaderboard.

---

## Part 1: Live Data with Real-Time Updates

### Problem
- 2026 YTD and 4-week production history may not be updating in real-time
- Data requires manual refresh to see latest changes

### Solution
Add Supabase real-time subscriptions to auto-update stats when production data changes.

**Files to modify:**
- `src/components/dashboard/YearPerformanceCard.tsx` - Add real-time subscription
- `src/components/dashboard/ProductionHistoryChart.tsx` - Add real-time subscription
- `src/components/dashboard/TeamSnapshotCard.tsx` - Add real-time subscription

**Implementation:**
```typescript
// Add to each component
useEffect(() => {
  const channel = supabase
    .channel("live-production")
    .on("postgres_changes", { event: "*", schema: "public", table: "daily_production" }, () => {
      fetchStats(); // Re-fetch on any change
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [agentId]);
```

---

## Part 2: Metric Scope Rules by Role

### Admin View (Sam)
- Dashboard shows **TEAM TOTAL** production (not personal-only)
- YearPerformanceCard fetches ALL agents' production
- TeamSnapshotCard already scopes correctly for admin

### Manager View
- Dashboard shows **team totals + personal production**
- Scoped to `invited_by_manager_id = current_agent_id`

### Agent View
- Dashboard shows **personal numbers only**
- No team totals visible

**Files to modify:**
- `src/components/dashboard/YearPerformanceCard.tsx` - Add role-aware scoping
- `src/pages/AgentPortal.tsx` - Already handles admin/manager scoping, verify logic

**Changes to YearPerformanceCard:**
- Accept optional `isAdmin` and `isManager` props
- If admin: query ALL agents' production for YTD
- If manager: query team + self
- If agent: query personal only

---

## Part 3: Leaderboard Admin Tools - Create Profile + Login

### New Capability
Admin can tap any leaderboard entry (especially "Unknown Agent") and either:
1. **MERGE** with existing agent (already implemented)
2. **CREATE PROFILE + SEND LOGIN** (new feature)

### UI Flow in AgentQuickEditDialog
```text
┌─────────────────────────────────────────────────────┐
│  Edit Agent: Unknown Agent                          │
│  ─────────────────────────────────────────────────  │
│  📋 Imported as: KJ Vaughns (kj@email.com)         │
│  ─────────────────────────────────────────────────  │
│  Display Name: [___________________]                │
│  Email: [_____________] (required for login)       │
│  Phone: [_____________] (optional)                 │
│  Instagram: [___________] (optional)               │
│  ─────────────────────────────────────────────────  │
│  🔍 Possible Matches: (for merge)                  │
│  ○ John Smith (john@email.com) - $3,420            │
│  ─────────────────────────────────────────────────  │
│  [ Save Name ]  [ Merge ]  [ Create & Send Login ] │
└─────────────────────────────────────────────────────┘
```

### "Create & Send Login" Button Logic
1. If agent has no `user_id` (orphan record):
   - Create Supabase Auth user with **no password** (magic link only)
   - Create profile record
   - Link agent record to new `user_id` and `profile_id`
   - Set `onboarding_stage = "evaluated"` (LIVE status)
   - Set `is_deactivated = false`, `is_inactive = false`
   - Generate magic link via `generate-magic-link`
   - Send welcome email with magic link
   - Sync to CRM automatically

2. If agent already has `user_id`:
   - Just generate new magic link and send it

**New Edge Function: `create-agent-from-leaderboard`**
```typescript
// Input: { agentId, email, fullName, phone?, instagramHandle? }
// Steps:
// 1. Create auth user (no password, email_confirm: true)
// 2. Create profile
// 3. Update agent record with user_id, profile_id, onboarding_stage = "evaluated"
// 4. Add agent role
// 5. Generate magic link
// 6. Send welcome email with magic link
// 7. Return success with magic link for display
```

**Files to modify:**
- `src/components/dashboard/AgentQuickEditDialog.tsx` - Add "Create & Send Login" button and form fields
- Create `supabase/functions/create-agent-from-leaderboard/index.ts`

---

## Part 4: Magic Link Login - No Password Required

### Current State
- Magic links work via `generate-magic-link` + `verify-magic-link`
- Links expire in 24 hours

### Enhancements
1. **Persistent Sessions**: Already implemented via Supabase client config
2. **"Remember This Device"**: Sessions persist in localStorage by default
3. **Re-entry Flow**: If session expires, agent enters email/phone to receive new magic link

### First-Time Agent Experience
1. Agent receives email: "Your portal access is ready"
2. Clicks magic link → opens directly into portal (no password prompt)
3. Inside dashboard, they can **optionally**:
   - Set password (not required)
   - Add Instagram handle
   - Upload profile picture

---

## Part 5: Optional Profile Completion

### Profile Tab in Agent Dashboard
Make it clear that profile fields are optional and non-blocking.

**Already implemented in `ProfileSettings.tsx`:**
- Full name (required for display)
- Email (required for login)
- Phone (optional)
- City/State (optional)
- Instagram handle (optional)
- Bio (optional)
- Avatar upload (optional)

### Change Needed
Add a banner/note in Settings indicating: "Complete your profile for a personalized experience. All fields except name and email are optional."

---

## Part 6: Database Changes

### Add columns for quick profile creation (if not present):
None needed - existing schema supports all required fields.

### Enable real-time on daily_production (if not enabled):
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_production;
```
Note: This may already be enabled based on existing real-time subscriptions.

---

## Implementation Summary

### New Files to Create
| File | Purpose |
|------|---------|
| `supabase/functions/create-agent-from-leaderboard/index.ts` | Create profile + send magic link from leaderboard |

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/dashboard/YearPerformanceCard.tsx` | Add role-aware scoping, real-time subscription |
| `src/components/dashboard/ProductionHistoryChart.tsx` | Add real-time subscription |
| `src/components/dashboard/TeamSnapshotCard.tsx` | Add real-time subscription (verify existing logic) |
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Add Create & Send Login button, email/phone fields |
| `src/components/dashboard/ProfileSettings.tsx` | Add "optional fields" clarification banner |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `create-agent-from-leaderboard` | New - creates auth user + profile + sends magic link |
| `generate-magic-link` | Existing - generates magic link |
| `send-agent-portal-login` | Existing - sends portal access email |

---

## Expected Results

After implementation:
- ✅ **2026 YTD and 4-week production update in real-time** - no manual refresh needed
- ✅ **Admin sees TEAM totals** on dashboard by default
- ✅ **Manager sees team + personal** production
- ✅ **Agent sees personal only**
- ✅ **Admin can tap any leaderboard entry** and create profile + send login in seconds
- ✅ **New agents get magic link email** - no password required
- ✅ **Persistent sessions** - agents stay logged in
- ✅ **Optional profile fields** - Instagram, photo, etc. are non-blocking
- ✅ **Created agents auto-set to LIVE status** (if on scoreboard = selling)
- ✅ **Agents pushed to CRM automatically** on creation

---

## Technical Flow: Admin Creates Agent from Leaderboard

```text
Admin taps "Unknown Agent" on leaderboard
           ↓
AgentQuickEditDialog opens
           ↓
Shows "Imported as: [name]" from linked profile
           ↓
Admin enters/confirms:
- Full Name (pre-filled from import)
- Email (required)
- Phone (optional)
- Instagram (optional)
           ↓
Admin clicks "Create & Send Login"
           ↓
Edge Function: create-agent-from-leaderboard
  1. Create Supabase Auth user (no password)
  2. Create profile record
  3. Update agent: user_id, profile_id, onboarding_stage = "evaluated"
  4. Add "agent" role
  5. Generate magic link
  6. Send welcome email
           ↓
Toast: "Login sent to [email]! Agent is now LIVE."
           ↓
Leaderboard refreshes with correct name
```
