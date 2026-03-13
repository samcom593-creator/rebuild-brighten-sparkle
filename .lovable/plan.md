

# Comprehensive Platform Refinement — 12 Tasks

This plan addresses every issue raised, organized by priority. Each section describes the problem and the fix.

---

## 1. Remove Quote Engine Entirely

**Problem:** The quote engine doesn't work and needs to be scrapped.

**Changes:**
- Remove routes from `App.tsx`: `/quote-engine`, `/quote-engine/admin`, `/quote-engine/history`
- Remove the "Quote Engine" nav item from `GlobalSidebar.tsx` (line 179)
- Delete page files: `QuoteEngine.tsx`, `QuoteEngineAdmin.tsx`, `QuoteHistory.tsx`
- Delete component folder: `src/components/quote-engine/*`
- Delete lib files: `src/lib/quoteEngine.ts`, `src/lib/quoteEngineTypes.ts`
- Remove lazy imports from `App.tsx`

---

## 2. Fix Sidebar Agent Search

**Problem:** The search bar queries agents but only fetches the first 10 without filtering by name server-side, then filters client-side — meaning the target agent is often not in the 10 returned.

**Fix in `GlobalSidebar.tsx` (lines 93-97):** Change the query to use `.ilike()` or `.or()` filtering on the `display_name` column, and also search profiles by `full_name`/`email` with the search term. Use the `log-production` edge function's `search` action (which already does full-text search across all agents) instead of the broken client-side approach.

```typescript
const { data } = await supabase.functions.invoke("log-production", {
  body: { action: "search", query: searchQuery.trim() }
});
const results = (data?.agents || []).slice(0, 6).map(a => ({
  id: a.id, name: a.name, email: a.email
}));
setSearchResults(results);
```

---

## 3. Auto-Create Agent + Enroll in Course When Hired (Licensed)

**Problem:** Clicking "Hired" on a licensed applicant doesn't create an agent record or enroll them in the course.

**Fix in `DashboardApplicants.tsx` `handleMarkAsHired`:** After marking as hired, if the applicant is **licensed**, automatically invoke the `add-agent` edge function with `hasTrainingCourse: true` to create their agent record, auth account, and enroll them in the course in one step. The `add-agent` function already supports this — it sets `onboarding_stage: "training_online"` and `has_training_course: true` when the flag is passed.

```typescript
// After successful status update, auto-create agent if licensed
if (app.license_status === "licensed") {
  await supabase.functions.invoke("add-agent", {
    body: {
      firstName: app.first_name,
      lastName: app.last_name,
      email: app.email,
      phone: app.phone,
      managerId: agentId, // current user's agent ID
      licenseStatus: "licensed",
      hasTrainingCourse: true,
    }
  });
}
```

Also update the `add-agent` edge function to send the course enrollment email automatically after agent creation when `hasTrainingCourse` is true, by invoking `send-course-enrollment-email`.

---

## 4. Show Login Link When Tapping Agent Code

**Problem:** When viewing an agent's code, there's no easy login link to share.

**Fix:** In the agent detail views (AgentPortal, DashboardCRM, TeamDirectory — wherever agent codes are displayed), add a copyable login link next to the agent code. The link format: `https://rebuild-brighten-sparkle.lovable.app/login` — display it as a "Login Link" button that copies to clipboard. Also show the magic login URL format for quick sharing.

---

## 5. Manager CC'd on Every Application Step Change

**Problem:** Managers aren't notified when applicants move through pipeline stages.

**Fix:** Update the following edge functions to CC the referring manager:
- `notify-stage-change/index.ts` — currently only emails the agent. Add logic to look up `invited_by_manager_id` → get manager's profile email → CC them.
- `submit-application/index.ts` — on new application, CC the `assigned_agent_id`'s manager.
- `send-post-call-followup/index.ts` — CC the manager on hire emails.

Also update `handleMarkAsHired` and status change handlers in `DashboardApplicants.tsx` and `LeadCenter.tsx` to pass `agentId` so edge functions can resolve the manager.

---

## 6. Leaderboards Should Be Public

**Problem:** Agent production leaderboard requires authentication.

**Fix:** The `/apex-daily-numbers` page is already public and uses the `log-production` edge function's `leaderboard` action (which uses service role). Add a visible leaderboard section to that page showing the weekly rankings. No RLS changes needed since the edge function bypasses RLS.

---

## 7. Duplicate Merge — Auto-Detect Same Email/Phone

**Problem:** The merge feature exists (`DuplicateMergeTool.tsx`) but may not be surfaced properly or auto-merging.

**Fix:** Verify the merge tool is accessible from the admin dashboard. Add a badge/notification indicator showing the count of detected duplicates. The tool already handles email and phone matching — ensure it's prominently placed in the Command Center or Pipeline view.

---

## 8. Reduce Load Screen Times

**Problem:** Pages take too long to load.

**Fix:**
- The `QueryClient` already has `staleTime: 120000` and `gcTime: 300000` — good.
- Add `prefetchQuery` calls for common data (agents list, production) in `AuthenticatedShell` so data is ready before navigation.
- Convert the heaviest lazy-loaded pages (Dashboard, DashboardApplicants) to eager imports since they're the most visited.
- Add skeleton loading states to replace the generic `PageLoader`.

---

## 9. Remove Self-Healing Health Check

**Problem:** The self-healing system doesn't work.

**Fix:** Remove the `system-health-check` edge function and any cron jobs triggering it. Remove the `SystemIntegrityCard` component from the admin dashboard. Clean up the `health_check_log` table references.

---

## 10. Confirm WhatsApp Messages Are Sending

**Problem:** Need to verify WhatsApp delivery.

**Fix:** Review the `send-whatsapp-onboarding-blast` edge function logs. Add a delivery status indicator in the Notification Hub showing send/fail counts. The existing `notification_log` table tracks channel delivery — surface WhatsApp-specific stats in the Notification Hub dashboard.

---

## 11. Daily Top Producers Email

**Problem:** Need daily top producers notification.

**Fix:** The `notify-admin-daily-summary` cron job (already scheduled at 10:30 PM CST) already includes top 3 performers. Also, `notify-top-performers-morning` exists for morning recaps. Verify both cron jobs are active. If the morning one isn't scheduled, add a cron job for `notify-top-performers-morning` at 8:00 AM CST daily.

---

## 12. Overall Flow Polish

- Ensure the "Hire → Create Agent → Enroll in Course → Send Welcome Email → Send Login" pipeline is seamless end-to-end
- Add toast confirmations at each step so the user knows what happened
- Ensure the contracted modal and add-agent flows are consistent

---

## Files to Edit

| File | Change |
|------|--------|
| `src/App.tsx` | Remove quote engine routes, eager-load Dashboard |
| `src/components/layout/GlobalSidebar.tsx` | Remove QE nav item, fix search to use edge function |
| `src/pages/DashboardApplicants.tsx` | Auto-create agent on hire for licensed applicants |
| `supabase/functions/add-agent/index.ts` | Auto-send course enrollment email when `hasTrainingCourse` |
| `supabase/functions/notify-stage-change/index.ts` | CC manager on stage changes |
| `supabase/functions/submit-application/index.ts` | CC manager on new applications |
| `src/pages/LogNumbers.tsx` | Add public leaderboard section |
| `src/components/admin/SystemIntegrityCard.tsx` | Remove or disable |

**Files to Delete:**
- `src/pages/QuoteEngine.tsx`
- `src/pages/QuoteEngineAdmin.tsx`
- `src/pages/QuoteHistory.tsx`
- `src/components/quote-engine/*` (entire folder)
- `src/lib/quoteEngine.ts`
- `src/lib/quoteEngineTypes.ts`

