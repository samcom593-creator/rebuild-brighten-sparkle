

# Rename "Hours Called" to "Pages" in Agent Portal & Related Components

## Scope
This is a **label-only rename** — the underlying database column (`hours_called`) stays the same. We change all user-facing labels from "Hours Called" / "Hours Dialed" / "Avg Hours" to "Pages" across these files:

## Files to Edit

1. **`src/components/dashboard/ProductionEntry.tsx`** (line 383)
   - `"Hours Called"` → `"Pages"`, change icon from `Clock` to `FileText`, emoji from `"⏱️"` to `"📄"`, remove `step: "0.5"` (pages are whole numbers, step 1)

2. **`src/components/dashboard/CompactProductionEntry.tsx`** (line 250)
   - `"Hours Called"` → `"Pages"`, icon `Clock` → `FileText`, emoji `"⏱️"` → `"📄"`, remove `step: 0.5`

3. **`src/components/dashboard/LeaderboardTabs.tsx`** (line 692)
   - Comment `"Hours Dialed"` → `"Pages"`

4. **`src/pages/LogNumbers.tsx`** (line 311)
   - `"Hours Called"` → `"Pages"`, emoji `"📞"` → `"📄"`, change `step: 0.5` → `step: 1`

5. **`src/components/dashboard/TeamSnapshotCard.tsx`** (lines 433-437)
   - Comment `"Avg Hours Called"` → `"Avg Pages"`, label `"Avg Hours"` → `"Avg Pages"`, icon `PhoneCall` → `FileText`

6. **`src/components/dashboard/EstimatedEarningsCard.tsx`** — rename internal variable `personalHours` for clarity (cosmetic, no user-facing impact)

No database changes needed — the column remains `hours_called` for backward compatibility.

