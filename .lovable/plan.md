

# Fix: Accurate Unlicensed Tracking + Test Date Notifications

## What's Actually Happening

After investigation, the "Hired (Unlicensed)" stat card in your CRM **does already include** everyone who isn't licensed -- course purchased, fingerprints, test scheduled, waiting on license -- they all count. The number is correct. However, the issue is that **you can't see or change their licensing stage** from the CRM cards or the Dashboard roster, and there are **no email notifications** when a test date is set.

Here's what needs to be fixed:

---

## Change 1: Add License Progress Selector to CRM Agent Cards

Right now, the CRM agent cards don't show the licensing stage (Course Purchased, Test Scheduled, Fingerprints, etc.) for unlicensed agents. This makes it impossible to track where each person is in the licensing process from the CRM view.

| File | Change |
|------|--------|
| `src/pages/DashboardCRM.tsx` | Add the `LicenseProgressSelector` component to each unlicensed agent's card. This is the same dropdown already used in the Pipeline page -- it shows the current stage and lets you advance it with one tap. When "Test Scheduled" is selected, the date picker will appear. |

After this change, every unlicensed person in the CRM will show their licensing stage badge (e.g., "Course Started", "Test Scheduled (Mar 5)", "Fingerprints") and you can update it directly from the card.

---

## Change 2: Add License Progress Selector to Dashboard Roster (ManagerTeamView)

Same issue -- the Agency Roster on the main dashboard doesn't show licensing progress for unlicensed team members.

| File | Change |
|------|--------|
| `src/components/dashboard/ManagerTeamView.tsx` | For unlicensed members, show a `LicenseProgressSelector` badge on their card. This requires fetching `license_progress` and `test_scheduled_date` from the applications table (matching by `assigned_agent_id`) and passing it to the selector. |

---

## Change 3: Create Test Date Notification Edge Function

When someone's test date is set (or approaching), automatically email the agent, their manager, and admin.

| File | Change |
|------|--------|
| `supabase/functions/notify-test-scheduled/index.ts` | **New function.** Sends three emails when a test date is recorded: (1) Confirmation to the applicant with the date and prep tips, (2) CC to the manager, (3) CC to admin. |
| `supabase/functions/notify-test-reminder/index.ts` | **New function.** A scheduled (cron) function that runs daily, queries all applications with `license_progress = 'test_scheduled'` and `test_scheduled_date` within the next 2 days, and sends reminder emails to the applicant + manager + admin. Also sends a follow-up email 1 day after the test date asking "Did you pass?" |

---

## Change 4: Trigger Notification When Test Date Is Set

| File | Change |
|------|--------|
| `src/components/dashboard/LicenseProgressSelector.tsx` | After successfully saving a test date, invoke `notify-test-scheduled` edge function with the application ID and test date. |

---

## Change 5: Set Up Daily Cron for Test Reminders

A database cron job will call `notify-test-reminder` once daily to check for upcoming and past test dates and send the appropriate emails automatically.

---

## Summary of What You'll See After This

- **CRM "Hired (Unlicensed)" view**: Each person shows their exact licensing stage (Course Started, Test Scheduled with date, Fingerprints, etc.) and you can change it with one tap
- **Dashboard Roster**: Same licensing stage badges on unlicensed team members
- **When you set a test date**: Automatic email goes to the applicant, their manager, and admin confirming the scheduled date
- **2 days before the test**: Reminder email to everyone
- **1 day after the test**: "Did you pass?" follow-up email to everyone
- All emails CC admin (info@apex-financial.org) and the assigned manager per existing policy

