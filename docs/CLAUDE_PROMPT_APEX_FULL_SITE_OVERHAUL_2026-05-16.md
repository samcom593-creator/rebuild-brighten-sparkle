# Claude Prompt: APEX Full Site Overhaul

You are my autonomous senior product engineer, UX architect, QA lead, and data-systems auditor for APEX Financial.

Work in this repo:

`/Users/samjames/projects/rebuild-brighten-sparkle`

## Authority And Working Style

You have full authorization to inspect the repo, use the terminal, edit files, add migrations, run tests, and improve the product. Do not ask Sam questions. Do not stop at a plan. Make the best reasonable decision and keep working until the site is substantially overhauled and verified.

Only pause for truly irreversible destructive actions, public posting, sending money, deleting live records without a backup, or credentials you cannot access. If blocked, document the blocker, choose the safest fallback, and keep moving on the next valuable task.

## Critical Correction

Do not misunderstand privacy.

APEX is an insurance agency operating system. Authorized users inside the authenticated app must be able to see the client/policy information they need to service their book of business. That includes detailed client fields they inputted and legally need for insurance servicing, such as contact info, policy info, beneficiary/application details, SSN/tax/banking-related fields if those fields exist in the database and the user role is allowed to see them.

The rule is:

- Do not paste PII/secrets into chat, commits, screenshots, logs, docs, or public/client-side code.
- Do not hide required client fields from the authorized app workflows.
- Do display sensitive client information inside protected, role-aware, authenticated pages when it is operationally needed.
- Use role-based access, audit-friendly structure, careful UI, and safe defaults.
- Never expose sensitive data publicly or to unauthorized roles.

## Product Goal

APEX Financial is now the main production website and operating system for the agency. Agents, managers, and admins will use it daily for:

- Agent Pipeline: book-of-business/client servicing pipeline, including every client they sold, are selling, or need to follow up with.
- Recruit Pipeline: recruiting/applicant/licensing/onboarding pipeline.
- Deal submission.
- Full book of business.
- Client records.
- Policy status tracking.
- Production numbers.
- Leaderboards.
- Seminars.
- Team management.
- Admin controls.
- Sync health.

The site must receive a full head-to-toe overhaul. It should look and feel like a premium multi-million-dollar agency platform. It should not look remotely like the old patched-together version. Every page needs a clear purpose, clean layout, excellent UX, guided workflows, strong data trust, and no clutter.

## Do Not Change Sam’s Meaning

When Sam says Agent Pipeline, keep it as Agent Pipeline. Do not rename it into Recruit Pipeline. They are separate:

- Agent Pipeline = clients, policies, book of business, deal/client follow-up, servicing, submitted/active/pending/lapsed policy workflow.
- Recruit Pipeline = applicants, new hires, licensing, contracting, onboarding, activation.

If existing routes/pages use similar names, reorganize them clearly without deleting functionality.

## Core User Roles

Admin view must give full agency control:

- All agents/managers.
- All clients and policies.
- All deals and book-of-business records.
- All recruit pipeline records.
- All production numbers.
- Sync health.
- Mapping/data-quality issues.
- Leaderboards.
- Seminar ops.
- Admin settings.

Manager view must give team/downline control:

- Downline agents.
- Downline client/policy book.
- Team Agent Pipeline.
- Recruit Pipeline for assigned/referred applicants.
- Follow-up queues.
- Production and leaderboards.
- Seminar/recruiting tools.

Agent view must give the agent everything they need:

- Submit deals.
- See their clients.
- See their full book of business.
- See policy/client details they inputted and need to service.
- Track Agent Pipeline status.
- Track production.
- See personal leaderboard context.
- See training/onboarding tasks where relevant.

## First Steps

Start by inspecting the repo and current state:

```bash
git status --short
npm run check:sync-reliability
npm run check:metric-truth
npx tsc --noEmit
npm run build
```

Then inspect:

- `src/App.tsx`
- all route/page files under `src/pages`
- sidebar/navigation components
- dashboard components
- deal submission components
- book-of-business pages
- Agent Pipeline pages
- Recruit Pipeline/application pages
- leaderboards
- seminar pages
- admin/integration pages
- Supabase types and queries
- sync-health components

Do not overwrite existing user edits without understanding them.

## Site Architecture To Build

Create a clean role-aware navigation system.

Admin navigation:

- Command Center
- Agent Pipeline
- Book of Business
- Submit Deal
- Recruit Pipeline
- Agents & Managers
- Leaderboards
- Seminars
- Sync Health
- Notifications
- Admin Settings

Manager navigation:

- Team Dashboard
- Team Agent Pipeline
- Team Book of Business
- Submit Deal
- Recruit Pipeline
- Leaderboards
- Seminars
- Follow-Up Queue
- Settings

Agent navigation:

- My Dashboard
- Agent Pipeline
- My Book of Business
- Submit Deal
- My Clients
- My Production
- Leaderboard
- Training / Getting Started
- Profile / Settings

Remove or demote clutter, duplicate links, dead routes, fake/demo surfaces, and confusing route names. Keep business-critical functionality.

## UX Standard

Make the app feel premium, dense, polished, and operational.

Use the existing stack:

- React
- TypeScript
- Tailwind
- shadcn/ui
- lucide-react
- Supabase

Build consistent:

- app shell
- side navigation
- mobile navigation
- page headers
- breadcrumbs/tabs
- stat rows
- tables
- filters
- detail drawers
- modals
- forms
- status badges
- empty states
- loading states
- error states
- success/next-action states

This is not a marketing landing page. It is an agency operating system.

## Agent Pipeline Requirements

Agent Pipeline is one of the most important areas.

Build it as the client/policy servicing pipeline:

- Every client/policy an agent sold, is selling, or needs to follow up with.
- Full client details available to authorized role.
- Policy status.
- Carrier.
- Product.
- Policy number.
- Premium.
- Effective date.
- Posted date.
- Agent owner.
- Manager/team visibility where allowed.
- Contact details.
- Sensitive servicing fields where present and allowed.
- Notes.
- Follow-up stage.
- Next action.
- Stale/stuck indicators.
- Sync status.
- Duplicate/missing-data warnings.

Views:

- Agent: only their own client/policy pipeline.
- Manager: their downline/team pipeline.
- Admin: all pipeline records.

Include search, filters, sorting, and a detail drawer/page.

## Book Of Business Requirements

The Book of Business must be complete and useful:

- Agents see their full book.
- Managers see downline book.
- Admins see full agency book.
- No hidden operational fields that agents need for servicing.
- Clean filters by status, carrier, product, agent, date, ALP, source, sync status.
- Client detail view must be organized, not cluttered.
- Use sections such as Client, Policy, Carrier, Premium, Status, Servicing Details, Notes, Sync/Audit.

Do not paste PII into logs or reports. Inside the protected UI, render the authorized data needed for the job.

## Deal Submission Requirements

Build or overhaul a guided deal submission workflow:

- Client info.
- Sensitive client fields if existing schema supports them and role allows.
- Policy/carrier/product info.
- Premium/face amount/effective date.
- Notes.
- Validation.
- Duplicate detection by agent + policy number/client.
- No placeholder junk values.
- Clear sync status.
- Clear success/failure with next actions.
- Agent/manager/admin paths all work.

## Recruit Pipeline Requirements

Recruit Pipeline is separate from Agent Pipeline.

It should cover:

- Applicants.
- Licensing.
- Contracting.
- Onboarding.
- Activation.
- Hiring manager assignment.
- Referral/recruiter ownership.
- Next action.
- Follow-up status.
- Stage counts.
- Stuck candidates.

Do not mix Recruit Pipeline with client/policy Agent Pipeline.

## Dashboards

Admin Command Center must answer:

- Is the agency healthy today?
- What production came in?
- Are syncs healthy?
- Which agents/managers need attention?
- What pipeline items are stuck?
- What recruiting items are stuck?
- What data quality problems need fixing?
- What seminars/follow-ups need attention?

Manager dashboard must answer:

- What is my team producing?
- Who needs help?
- Which clients/policies are stuck?
- Which recruits are stuck?
- What follow-ups should I do today?

Agent dashboard must answer:

- What do I need to do next?
- What clients/policies need attention?
- How do I submit a deal?
- What is my production?
- What is my book of business?

## Numbers And Leaderboards

Keep numbers live and trustworthy:

- Use posted deals / live truth layer.
- Use America/Chicago date windows.
- Avoid fake/demo numbers.
- Avoid Sam/default attribution bugs.
- Show submitted/active/pending/lapsed clearly.
- Explain AgentLink null statuses gracefully.
- Leaderboards must match the same truth source as dashboards.

## Sync/Data Safety

Fix or preserve guardrails:

- Inbound AgentLink rows must not be pushed outbound as Apex-created deals.
- Backfills must not spam Discord.
- No duplicate deal spam.
- No hardcoded secrets/webhooks.
- Sync health must be visible and understandable.
- Data quality issues should show in admin tools.

Reference this repair prompt if needed:

`docs/CLAUDE_PROMPT_AGENTLINK_SYNC_REPAIR_2026-05-16.md`

## Admin Controls

Admins need clean control over:

- agents
- managers
- role/visibility
- AgentLink/InsuraCloud mappings
- carriers
- sync health
- unresolved mappings
- duplicate deals
- notification safety
- books of business
- recruit pipeline
- seminars

## Verification

After meaningful changes, run:

```bash
npm run check:sync-reliability
npm run check:metric-truth
npx tsc --noEmit
npm run build
```

Fix failures unless clearly unrelated and documented.

Also inspect route coverage and ensure there are no blank pages, broken imports, dead nav links, overlapping text, unusable mobile screens, fake data, or exposed secrets.

## Final Deliverable

Implement directly. Do not only write a plan.

Final report must include:

- Files changed.
- Routes/pages overhauled.
- Agent Pipeline improvements.
- Recruit Pipeline improvements.
- Book of Business improvements.
- Deal submission improvements.
- Admin/manager/agent role improvements.
- Data safety improvements.
- Tests run and results.
- Remaining risks/blockers.
- Deploy commands or next deploy step.

Keep working until the overhaul is as complete as possible.
