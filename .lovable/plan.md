
# Agent Portal V3: Premium UI Polish & Layout Restructure

## Summary

This plan addresses all your feedback to create a cleaner, more elite experience for the Agent Portal:

1. **"Log Today's Numbers" - Premium Input Experience**: Redesigning the production entry form with sleek, modern input styling, subtle animations, and a more visually pleasing layout
2. **"Today's Logs" - Elite View**: Rearranging the quick stats display into a premium dashboard card format
3. **Layout Restructure**: Moving Weekly Badges to the bottom, adding Year Performance section in its place
4. **Text Change**: Renaming "Passed Price" to "Pitched Price" across all components
5. **Admin Editing**: Ensuring you can change anyone's numbers with full name display
6. **Leaderboard Sizing**: Making it slightly bigger with better proportions
7. **Performance Dashboard**: Making it more prominent than the leaderboard

---

## Detailed Changes

### 1. Premium "Log Today's Numbers" Form

**Current Issues:**
- Input fields feel basic
- Too compact, not "elite" feeling
- Labels are small and cramped

**New Design:**
- Larger, more spacious input fields (h-14 instead of h-12)
- Floating label effect with animated transitions
- Soft gradient backgrounds on focused inputs
- Subtle shadow depth when active
- Card-style grouping with visual separation between metrics
- Satisfying micro-interactions on value changes

**Visual Mockup:**
```text
┌─────────────────────────────────────────────────────────────────┐
│  ✨ Log Today's Numbers                         [Agent Dropdown]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐│
│   │ PRESENTATIONS│  │PITCHED PRICE│  │HOURS CALLED │  │REFERRALS││
│   │    ┌─────┐  │  │    ┌─────┐ │  │    ┌─────┐  │  │  ┌────┐ ││
│   │    │  5  │  │  │    │  3  │ │  │    │ 4.5 │  │  │  │  2 │ ││
│   │    └─────┘  │  │    └─────┘ │  │    └─────┘  │  │  └────┘ ││
│   │      🎯     │  │      💰    │  │      ⏱️     │  │   👥    ││
│   └─────────────┘  └─────────────┘  └─────────────┘  └────────┘│
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐│
│   │BOOKED IN-HOME│  │REF. PRESENT.│  │ DEALS CLOSED│  │  ALP   ││
│   │    ┌─────┐  │  │    ┌─────┐ │  │    ┌─────┐  │  │ ┌─────┐││
│   │    │  1  │  │  │    │  0  │ │  │    │  2  │  │  │ │$2,400│││
│   │    └─────┘  │  │    └─────┘ │  │    └─────┘  │  │ └─────┘││
│   │      🏠     │  │      🤝    │  │      📈     │  │   💵   ││
│   └─────────────┘  └─────────────┘  └─────────────┘  └────────┘│
│                                                                 │
│   ┌───────────────────────────────────────────────────────────┐│
│   │              💾  Save Today's Numbers                     ││
│   └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 2. Page Layout Restructure

**New Order (top to bottom):**
1. Header (user info, date, logout)
2. Quick Stats Grid (Today's ALP, Deals, Presentations, Close Rate)
3. **Log Today's Numbers** (premium form - PROMINENT)
4. **Performance Dashboard** (moved UP, made larger) 
5. **Personal Stats Card** (your benchmarks)
6. **Leaderboard** (slightly bigger, but below Performance section)
7. **Year Performance Card** (NEW - replaces Weekly Badges position)
8. Production History Chart
9. Income Goal Tracker
10. Team Goals
11. Additional Leaderboards (Closing Rate, Referral)
12. Referral Links Section
13. **Weekly Badges** (MOVED to bottom)
14. Motivational Quote Footer

### 3. New "Year Performance" Card

A new component showing annual stats:

**Data Displayed:**
- Year-to-Date ALP Total
- Total Deals Closed (YTD)
- Average Close Rate (YTD)
- Total Presentations (YTD)
- Comparison to same period last year (if data exists)

**Design:**
```text
┌─────────────────────────────────────────────────────────────────┐
│  📊 2026 Year Performance                              Annual   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐      │
│   │    $45,200    │  │      28       │  │     42%       │      │
│   │   YTD ALP     │  │  Total Deals  │  │  Avg Close %  │      │
│   └───────────────┘  └───────────────┘  └───────────────┘      │
│                                                                 │
│   Total Presentations: 67  •  Avg Deal Size: $1,614            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Text Change: "Passed Price" → "Pitched Price"

Updating across 4 files:
- `ProductionEntry.tsx` - line 284
- `CompactProductionEntry.tsx` - line 113
- `LogNumbers.tsx` - line 351
- Any leaderboard display references

### 5. Admin Full Access with Full Names

**Current State:** Admin dropdown shows first names only and grouped by manager

**Enhancement:**
- Show **full names** in dropdown (e.g., "Samuel James" not just "Samuel")
- Add agent's manager name in parentheses for context
- Ensure dropdown is wider to accommodate full names
- Maintain ability to edit ANY agent's production

**Dropdown Example:**
```text
┌────────────────────────────────────────┐
│ 🙋 Samuel James (Me)                   │
├────────────────────────────────────────┤
│ 📋 Manager: John Smith                 │
│    👤 Michael Johnson                  │
│    👤 Sarah Williams                   │
│    👤 David Brown                      │
├────────────────────────────────────────┤
│ 📋 Manager: Jane Doe                   │
│    👤 Emily Davis                      │
│    👤 Robert Wilson                    │
└────────────────────────────────────────┘
```

### 6. Leaderboard Sizing Adjustments

**Changes:**
- Increase card padding from p-4 to p-5
- Row height from 36px to 40px
- Font sizes: Rank 13px, Name 14px, Stats 12px
- Avatar size from 24px to 28px
- Header title from text-sm to text-base

### 7. Performance Dashboard Prominence

**Changes:**
- Move PerformanceDashboardSection **above** the Leaderboard
- Increase padding from p-6 to p-8
- Make feature cards slightly larger
- Add subtle background gradient for visual weight
- Remove the "hidden sm:block" restriction so it's always visible

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/ProductionEntry.tsx` | Premium input styling, "Pitched Price" text, full names in dropdown, larger inputs, card-style grouping |
| `src/components/dashboard/CompactProductionEntry.tsx` | "Pitched Price" text change |
| `src/pages/LogNumbers.tsx` | "Pitched Price" text change |
| `src/pages/AgentPortal.tsx` | Layout restructure - move PerformanceDashboard up, WeeklyBadges down, add YearPerformanceCard |
| `src/components/dashboard/LeaderboardTabs.tsx` | Slightly larger sizing (rows, fonts, avatars) |
| `src/components/dashboard/PerformanceDashboardSection.tsx` | Larger padding, always visible |
| `src/components/dashboard/YearPerformanceCard.tsx` | **NEW FILE** - Annual stats display |

---

## Technical Details

### New Component: YearPerformanceCard

```tsx
// Query: Get all production for current year
const yearStart = `${new Date().getFullYear()}-01-01`;
const { data } = await supabase
  .from("daily_production")
  .select("aop, deals_closed, presentations, closing_rate")
  .eq("agent_id", agentId)
  .gte("production_date", yearStart);

// Calculate aggregates
const ytdALP = data.reduce((sum, p) => sum + Number(p.aop), 0);
const ytdDeals = data.reduce((sum, p) => sum + Number(p.deals_closed), 0);
const ytdPresentations = data.reduce((sum, p) => sum + Number(p.presentations), 0);
const avgCloseRate = ytdPresentations > 0 ? (ytdDeals / ytdPresentations) * 100 : 0;
```

### ProductionEntry Input Styling

```tsx
// Premium input card styling
<div className={cn(
  "relative p-4 rounded-xl border-2 transition-all duration-300",
  "bg-gradient-to-br from-background to-muted/30",
  "hover:border-primary/30 hover:shadow-md",
  hasValue && "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
)}>
  <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">
    {field.label}
  </Label>
  <div className="relative">
    <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
    <Input
      className="h-14 text-2xl font-bold text-center pl-10 border-0 bg-transparent"
      ...
    />
  </div>
</div>
```

---

## Success Criteria

1. Production entry feels premium and elite
2. Full agent names visible in admin dropdown
3. Year Performance card shows annual stats prominently
4. Weekly Badges moved to bottom
5. Leaderboard slightly larger but secondary to Performance Dashboard
6. "Pitched Price" label throughout
7. Admin can edit any agent's numbers easily
