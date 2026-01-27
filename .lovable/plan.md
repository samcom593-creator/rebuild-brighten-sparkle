
# Agent Portal V2: Zero-Friction Daily Stats & Leaderboard

## Executive Summary
Rebuild the agent portal to be a lightning-fast, habit-forming daily tool. Primary goal: **agent clicks link → enters numbers → sees leaderboard → done in under 30 seconds**. Eliminate all forced re-logins, simplify authentication to email/phone only (no password by default), and create a high-density, visually intelligent leaderboard.

---

## Current State Analysis

### What Exists
- **AgentPortal.tsx**: Full dashboard with stats, charts, goals, weekly badges (621 lines - too heavy for daily use)
- **LogNumbers.tsx**: Standalone public entry (no auth) with search-by-name flow
- **AgentNumbersLogin.tsx**: Email-first login with password/set-password flows
- **ProductionEntry.tsx**: 8-field stat entry form with manager team selector
- **LeaderboardTabs.tsx**: Full-featured leaderboard with day/week/month, sorting, rank changes

### Pain Points
1. **Forced re-login**: Sessions expire or users hit login walls clicking email links
2. **Too much friction**: Multiple steps to get to number entry
3. **Heavy portal**: AgentPortal loads too much (charts, badges, goals) for quick daily use
4. **Leaderboard UX**: Oversized rows, low density, too much dead space
5. **Manager notifications**: Only admin gets production emails, not direct managers

---

## Architecture Decisions

### 1. Single Entry Point Strategy
Create **one unified route** (`/numbers`) that handles everything:
- Already authenticated? → Show entry form immediately
- Not authenticated? → Show inline login (email/phone only)
- No CRM match? → Create quick account inline

### 2. "Simple Login" as Default
- First visit: Enter email OR phone
- System checks CRM via `check-email-status`
- **CRM match found**: Immediately grant access (no password)
- **No match**: Quick inline signup (name + email/phone)
- Session persists via Supabase auth with extended expiry

### 3. Optional Password Lock
After first login, agents can optionally enable "Require password" in settings. Default is **Simple Login** (identifier only).

---

## Implementation Plan

### Phase 1: Create Unified Portal Page (`/numbers`)

**New file: `src/pages/Numbers.tsx`**

A single-screen experience combining:
1. **Inline Auth Block** (only if not logged in)
   - Email/phone input
   - Auto-lookup against CRM
   - If found: create session instantly (no password)
   - If not found: show name field + create account
   
2. **Stat Entry Section**
   - Compact 2x4 grid (same 8 fields)
   - Large, touch-friendly inputs
   - Single "Submit" button
   - Micro-animation + sound on success

3. **Compact Leaderboard**
   - High-density rows (avatar + name + key stats)
   - Day/Week/All toggle
   - Highlight current user position
   - Real-time updates

**Key UX Features:**
- Page remembers scroll position
- Keyboard-optimized (tab through fields)
- Works perfectly on mobile
- No unnecessary sections (no charts, badges, goals on this page)

### Phase 2: Passwordless Session System

**Update `check-email-status` edge function:**
- Return `passwordRequired: boolean` from agent settings
- Default: `false` (simple login)

**New field on agents table:**
```sql
ALTER TABLE agents ADD COLUMN password_required boolean DEFAULT false;
```

**New edge function: `simple-login`**
- Receives: email or phone
- Checks CRM match
- If match + `password_required = false`:
  - Generate a session token via Supabase Admin API
  - Return auth session to frontend
- If match + `password_required = true`:
  - Return `{ requiresPassword: true }`
- If no match:
  - Return `{ needsAccount: true }`

**Frontend flow:**
```
User enters email/phone
  ↓
Call simple-login
  ↓
├─ Session returned → setSession → navigate to entry form
├─ requiresPassword → show password field
└─ needsAccount → show name field → create account → auto-login
```

### Phase 3: Compact Leaderboard Component

**New component: `src/components/dashboard/CompactLeaderboard.tsx`**

Design specifications:
- **Row height**: 40px (currently ~60px)
- **Avatar**: 28px circle (currently 32px)
- **Columns**: Rank | Avatar+Name | Deals | ALP
- **No hover cards or tooltips on mobile**
- **Current user row**: Highlighted with subtle glow
- **Top 3**: Gold/Silver/Bronze icons inline

**Layout:**
```
┌──────────────────────────────────────────────┐
│ Today ▼   [Day] [Week] [All]                 │
├──────────────────────────────────────────────┤
│ 🥇 JD  John Doe         5    $12,400         │
│ 🥈 AS  Alice Smith      4    $9,800          │
│ 🥉 BJ  Bob Johnson      3    $7,200          │
│ 4  MK  Mike Kim         2    $4,500          │
│ ▸ 5  YOU  Your Name     1    $2,100  ◀       │
│ 6  TW  Tom Wilson       1    $1,800          │
└──────────────────────────────────────────────┘
```

### Phase 4: Manager Notifications on Submission

**Update `notify-production-submitted` edge function:**

1. Lookup agent's `invited_by_manager_id`
2. Fetch manager's profile email
3. Send identical production email to:
   - Admin (existing: `info@kingofsales.net`)
   - Direct manager (new)

**Email subject for manager:**
```
🔥 [Agent Name] just logged production | $X,XXX ALP
```

### Phase 5: CRM Manager Assignment Icon

**Update `DashboardCRM.tsx` agent cards:**

Add a small icon button (e.g., `Users` icon) next to each agent that opens a quick menu to:
- View current manager
- Reassign to different manager

**New component: `ManagerAssignMenu.tsx`**
- Dropdown showing all managers
- Click to reassign `invited_by_manager_id`
- Immediately updates CRM

### Phase 6: Manager Production Dashboard

**Add section to `Dashboard.tsx` for managers:**

**New component: `ManagerProductionStats.tsx`**
- Shows aggregate stats for direct reports:
  - Total team ALP (today/week/month)
  - Total deals closed
  - Average close rate
  - Active agents count
- Expandable to see individual agent stats

---

## Database Changes

```sql
-- Add password preference to agents
ALTER TABLE agents ADD COLUMN password_required boolean DEFAULT false;

-- Index for faster manager lookups
CREATE INDEX IF NOT EXISTS idx_agents_invited_by_manager 
ON agents(invited_by_manager_id) WHERE is_deactivated = false;
```

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `src/pages/Numbers.tsx` | Unified entry point: auth + entry + leaderboard |
| `src/components/dashboard/CompactLeaderboard.tsx` | High-density leaderboard |
| `src/components/dashboard/ManagerProductionStats.tsx` | Manager's team production view |
| `src/components/dashboard/ManagerAssignMenu.tsx` | Quick manager reassignment |
| `supabase/functions/simple-login/index.ts` | Passwordless auth flow |

### Modified Files
| File | Changes |
|------|---------|
| `src/App.tsx` | Add `/numbers` route (unprotected, handles own auth) |
| `supabase/functions/check-email-status/index.ts` | Return `passwordRequired` field |
| `supabase/functions/notify-production-submitted/index.ts` | CC direct manager on production emails |
| `src/pages/Dashboard.tsx` | Add ManagerProductionStats for managers |
| `src/components/dashboard/DashboardCRM.tsx` | Add manager reassignment icon |

---

## Session Persistence Strategy

**Current Supabase defaults:**
- Session stored in localStorage
- Auto-refresh enabled
- Sessions last ~7 days

**Enhancements:**
1. In `Numbers.tsx`, check session on mount and skip login if valid
2. Use `supabase.auth.getSession()` immediately on page load
3. Never redirect to external login pages - handle all auth inline
4. For "Simple Login" users, we'll use `signInWithOtp` style flow with server-generated tokens

---

## Roles & Visibility

| Role | Can Log Numbers For | Can See Leaderboard | Can Reassign Manager |
|------|---------------------|---------------------|----------------------|
| Agent | Self only | Everyone | No |
| Manager | Self + Team | Everyone | Own team |
| Admin | Self + Anyone | Everyone | Anyone |

---

## Mobile-First Design Specs

**Stat Entry Grid:**
```
┌─────────────┬─────────────┐
│ Presentations│ Passed Price│
├─────────────┼─────────────┤
│ Hours Called │ Referrals   │
├─────────────┼─────────────┤
│ Booked Home │ Ref. Pres.  │
├─────────────┼─────────────┤
│ Deals Closed│   ALP ($)   │
└─────────────┴─────────────┘
        [ Submit Numbers ]
```

**Input sizing:**
- Height: 48px (touch-friendly)
- Font: 18px numeric
- Label: 11px muted

**Animations:**
- Submit success: Confetti burst (existing)
- Number update: Subtle scale pulse
- Leaderboard position: Slide transition

---

## Success Metrics

1. **Time to log numbers**: < 30 seconds from link click
2. **Zero forced re-logins**: Session persists across visits
3. **Leaderboard density**: 8+ entries visible without scroll on mobile
4. **Manager awareness**: Direct managers receive instant production notifications

---

## Technical Notes

### Simple Login Security
- Uses Supabase Admin API to generate session tokens server-side
- Token is single-use and short-lived (5 minutes)
- Links email/phone to auth user if not already linked
- Falls back to password flow if agent has opted in

### Realtime Updates
- Leaderboard subscribes to `daily_production` changes
- Uses existing channel pattern from `LeaderboardTabs.tsx`
- Updates trigger re-render without full page reload

### CRM Integration
- All lookups use `profiles` table (email, phone, name)
- Agent records link via `agents.user_id` → `profiles.user_id`
- Manager hierarchy via `agents.invited_by_manager_id`
