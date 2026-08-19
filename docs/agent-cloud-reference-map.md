# Agent Cloud — Reference Map (from the actual video)

*Source: `~/Downloads/Dashboard — Agent Cloud.mp4` (83s, studied via extracted
frames 2026-08-19). Frames live in the session scratchpad `agentcloud/`.*

## The context that matters

The video is **Sam's own account on useagentcloud.com** — a real third-party
insurance-agency SaaS, already branded "APEX Financial · BY AGENT CLOUD",
accent `#C9A227`, subdomain `apexfinancial.agentcloud.com`, White Label
available on application. The account is EMPTY (all zeros, "Add sample data"
offered, setup checklist "2 of 11 done"). Agent Cloud is therefore both the
design benchmark AND a live competitor for Sam's operating system.

## Information architecture (observed sidebar)

```
APEX Financial / BY AGENT CLOUD
├─ Home
├─ Clients        → Pipeline · Calendar · Book of Business · Retention
├─ Agency         → Team · Announcements · Leaderboard
├─ Contracting    → My Contracts · Invite an agent · Carrier Directory
│    RUN CONTRACTING → Contracting Ops · Contract Requests
├─ Reports
├─ Finances
├─ Tools          → Import · Document review · Resources · Quoter↗ · Marketing
├─ Nova           (AI)
└─ Account        → Settings (Agency settings · Notifications) · Producer Profile
```

Collapsed groups, quiet section labels, one gold CTA in the topbar.

## Topbar pattern

`Good evening, Samuel · Tuesday, August 18` (left) · Search ⌘K · favorite ·
bell · theme toggle · **gold "Post a Deal"** · avatar. Breadcrumbs replace the
greeting on inner pages (`Clients / Calendar`, `Settings / Agency settings`).

## Patterns worth stealing (observed, per screen)

**Home**: Production Trend line chart (with team delta chip) · Enrollment
donut w/ legend rows (Active / In Review / Active downline / Active contracts)
· **POLICY STATUS**: 10 compact tiles with semantic tinted fills+borders
(Active green · Issued-Not-Paid green · In Review blue · Lapse Pending amber ·
Lapsed red · Cancelled red · Withdrawn neutral · Not Taken amber · Postponed
amber · Carrier N/A neutral) · **AI Briefing** panel: plain-language bullets
("Your month is starting at zero across all production categories…") +
Refresh · **NEXT BEST ACTIONS**: rows with priority pills (high) · persistent
bottom-right **setup checklist** ("Set your commission levels — 2 of 11 done").

**Calendar**: auto-generated insurance events — legend: Appointment · Birthday
· Policy Starting Soon · Beneficiary Check-In · Lapse Follow-Up · Policy
Anniversary. Today/arrows · Day/Week/Month segmented · gold + Create.

**Contracting Ops / Document review**: subtitle states the operating model in
one line ("Licensing, carrier contracting, writing numbers, compensation and
hierarchy — prepared here, submitted through whichever system each carrier
requires."), search by agent/doc type, status chip filter, document-approval
queue with expiry awareness ("E&O certificate · Expires in 21d"), empty state
that TEACHES ("A document waiting on review does not satisfy a requirement —
approve it first.").

**Agency settings**: accent color picker (hex input + swatch), subdomain field,
White-Label upsell block with honest copy about DNS, **"Add sample data"**
(fills the product with a labelled realistic book), visibility toggles with
consequence copy ("Off keeps your personal deals out of the Discord feed").

## The quality bar in one sentence

Every screen: breadcrumb topbar + one-line purpose subtitle + quiet controls +
semantic-tinted status tiles + teaching empty states + a single gold CTA — and
insurance concepts (lapse, beneficiary check-in, E&O expiry, writing numbers)
are FIRST-CLASS objects, not generic CRM fields.

## What APEX already beats it on

Sam's system has live production data, an 83-agent AgentLink book, real
recruiting volume (792 open applicants), working call/text/email, one-link
contracting with delivery queue, Discord/Telegram automation, and 50 truth
guards. Agent Cloud's account is an empty shell. The rebuild marries THEIR
finish to OUR data and automations.
