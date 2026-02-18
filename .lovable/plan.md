

# Fix: Dashboard Unlicensed Count Is Wrong (Shows 3, Should Be 30+)

## The Problem

The dashboard "Recruiting Stats" card (AgencyGrowthCard) only shows **3 unlicensed** because it's counting from the `agents` table, which only has 3 unlicensed agent records. However, there are **30 unlicensed hired people** in the `applications` table (status: reviewing, contracting, approved) who haven't been converted to agent records yet, or whose agent records show "licensed" while their application doesn't.

The dashboard never merges these two data sources to give you the real unlicensed total.

## The Fix

Update `src/components/dashboard/AgencyGrowthCard.tsx` to show the **true unlicensed count** by merging data from both the `agents` and `applications` tables, matching the same logic used in the CRM.

### What Changes

| File | Change |
|------|--------|
| `src/components/dashboard/AgencyGrowthCard.tsx` | Replace the current "Licensed Producers" / "New Hires" / "In Pipeline" / "Growth" card layout with a more accurate set of stats that includes a dedicated **"Unlicensed"** total card. The unlicensed count will merge agents with `license_status != 'licensed'` AND applications with status `reviewing`/`contracting`/`approved` and `license_status != 'licensed'`, deduplicated by email so no one is counted twice. |

### Stat Cards After Fix

The four cards will be:

1. **Licensed Producers** -- total active agents with `license_status = 'licensed'` (unchanged, currently correct)
2. **Unlicensed (Total)** -- everyone hired who is NOT licensed, merged from both `agents` and `applications` tables, deduplicated by email. This will show the real number (~30) instead of 3.
3. **In Pipeline** -- agents in onboarding/training stages (unchanged)
4. **New Hires (Period)** -- new hires for the selected period (day/week/month), with licensed vs unlicensed sub-label (unchanged)

### Technical Details

The query will:
1. Fetch all non-deactivated agents with their license status
2. Fetch all non-terminated applications with status in `('reviewing', 'contracting', 'approved')` and `license_status != 'licensed'`
3. Get agent emails from the `profiles` table to deduplicate against application emails
4. Combine both lists, dedup by email, and show the merged count

This matches exactly how the CRM's "Hired (Unlicensed)" stat works, ensuring consistency across the dashboard and CRM views.

## Result

After this fix, when you look at the dashboard you'll see the accurate count of all unlicensed people across your entire pipeline -- whether they exist as agent records or application records. The number will match what you see in the CRM.
