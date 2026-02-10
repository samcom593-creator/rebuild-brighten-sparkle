
# Fix Production Entry + Number Reminders

## Problems Found

### 1. CompactProductionEntry (used on /numbers page) doesn't load existing data
When an agent opens the `/numbers` page, the form starts with ALL ZEROS. If they already submitted numbers today and come back to add more, the upsert **overwrites everything with zeros** except what they enter this time. This is the primary "showing as zero" bug.

### 2. ProductionEntry date-change bug (used on Agent Portal)
When an agent changes the date picker to a past date while viewing their own record, the code at line 185 checks `selectedAgentId === agentId && existingData` -- this resets the form to TODAY's data instead of fetching the selected date's data. This means backdated entries could overwrite with wrong values.

### 3. notify-fill-numbers uses UTC dates instead of CST
The reminder function calculates today's date using `now.toISOString().split("T")[0]` which is UTC. When the 9 PM CST cron runs, that's 3 AM UTC the NEXT day -- so it checks for tomorrow's production, finds none, and sends reminders to agents who already filled their numbers today.

---

## Fix 1: CompactProductionEntry -- Load existing data on mount

**File: `src/components/dashboard/CompactProductionEntry.tsx`**

- Add a `useEffect` that fetches existing production for the selected date when the component mounts or the date changes
- Pre-populate the form AND the BubbleDealEntry with existing deals so agents see what they already entered
- Pass `initialDeals` to `BubbleDealEntry` based on existing AOP/deals data

Changes:
- Add `useEffect` to fetch `daily_production` for `agentId` + `selectedDate`
- When existing data is found, populate `formData` with it
- When existing data has `aop > 0`, create initial deal bubbles from existing data so the total is preserved
- This prevents the "overwrite with zeros" problem

## Fix 2: ProductionEntry -- Fix date-change data loading

**File: `src/components/dashboard/ProductionEntry.tsx`**

- Fix the `useEffect` at line 183 so that when `selectedDate` changes and it's NOT today, it always fetches from the database regardless of whether `selectedAgentId === agentId`
- The condition should only use `existingData` prop when it's the current agent AND the date is today

Change the condition from:
```
if (selectedAgentId === agentId && existingData) { ... }
```
To:
```
const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
if (selectedAgentId === agentId && existingData && isToday) { ... }
```

## Fix 3: notify-fill-numbers -- Use CST date

**File: `supabase/functions/notify-fill-numbers/index.ts`**

- Replace the UTC date calculation with a CST-aware one
- Change from: `const targetDate = now.toISOString().split("T")[0]`
- Change to: Calculate the date in America/Chicago timezone using `Intl.DateTimeFormat`

For the 10 AM reminder which checks yesterday's production:
- Add logic so that `reminderType === "10am"` checks the previous day's date instead of today

## Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Numbers showing as zero | CompactProductionEntry starts at 0, overwrites on upsert | Load existing data on mount |
| Backdated entries wrong | ProductionEntry uses today's data for all dates | Check date before using cached existingData |
| Reminders sent incorrectly | UTC date used instead of CST | Use CST timezone for date calculation |
