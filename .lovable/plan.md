

## Production Leaderboard Layout Fix

### Problem Identified
1. **Desktop**: The Production Leaderboard currently uses `lg:col-span-2` in a 3-column grid, leaving the Recognition Queue + Course Progress in a single column on the right. The leaderboard card has a fixed `max-h-[500px]` which creates dead space below it.

2. **Mobile**: On small screens, the entire grid stacks vertically but the leaderboard rows are cramped due to tight padding and the internal list also has a `max-h-[500px]` constraint that may cut off content.

### Solution

#### Desktop Layout (reduce dead space)
- Remove the fixed `max-h-[500px]` constraint on the leaderboard content
- Instead, make the leaderboard expand to fill available space using `flex-1` and `min-h-0`
- Apply a reasonable maximum height only when there are many entries (e.g., `max-h-[70vh]`)
- This ensures the leaderboard stretches fully within the 2-column space

#### Mobile Layout (fix cramped view)
- Increase row padding from `p-3` to `p-4` on mobile
- Reduce the number of visible stats per row to prevent overflow
- Use stacked layout for agent info + stats on very small screens
- Remove the scroll container height limit on mobile so users can scroll the entire page naturally

### Technical Changes

**File: `src/pages/DashboardCommandCenter.tsx`**

1. Update the leaderboard Card container (lines 511-647):
   - Add `flex flex-col h-full` to the Card
   - Add `flex-1 min-h-0` to CardContent
   - Change `max-h-[500px]` to `max-h-[70vh] lg:max-h-[600px]` for better desktop use
   - On mobile (below `lg`), remove the max-height entirely so the list expands naturally

2. Update individual agent rows (lines 535-641):
   - On mobile: Use responsive classes to stack the stats below the name
   - Increase touch targets to 48px minimum
   - Add `flex-wrap` for the stats section on small screens

3. Grid layout adjustment (line 509):
   - Change from `grid lg:grid-cols-3 gap-6` to use equal flex distribution
   - Make the leaderboard take more horizontal space on desktop (e.g., 70/30 split)

---

### Summary of File Changes

| File | Change |
|------|--------|
| `src/pages/DashboardCommandCenter.tsx` | Remove fixed height constraints, expand leaderboard to use full available space, improve mobile row layout |

