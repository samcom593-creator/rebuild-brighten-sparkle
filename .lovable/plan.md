
# Agent Portal Refinement: UI Polish, Admin Editing & Domain Clarity

## Current Issues Analysis

### 1. Email Domain Concern
The codebase is already configured correctly - all edge functions use `apex-financial.org` for:
- Email sender addresses (`noreply@apex-financial.org`, `notifications@tx.apex-financial.org`)  
- All portal links and redirects
- Magic link destinations

The `rebuild-brighten-sparkle.lovable.app` URL you're seeing is Lovable's default **published URL** for the preview system. Your code already sends all emails and links to `apex-financial.org`. No code changes needed here - everything is correct.

### 2. UI Not Updating / Looking the Same
You're viewing `/agent-portal` which uses the **old** `LeaderboardTabs.tsx` component. The new compact design was built for `/numbers` route with `CompactLeaderboard.tsx`. The agent-portal page needs to be updated to use the refined components.

### 3. Admin Number Editing
Currently, admins can only edit numbers for agents in their **direct team** (via `invited_by_manager_id`). As the primary admin, you need the ability to edit **any agent's numbers**. The RLS policies support this, but the UI needs enhancement.

### 4. Leaderboard Visual Issues
The `LeaderboardTabs.tsx` on `/agent-portal` uses oversized rows and has too much dead space. Needs complete visual overhaul.

---

## Implementation Plan

### Phase 1: Refined Leaderboard for Agent Portal

**File: `src/components/dashboard/LeaderboardTabs.tsx`**

Complete visual redesign to match modern, high-tech aesthetic:

| Change | Details |
|--------|---------|
| Row height | Reduce from 48px to 36px |
| Font sizes | Rank: 12px, Name: 13px, Stats: 11px |
| Column widths | Tighter grid with less padding |
| Top 3 display | Inline medals instead of large icons |
| Progress bars | Add ALP comparison to #1 |
| Remove excess | Less margins, tighter spacing |
| Live indicator | Add pulsing green dot |

**Before → After Layout:**
```text
BEFORE (current):
│ 🏆  │ ↑ │ [Avatar]  Agent Name [badges]           │ 5  │ 12  │ 42% │ $12,400 │
     ^large spacing^                                   ^oversized columns^

AFTER (refined):
│#1│○│JD Agent Name 👑│5│12│42%│$12,400 ███████░ 85%│
   ^compact^            ^tight cols^    ^progress bar^
```

### Phase 2: Admin Universal Editing

**File: `src/components/dashboard/ProductionEntry.tsx`**

Add admin capability to select ANY agent from the entire roster:

1. Check if user has `admin` role
2. If admin: fetch ALL active agents (not just team)
3. Show full roster in dropdown grouped by manager
4. Allow editing any agent's numbers

**Changes:**
- Line ~62-115: Add admin logic branch
- Fetch all agents with `is_deactivated = false` for admins
- Group dropdown by `invited_by_manager_id` 

### Phase 3: Apply Compact Leaderboard to Agent Portal

**File: `src/pages/AgentPortal.tsx`**

Replace `LeaderboardTabs` import with refined version OR use the new `CompactLeaderboard` component for consistency:

Option A: Swap component on agent portal
Option B: Enhance `LeaderboardTabs` with compact mode prop

Recommend Option B - add `compact` prop to `LeaderboardTabs` that triggers slimmer design.

### Phase 4: CSS Animation Classes

**File: `src/index.css`**

Ensure these animation classes exist (some may already be added):
- `.animate-rank-glow` - subtle pulse for top positions
- `.animate-live-pulse` - green dot pulsing indicator
- Tighter scrollbar styles for leaderboard

---

## Technical Changes Summary

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/LeaderboardTabs.tsx` | Complete visual redesign: smaller rows (36px), tighter grid, slimmer fonts, inline medals, ALP progress bars, live indicator |
| `src/components/dashboard/ProductionEntry.tsx` | Add admin check, fetch all agents for admins, grouped dropdown |
| `src/pages/AgentPortal.tsx` | Pass compact props to leaderboard, ensure refined UI is visible |
| `src/index.css` | Add any missing animation utilities |

### RLS Policy Note

The `daily_production` table already has this policy:
```sql
"Admins can manage all production" - Command: ALL
Using: (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = ANY (ARRAY['admin', 'manager'])))
```

This means admins can already INSERT/UPDATE any production record. The UI just needs to expose this capability.

---

## Visual Design Specs

### Leaderboard Rows
- Height: 36px
- Avatar: 24px circle
- Rank: 12px font, 24px width
- Name: 13px font, flex-grow
- Stats: 11px font, 48px each column
- ALP: 13px bold + tiny progress bar

### Color Palette
- Gold (#fbbf24) for 1st place
- Silver (#cbd5e1) for 2nd place  
- Bronze (#f97316) for 3rd place
- Teal (#14b8a6) for current user highlight
- Muted text for secondary info

### Animations
- Row entry: 30ms staggered fade-in
- Rank changes: slide animation with direction indicator
- Live indicator: 2s pulse cycle
- Hover: subtle background lightening

---

## Confirmation: Live Portal Link

Your agents should use:
```
https://apex-financial.org/numbers
```

This is the primary link for daily stat entry. All emails already link here. The `rebuild-brighten-sparkle` URL is just Lovable's internal preview - it's not used in any agent-facing communications.

---

## Success Criteria

1. Leaderboard rows are 40% smaller (36px vs 48px)
2. More entries visible on screen without scrolling
3. Admin can select any agent from dropdown
4. Live indicator shows real-time connection
5. No dead space between elements
6. Modern, high-tech aesthetic

