

# Fix Plan: Performance Dashboard Branding + Leaderboard ALP Editing

## Issue 1: "Powered by Apex" Missing from Performance Dashboard

### Problem
The `PerformanceDashboardSection.tsx` component header area lacks the "Powered by Apex" branding in the top-right corner.

### Solution
Add a subtle, faint "Powered by Apex" text to the top-right of the Performance Dashboard section.

**File:** `src/components/dashboard/PerformanceDashboardSection.tsx`

**Changes:**
- Add a positioned element in the top-right of the GlassCard
- Style it to be faint/muted so it's not obnoxious
- Use `text-[10px]` with low opacity for subtlety

```tsx
{/* Powered by Apex - subtle branding */}
<span className="absolute top-3 right-4 text-[10px] text-muted-foreground/50 font-medium tracking-wide">
  Powered by Apex
</span>
```

---

## Issue 2: Cannot Edit ALP in Leaderboard Custom View

### Problem
When the leaderboard is set to "Custom" date range, clicking an agent opens the edit dialog, but the ALP/Deals editing only updates "today's" production record. The user wants to **override the range total** directly.

### Root Cause
The `AgentQuickEditDialog` component:
1. Has ALP/Deals editing (added earlier), but it only writes to **today's date**
2. When viewing a Custom date range that spans multiple days, editing "today" doesn't affect the historical totals

### Solution: Date-Aware Production Editing

Since the user chose "Override the range total" approach, I'll implement:

1. **Pass the current date range to the edit dialog** so it knows which period is being viewed
2. **Calculate the delta** between the current displayed total and the new desired total
3. **Apply the delta** as an adjustment to the most recent date in the range (or create a new record if needed)

**Files to Modify:**
- `src/components/dashboard/LeaderboardTabs.tsx` - Pass date range context to AgentQuickEditDialog
- `src/components/dashboard/AgentQuickEditDialog.tsx` - Accept date range, show "override total" mode, apply adjustment correctly

### Implementation Details

#### Step 1: Update LeaderboardTabs.tsx

When opening the edit dialog, pass the current period and date range:

```tsx
// Current (line 547-549):
setSelectedAgent({ id: entry.agentId, name: entry.name, alp: entry.alp, deals: entry.deals });

// Updated:
setSelectedAgent({ 
  id: entry.agentId, 
  name: entry.name, 
  alp: entry.alp, 
  deals: entry.deals,
  period,
  customDateRange,
  startDate: /* calculated startDate based on period */,
  endDate: /* calculated endDate based on period */,
});
```

Update the `AgentQuickEditDialog` props:

```tsx
<AgentQuickEditDialog
  open={editDialogOpen}
  onOpenChange={setEditDialogOpen}
  agentId={selectedAgent.id}
  currentName={selectedAgent.name}
  production={selectedAgent.alp}
  deals={selectedAgent.deals}
  onUpdate={fetchLeaderboard}
  // NEW PROPS:
  period={selectedAgent.period}
  dateRange={{ from: selectedAgent.startDate, to: selectedAgent.endDate }}
/>
```

#### Step 2: Update AgentQuickEditDialog.tsx

Add new props to accept date range context:

```tsx
interface AgentQuickEditDialogProps {
  // ... existing props
  period?: "day" | "week" | "month" | "custom";
  dateRange?: { from?: string; to?: string };
}
```

Update the "Edit Production" section:

- When `period === "custom"`, show a message indicating this will adjust the total for the selected range
- Calculate the adjustment needed: `desiredTotal - currentTotal`
- Apply the adjustment to the most recent date in the range (or today if within range)

```tsx
// In handleSaveChanges:
if (isAdmin && (editAlp !== production || editDeals !== deals)) {
  // Calculate what date to apply the adjustment to
  let targetDate = new Date().toISOString().split('T')[0]; // Default: today
  
  if (period === "custom" && dateRange?.to) {
    // Use the end date of the custom range
    targetDate = dateRange.to;
  }
  
  // Calculate the delta (adjustment needed)
  const alpDelta = editAlp - production;
  const dealsDelta = editDeals - deals;
  
  // Fetch existing record for target date
  const { data: existingRecord } = await supabase
    .from("daily_production")
    .select("id, aop, deals_closed")
    .eq("agent_id", agentId)
    .eq("production_date", targetDate)
    .maybeSingle();

  if (existingRecord) {
    // Add delta to existing values
    await supabase
      .from("daily_production")
      .update({ 
        aop: Number(existingRecord.aop) + alpDelta,
        deals_closed: Number(existingRecord.deals_closed) + dealsDelta,
      })
      .eq("id", existingRecord.id);
  } else {
    // Create new record with just the delta as values
    await supabase
      .from("daily_production")
      .insert({
        agent_id: agentId,
        production_date: targetDate,
        aop: Math.max(0, alpDelta), // Don't go negative for new records
        deals_closed: Math.max(0, dealsDelta),
        presentations: dealsDelta > 0 ? dealsDelta : 0,
      });
  }
}
```

Update the UI text when in custom mode:

```tsx
{period === "custom" ? (
  <p className="text-[10px] text-muted-foreground">
    Changes will adjust the total for the selected date range 
    ({dateRange?.from} to {dateRange?.to}).
  </p>
) : (
  <p className="text-[10px] text-muted-foreground">
    Changes will update today's production record for this agent.
  </p>
)}
```

---

## Summary

| File | Change |
|------|--------|
| `src/components/dashboard/PerformanceDashboardSection.tsx` | Add subtle "Powered by Apex" branding in top-right |
| `src/components/dashboard/LeaderboardTabs.tsx` | Pass period and date range to AgentQuickEditDialog |
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Accept date range props, apply delta-based adjustment for custom ranges |

## Result
1. "Powered by Apex" appears subtly in the Performance Dashboard (faint, not obnoxious)
2. Admins can click any ALP value in the leaderboard (including Custom view) and edit the total directly - the system calculates the adjustment needed and applies it appropriately

