

## Critical Platform Fix: Navigation Freezes, Crown Logo & Course Completion Notifications

### Executive Summary

After investigating the codebase, I've identified the root causes of the navigation freezes and understand all the requirements:

1. **Navigation Freezes** - Still caused by `AnimatePresence mode="wait"` in the main LeaderboardTabs component (line 499) which blocks UI during tab switches
2. **Crown Logo Behavior** - Should go to Dashboard if logged in, otherwise stay on Home
3. **Course Completion Notifications** - Need to notify both admin AND manager when agent completes coursework (already implemented in edge function but need to verify manager notification flow)

---

### Issue 1: Navigation Freezes (Both Dashboard + Public Pages)

**Root Cause Found:**

There's still one critical `AnimatePresence mode="wait"` at line 499 in LeaderboardTabs.tsx that causes the main content flip animation to block navigation. When you click another nav item while the leaderboard is animating, the entire app freezes.

**Files with blocking `mode="wait"` that need fixing:**

| File | Line | Impact |
|------|------|--------|
| `src/components/dashboard/LeaderboardTabs.tsx` | 499 | HIGH - Main leaderboard flip blocks navigation |
| `src/components/landing/HeroSection.tsx` | 181 | LOW - Carrier logos on landing |
| `src/components/landing/DealsTicker.tsx` | 64 | LOW - Deal ticker animation |
| `src/components/landing/SystemsSection.tsx` | 195 | LOW - Tab content on landing |

**Fix:**
- Change `mode="wait"` to `mode="popLayout"` in LeaderboardTabs.tsx (the high-impact one)
- For landing page components, change to `mode="sync"` to allow immediate rendering

---

### Issue 2: Crown Logo Navigation Logic

**Current Behavior:**
The Crown logo in the sidebar (`GlobalSidebar.tsx` lines 220-235) always links to `/dashboard`.

**Required Behavior:**
- If logged in → Go to `/dashboard`
- If NOT logged in → Stay on `/` (home)

**Files to Change:**
- `src/components/layout/GlobalSidebar.tsx` - The crown is already linked to `/dashboard`, which is correct since this sidebar only appears for authenticated users. This works as expected.
- `src/components/landing/Navbar.tsx` - The crown on the public landing page already links to `/` (home). This is correct.
- `src/components/layout/SidebarLayout.tsx` (mobile header) - Crown links to `/dashboard`. Since this layout is only used inside protected routes, this is correct.

**Conclusion:** The crown behavior is already correct. The GlobalSidebar and SidebarLayout are only rendered for authenticated users, so linking to `/dashboard` is correct. The landing Navbar links to `/` which is correct for public visitors.

---

### Issue 3: Course Completion Notifications to Admin + Manager

**Current Implementation Review:**

The `notify-course-complete` edge function (reviewed above) already:
1. Gets the agent's manager via `invited_by_manager_id`
2. Sends email to both admin (`info@kingofsales.net`) AND manager
3. Sends congratulations email to the agent
4. Updates agent stage to `in_field_training`

**However, there's a potential issue:** The function looks up manager by `agent.invited_by_manager_id`, but some agents may not have this set if they were added differently.

**Improvement:**
Add a fallback to check `agent.manager_id` if `invited_by_manager_id` is null, ensuring manager notifications always reach the right person.

**Email Content Already Includes:**
- Admin/Manager: "Course Completed!" notification with recommended actions
- Agent: Congratulations with Discord link, daily meeting info (10 AM CST, Camera ON), and $20k standard

---

### Implementation Plan

#### Step 1: Fix Navigation Freezes

**File: `src/components/dashboard/LeaderboardTabs.tsx` (Line 499)**
```typescript
// Change from:
<AnimatePresence mode="wait">

// To:
<AnimatePresence mode="popLayout">
```

This allows the new content to render immediately while the old content animates out, preventing the freeze.

**File: `src/components/landing/HeroSection.tsx` (Line 181)**
```typescript
// Change from:
<AnimatePresence mode="wait">

// To:
<AnimatePresence mode="sync">
```

**File: `src/components/landing/DealsTicker.tsx` (Line 64)**
```typescript
// Change from:
<AnimatePresence mode="wait">

// To:
<AnimatePresence mode="sync">
```

**File: `src/components/landing/SystemsSection.tsx` (Line 195)**
```typescript
// Change from:
<AnimatePresence mode="wait">

// To:
<AnimatePresence mode="sync">
```

#### Step 2: Improve Manager Notification (Edge Function)

**File: `supabase/functions/notify-course-complete/index.ts`**

Add fallback to also check `manager_id` field:
```typescript
// After getting agent, check both fields
let managerId = agent?.invited_by_manager_id || null;

// If no invited_by_manager_id, check if there's a manager_id
if (!managerId && agent?.manager_id) {
  managerId = agent.manager_id;
}
```

Update the select to include `manager_id`:
```typescript
const { data: agent } = await supabase
  .from("agents")
  .select("invited_by_manager_id, manager_id, profile_id")
  .eq("id", agentId)
  .single();
```

---

### Technical Summary

| Change | File | Purpose |
|--------|------|---------|
| `mode="wait"` → `mode="popLayout"` | LeaderboardTabs.tsx | Fix dashboard navigation freeze |
| `mode="wait"` → `mode="sync"` | HeroSection.tsx | Fix landing page animations |
| `mode="wait"` → `mode="sync"` | DealsTicker.tsx | Fix landing page animations |
| `mode="wait"` → `mode="sync"` | SystemsSection.tsx | Fix landing page animations |
| Add manager_id fallback | notify-course-complete/index.ts | Ensure manager always notified |

---

### Expected Results

After implementation:
1. **Navigation** - Instant page transitions, no more getting stuck when clicking sidebar items
2. **Crown Logo** - Already works correctly (Dashboard if logged in, Home if not)
3. **Course Completion** - Both admin and manager will always receive notification when agent completes coursework
4. **Landing Page** - Smoother animations that don't block interaction

---

### Files to Modify

1. `src/components/dashboard/LeaderboardTabs.tsx`
2. `src/components/landing/HeroSection.tsx`
3. `src/components/landing/DealsTicker.tsx`
4. `src/components/landing/SystemsSection.tsx`
5. `supabase/functions/notify-course-complete/index.ts`

