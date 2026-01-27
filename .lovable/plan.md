
# Layout Restructure: Leaderboard Above Log Numbers

## Summary

Move the main leaderboard **above** the "Log Today's Numbers" section so agents immediately see their competitive standing when they open the portal. This creates a motivational workflow:

1. See where you rank → 2. Get motivated → 3. Log your numbers to climb!

---

## Current Layout vs. New Layout

| Position | Current | New |
|----------|---------|-----|
| 1 | Header + Rank Badge | Header + Rank Badge |
| 2 | Quick Stats Grid | Quick Stats Grid |
| 3 | Tab Nav (mobile) | Tab Nav (mobile) |
| 4 | **Log Today's Numbers** | **Leaderboard** ← Moved UP |
| 5 | Performance Dashboard | **Log Today's Numbers** ← Moved DOWN |
| 6 | Personal Stats | Performance Dashboard |
| 7 | **Leaderboard** | Personal Stats |
| 8+ | Year Performance, etc. | Year Performance, etc. |

---

## Changes Required

### File: `src/pages/AgentPortal.tsx`

**Move the Leaderboard section (lines 439-453) to come BEFORE the ProductionEntry section (lines 385-411)**

Updated order in the JSX:
1. Quick Stats Grid (lines 327-358) - no change
2. Tab Navigation (lines 360-383) - update tab order to reflect new priority
3. **Leaderboard** ← MOVE TO HERE
4. **Log Today's Numbers** ← MOVE BELOW LEADERBOARD
5. Performance Dashboard - no change
6. Personal Stats - no change
7. Rest unchanged

### Mobile Tab Navigation Update

Also update the mobile tab order to reflect the new priority:
- Current: `["numbers", "leaderboard", "stats"]`
- New: `["leaderboard", "numbers", "stats"]`

This way on mobile, "Leaderboard" is the first tab, matching the visual hierarchy.

### Animation Delays

Adjust the `transition.delay` values to maintain smooth staggered animations:
- Leaderboard: delay 0.3
- Log Numbers: delay 0.35
- Performance Dashboard: delay 0.4
- etc.

---

## Visual Result

When an agent opens the portal:

```text
┌─────────────────────────────────────────────────────────────────┐
│  [Avatar]  Samuel James  #4 📈        🌙  [Logout]              │
│            Monday, January 27, 2026                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │   $1,200  │  │     2     │  │     5     │  │    40%    │    │
│  │ Today ALP │  │   Deals   │  │   Pres.   │  │Close Rate │    │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🏆 Sales Leaderboard              [Day] [Week] [Month]    │  │
│  │  #1  👤 Sarah J.  $2,400  ████████████████████  100%     │  │
│  │  #2  👤 Mike R.   $1,800  ████████████████░░░░   75%     │  │
│  │  #3  👤 David K.  $1,500  █████████████░░░░░░░   62%     │  │
│  │  #4  👤 YOU       $1,200  ██████████░░░░░░░░░░   50%     │  │ ← See rank first!
│  │  #5  👤 Lisa M.   $900    ███████░░░░░░░░░░░░░   37%     │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ✨ Log Today's Numbers                    [Agent ▼]       │  │ ← Then log!
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │  │
│  │  │ Pres.   │  │ Pitched │  │ Hours   │  │ Deals   │       │  │
│  │  │    5    │  │    3    │  │   4.5   │  │    2    │       │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Code Changes

1. **Move LeaderboardTabs section** from lines 439-453 to just after the mobile tab navigation (after line 383)

2. **Move ProductionEntry section** from lines 385-411 to come after the Leaderboard

3. **Update mobile tab array** (line 367-382):
```tsx
// Change tab order from:
["numbers", "leaderboard", "stats"]
// To:
["leaderboard", "numbers", "stats"]
```

4. **Update default activeTab state** (line 111):
```tsx
// Change from:
const [activeTab, setActiveTab] = useState<"numbers" | "leaderboard" | "stats">("numbers");
// To:
const [activeTab, setActiveTab] = useState<"numbers" | "leaderboard" | "stats">("leaderboard");
```

This ensures mobile users see the leaderboard first when they load the page.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/AgentPortal.tsx` | Reorder sections: Leaderboard above ProductionEntry, update mobile tab order, adjust animation delays |

---

## Benefits

1. **Immediate motivation** - Agents see their rank as soon as they enter
2. **Competitive drive** - They can see who's ahead of them before logging
3. **Clear call to action** - After seeing the leaderboard, the natural next step is to log numbers to improve rank
4. **Consistent with gamification** - Matches the rank badge already shown in the header
