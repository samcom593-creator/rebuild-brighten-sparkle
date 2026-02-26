

# Phase 1: Critical Data Fixes

## 1A. Fix Lead Center Stats

**File: `src/pages/LeadCenter.tsx`**

The stats calculation at lines 332-339 needs these fixes:

### "Contacted" stat (line 335)
Current: `!!l.contactedAt || (l.status !== "new" && l.status !== "not_contacted")`
This was already partially fixed in the last round. However, it still misses leads that have `contact_history` records but no `contactedAt` field set and remain in `new` status. 

Fix: Fetch `contact_history` records and cross-reference. During `fetchLeads()`, also query `contact_history` to get a Set of application IDs that have been contacted. Then in the Lead interface, add a `hasContactHistory` boolean. The stat becomes: `!!l.contactedAt || l.hasContactHistory || (l.status !== "new")`.

### "Closed" stat (line 336)
Current: includes `"approved"` which is correct — `hired`, `contracted`, `approved` all count as closed.
This looks reasonable already. No change needed unless user disputes.

### "Licensed" stat (line 337)
Current: `l.licenseStatus === "licensed"` — this is correct across both sources.

### Filter logic fix (lines 309-319)
The `"not_contacted"` filter at line 313 only checks `!lead.contactedAt`. It should also check `!lead.hasContactHistory && lead.status === "new"`.

The `"has_contacted"` filter at line 314 should also include `lead.hasContactHistory`.

The `"closed_all"` filter at line 316 should also include `"approved"`.

### Implementation detail:
In `fetchLeads()` (~line 164), after fetching applications and aged leads, add:
```typescript
// Fetch contact history IDs for accurate "contacted" tracking
const { data: contactedAppIds } = await supabase
  .from("contact_history")
  .select("application_id");
const contactedSet = new Set(contactedAppIds?.map(c => c.application_id) || []);
```
Then when building `appLeads`, add: `hasContactHistory: contactedSet.has(app.id)` to each Lead object.

Update the Lead interface to include `hasContactHistory?: boolean`.

---

## 1B. Fix Log Numbers Submission

The edge function works correctly (tested — returns `{"success": true}`). The unique constraint `unique_agent_production_date` exists on `(agent_id, production_date)`.

The likely issue is in the **UI error handling** at lines 244-256. The `supabase.functions.invoke` method on newer SDK versions may return errors differently. Specifically:
- `res.error?.context?.json` may not exist on all error types
- The error may be swallowed silently

**Fix in `src/pages/LogNumbers.tsx`:**
1. Simplify the error handling to be more robust
2. Add a toast.success on successful submission so the user gets clear feedback
3. Add `console.log` of the full response for debugging
4. The `productionData` object includes `passed_price` and `booked_inhome_referrals` which are NOT columns in the `daily_production` table — the edge function passes `...productionData` to the upsert, which would cause a Postgres error for unknown columns.

**Root cause found:** The `productionData` state includes `passed_price` and `booked_inhome_referrals` fields (lines 81, 84) that do NOT exist as columns in the `daily_production` table. When the edge function does `...productionData` in the upsert (line 82 of the edge function), Postgres throws an error for these unknown columns. The edge function catches this and returns a 500, but the UI may not surface it properly.

**Fix in `supabase/functions/log-production/index.ts`:**
In the `submit` action, explicitly map only the known columns instead of spreading `...productionData`:
```typescript
{
  agent_id: agentId,
  production_date: date,
  presentations: Number(productionData.presentations) || 0,
  deals_closed: Number(productionData.deals_closed) || 0,
  hours_called: Number(productionData.hours_called) || 0,
  referrals_caught: Number(productionData.referrals_caught) || 0,
  referral_presentations: Number(productionData.referral_presentations) || 0,
  aop: Number(productionData.aop) || 0,
}
```

This removes the unknown `passed_price` and `booked_inhome_referrals` columns from the upsert.

**Also fix in `src/pages/LogNumbers.tsx`:**
- Improve error handling in `handleSubmitProduction` to better surface errors
- Add `toast.success("Numbers saved!")` before confetti

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/LeadCenter.tsx` | Add `hasContactHistory` to Lead interface, fetch contact_history in fetchLeads, update stats and filter logic |
| `supabase/functions/log-production/index.ts` | Fix submit action to explicitly map known columns instead of spreading productionData |
| `src/pages/LogNumbers.tsx` | Improve error handling, add success toast |

## No Database Changes Required
The unique constraint already exists. No new tables or migrations needed.

