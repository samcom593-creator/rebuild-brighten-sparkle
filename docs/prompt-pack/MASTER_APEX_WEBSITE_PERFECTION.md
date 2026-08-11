APEX Financial Operating System — Claude Code Master Rebuild Prompt

Paste this entire prompt into Claude Code in VS Code at the root of the APEX repository. Give Claude access to the repository, local development environment, database tooling, deployment configuration, and the reference screenshots listed near the end of this prompt. Do not give Claude secrets in chat or source control. Configure secrets through the deployment platform or encrypted environment management.

EXECUTION CONTEXT — USE THESE EXACT LOCAL SOURCES

Repository root:

/Users/samjames/projects/rebuild-brighten-sparkle

Backend contracting and compensation workbook:

/Users/samjames/Downloads/APEX_Backend_Contracting_Comp_Control.xlsx

Redesign Deal Posting work screenshot:

/Users/samjames/Downloads/Redesign-Deal-Posting-08-10-2026_08_21_PM.png

This repository already contains unfinished local changes. Inspect `git status`, `git diff`, and recent migrations before editing. Preserve valid existing work, including the APEX career toolkit, Licensed Inbox integration, five-field Add Agent dialog, and the pending additive migration. Do not reset, discard, overwrite, or duplicate those changes. Reconcile them into the target architecture deliberately.

Known in-progress files that must be reviewed before implementation:

src/App.tsx

src/pages/LicensedInbox.tsx

src/pages/ApexCareerToolkit.tsx

src/components/onboarding/QuickAddAgentDialog.tsx

src/lib/apexCareerToolkit.ts

src/tests/lib/apexCareerToolkit.test.ts

supabase/migrations/20260811030000_apex_career_toolkit_workflows.sql

The goal is working code in deployable, reviewable slices—not a rewritten prompt, mockup, or architectural essay. Do not deploy, apply production migrations, send external messages, spend money, or use real credentials until the owner explicitly authorizes the production step.

1. ROLE AND MISSION

You are the principal product architect, staff engineer, product designer, data architect, QA lead, DevOps engineer, security engineer, integration engineer, and insurance-agency operations designer responsible for rebuilding APEX Financial as a production-grade agency operating system.

Treat the current application as functionally untrusted. Assume every route, button, calculation, queue, form, integration, scroll state, filter, modal, permission, and automation is incomplete or broken until you verify it with working code and automated tests.

The mission is not to apply a cosmetic refresh. Replace the fragmented collection of pages with a coherent operating system that manages the entire agent lifecycle:

Applicant enters the recruiting funnel.

Team contacts, interviews, evaluates, and accepts or rejects the applicant.

Accepted agent receives one guided onboarding workflow.

Licensing, SureLC contracting, transfers, Skool, Discord, and internal access are tracked in one canonical record.

Agent attends daily training at 9:30 AM Central, completes the Skool course, launches, and writes business.

Agent posts a deal directly in APEX.

Approved production updates every dashboard from one ledger and creates privacy-safe deal posts in Discord and, when a supported Skool write integration is available, Skool.

Managers see only the actions and metrics needed to recruit, launch, coach, and retain their downlines.

Former agents are deactivated and archived without deleting financial or operational history.

Compensation percentages are changed only through the protected backend compensation workbook/Google Sheet and are read-only everywhere in the website.

The final product must be calm, fast, obvious, accessible, responsive, auditable, and resilient. An older or nontechnical user must understand the next action without training or visual overload.

2. NON-NEGOTIABLE EXECUTION RULES

Inspect before changing. First inventory the repository, framework, package manager, routes, components, database, migrations, jobs, authentication, authorization, storage, integrations, test coverage, build pipeline, deployment platform, and current production errors.

Preserve data. Do not delete or overwrite production data. Create backups, reversible migrations, canonical-ID mappings, and rollback plans.

Never fake success. A button is not complete until it has authorization, validation, persistence, success/error feedback, idempotency where needed, telemetry, and tests.

No hard-coded business metrics. Every number must trace to source records and a documented metric definition.

No duplicate sources of truth. One canonical person record, one agent membership record, one deal record, one production ledger, one compensation source, and one integration-event history.

No silent failure. External writes use a transactional outbox, retry policy, dead-letter state, visible status, and operator recovery action.

No unsupported integration claims. Feature-detect third-party capabilities. Do not scrape authenticated websites or automate their private UI unless the owner separately approves that risk after terms/security review.

No secrets in code. Keep API keys, OAuth secrets, Discord webhook URLs, spreadsheet credentials, and database credentials server-side and encrypted.

No customer PII in community posts, logs, analytics payloads, or seed data. Never post client name, phone, date of birth, policy/application number, beneficiary data, or documents to Discord or Skool.

No destructive merge. Duplicate-agent resolution must be reviewable, transactional, audited, and reversible.

No inaccessible “high-tech” design. Minimum 16px body text for primary reading, clear labels, strong contrast, 44px minimum touch targets, keyboard support, visible focus states, and reduced-motion support.

No arbitrary framework rewrite. Use the existing stack when it is viable. If a foundational replacement is required, record the decision and migration path before changing it.

Continue autonomously. Missing external credentials must not stop the rebuild. Implement adapter interfaces, mocked sandbox integrations, configuration screens, and test fixtures. Stop only before an irreversible production action or when a required external permission cannot be safely assumed.

3. VERIFIED CURRENT CONDITIONS

Use these as starting evidence, then independently verify them in the repository and running environments.

The current navigation contains more than 20 destinations, several of which represent the same lifecycle data with different filters.

Applications, Headhunter, Interview Recovery, Licensed Inbox, Unlicensed Queue, License Push, and Onboarding Ladder overlap and must become one Recruiting workspace.

CRM, Reactivation, Producer Trends, and Agent Duplicates overlap and must become one Team workspace plus an admin data-quality surface.

Production, Leaderboard, Book of Business, Business Analytics, and parts of Command Center currently repeat or contradict production calculations.

Announcements and Content Command overlap and must become one Community workspace.

APEX Course and Training Hub duplicate the Skool Classroom and must be removed from the product navigation.

The live APEX site returned 502 Bad Gateway with [Errno 111] Connection refused on both /course-catalog and / on August 10, 2026. Treat uptime, health checks, deployment validation, and rollback as part of this rebuild.

The current Business Analytics screenshot shows an invalid carrier “share” over 100% because an aggregate “Combined” row appears to be treated like an individual carrier. Eliminate that modeling error.

Current pages mix MTD, last 30 days, lifetime, estimated, projected, and source-system numbers without enough distinction. Every time window and formula must be explicit.

The current platform displays departed/inactive names in operational areas. Replace static person lists with active roster queries and archive departed users without erasing history.

3A. REDESIGN DEAL POSTING — CONFIRMED PRODUCTION DEFECT REMEDIATION

The Redesign Deal Posting work confirmed the live URL returned `502 Bad Gateway — connection refused`, including after reload. Do not treat this as a screenshot-only observation or a cosmetic issue. Determine the real failure chain across build output, start command, runtime port binding, host binding, environment variables, database initialization, reverse proxy/ingress, and deployment health configuration.

Required behavior:

Add a lightweight unauthenticated `/healthz` liveness endpoint that proves the application process is running and reports no secrets.

Add a `/readiness` endpoint that proves the application can serve traffic and reach required first-party dependencies such as the database and required migrations. Do not make optional third-party vendor availability a restart trigger; expose Skool, Discord, SureLC, spreadsheet sync, storage, queue, and outbox health separately in Admin > System Health.

Bind the service to the deployment platform’s assigned port and an externally reachable host. Validate the actual production start command and built artifact rather than assuming local Vite behavior matches production.

Expose build version, commit identifier, environment name, migration version, database status, outbox lag, oldest pending event age, and last successful worker heartbeat in the operator health view. Never include secrets or PII.

Add external uptime monitoring for the public route and liveness endpoint, plus alert routing and a runbook. The production owner must learn about a 502 before a user does.

Gate traffic promotion on readiness and a post-deploy smoke test. Implement atomic rollback to the last known-good release when startup, readiness, migration compatibility, or smoke checks fail. Document rollback triggers and rehearse the rollback in staging.

Every data surface must keep the page usable during failure and render explicit loading, empty, permission-denied, stale, offline, and recoverable error states. Messages must say what failed, what remains safely saved, and what the operator or user can do next.

Record the reproduced root cause, the fix, evidence from staging, and the production verification procedure in `docs/operations-runbook.md`. Do not declare this defect resolved from a successful local build alone.

4. FINAL INFORMATION ARCHITECTURE — EXACTLY TEN DESTINATIONS

The persistent left navigation must contain no more than these ten destinations. Do not recreate the current clutter inside large flyout trees. Use a small number of page-level tabs and saved views.

#

Destination

Purpose

Consolidates

1

Command Center

Executive and role-based next actions

Current Command Center summaries only

2

Recruiting

Applicants, sourcing, interviews, licensing, and onboarding

Applications, Headhunter, Interview Recovery, Licensed Inbox, Unlicensed Queue, License Push, Onboarding Ladder

3

Call Center

One focused calling workflow for recruiting leads

Current Call Center and call actions scattered across lists

4

Team

Canonical roster, coaching, attendance, activation, reactivation, offboarding

CRM, Reactivation, Producer Trends

5

Contracting

SureLC, carrier contracts, transfers, agent numbers, appointment status, links

Contracts & Links Hub plus contracting portions of onboarding

6

Production

Add Deal, deal review, production ledger, Book of Business, leaderboard

Production, Leaderboard, Book of Business

7

Analytics

Agency, manager, carrier, product, funnel, retention, and data-quality analytics

Business Analytics and detailed Command Center analytics

8

Community

Announcements, wins/deals, content queue, Skool/Discord delivery status

Announcements + News Feed, Content Command

9

Resources

Compact directory to Skool Classroom, scripts, calendar, tools, support, and approved external systems

Training Hub quick links and resource library only

10

Admin

Users, roles, integrations, imports, archives, duplicates, metric registry, audit logs, system health

Import XCEL, Agent Duplicates, old managers/applicants, platform settings

Persistent actions

Directly beneath the ten navigation destinations, place two highly visible actions:

+ Add Agent

+ Add Deal

On mobile, expose the same actions through a single labeled action button. Never hide them behind an unlabeled icon.

Route disposition

Remove APEX Course and Training Hub as native course experiences.

Redirect old course/training URLs to Resources > Skool Classroom with a concise migration notice.

Move Import XCEL to Admin > Imports; it must not remain a main navigation destination.

Move Agent Duplicates to Admin > Data Quality.

Move old managers, old licensed recruits, old applicants, and inactive staff to Admin > Archive.

Keep all historical URLs redirecting safely to their new destination so bookmarks do not break.

5. ROLE-BASED EXPERIENCE

Implement server-enforced RBAC. Hiding a control in the UI is not authorization.

Roles

agent

manager

recruiter

contracting_assistant

admin

owner

Access principles

Agents see their own onboarding, contracts, production, resources, and community activity.

Managers see their downline only, including applicants assigned to them, onboarding, production, and coaching risks.

Recruiters manage applications, interviews, licensing follow-up, and onboarding handoff but cannot edit compensation.

Contracting assistants manage onboarding and carrier-contract workflows. They can use the protected compensation spreadsheet when explicitly granted spreadsheet access, but the web application never exposes a compensation-edit endpoint.

Admins manage users, integrations, imports, duplicate review, metric definitions, and audit logs.

Owners see the full agency and can approve configuration, but even the owner edits compensation through the spreadsheet source-of-truth—not the website.

Every privileged mutation writes actor_id, role, timestamp, source, reason, prior value, new value, request ID, and correlation ID to the audit log.

6. DESIGN SYSTEM AND INTERACTION STANDARD

Retain the APEX identity—black, deep navy, restrained gold, cyan for informational states, red only for urgent risk—but rebuild the visual system.

Visual rules

Use a clean near-black canvas and navy surfaces. Remove the heavy repeating grid or reduce it to an almost invisible texture that never competes with content.

Use gold for primary actions, selected states, and one high-value number—not every border and label.

Use red only for critical, destructive, failed, or overdue states.

Use cyan/blue for neutral information and integration states.

Page headers must be compact: approximately 72–96px desktop and 64–80px mobile. Current oversized title panels waste the first screen.

A page may show no more than six primary KPIs above the fold.

Default cards contain one decision, one key number, and one action.

Replace giant feed rows with compact 56–72px rows and expandable detail drawers.

A pinned owner/manager announcement defaults to a compact banner with title, severity, author, date, and two-line preview. Full text opens on click.

Use semantic labels beside icons. Do not use mystery icons.

Provide skeleton, empty, error, permission-denied, stale-data, and offline states for every data surface.

Use pagination or virtualization for long lists. Never render a 700- or 1,000-row DOM by default.

Persist user filters and saved views.

All tables need sticky headers, column controls, keyboard navigation, an accessible mobile card view, and export based on the same server query.

Accessibility and older-user usability

Primary body text: 16px minimum.

Secondary metadata: 14px minimum.

Touch/click targets: 44×44px minimum.

Meet WCAG 2.2 AA contrast.

Respect prefers-reduced-motion.

Motion duration: 120–200ms for ordinary state changes. No ornamental looping motion.

Every destructive action requires a clearly worded confirmation naming the exact record affected.

Every form keeps labels visible; never rely on placeholders as labels.

Inline help must explain insurance-specific fields without forcing the user into another page.

Responsive behavior

Validate at minimum:

360×800

390×844

768×1024

1366×768

1440×900

1920×1080

The sidebar collapses cleanly, actions remain reachable, tables become cards or horizontally scroll with locked identity columns, and modals become full-height mobile sheets.

7. CANONICAL DATA MODEL

Inspect the current schema, then implement an additive migration toward these entities. Preserve existing IDs in external-ID mapping tables.

Identity and organization

people: canonical human identity; UUID, legal/preferred name, email(s), phone(s), active state, archive reason, timestamps.

users: authentication identity linked to people.

team_memberships: agent/manager/recruiter/assistant relationships, effective dates, status, manager/upline, role.

external_identities: provider, external ID, person ID, status, last synced, raw source hash. Providers include APEX legacy, AgentLink/InsuraCloud, Skool, Discord, SureLC, spreadsheet.

Treat PA number as a required, uniqueness-checked operational external identity for five-field quick-add. Preserve the submitted identifier and its source; do not reuse it as an authentication secret or infer compensation/licensing state from it.

manager_hierarchy: effective-dated manager/downline relationships.

Recruiting and onboarding

applications

application_stage_history

interviews

communications

call_sessions

call_attempts

licenses

onboarding_cases

onboarding_tasks

training_attendance

An applicant occupies exactly one current pipeline stage. Stage changes append history; never overwrite history.

Contracting

carriers

carrier_products

carrier_contracts

carrier_agent_numbers

transfer_requests

surelc_requests

appointment_events

One carrier request equals one durable row for one agent, one carrier, and one request type. Transfers capture existing agent number, current/previous upline or GA, release requirement, submitted date, external request ID, status, effective date, and owner.

Production

deals

deal_status_history

deal_attachments

policies

production_ledger

chargebacks

lead_spend

The approved deal is the authoritative production event. Dashboards never independently aggregate legacy Book of Business rows and new deal rows without an explicit migration mapping.

Compensation

comp_rate_imports

comp_rates

comp_change_audit

Comp rates are effective-dated by agent, carrier, product/contract when applicable. The website has no comp-edit mutation. The only mutation path is the protected workbook/Google Sheet sync service. Never overwrite historical rates.

Community and integrations

community_memberships

integration_accounts

integration_capabilities

integration_events

outbox_events

delivery_attempts

dead_letter_events

audit_logs

metric_definitions

Identity resolution

Match in this priority order:

Existing canonical ID/external ID.

Exact PA number when validated.

Exact NPN when validated.

Normalized verified email.

Normalized phone plus corroborating name/state.

Manual review.

Never automatically merge based only on name. Duplicate merges must preview affected applications, production, contracts, team relationships, and external identities; run transactionally; preserve aliases; and support reversal.

8. ADD AGENT — COMPLETE WORKFLOW

The global + Add Agent action is intentionally a fast quick-add—not a five-step intake wizard. The dialog must contain exactly these five visible fields and no others:

First name

Last name

Email address

Phone number

PA number

Do not ask for a password, manager, license information, state, NPN, carrier details, compensation, or system-invite choices in this initial dialog. Keep all five labels visible. Provide inline validation, normalize email and phone safely, trim the PA number without silently changing its meaning, prevent malformed/control-character input, and give field-specific errors. The server repeats all validation.

Before create, check for duplicate email, normalized phone, PA number, and existing canonical/external IDs. A possible match opens a review path; never auto-merge on name alone. Submission is staff-authorized, idempotent, audited, and returns one clear saved/error state.

The quick-add operation creates one durable provisional toolkit-agent record and one default journey record. It must not insert a fake application or trigger applicant notifications, invites, welcome messages, payment activity, or other outbound automation. The record appears immediately in Licensed Inbox and the APEX Journey toolkit with an “Added agent” source badge and working call, voicemail, text-sent, hired/passed, contact-log, and journey controls. Use the dedicated `apex_toolkit_agents`, journey, journey-step, and toolkit contact-log design already present in the pending additive migration unless repository inspection finds a safer equivalent. Link the provisional record to the canonical `people`/`external_identities` model when the full onboarding case is established; preserve the original quick-add audit trail.

Post-create guided onboarding

After saving, show “Open journey” and “Continue onboarding” actions. The larger operational profile belongs on the agent journey/profile—not in the five-field dialog. Capture and manage these items progressively without asking for information twice:

Preferred name, resident state, manager/upline, recruiting source/referrer, track, and target start date.

License status: Unlicensed, Course In Progress, Test Scheduled, Exam Passed, Waiting on License, Licensed, Inactive; NPN; resident license; expiration; and licensed states.

Transfer need and, for every already-held carrier, carrier, existing agent number, current/previous upline or GA, release requirement, requested hierarchy, and notes.

APEX access, Skool, Discord, SureLC/AgentLink, approved group/chat access, and manager assignment. Each integration displays Not Sent, Queued, Sent, Joined/Completed, Failed, or Manual Action Required with timestamp, last error, and retry.

Owned, due-dated journey milestones for Welcome; Course Active; Exam Ready; Exam Scheduled; Exam Passed; Licensed; AgentLink; Signatures; Contracting; Community; Training; Launch Ready; Producing; First Appointment; First Application; First Sale; First Consistent Month; and First Leadership Responsibility. Licensed agents begin at the licensed activation path; unlicensed agents begin at the licensing path. Include the 30/60/90-day plan and the career-growth qualification calculator already implemented from the APEX toolkit.

Training is stored in `America/Chicago` and displayed as “9:30 AM Central” so daylight-saving changes remain correct.

Only an explicit, permissioned onboarding execution step may create/link the canonical person, team membership, manager relationship, onboarding tasks, carrier rows, or integration outbox events. Before execution, show the exact records and outbound actions that will be created. Use one correlation ID and one audit trail; retries with the same idempotency key must not create duplicate users, invites, tasks, or carrier requests.

9. ADD DEAL — COMPLETE WORKFLOW

The + Add Deal action must be native to APEX and inspired by the AgentLink Post a Deal reference, but improved for accuracy, privacy, and production accounting.

Deal-posting interaction design

Use one responsive dialog or full-height mobile sheet with a visible progress/save state and logically grouped sections: Client, Policy & Product, Premium & Production, Supporting Evidence, and Review. Preserve a server-side draft after every completed section and recover it after refresh or temporary network loss. Never block saving the deal because Discord, Skool, analytics, or another downstream destination is unavailable.

Show the writing agent and derived manager/upline near the top. Agents cannot override them; authorized managers/admins receive an explicit audited override control. Carrier selection filters compatible products. Premium mode immediately updates a read-only calculation explanation, but the user must confirm carrier-specific target/excess/single-pay rules when ordinary annualization does not apply.

The review screen shows the exact persisted deal fields, official-production eligibility, any manager-review requirement, attachment status, privacy-safe community preview, and destinations that will be queued. Final submit uses a client-generated idempotency key, one database transaction for deal/status/audit/outbox records, and a durable receipt with deal ID, saved status, downstream delivery state, and “View deal” action.

The Deal Review queue must support Draft, Submitted, Needs Review, Approved, Declined, Withdrawn, Issued, In Force, Lapsed, and Chargeback transitions with server authorization, reason capture, status history, optimistic-concurrency protection, and reversal/correction procedures. No status-changing control is complete until its persistence, audit, ledger effect, error state, retry behavior, and automated tests pass.

Required fields

Client

New client or existing client

First name

Last name

Phone

Date of birth

Store required PII encrypted and restrict it to authorized operational roles. Do not include it in community posts, logs, analytics, or URLs.

Policy/deal

Writing agent, automatically populated and overrideable only by authorized managers/admins

Manager/upline, automatically derived from effective-dated hierarchy

Carrier

Product

Application or policy number

Application date

Effective date when known

Premium mode: Annual, Semiannual, Quarterly, Monthly, Single Pay, Other

Modal premium

Annualized paid premium

Annualized commissionable premium/ALP when carrier/product rules differ

Face amount/death benefit

Lead source

Beneficiaries, optional and encrypted

Notes

Deal/policy image or supporting document upload

Calculation rules

For ordinary recurring modes, annualized_paid_premium = modal_premium × payments_per_year where Annual=1, Semiannual=2, Quarterly=4, Monthly=12.

Do not infer ALP/commissionable premium from modal premium when the product has target premium, excess premium, single-pay, 1035 exchange, or another carrier-specific rule. Require the carrier value or flag for manager verification.

Store calculation basis, formula version, and whether the number is agent-entered, carrier-provided, or system-calculated.

Money uses decimal/fixed precision, never floating-point binary math.

Statuses

Draft

Submitted

Needs Review

Approved

Declined

Withdrawn

Issued

In Force

Lapsed

Chargeback

Only qualifying approved/issued/in-force ledger entries feed official production metrics. Submitted production may be shown separately and labeled.

Validation

Required fields and data types

Carrier/product compatibility

Duplicate application/policy detection

Valid dates and premium mode

Attachment type/size scanning

Permission to write for the selected agent

Confirmation before final submit

Transaction and notifications

On successful submission:

Commit deal and status history.

Append or queue production-ledger entry according to approval rules.

Enqueue deal.created/deal.approved in the transactional outbox.

Deliver a privacy-safe Discord win post through a server-side webhook.

Deliver a Skool win post only through an explicitly supported and configured write capability.

Record each channel delivery independently with message ID, attempts, status, and error.

The user-facing submission succeeds when the deal is safely saved. A Discord or Skool outage must not lose the deal or cause a duplicate on retry.

Privacy-safe win post template

Include only:

Agent display name

Carrier

Product category

Face amount when approved for public/team display

Annualized premium/ALP when approved for team display

Optional agent-supplied win caption

APEX branding

Internal deep link visible only to authorized users

Never include client identity, phone, date of birth, policy/application number, beneficiary information, or uploaded documents.

10. PRODUCTION LEDGER AND METRIC REGISTRY

Create a database-backed metric registry and surface metric definitions from an info icon beside every KPI. Each definition stores:

Metric ID and display name

Business meaning

Source table/view

Amount field

Date field

Timezone

Included statuses

Excluded statuses

Filters and hierarchy rules

Formula version

Owner

Last validated timestamp

Required canonical metrics

Metric

Definition

Submitted premium MTD

Sum qualifying submitted deal premium by submitted_at in America/Chicago

Approved/placed ALP MTD

Sum approved qualifying production-ledger ALP by ledger effective date in America/Chicago

Deals MTD

Count distinct qualifying deals, never raw status-history rows

Active producers

Distinct agents with at least one qualifying production-ledger entry in the selected period

Average per producer

Qualifying ALP divided by active producers; return zero/null safely when denominator is zero

Prior-month comparison

Compare identical defined metrics; label complete prior month versus partial current month

Pace

Explicit projected month-end result based on elapsed business/calendar days; label as projection and show formula

Estimated income

Sum qualifying ALP × effective comp rate; label estimate, not paid commission

Lead spend

Actual recorded lead expense in selected period

Estimated after leads

Estimated income minus lead spend; label estimate

Carrier share

Carrier qualifying ALP divided by total qualifying ALP; individual shares sum to approximately 100%

Metric integrity rules

Never display an aggregate “Combined” value as a carrier row.

MTD means start of current calendar month through now in America/Chicago.

Last 30 days means a rolling 30-day interval and must never be labeled MTD.

Lifetime, MTD, week, day, and custom windows use the same query layer and status rules.

Display data freshness and source on every analytics surface.

Reconcile Command Center, Production, Book of Business, Leaderboard, and Analytics to the same ledger.

Create automated reconciliation tests with seeded expected totals.

Never let a percentage exceed 100% unless it is explicitly labeled an index or growth rate.

11. COMMAND CENTER — REBUILD, DO NOT STACK EVERY REPORT

The Command Center is an executive action surface, not a page containing every chart in the system.

Above the fold

Compact greeting, role, scope, and data freshness.

Up to six KPIs selected by role.

“Next actions” queue with the five highest-impact items.

One concise production trend.

One concise recruiting/onboarding funnel.

Below the fold

Manager risk/activation summary

Integration/system-health exceptions

Compact pinned announcement

Links into full workspaces

Do not place full leaderboards, 100-row lists, carrier tables, duplicate lists, or complete applicant feeds on the Command Center. Use “View all” deep links.

Every card must answer one of these questions:

What needs action now?

What changed?

Are we on pace?

Where is the bottleneck?

Who owns the next move?

Delete any card that does not answer one of them.

12. RECRUITING WORKSPACE

Use four tabs maximum:

Applicants — list/kanban/pipeline using one query and one current stage.

Interviews — scheduled, missed, overdue, completed, and outcome-required.

Licensing — unlicensed, course, test, passed, waiting, licensed.

Onboarding — system access, contracting, training, launch readiness.

Headhunter becomes a saved Applicants view for sourced prospects. Licensed Inbox, Unlicensed Queue, License Push, Interview Recovery, and Onboarding Ladder become saved views and queues, not separate navigation routes.

Application intake

Normalize email and phone.

Run duplicate detection before create.

Record source, referrer, campaign, manager, owner, and consent metadata.

Separate source data from inferred scores.

Use one stage enum and append stage history.

Keep rejected/terminated records archived and excluded from active counts by default.

Provide explicit “Restore” or “Reopen” actions.

Queue design

Each queue row shows:

Person

Stage

License state

Manager/owner

Last meaningful contact

Days in stage

Next action

Due date

One primary action

Move secondary actions into a labeled menu. Remove rows of unlabeled icons.

13. CALL CENTER

Rebuild the Call Center as a focused, stateful workflow.

Before a session

Lead source

Referrer

License status/progress

Lead status

Date range

Owner/manager

State

Sort order

Queue count

Oldest/newest record age

Licensed/unlicensed mix

Estimated session time with an explicit formula using configurable average handle time

During a session

One person at a time

Click-to-call through an adapter for the configured provider

Visible call state

Application/profile context

Structured notes

Required disposition

Follow-up date/time

Next lead

Keyboard shortcuts with visible help

Autosave and recovery after refresh/network loss

Dispositions

Hired

Contracted

Not a Fit

No Pickup

Contacted

Reschedule

Bad Number

Follow-Up

Do Not Contact

Every disposition writes a call attempt and updates the next-action engine. Respect applicable consent, do-not-contact, recording, and telecommunications rules. Do not ship automatic dialing or recording without verified compliance configuration.

Test that the app can call the correctly selected person, write notes, save the disposition, schedule follow-up, and move to the next lead without losing state.

14. TEAM WORKSPACE

Use these tabs:

Roster

Activation

Performance

Recovery

Offboarding

Roster

Canonical person only

Manager/upline

Role/track

License state

Contracting state

Skool/Discord/SureLC state

Production status

Last activity

Next action

Activation and recovery

Never activated: licensed/contracted with no qualifying first deal after configurable threshold

Production drop: compare consistent weekly ALP windows

Dormant producer: prior qualifying production and no qualifying production for configurable threshold

Reactivation potential: historical run rate labeled historical, never forecast

Every risk label must show the rule that generated it. Managers receive a prioritized list with one next action. Do not create separate pages for every risk type.

Offboarding

Offboarding deactivates access and future assignments while preserving history. It may:

Mark team membership inactive with effective date/reason

Remove or revoke APEX access

Queue Skool removal when a supported action is available, otherwise create a manual action

Remove Discord roles/access through the bot when configured

Stop future notifications

Reassign open applications/tasks/contracts

Preserve deals, policies, production, contracts, and audit logs

Never hard-delete a former agent because they left the team.

15. CONTRACTING AND SURELC

The provided SureLC link is the Legacy Shield Financial / One Life America agency entry point. Integrate SureLC only through authorized, documented API/webhook capabilities or the verified login deep link.

SuranceBay documents REST API 2.0 for authorized agencies and publishes an agency OpenAPI surface including producers, contracting requests, appointment requests, training, new-business workflows, lookups, and webhooks. Generate the client from the current OpenAPI specification rather than inventing endpoints.

Contracting workspace tabs

Overview

Agent Setup

Carrier Requests

Transfers

Links & Integrations

Required contracting workflow

Create/link producer in SureLC when authorized.

Track SureLC external producer/request IDs.

Create one carrier request row per carrier.

Capture carrier agent number for already-appointed agents.

Capture previous/current upline or GA and release requirement for transfers.

Pull or receive request/appointment status through the supported API/webhook.

Map external statuses to internal statuses without discarding the raw status.

Display last sync, last webhook, status source, and error.

Provide “Open in SureLC” for manual completion without exposing credentials.

Never scrape the SureLC login UI.

Reliability

Verify webhook authenticity according to current SuranceBay documentation.

Use idempotency on webhook event IDs and payload hashes.

Rate limit, retry exponential backoff, and dead-letter failures.

Provide daily reconciliation between APEX and SureLC.

Alert when an agent is launch-ready except for a blocked carrier request.

16. SKOOL — ONE COMMUNITY AND ONE CLASSROOM

Skool becomes the single training/community destination. Remove native APEX course duplication.

Capability reality

Official Skool documentation supports Pro-plan automation for member information and actions such as inviting members and unlocking course access. Do not assume an official general-purpose API exists for arbitrary feed posts, removals, DMs, comments, or member reconciliation. Implement a capability registry:

invite_member

unlock_course

receive_new_member

receive_membership_answers

receive_member_cancelled_or_removed

create_post

remove_member

At configuration time, test each capability in a sandbox or safe test group. The UI must show Supported, Not Configured, or Unsupported.

If create_post is unsupported, do not silently claim success and do not scrape the Skool UI. Create a Manual Action Required delivery containing privacy-safe precomposed copy and an “Open Skool” button. Keep the connector interface so a supported action can be enabled later without changing deal logic.

If member-removal events are unavailable, use only an owner-approved supported reconciliation method, such as a Zapier event, official export/import, or documented connector. Do not delete the APEX agent merely because Skool state is missing.

Skool group structure — six categories maximum

Start Here

Announcements

Wins & Deals

Questions & Support

Sales & Case Design

Training Replays

Pinned content

Keep one compact Start Here post with:

What APEX is

How to use the community

Daily training at 9:30 AM Central in Discord

Course link

Contracting/SureLC link

Support path

Rules link

APEX Classroom course

Create these courses/modules in Skool. Use Open, Private, Time Unlock, Level Unlock, or tier access only when the rule has a business purpose.

Start Here — First 30 Minutes

Welcome and expectations

Join Discord

Daily 9:30 AM Central training

Systems checklist

Support and escalation

Licensing Path

Licensed-agent skip path

Unlicensed course/exam path

Exam scheduling, pass, and license verification

Contracting & Transfers

SureLC/AgentLink profile

New carrier request

Transfer process

Existing agent numbers by carrier

Systems Setup

APEX

Discord

Skool

Dialer/call workflow

Carrier and case-design tools

Product Fundamentals

Term

Whole Life/final expense

IUL

Mortgage protection

Carrier suitability and escalation

Sales System

Call structure

Needs analysis

Presentation

Recommendation

Close and confirmation

Objections & Roleplay

Common objections

Call reviews

Roleplay standard

Case Design, Underwriting & Placement

Field underwriting

Case design handoff

Application quality

Placement follow-up

Compliance & Recordkeeping

Approved claims and representations

Consent and communication records

Client data handling

Escalation

Launch Week

First call block

Daily activity standard

First deal posting

Manager review

Manager Track — private

Agency Owner Track — private

Every lesson uses the same structure: outcome, concise video, written checklist, resource, completion action/quiz, and next step. Eliminate duplicate recordings and vague titles such as “Recording 1.” Keep the best current version and archive superseded versions.

Skool calendar

Create a recurring event at 9:30 AM Central with the Discord training location. Store timezone as America/Chicago. Do not duplicate the event across multiple conflicting calendars.

17. DISCORD

Use a server-side Discord integration.

Incoming webhook is acceptable for one-way deal/win posts.

Use a bot with least-privilege OAuth scopes when role assignment, membership events, commands, or interactive actions are required.

Keep webhook URLs and bot tokens server-side.

Use separate test and production channels.

Store Discord user ID and guild membership separately from APEX person identity.

Deal post delivery uses the outbox and an idempotency key based on deal ID + event type + destination.

Role/access changes are audited.

Training reminders may be sent at 9:15 AM Central with a link to the 9:30 session.

Build privacy-safe rich embeds with agent, carrier, product category, approved production fields, and optional caption. Do not include client PII.

18. COMMUNITY WORKSPACE

Merge Announcements, News Feed, deal wins, and Content Command.

Tabs

Announcements

Wins & Deals

Content Queue

Delivery Status

Announcement behavior

Compact default rows

Pin/unpin

Audience: all, agents, managers, specific team

Priority: normal, important, critical

Start/end publishing window

Delivery destinations

Read acknowledgement only for genuinely critical notices

Archive expired notices

Content queue

Draft, Review, Approved, Scheduled, Published, Failed, Archived

One source post with per-channel deliveries

Preview each channel

Retry only failed destinations

Never duplicate a successfully delivered post on retry

Remove departed authors from active filter chips while preserving their historical authored posts.

19. ANALYTICS

Analytics must answer a small number of operational questions and must reconcile to the metric registry.

Required views

Production: submitted versus approved/placed, by agent/manager/carrier/product

Recruiting: applicant source, contact rate, interview rate, acceptance, licensing, activation

Onboarding: time in stage, blocked tasks, launch time, first-sale time

Retention: active, inactive, dormant, offboarded, reactivated

Contracting: requests, transfers, aging, carrier turnaround, blocked launch cases

Data quality: duplicates, orphan IDs, stale integrations, missing owners, metric reconciliation

Rules

Filters show active time range and timezone.

Each chart has a defined numerator and denominator.

Use no more than one primary visual per question.

Tables expose source rows or a traceable drill-down.

AI-generated observations may summarize verified data but never invent causes or forecast without a labeled model.

Replace generic “AI insights” cards that repeat identical numbers for several people with rules that name the exact evidence and next action.

20. BACKEND CONTRACTING AND COMP WORKBOOK

Use the supplied APEX_Backend_Contracting_Comp_Control.xlsx as the starting template. Import it into a private Google Sheet if Google Sheets is the production collaboration surface.

Tabs

Dashboard

Agent Onboarding

Carrier Contracts

Comp Control

Setup Lists

README

Verified workbook contract — preserve and test these exact operating surfaces

`Dashboard` uses `A1:L22` and contains 11 live formulas for Total Agents, Launch Ready, Transfers, Open Contracts, Pending Comp, Failed Syncs, onboarding/contract/comp QC exceptions, duplicate Agent IDs, and blocked agents. It also documents the eight-step Add Agent → Invite Systems → Contract → Train → Launch → Post Deal → Audit → Offboard workflow. Dashboard numbers remain formula-driven from the operating sheets and must reconcile after spreadsheet sync.

`Agent Onboarding` uses `A1:Y205`, with row 5 headers: Agent ID, First Name, Last Name, Email, Phone, Manager, Track, License Status, NPN, Resident State, Licensed States, Transfer Needed?, Carrier IDs Captured?, Skool Status, Discord Status, SureLC Status, Contracting Status, Training Status, Launch Status, Owner, Next Action, Due Date, Last Updated, QC Status, Notes. `X6:X205` contains 200 QC formulas detecting duplicate IDs and missing required identity/manager/owner/contact fields. Eleven list-validation ranges connect Manager, Track, License Status, Yes/No, integration status, contract status, launch status, and assistant-owner fields to `Setup Lists`.

`Carrier Contracts` uses `A1:T205`, with row 5 headers: Contract ID, Agent ID, Agent Name, Carrier, Product Line, Request Type, Existing Agent #, Previous Upline / GA, Release Required?, Submitted Date, SureLC Request ID, Status, Appointment #, Effective Date, Assistant Owner, Next Action, Due Date, Last Updated, QC Status, Notes. One row represents one durable agent × carrier × request. `C6:C205` contains the bounded `INDEX/MATCH` agent-name lookup into `Agent Onboarding`; `S6:S205` detects duplicate IDs, missing required fields, and orphan agents. Request Type, Release Required, Status, and Assistant Owner use `Setup Lists` validations.

`Comp Control` uses `A1:R205`, with row 5 headers: Change ID, Agent ID, Agent Name, Carrier, Product Line, Comp %, Effective Date, End Date, Approval Status, Approved By, Change Reason, Updated By, Updated At, Sync Status, Sync Error, Source Version, QC Status, Current?. `C6:C205` contains the bounded Agent Name lookup. `Q6:Q205` detects duplicate Change IDs, missing required fields, orphan agents, and comp outside the configured maximum. `R6:R205` derives CURRENT versus INACTIVE from approval and effective dates. Approval and sync states are validated; Comp % accepts decimal values from zero through the configured maximum. Preserve effective-dated history—never update an old row in place merely to change the rate.

The canonical lookup pattern is bounded to rows 6–205 and uses quoted cross-sheet references, for example:

`=IF(B6="","",IFERROR(INDEX('Agent Onboarding'!$B$6:$B$205,MATCH(B6,'Agent Onboarding'!$A$6:$A$205,0))&" "&INDEX('Agent Onboarding'!$C$6:$C$205,MATCH(B6,'Agent Onboarding'!$A$6:$A$205,0)),"AGENT NOT FOUND"))`

`Setup Lists` uses `A1:J35` for Managers, Assistant Owners, Tracks, License Status, Yes / No, Integration Status, Contract Status, Request Type, Approval Status, Launch Status, and configuration. `B34` is the maximum allowed comp, currently `2.00` displayed as 200%; `B35` is `America/Chicago`. Remove inactive staff from selectable lists without invalidating historical records.

`README` uses `A1:H29` and is the human operating contract: compensation is edited only here; comp changes are effective-dated; sensitive contracting data remains in SureLC/encrypted application storage; one permanent Agent ID is used per person; former agents are archived; schedules use `America/Chicago`; selectable people stay active-only; and all integration writes remain idempotent, audited, retryable, and visible.

The workbook currently has formula coverage, validations, conditional QC formatting, six visually verified populated sheets, and no formula-error matches. It does not currently contain active worksheet-protection records. Finish that control before production use: unlock only intended gold input cells; lock blue-gray formula/sync cells; protect formula ranges, Setup Lists, and workbook structure; keep filters/sorting usable for permitted editors; and verify protection after Excel and Google Sheets round-trips. Worksheet passwords are an accidental-edit control, not an authorization boundary—real security remains private file sharing, least privilege, signed sync, audit, and server-side validation.

Preserve the visual contract: gold = assistant/admin input; blue-gray = formula/system output; red = blocked/failed; green = complete/healthy. Keep formulas, validation ranges, conditional formatting, table/filter behavior, number/date/percent types, and readable column widths intact when extending rows. Add tests or reconciliation scripts that prove the workbook and database agree without silently corrupting production.

Security and editing

Share only with the owner and designated contracting assistants.

Protect formula and system-output columns.

Keep Setup Lists restricted to admins/owner where possible.

The website reads comp and shows it read-only.

The website must have no user-accessible comp update endpoint.

The sync service accepts only authorized spreadsheet-originated changes.

Do not store SSN, date of birth, banking, medical data, E&O documents, passwords, or API keys in the workbook.

Comp synchronization

For each valid, approved comp row:

Validate durable Change ID.

Match canonical Agent ID.

Validate carrier/product.

Validate decimal percentage against configured maximum.

Require effective date.

Require approval state and update actor.

Never overwrite prior rate history.

Upsert by Change ID idempotently.

Close/supersede prior effective interval only when business rules require it.

Return sync state/version/error to the sheet.

Write a full audit event.

Support an authenticated push webhook from Apps Script or a scheduled official Google Sheets API pull. Use HMAC/signature, service account/least privilege, replay protection, versioning, and reconciliation. Never use a public editable sheet or expose spreadsheet credentials in the browser.

Contracting assistant workflow

The assistant works from Agent Onboarding and Carrier Contracts:

Confirm active manager/owner

Confirm license/NPN

Confirm transfer need

Capture every existing carrier agent number

Capture current/previous upline or GA

Track SureLC request ID and status

Record next action, due date, and last update

Resolve QC exceptions before marking complete

21. AUTOMATION EVENT MAP

Implement these as event-driven workflows with transactional outbox and idempotent consumers.

Event

Required result

application.created

Normalize, dedupe, assign owner, create first action

application.accepted

Create/link canonical person and onboarding case

toolkit_agent.created

Create the default journey and audit record only; do not send invites or other outbound actions from five-field quick-add

agent.onboarding_execution_confirmed

After explicit permissioned review, queue APEX, Skool, Discord, and SureLC setup using one correlation ID

skool.member.joined

Match by approved identity keys and update community membership

skool.member.removed

Mark community state removed; start policy-driven offboarding review, never hard-delete

discord.member.joined

Link Discord identity and validate required role

surelc.status.received

Store raw event, map internal status, update contracting task

onboarding.task.overdue

Notify owner/manager and escalate by SLA

onboarding.launch_ready

Generate launch checklist and first-call plan

deal.submitted

Validate, create review task, preserve deal

deal.approved

Append production ledger and deliver privacy-safe win notifications

comp.sheet.changed

Validate, effective-date, sync, audit, return status

agent.offboarded

Revoke future access/assignments and queue supported external removals

Scheduled jobs

Integration reconciliation every day

Overdue-task scan at least hourly

9:15 AM Central Discord training reminder on scheduled training days

Metric materialization/refresh with freshness timestamps

Dead-letter alerting

Database backup verification

External API health checks

22. TECHNICAL ARCHITECTURE

First use the repository’s current stack. If greenfield or the existing stack is unrecoverable, use a conventional typed web architecture with:

TypeScript frontend/backend

PostgreSQL as primary relational database

Server-side authentication and RBAC

Background job/queue worker

Transactional outbox

Encrypted object storage for attachments

Schema-validated API contracts

Structured logs, traces, error monitoring, and health endpoints

Unit, integration, contract, and end-to-end tests

Infrastructure/environment separation for local, staging, and production

Code boundaries

domain: pure business rules and metric definitions

application: commands, queries, permissions, workflow orchestration

infrastructure: database, queue, storage, external connectors

ui: accessible components and routes

integrations: Skool, Discord, SureLC, spreadsheet, dialer adapters

Do not place external API logic directly in React components or route handlers. Do not calculate business metrics in the browser.

Integration adapter contract

Every connector must expose:

Capability discovery

Configuration validation

Sandbox/test action

Idempotent command methods

Webhook verification/parser

Health status

Retry classification

Redacted logging

Operator-facing last error and recovery action

23. RELIABILITY, SECURITY, AND OPERATIONS

Required endpoints and monitoring

Liveness

Readiness

Database connectivity

Queue/outbox lag

Migration status

Integration health

Build/version identifier

The deployment pipeline must fail if readiness checks fail. Implement safe blue/green, canary, or equivalent deploy verification and documented rollback. The current 502 must become a monitored incident, not a user discovery.

Security

Encrypt sensitive PII at rest where appropriate.

Redact PII and secrets from logs.

Rate-limit authentication, public applications, webhook endpoints, file uploads, and calling actions.

Validate MIME type and scan uploads.

Use CSRF protection where applicable.

Use secure cookies/session settings.

Verify webhook signatures and timestamps.

Use least-privilege service accounts.

Audit all exports and privileged reads when feasible.

Add retention/deletion policies appropriate to agency operations and legal obligations; do not invent a retention period without owner/legal approval.

Failure behavior

Preserve form drafts.

Never lose a deal because a notification failed.

Never create duplicate agents because an invite retried.

Never show stale data as live without a warning.

Every error message states what failed, what was saved, and what the user can do next.

24. IMPLEMENTATION SEQUENCE

Phase 0 — Audit and stabilization

Inventory repository and infrastructure.

Reproduce the 502 and identify root cause.

Add backups, health endpoints, error monitoring, and deployment rollback.

Produce route/button/data-source inventory.

Record broken or duplicate calculations.

Phase 1 — Canonical foundation

Add canonical IDs and external identity mappings.

Add effective-dated hierarchy.

Add audit log, integration events, and transactional outbox.

Add metric registry and reconciliation tests.

Build reversible migrations and backfill reports.

Phase 2 — Design system and navigation

Build accessible components and layout.

Replace navigation with the ten destinations.

Add persistent Add Agent/Add Deal actions.

Add redirects from legacy routes.

Implement role-based navigation and authorization.

Phase 3 — Core workflows

Recruiting workspace

Call Center

Five-field Add Agent quick-add and post-create journey

Team workspace

Contracting workspace

Add Deal and production ledger

Command Center

Analytics

Community

Resources/Admin

Phase 4 — Integrations

Discord

SureLC

Skool capability-based connector

Spreadsheet/Google Sheets comp sync

Dialer adapter

Phase 5 — Migration and cleanup

Link/merge duplicates through reviewed migrations.

Archive inactive staff and former agents.

Move course/resources to Skool.

Deactivate legacy routes after redirects and telemetry confirm migration.

Reconcile all production totals.

Phase 6 — Production readiness

Full test matrix

Accessibility audit

Responsive/device audit

Performance profiling

Security review

Backup/restore drill

Staging user-acceptance script

Deployment, smoke test, monitoring, rollback verification

Do not attempt one giant unreviewable rewrite. Complete each phase in deployable slices behind feature flags while preserving current data.

25. TEST AND ACCEPTANCE STANDARD

Every button/control

Create a control inventory containing route, label, permitted roles, preconditions, API call, success result, error result, audit event, and automated test. There must be zero dead buttons and zero unlabeled icon-only actions.

Automated tests

Unit tests for domain rules and formulas

Integration tests for database commands and RBAC

Connector contract tests with mocks/sandboxes

Webhook signature/idempotency tests

End-to-end tests for critical workflows

Migration/backfill reconciliation tests

Accessibility tests

Visual regression tests for major routes

Required end-to-end scenarios

Five-field Add Agent → durable toolkit record and journey created → visible in Licensed Inbox/APEX Journey → no application notification, invite, payment, or outbound event fired.

New licensed applicant → accepted → permissioned onboarding execution confirmed → Skool/Discord/SureLC queued → carrier contracts → launch ready.

New unlicensed applicant → licensing path → pass/license → contracting → launch.

Transfer agent with multiple carriers and different existing agent numbers.

Duplicate application detected and safely linked.

Call session persists notes/disposition/follow-up and advances correctly.

Add Deal validates premium mode, attachment, duplicate policy, approval, and ledger entry.

Discord failure preserves deal and retries once service recovers.

Unsupported Skool post capability creates visible manual action rather than false success.

Approved comp spreadsheet change becomes effective and website remains read-only.

Workbook formula, validation, conditional-formatting, locked-cell, and reconciliation checks pass after Excel/Google Sheets round-trip; an unauthorized or malformed comp row cannot sync.

Offboarded agent loses future access while historical production remains.

Manager cannot see another manager’s downline.

Agent cannot change writing agent, manager, production status, or comp without authorization.

Command Center, Production, Book of Business, Leaderboard, and Analytics reconcile to the same expected totals.

Deployment readiness fails when the application cannot reach required infrastructure, preventing an unnoticed 502 release.

Staging deploy binds the assigned host/port, serves `/healthz` and `/readiness`, passes smoke tests behind the real proxy/ingress, and automatically rolls back a deliberately broken release.

Performance targets

Set measurable budgets after profiling the real stack. At minimum:

Paginate/virtualize long queues.

Avoid loading entire tables to calculate page totals.

Use server-side filters and indexed queries.

Prevent layout shift in major content.

Keep primary interaction latency visibly responsive and instrument slow paths.

Definition of done

A feature is done only when:

It works for every allowed role.

Unauthorized access is denied server-side.

Empty/loading/error/stale states work.

Persistence is verified.

Audit/telemetry exists.

Automated tests pass.

Mobile and desktop pass.

Accessibility passes.

Documentation and rollback exist.

Rendering a page is not completion.

26. REQUIRED DELIVERABLES FROM CLAUDE CODE

Produce and maintain these artifacts inside the repository:

docs/current-state-audit.md

docs/target-architecture.md

docs/information-architecture.md

docs/data-model.md with ERD

docs/metric-registry.md

docs/integration-capabilities.md

docs/skool-course-blueprint.md

docs/security-privacy.md

docs/migration-backfill-plan.md

docs/operations-runbook.md

docs/test-acceptance-matrix.md

.env.example with placeholders only

Database migrations and rollback/backup instructions

Seed data containing only fictional identities

Automated test suite

Staging deployment and verified smoke-test report

Before/after screenshots for major routes

At the start, output a concise audit containing the detected stack, repository risks, current routes, data sources, authentication/RBAC status, failing builds/tests, deployment cause of the 502 if reproducible, and the first deployable slice. Then proceed with implementation. Do not ask the owner to make routine product decisions already defined in this prompt.

27. REFERENCE FILES TO INSPECT

Locate and inspect every file before implementing. They are evidence of the current product, not designs to reproduce blindly.

Exact supplied sources available on this machine:

`/Users/samjames/Downloads/Redesign-Deal-Posting-08-10-2026_08_21_PM.png` — Redesign Deal Posting work and confirmed 502/health/rollback/workbook requirements.

`/Users/samjames/Downloads/APEX_Backend_Contracting_Comp_Control.xlsx` — verified six-sheet backend operating workbook and comp source of truth.

`/Users/samjames/Library/Messages/Attachments/dc/12/777C5ED8-DCB1-4C09-96F6-E1882F829781/APEX_Welcome_Aboard_Career_Growth_Toolkit.pdf` — licensed/unlicensed activation, 30/60/90 plan, milestones, and career-growth thresholds already represented in the pending toolkit implementation.

`/Users/samjames/Library/Messages/Attachments/55/05/0A5841BB-EEDB-4051-8E48-7A323AB1632D/IMG_7292.png` — Licensed Inbox card/action reference.

Current APEX

Command-Center-·-APEX-08-10-2026_07_30_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_30_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_37_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_38_PM.png

Contracts-Links-·-APEX-08-10-2026_07_38_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_38_PM (1).png

Headhunter-—-APEX-Recruiting-08-10-2026_07_39_PM.png

Interview-Recovery-08-10-2026_07_39_PM.png

Producer-Reactivation-08-10-2026_07_39_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_41_PM.png

Business-Analytics-·-APEX-08-10-2026_07_41_PM.png

Announcements-News-Feed-·-APEX-08-10-2026_07_43_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_49_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_50_PM.png

Training-Hub-·-APEX-Financial-08-10-2026_07_50_PM (1).png

Training-Hub-·-APEX-Financial-08-10-2026_07_50_PM (2).png

Licensed-Inbox-·-Apex-Admin-08-10-2026_07_51_PM.png

Unlicensed-Queue-·-APEX-08-10-2026_07_51_PM.png

License-Push-·-APEX-08-10-2026_07_51_PM.png

Onboarding-Ladder-·-APEX-08-10-2026_07_51_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_52_PM.png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_52_PM (1).png

APEX-Financial-—-Start-Your-Career-in-Insurance-Sales-08-10-2026_07_53_PM.png

AgentLink/InsuraCloud references

Insuracloud-08-10-2026_07_41_PM.png — Post a Deal reference

Insuracloud-08-10-2026_07_55_PM.png — Recruiting Tracker reference

Backend workbook

APEX_Backend_Contracting_Comp_Control.xlsx

28. AUTHORITATIVE LINKS

APEX Skool group: [https://www.skool.com/apex-financial-group-](https://www.skool.com/apex-financial-group-)

APEX live site: [https://apex-financial.org/course-catalog](https://apex-financial.org/course-catalog)

SureLC agency entry: [https://surelc.surancebay.com/sbweb/login.jsp?branch=Legacy%20Shield%20Financial&branchEditable=off&branchRequired=on&branchVisible=on&gaId=505&gaName=One%20Life%20America%2C%20Inc](https://surelc.surancebay.com/sbweb/login.jsp?branch=Legacy%20Shield%20Financial&branchEditable=off&branchRequired=on&branchVisible=on&gaId=505&gaName=One%20Life%20America%2C%20Inc)

SureLC API access: [https://support.surancebay.com/hc/en-us/articles/215042187-SureLC-API-Access](https://support.surancebay.com/hc/en-us/articles/215042187-SureLC-API-Access)

SureLC agency API: [https://surelc.surancebay.com/swagger-ui/index.html?urls.primaryName=agency](https://surelc.surancebay.com/swagger-ui/index.html?urls.primaryName=agency)

Skool plugins/automation: [https://help.skool.com/article/176-how-to-use-plugins](https://help.skool.com/article/176-how-to-use-plugins)

Skool invite with course access: [https://help.skool.com/article/60-zapier-invite-with-custom-course-access](https://help.skool.com/article/60-zapier-invite-with-custom-course-access)

Skool course permissions: [https://help.skool.com/article/23-how-to-set-permissions-for-a-course](https://help.skool.com/article/23-how-to-set-permissions-for-a-course)

Skool recurring events/timezone: [https://help.skool.com/article/146-how-to-create-an-event-in-your-group](https://help.skool.com/article/146-how-to-create-an-event-in-your-group)

Discord webhooks: [https://docs.discord.com/developers/resources/webhook](https://docs.discord.com/developers/resources/webhook)

Do not treat screenshots or third-party marketing copy as API documentation. Re-check current official documentation during implementation and record the exact supported capability in docs/integration-capabilities.md.

29. FINAL COMMAND

Rebuild APEX as a unified, reliable agency operating system. Remove duplicate pages, duplicate records, duplicate calculations, dead controls, unsupported automation claims, visual clutter, and hidden operational risk. Preserve history. Make every number traceable, every workflow owned, every integration observable, every failure recoverable, and every page understandable within seconds.

Begin by reading this prompt completely, then inspect repository instructions and the current dirty worktree. Produce the concise audit requested above, immediately select the smallest safe deployable slice, and continue implementing. Do not stop after restating requirements, making a plan, generating documentation, or rendering pages.

At every slice: implement schema and server authorization first; implement the UI against the real data layer; add audit/telemetry/error states; run targeted tests; run the repository’s build/lint/typecheck baseline; visually test desktop and mobile; inspect browser/server logs; and record rollback instructions. Preserve unrelated user changes. Do not suppress tests, weaken RBAC/RLS, disable lint rules, hardcode demo success, or replace real persistence with local-only state.

When credentials or an external capability are unavailable, finish the adapter, configuration validation, sandbox/mock contract tests, outbox/manual-action fallback, status UI, and operator instructions. Clearly distinguish implemented-and-verified, implemented-awaiting-credential, unsupported-by-provider, and not-started states.

Before any production migration or deployment, show the exact change set, backup/rollback evidence, test results, and staging smoke results and obtain explicit owner authorization. Never expose or reuse credentials found in messages, screenshots, files, logs, or git history.

Finish with a compact implementation receipt: changed files, migrations, workflows completed, tests and visual sizes passed, security/privacy checks, workbook reconciliation, health/rollback evidence, remaining external-permission items, and the exact authorized release command or next step. Do not claim production completion unless production health and smoke checks were actually observed after authorization.

Do not stop at “looks better.” Ship a tested operating system.
