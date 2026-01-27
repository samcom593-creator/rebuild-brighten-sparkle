
# Add Date Picker + Fix Leaderboard Names via Profile ID

## Issues Identified

1. **Leaderboards show "Unknown Agent"** because they query names via `user_id` but imported agents only have `profile_id` linked
2. **No date selection for production entry** - agents can't backdate their numbers
3. **Edit dialog doesn't show the original profile name** for unknown agents

---

## Solution Overview

### Part 1: Add Date Picker to Production Entry

Add a calendar date picker next to the Day/Week/Month tabs that allows agents to select any past date (up to 30 days back) for entering their numbers.

**UI Design:**
```text
┌─────────────────────────────────────────────┐
│  Log Numbers                     $12,340    │
│  ─────────────────────────────────────────  │
│  📅 [Jan 27, 2026 ▼]  ← Date Picker        │
│  ─────────────────────────────────────────  │
│  Presentations    Pitched Price            │
│  [___]            [___]                    │
│  ...                                        │
└─────────────────────────────────────────────┘
```

**Changes to `CompactProductionEntry.tsx`:**
- Add `selectedDate` state (defaults to today)
- Add date picker with Popover + Calendar component
- Disable future dates
- Allow up to 30 days in the past
- Update the `production_date` in submit to use selected date

---

### Part 2: Fix Leaderboard Name Resolution

The root cause is that leaderboards query for profiles using `user_id`, but imported agents only have `profile_id` set.

**Fix for `LeaderboardTabs.tsx`:**
1. Query agents with BOTH `user_id` AND `profile_id`
2. Query profiles via `profile_id` foreign key (like `ProductionEntry.tsx` does)
3. Name fallback order: `profile.full_name` → `agent.display_name` → "Unknown Agent"

**Fix for `LiveLeaderboard.tsx`:**
- Same approach - use `profiles!agents_profile_id_fkey(full_name)` join

**Fix for `BuildingLeaderboard.tsx`:**
- Same approach

---

### Part 3: Show Profile Name in Edit Dialog

Update `AgentQuickEditDialog.tsx` to:
1. Query the agent's linked profile via `profile_id`
2. Display the profile name at the top: "Imported as: KJ Vaughns"
3. Pre-fill the display name input with the profile name
4. Show email from profile for verification

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/CompactProductionEntry.tsx` | Add date picker with Calendar + Popover, update submit to use selected date |
| `src/components/dashboard/LeaderboardTabs.tsx` | Query profiles via `profile_id` foreign key, fix name resolution |
| `src/components/dashboard/LiveLeaderboard.tsx` | Query profiles via `profile_id` foreign key, fix name resolution |
| `src/components/dashboard/BuildingLeaderboard.tsx` | Query profiles via `profile_id` foreign key if applicable |
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Fetch linked profile, show "Imported as: [name]", prefill display name |
| `src/components/ui/calendar.tsx` | Add `pointer-events-auto` to fix interaction in Popover |

---

## Technical Details

### Date Picker Implementation

```typescript
// Add to CompactProductionEntry.tsx
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";

// State
const [selectedDate, setSelectedDate] = useState<Date>(new Date());

// In submit
const productionDate = format(selectedDate, "yyyy-MM-dd");

// JSX - Date picker button above the form
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" className="w-full justify-start">
      <CalendarIcon className="mr-2 h-4 w-4" />
      {format(selectedDate, "EEEE, MMM d, yyyy")}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="start">
    <Calendar
      mode="single"
      selected={selectedDate}
      onSelect={(date) => date && setSelectedDate(date)}
      disabled={(date) => date > new Date() || date < subDays(new Date(), 30)}
      className="pointer-events-auto"
    />
  </PopoverContent>
</Popover>
```

### Leaderboard Query Fix

```typescript
// Get agents WITH profile_id
const { data: agents } = await supabase
  .from("agents")
  .select(`
    id, 
    user_id, 
    profile_id,
    display_name,
    profile:profiles!agents_profile_id_fkey(full_name, avatar_url, email)
  `)
  .in("id", agentIds);

// Name resolution
const name = agent?.profile?.full_name || agent?.display_name || "Unknown Agent";
const avatarUrl = agent?.profile?.avatar_url;
```

### AgentQuickEditDialog Enhancement

```typescript
// Fetch agent with linked profile
const { data: agentData } = await supabase
  .from("agents")
  .select(`
    id, 
    display_name,
    profile:profiles!agents_profile_id_fkey(full_name, email)
  `)
  .eq("id", agentId)
  .single();

// Display in dialog
{agentData?.profile?.full_name && (
  <p className="text-sm text-muted-foreground">
    📋 Imported as: <span className="font-medium">{agentData.profile.full_name}</span>
  </p>
)}
```

---

## Expected Results

After implementation:
- ✅ Agents can select any date in the past 30 days to log numbers
- ✅ All leaderboards display correct names for imported agents
- ✅ Tapping "Unknown Agent" shows the original imported name
- ✅ Edit dialog prefills with the profile name for easy verification
- ✅ No more "Unknown Agent" entries with production data

---

## Summary

This fix addresses the core issues:
1. **Date picker** lets agents accurately backdate their numbers
2. **Profile ID query** ensures names are correctly fetched for imported agents
3. **Enhanced edit dialog** shows the original name for easy verification before merging
