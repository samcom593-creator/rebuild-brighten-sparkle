
## Fix Plan: Post-Deal Glitching + Merge Functionality

### Problem 1: Site Glitches After Deal Submission

**Root Cause**: After submitting a deal, the system:
1. Fires 3 confetti bursts (with 90+ particles total) over 200ms
2. Immediately triggers 4-5 edge function calls in parallel:
   - `notify-deal-alert`
   - `notify-streak-alert`  
   - `notify-rank-passed`
   - `notify-comeback-alert`
   - `send-plaque-recognition` (if ALP >= $3,000)

This combination of heavy animation + network calls causes UI responsiveness issues, especially on mobile.

**Fix**:
1. **Reduce confetti intensity**: Lower particle counts from 40/25/25 to 20/15/15 (50 total vs 90)
2. **Delay edge function calls**: Run notifications AFTER confetti completes (2 seconds) instead of simultaneously
3. **Batch notification calls**: Use `Promise.allSettled()` instead of sequential awaits so one failure doesn't block others
4. **Add debouncing**: Prevent double-submission during confetti animation

### Problem 2: Cannot Merge Any Agent (Obi with Obi)

**Root Cause**: The merge list in `AgentQuickEditDialog.tsx` is too restrictive:
- Line 208: `.filter(m => m.name !== "Unknown" && m.production > 0)` excludes agents with zero production
- Line 209: `.slice(0, 10)` limits to only 10 options

If "Obi" (the duplicate) has no production recorded, they won't appear in the merge list.

**Fix**:
1. Remove the `m.production > 0` filter - allow merging with ANY agent regardless of production
2. Increase the limit from 10 to 50 matches so more agents are visible
3. Sort matches alphabetically so users can easily find agents by name
4. Add a search/filter option for large teams

---

## Implementation Details

### File 1: `src/components/dashboard/ConfettiCelebration.tsx`

**Changes**:
- Reduce particle counts: `40 → 20`, `25 → 15`, `25 → 15`
- Reduce ticks from 100 to 60 for faster cleanup

### File 2: `src/components/dashboard/ProductionEntry.tsx`

**Changes**:
- Move edge function calls to AFTER confetti completes (wrap in a 2s timeout)
- Use `Promise.allSettled()` to batch all notifications together
- Add a `submitting` ref to prevent double-submissions

### File 3: `src/components/dashboard/AgentQuickEditDialog.tsx`

**Changes at lines 192-209**:
```tsx
// Before:
.filter(m => m.name !== "Unknown" && m.production > 0)
.slice(0, 10);

// After:
.filter(m => m.name !== "Unknown") // Remove production > 0 requirement
.sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically
.slice(0, 50); // Allow more matches
```

### File 4: `src/components/dashboard/CompactProductionEntry.tsx`

**Same changes as ProductionEntry.tsx**:
- Delay notifications until after confetti
- Use `Promise.allSettled()` for batching

---

## Summary of Changes

| File | Change |
|------|--------|
| `ConfettiCelebration.tsx` | Reduce particle counts (90 → 50) and ticks (100 → 60) |
| `ProductionEntry.tsx` | Delay notifications 2s until after confetti; batch with `Promise.allSettled()` |
| `CompactProductionEntry.tsx` | Same notification delay and batching |
| `AgentQuickEditDialog.tsx` | Remove `production > 0` filter; increase limit to 50; sort alphabetically |

---

## Technical Details

### Confetti Optimization
The current implementation fires 90 particles across 3 bursts. Each particle requires:
- Individual DOM element creation
- Physics calculations for gravity/decay
- Animation frame updates

Reducing to 50 particles cuts rendering work by ~45%, significantly improving responsiveness on low-end devices.

### Notification Delay Pattern
```tsx
// After form submission:
setShowConfetti(true);

// Schedule notifications after confetti animation completes
setTimeout(async () => {
  if (formData.deals_closed > 0) {
    await Promise.allSettled([
      supabase.functions.invoke("notify-deal-alert", { body: {...} }),
      supabase.functions.invoke("notify-streak-alert", { body: {...} }),
      supabase.functions.invoke("notify-rank-passed", { body: {...} }),
      supabase.functions.invoke("notify-comeback-alert", { body: {...} }),
    ]);
  }
}, 2000); // Matches ConfettiCelebration's onComplete timing
```

### Merge List Improvement
The current filter excludes agents with no production history. Since the goal is to consolidate records (often from duplicates created before they had production), we must allow merging with ANY agent. The alphabetical sort + increased limit ensures users can find who they're looking for.
