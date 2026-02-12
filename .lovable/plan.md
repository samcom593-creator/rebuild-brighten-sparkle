

# Pipeline Card Enhancements

## What Changes

### 1. Rename "Onboarding" stage to "Hired"
The first stage in the OnboardingTracker (the clickable circle progression) currently says "Onboarding". This will be renamed to "Hired" with updated description "Agent has been hired and onboarded" since everyone in the CRM pipeline is already hired.

### 2. Always show licensing progress tag
Currently the license progress badge only shows when it's something other than "unlicensed". It will now always show on every card:
- **Unlicensed** (gray tag)
- **Course Purchased** (violet tag)
- **Finished Course** (violet tag)
- **Test Scheduled** (blue tag with exam date)
- **Passed Test** (green tag)
- **Fingerprints Done** (green tag)
- **Waiting On License** (amber tag)
- **Licensed** (green tag)

### 3. Show manager badge for agents not directly under you
When viewing as admin, any agent whose `invited_by_manager_id` is NOT your own agent ID will display a small badge like "Under KJ Vaughns" or "Under Obiajulu" so you can instantly see who manages them without tapping into the card.

### 4. Show last follow-up more prominently
The "last contacted" timestamp already exists but is tiny and easy to miss. It will be moved to its own line below the email, with a clear "Last F/U:" label and relative time, using a slightly more visible style.

---

## Technical Details

### Files to modify

| File | Change |
|------|--------|
| `src/components/dashboard/OnboardingTracker.tsx` | Rename first stage from "Onboarding" to "Hired", update description |
| `src/pages/DashboardCRM.tsx` | (1) Always show license progress badge even for "unlicensed". (2) Add manager name badge when agent is under a different manager. (3) Make last-contacted more prominent with "Last F/U:" label on its own line |

### License Progress Badge Colors
```
unlicensed     -> bg-slate-500/10, text-slate-400
course_purchased -> bg-violet-500/10, text-violet-400
finished_course  -> bg-violet-500/10, text-violet-400
test_scheduled   -> bg-blue-500/10, text-blue-400
passed_test      -> bg-emerald-500/10, text-emerald-400
fingerprints_done -> bg-emerald-500/10, text-emerald-400
waiting_on_license -> bg-amber-500/10, text-amber-400
licensed         -> bg-green-500/10, text-green-400
```

### Manager Badge Logic
The current user's agent ID is fetched at load time (already done in `fetchAgents`). For each agent card, if `agent.managerId` exists and differs from the current user's agent ID, show a small badge: "Under [managerName]" in a neutral style.
