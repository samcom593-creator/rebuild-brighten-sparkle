

# Fix CRM Paid Agents Count + Redesign LogNumbers Production Entry

## Issues Found

### 1. CRM "Paid Agents" showing zero
The payment tracking data shows 7 paid agents this week (week_start: 2026-02-08), with 6 of them in the "evaluated" stage and not deactivated. The code calculates `weekStartStr` using the browser's local `Date()` object, but the payment records use database-computed `date_trunc('week', now())` which uses **Monday** as the start of the week in PostgreSQL by default. The CRM code uses **Sunday** as the week start (JavaScript convention). This mismatch means the CRM queries `week_start = '2026-02-08'` (Sunday) but the database may have stored `'2026-02-09'` (Monday) -- or vice versa depending on when records were created. The fix is to align the week start calculation.

Additionally, the metric card order needs swapping so "Total Deals" appears to the right of "Paid Agents" as requested.

### 2. LogNumbers production form needs redesign
The current layout on `/apex-daily-numbers` has the deal premium entry (BubbleDealEntry) buried at the bottom below the stat fields, with a confusing "Deal Premiums (ALP)" label. Users can't easily find where to enter deal amounts. The form needs restructuring:

- Move the deal entry section to the **top** with a clear label like "Deal Amounts"
- Make the Closes field more prominent since it's the deal count
- Add a clear visual separator and hierarchy so the flow is: Deal Amounts first, then Activity Stats
- The label on BubbleDealEntry should say "Enter deal amount" or similar, not "Deal Premiums (ALP)"
- Ensure mobile-first layout with large tap targets

## Technical Changes

### File 1: `src/pages/DashboardCRM.tsx`

**Swap metric card order** (lines 1123-1145):
- Move "Paid Agents" card before "Total Deals" card (swap positions)
- So the order becomes: ...Attendance Issues, Paid Agents, Total Deals

**Fix week start calculation** (lines 324-327):
- The current code uses Sunday as week start. Verify against the actual `week_start` values in `lead_payment_tracking`. The DB data shows `2026-02-08` which IS a Sunday (Feb 10 is Tuesday, minus 2 days = Feb 8). So the JS calculation is actually correct.
- The real issue may be that managers can only see their own team's agents, and if none of their team agents have payments, it shows 0. For admins, it should show correctly. To be safe, add a debug-friendly approach and also ensure the `is_inactive` default filter isn't accidentally hiding paid agents.

**Actual root cause**: Looking more carefully at line 551 -- `const matchesInactive = showInactive ? agent.isInactive : !agent.isInactive;` -- this means when `showInactive` is false (default), agents with `isInactive = true` are hidden. But the `activeAgents` variable on line 585 is `agents.filter(a => !a.isDeactivated)` which uses the already-filtered `agents` state. Wait -- no, `agents` is the full state, `filteredAgents` applies the search/inactive filter. The `activeAgents` on line 585 uses `agents` (the full state) not `filteredAgents`. So paid agents should show up in the metric count even if filtered out of the list view.

Re-checking: the `agents` state is populated by `fetchAgents` which queries `status: 'active'` from the DB. None of those paid agents are deactivated. So `activeAgents` should have them. The `totalPaidAgents` formula checks `onboardingStage === "evaluated"` AND `(standardPaid || premiumPaid)`. The payment map is populated from a query with the correct `weekStartStr`.

I suspect this may be a **role-based visibility issue** -- if the user is a manager, the agents query (line 268-269) filters to only `invited_by_manager_id = currentAgent.id`. So managers only see their own team's paid agents. This is correct behavior, but if the user expects to see all paid agents, that's the discrepancy.

For safety, I'll ensure the payment query week_start aligns properly and also check if the `is_inactive` filter on agents state (line 428) is causing agents to be excluded before they even reach the stats calculation.

### File 2: `src/pages/LogNumbers.tsx`

**Restructure the production entry section** (lines 616-681):
- Move BubbleDealEntry to the TOP of the form, above the stat fields grid
- Change label from "Deal Premiums (ALP)" to "Deal Amounts" with a clear subtitle "Enter each deal amount"
- Make the Closes field in the stat grid visually distinct (highlighted border or different color)
- Add a clear section header "Activity Stats" above the grid
- Ensure the flow is intuitive: Deal Amounts -> Activity Stats -> Submit

**Improve BubbleDealEntry label** in LogNumbers context:
- Label: "Deal Amounts" with subtitle "Type amount and tap + Add for each deal"

### File 3: `src/components/dashboard/CompactProductionEntry.tsx`

**Same restructuring** as LogNumbers:
- The deal entry section is already at the top (good), but update the label from "Deals" to "Deal Amounts" with clearer instructions
- Add a subtitle under the section header: "Enter each deal amount below"

### File 4: `src/components/dashboard/BubbleDealEntry.tsx`

- Update placeholder from "Enter premium" to "Enter deal amount"
- This is the single source of truth for all three production forms

## Summary of Changes

1. **BubbleDealEntry.tsx**: Change placeholder to "Enter deal amount"
2. **LogNumbers.tsx**: Move deal entry to top, improve labels, reorder sections
3. **CompactProductionEntry.tsx**: Improve deal section labels
4. **DashboardCRM.tsx**: Swap Paid Agents and Total Deals card positions, ensure payment tracking week alignment

