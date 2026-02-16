

# Fix Contracting Workflow: Agents Not Appearing in CRM, Course, or Dashboard

## Problem Found

After investigating the database, here's what's broken:

1. **Travon Colston** (contracted today) -- has NO agent record at all. The `add-agent` backend function failed (likely due to the deployment timeout error), but the code still marked the application as contracted. This means Travon is invisible everywhere: no CRM card, no course enrollment, no dashboard entry.

2. **Marc Pelissier** -- has an agent record but `has_training_course` is `false`, so he won't appear in course progress tracking.

3. **4 applications** have `status: "new"` instead of `"contracting"` even though they have `contracted_at` timestamps set. This is from older code that didn't update the status field.

## Root Cause

The ContractedModal has a critical sequencing bug: it calls the `add-agent` function first, but if the function fails, the code catches the error and returns early -- **except** the Supabase SDK doesn't always properly report edge function errors for non-2xx responses. This means the code can silently proceed past the error check, mark the application as contracted, but never actually create the agent.

## Fixes

### 1. Fix ContractedModal.tsx -- Bulletproof Error Handling
- Add explicit response status checking when invoking `add-agent`
- If agent creation fails for any reason, do NOT update the application -- abort entirely with an error message
- Remove the `as any` type cast on status (it's a valid enum, no cast needed)

### 2. Repair Orphaned Data
- **Travon Colston**: Create auth account, profile, and agent record via the `add-agent` function now that it's deployed
- **Marc Pelissier**: Set `has_training_course = true` on his agent record
- **Fix all 4 application statuses**: Update from `"new"` to `"contracting"` where `contracted_at` is set

### 3. Fix Application Status Updates
- Update all 4 orphaned applications (Travon, Lev, Shavanna, Marc) to have `status = "contracting"` to match their `contracted_at` timestamps

## Files to Modify
1. `src/components/dashboard/ContractedModal.tsx` -- Fix error handling to prevent silent failures
2. Data repair actions for the 5 affected records

