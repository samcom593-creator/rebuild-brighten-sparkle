

# Plan: Add Search Bar to Dashboard Team View + Deployment Guidance

## What's Missing

After reviewing the codebase, **7 of 8 requested changes are already implemented**. The one missing piece:

**Dashboard "Your Team" search bar**: `ManagerTeamView.tsx` has `searchQuery` state (line 289) and filtering logic (line 375), but **never renders a search input field** in the UI. The search bar needs to be added to the component's JSX.

## Implemented Changes (Confirmed)

1. **Check-in revamp** — `ApplicantCheckin.tsx` updated with new progress options
2. **Daily check-in prompt** — `send-daily-checkin-prompt` edge function created
3. **Unlicensed process email** — `send-unlicensed-process-update` edge function created  
4. **Referral dropdown** — `get-active-managers` updated to include live agents
5. **Contracted modal fix** — `ContractedModal.tsx` updated to skip CRM check
6. **Admin daily summary** — `notify-fill-numbers` updated with admin email
7. **Pipeline search** — `DashboardApplicants.tsx` already filters by name, email, AND phone
8. **Aged leads assignment** — `QuickAssignMenu` now supports `source` prop; Lead Center has "Aged Leads" stat card
9. **Call Center referrer** — "Referred by" badge added to `CallCenterLeadCard` and `CallModeInterface`

## Fix Required

**File**: `src/components/dashboard/ManagerTeamView.tsx`

Add a search input + sort/filter controls row before the team member list (before line 392's `return`). Render an `<Input>` bound to the existing `searchQuery` state, with a search icon, so admins/managers can search for agents by name or email directly on the dashboard.

## Deployment Note

All **backend changes** (edge functions, database migrations) deploy automatically and are already live. **Frontend changes** require the user to publish:
- Click the **Publish** button (top-right on desktop, or `...` menu on mobile → "Publish")
- Click **"Update"** in the publish dialog
- Wait ~30 seconds for the new version to go live

The delay the user noticed is because the preview shows the latest code, but the published site only updates when you explicitly publish.

