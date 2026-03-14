

# Fix Numbers Entry + Process XCEL Data + Merge Duplicates

## Problem Analysis

Based on the screenshots and your message, there are three things to address:

1. **Numbers entry not working** — The authenticated `/numbers` page uses direct Supabase client calls which rely on RLS policies with `current_agent_id()`. If an agent's `user_id` isn't properly linked, inserts silently fail. The public `/apex-daily-numbers` page uses an edge function (service role) and should work — but may have a UI or search issue preventing agents from finding themselves.

2. **XCEL Solutions course data** (screenshot 1) — Your XCEL daily report shows 16+ students with course progress, completion percentages, and prep status. This data should be synced into your platform's lead records.

3. **Duplicate records** (screenshot 2) — Pierre Auguste appears twice with different emails (`pierreauguste71@yahoo.com` vs `pierre.auguste@placeholder.com`). These need merging.

---

## Plan

### Task 1: Fix Numbers Entry — Add Error Logging + Fallback
**Problem:** The `CompactProductionEntry` (used in Agent Portal and `/numbers`) does a direct `supabase.from("daily_production").upsert(...)` which fails silently if RLS blocks the insert.

**Fix in `CompactProductionEntry.tsx`:**
- Add explicit error logging with `toast.error` showing the actual error message
- Add a fallback: if the direct upsert fails with a permission error, retry via the `log-production` edge function (which uses service role and always works)
- This ensures numbers can always be saved regardless of RLS state

**Fix in `LogNumbers.tsx` (public page):**
- Add console.log statements to the search and submit handlers so we can trace failures
- The edge function path should already work — verify the function is deployed

### Task 2: Process XCEL Course Data
From the screenshot, update lead records with course progress data for these students:
- Paul Williams — 0% complete, NOT PREPARED
- Danglo Walter — 14% complete, NOT PREPARED  
- Jason Ballard — 3% complete, NOT PREPARED
- Caleb Watkins — 22% complete, NOT PREPARED (Manager: Samuel James)
- Brandon Davidson — 51% complete, NOT PREPARED (Manager: Sam)
- JOSE COOPER — 3% complete, NOT PREPARED (Manager: JOSE)
- Charles Reese — 100% complete, PLE 03/07, 75% sim, GETTING CLOSER (Manager: Kaeden Vaughns)
- Ben Gillie — 100% complete, PLE 03/11, 8% prep, 25% sim, GETTING CLOSER
- Jordan McClendon — 100% complete, 8% prep, 50% sim, GETTING CLOSER
- Cooper Ubert — 100% complete, PLE 02/23, 33% prep, 50% sim, GETTING CLOSER (Manager: Samuel James)
- Andre Sanatria — 100% complete, PLE 02/19, 100% prep, 0% sim, ALMOST THERE (Manager: Samuel)
- Malik Tobias — 100% complete, PLE 02/14, 84% prep, 100% sim, PREPARED TO PASS (Manager: Samuel James — **this student is ready!**)
- Demetric Fulton — 100% complete, PLE 02/18, N/A 58%, GETTING CLOSER
- Yosiah Augustine — 45 hrs 52min, 17% complete, NOT PREPARED (Manager: KJ)

**Life & Health section:**
- Isaiah Nieves — 4% complete, NOT PREPARED (Manager: Samuel James)
- Joshua Auguste — 0% complete, NOT PREPARED
- Pierre Auguste — 100% complete, PLE 12/17/2025, 25% prep, 25% sim, GETTING CLOSER (Manager: Samuel James)

**Action:** Update lead notes and `license_progress` status via a database query for each student. Mark students with 100% course completion as `finished_course`.

### Task 3: Merge Duplicate Pierre Auguste
Merge the two Pierre Auguste records:
- Keep: `pierreauguste71@yahoo.com` / `4077545167` (the real contact info)
- Remove: `pierre.auguste@placeholder.com` (placeholder email, no phone)
- Preserve the "Licensed" status from the second record

### Files to Edit
| File | Change |
|------|--------|
| `src/components/dashboard/CompactProductionEntry.tsx` | Add edge function fallback on RLS failure |
| `src/pages/LogNumbers.tsx` | Add debug logging to search/submit |

### Database Actions
- Update lead records with XCEL course progress data
- Merge duplicate Pierre Auguste records
- Verify `log-production` edge function is deployed and working

