

# Enhanced Leaderboard with Category Filters

This plan enhances the main Sales Leaderboard in the Agent Portal to include sortable categories, highlight category leaders, and improve data display.

---

## Current State Analysis

The existing `LeaderboardTabs.tsx` component:
- Displays agents ranked by ALP (Annual Life Premium) only
- Shows Deals, Presentations, Close %, and ALP columns
- Has Day/Week/Month time period filters
- Does NOT allow sorting by different metrics
- Does NOT highlight leaders in each category

---

## Proposed Enhancements

### 1. Add Category Filter Dropdown

Add a filter dropdown alongside the period tabs that allows sorting by:
- **Most ALP** (default) - Highest total premium
- **Most Presentations** - Who's working the hardest
- **Highest Close Rate** - Most efficient closers (min 3 presentations)
- **Most Deals** - Most closes

Each filter will re-sort the leaderboard and highlight the current category leader.

### 2. Visual Category Leader Badges

When viewing the full leaderboard, add small badge indicators showing which agents lead in each category:
- Crown icon for ALP leader
- Target icon for Presentations leader  
- Percent icon for Close Rate leader
- Trophy icon for Deals leader

This makes it easy to see who's dominating in each area at a glance.

### 3. Include All Historical Production Data

Update the query logic to:
- When "Month" filter is selected, include ALL historical production (no date filter)
- This ensures previous numbers are factored into rankings
- Agents with imported historical ALP will appear on the leaderboard

### 4. Enhanced Column Display

The leaderboard already shows the key metrics. We'll ensure they're properly visible:
- **Deals** column (already present)
- **Presentations** column (already present)
- **Close %** column (already present)
- **ALP** column (already present)

Add subtle highlighting to the column being sorted by.

---

## Technical Implementation

### File: `src/components/dashboard/LeaderboardTabs.tsx`

**Changes:**

1. **Add `sortBy` state** (line ~53):
   ```typescript
   type SortCategory = "alp" | "presentations" | "closingRate" | "deals";
   const [sortBy, setSortBy] = useState<SortCategory>("alp");
   ```

2. **Add category filter UI** (after period tabs, ~line 244):
   - Add a Select dropdown with options: "By ALP", "By Presentations", "By Close Rate", "By Deals"
   - Style to match the period tabs

3. **Modify sorting logic** (~line 197):
   ```typescript
   // Sort based on selected category
   switch (sortBy) {
     case "presentations":
       leaderboardEntries.sort((a, b) => b.presentations - a.presentations);
       break;
     case "closingRate":
       // Filter to only show agents with 3+ presentations for fair comparison
       leaderboardEntries = leaderboardEntries.filter(e => e.presentations >= 3);
       leaderboardEntries.sort((a, b) => b.closingRate - a.closingRate);
       break;
     case "deals":
       leaderboardEntries.sort((a, b) => b.deals - a.deals);
       break;
     default: // "alp"
       leaderboardEntries.sort((a, b) => b.alp - a.alp);
   }
   ```

4. **Add category leader detection** (after sorting):
   ```typescript
   // Detect leaders in each category for badge display
   const leaders = {
     alp: leaderboardEntries.reduce((max, e) => e.alp > max.alp ? e : max),
     presentations: leaderboardEntries.reduce((max, e) => e.presentations > max.presentations ? e : max),
     closingRate: leaderboardEntries.filter(e => e.presentations >= 3).reduce((max, e) => e.closingRate > max.closingRate ? e : max, { closingRate: 0 }),
     deals: leaderboardEntries.reduce((max, e) => e.deals > max.deals ? e : max),
   };
   ```

5. **Add visual badges in each row** (~line 310-336):
   - Show small icons next to agent names indicating which categories they lead
   - Use Tooltip for context on hover

6. **Highlight active sort column** (~line 248-256):
   - Add visual indicator (underline or bold) to the column header being sorted

7. **Update period "month" to include all data** (~line 86-95):
   ```typescript
   case "month":
     // Include ALL historical data for comprehensive rankings
     startDate = subDays(today, 365).toISOString().split("T")[0]; // Last year
     break;
   ```

---

## UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│ 🏆 Sales Leaderboard              [By ALP ▼]   [Day|Week|Month] │
├─────────────────────────────────────────────────────────────────┤
│ #  Δ   Agent           Deals   Presentations   Close%    ALP   │
├─────────────────────────────────────────────────────────────────┤
│ 🥇    Samuel 👑🎯       3       12              25%    $45,000  │
│ 🥈    John 🎯           2       15              13%    $32,000  │
│ 🥉    Mike %            4        8              50%    $28,000  │
│ 4     Sarah             1        5              20%    $15,000  │
└─────────────────────────────────────────────────────────────────┘

Legend: 👑 = ALP Leader  🎯 = Presentations Leader  % = Close Rate Leader
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/LeaderboardTabs.tsx` | Add sortBy state, category filter dropdown, leader detection, visual badges, column highlighting |

---

## Additional Considerations

1. **Minimum Threshold for Close Rate**: Only show agents with 3+ presentations when sorting by close rate to ensure fair comparison

2. **Real-time Updates**: The existing real-time subscription will continue to work - when new production is logged, the leaderboard will re-fetch and re-sort

3. **Performance**: Leader detection adds minimal overhead since we're already iterating through all entries

4. **Mobile Responsiveness**: The category filter dropdown will stack nicely on mobile alongside the period tabs

---

## Expected Outcome

After implementation:
- Users can sort the leaderboard by ALP, Presentations, Close Rate, or Deals
- Category leaders are visually highlighted with badge icons
- Previous/historical production data is included in monthly rankings
- The UI clearly shows which agents are excelling in which areas
- Competitive agents can see exactly where they need to improve

