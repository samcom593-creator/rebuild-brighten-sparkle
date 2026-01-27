
# Mobile UX Fixes + Team Notifications Enhancement

## Issues Identified

### 1. Mobile Input Cursor Bug
The number inputs show `value={value || ""}` with a `placeholder="0"`. On mobile devices, when tapping an input that displays "0" (placeholder), the cursor can appear at the front instead of the back. This is a common mobile browser issue with number inputs that have empty string values but show placeholder zeros.

**Root Cause**: Using empty string `""` as value when zero, combined with `placeholder="0"`. Mobile browsers sometimes position cursor at start of placeholder text.

**Solution**: 
- Use controlled values that show `"0"` as the actual value (not placeholder)
- Or clear the input entirely on focus and restore on blur
- Add `onFocus` handler to select all text (best UX for mobile number entry)

### 2. Missing "Month" Filter in Leaderboard
Currently the period tabs show: `Day | Wk | All`

The user wants: `Day | Week | Month | All`

**Files Affected**:
- `src/components/dashboard/LeaderboardTabs.tsx` (lines 352-358)
- Need to add "month" period that filters last 30 days

### 3. Mobile UI Polish
- Add smoother animations and transitions
- Improve touch targets for mobile buttons
- Add proper spacing on mobile tab overflow

### 4. Welcome Email Update
The welcome email (`supabase/functions/welcome-new-agent/index.ts`) needs updates:
- Inform agents about receiving update notifications
- Tell them what time to submit numbers (by 8 PM CST)
- Explain the deal alert system

### 5. Team-Wide Deal Notifications (Already Exists!)
The `notify-deal-alert` edge function already sends emails to all active agents when someone logs deals. This is already implemented and working. We just need to update the welcome email to inform new agents about this.

---

## Technical Changes

### File 1: `src/components/dashboard/CompactProductionEntry.tsx`
**Fix mobile cursor issue**:
- Add `onFocus` handler to select all text in input
- Use `text-align: right` to push cursor to the correct side
- Add `selection-start` positioning on focus

```tsx
// Add to Input component
onFocus={(e) => {
  // Select all on focus for easy editing on mobile
  e.target.select();
}}
```

### File 2: `src/components/dashboard/ProductionEntry.tsx`
**Same cursor fix**:
- Add `onFocus` handler to select all text
- Ensures cursor appears at end for mobile users

### File 3: `src/components/ui/input.tsx`
**Global mobile input improvements**:
- Add `-webkit-appearance: none` for consistent mobile styling
- Ensure proper touch target size

### File 4: `src/components/dashboard/LeaderboardTabs.tsx`
**Add Month filter**:

Current:
```tsx
type Period = "day" | "week" | "month";
// ...
<TabsTrigger value="day">Day</TabsTrigger>
<TabsTrigger value="week">Wk</TabsTrigger>
<TabsTrigger value="month">All</TabsTrigger>
```

Change to:
```tsx
type Period = "day" | "week" | "month" | "all";
// ...
// Update fetch logic:
case "month":
  startDate = subDays(today, 30).toISOString().split("T")[0]; // Last 30 days
  break;
case "all":
  startDate = subDays(today, 365).toISOString().split("T")[0]; // All time
  break;
// ...
<TabsTrigger value="day">Day</TabsTrigger>
<TabsTrigger value="week">Week</TabsTrigger>
<TabsTrigger value="month">Month</TabsTrigger>
<TabsTrigger value="all">All</TabsTrigger>
```

### File 5: `src/index.css`
**Mobile smoothness improvements**:
```css
/* Mobile touch improvements */
@media (max-width: 640px) {
  input[type="number"] {
    font-size: 16px !important; /* Prevents iOS zoom on focus */
    -webkit-appearance: none;
    -moz-appearance: textfield;
  }
  
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
}

/* Smoother animations on mobile */
@media (prefers-reduced-motion: no-preference) {
  .transition-all {
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
}
```

### File 6: `supabase/functions/welcome-new-agent/index.ts`
**Enhanced welcome email with notification info**:

Add new sections:
```html
<div class="highlight">
  <h3>🚨 Team Deal Alerts</h3>
  <p>When any teammate closes a deal, you'll receive an instant <strong>DEAL ALERT</strong> email to keep you motivated!</p>
</div>

<div class="highlight">
  <h3>⏰ Daily Numbers Deadline</h3>
  <p>Please submit your daily production numbers <strong>by 8:00 PM CST</strong> each day.</p>
  <p>This keeps our leaderboards accurate and ensures you don't miss out on recognition!</p>
</div>

<div class="highlight">
  <h3>🏆 Competition Updates</h3>
  <p>You'll also receive:</p>
  <ul>
    <li>🌅 Morning top performer summaries (9 AM CST)</li>
    <li>📊 Weekly champion announcements</li>
    <li>🔥 Hot streak alerts when you're on fire!</li>
    <li>📈 Daily admin summaries (9 PM CST)</li>
  </ul>
</div>
```

Update the Agent Portal link from `/numbers` to `/agent-portal`.

---

## Summary of Changes

| File | Change |
|------|--------|
| `CompactProductionEntry.tsx` | Add `onFocus` select-all for mobile cursor fix |
| `ProductionEntry.tsx` | Add `onFocus` select-all for mobile cursor fix |
| `LeaderboardTabs.tsx` | Add "Month" (30 days) filter, rename current "All" to proper all-time |
| `src/index.css` | Mobile input styling, prevent iOS zoom, smoother transitions |
| `welcome-new-agent/index.ts` | Add notification info, deadline times, update portal link |

---

## User Experience After Changes

1. **Mobile Number Input**: Tapping any input field will select all text, so users can immediately type their new number without cursor positioning issues

2. **Leaderboard Filters**: `Day | Week | Month | All` - four clear options for time periods

3. **New Agent Welcome**: New agents will know:
   - They'll get instant deal alerts when teammates close
   - Numbers are due by 8 PM CST
   - What other notifications they'll receive (morning summaries, streak alerts, etc.)

4. **Existing Deal Alert System**: Already works! When any agent logs `deals_closed > 0`, the `notify-deal-alert` function sends a "🚨🔥 DEAL DROPPED!" email to all active agents.
