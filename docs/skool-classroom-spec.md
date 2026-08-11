# APEX Skool — community + classroom specification

Status: **specification, not deployed.** See "Why this is not automated" below before
asking why nothing shipped to Skool.

## Why this is not automated

There is no Skool integration in this repo or database — verified 2026-08-11 by searching
`src/`, `supabase/functions/` (244 deployed functions) and the live schema. Nothing to extend.

Skool's documented automation surface for Pro plans covers member actions —
`invite_member`, `unlock_course`, and inbound member events. It does **not** document a
general write API for creating feed posts, removing members, DMs, or comments. So the
classroom below is built by hand once, and only the member-lifecycle actions are candidates
for automation later.

Two rules that follow from that, and that the product must respect:

1. **Do not scrape the Skool UI.** Driving a logged-in browser session against their private
   UI is a terms and security risk that has not been reviewed or approved.
2. **Never report a Skool write as succeeded unless a supported capability confirmed it.**
   If `create_post` is unavailable, the delivery is `Manual Action Required` with
   precomposed privacy-safe copy and an "Open Skool" button — not a silent success. This
   platform has a documented history of exactly that failure (465 InsuraCloud rows, 198
   AgentLink rows, all recorded as successes while writing nothing).

## Group structure — six categories, no more

| Category | Purpose |
|---|---|
| Start Here | One pinned orientation post. Nothing else. |
| Announcements | Owner/manager broadcast only. |
| Wins & Deals | Privacy-safe deal posts (see PII rule). |
| Questions & Support | Agent questions, answered in public. |
| Sales & Case Design | Objections, case structure, carrier fit. |
| Training Replays | Recordings of the 9:30 session. |

More than six categories and the feed fragments; agents stop reading it.

## Pinned Start Here post

Keep it to these six lines. Every extra line reduces the odds it is read.

- What APEX is, in two sentences.
- Daily training: **9:30 AM Central**, in Discord.
- Course link (APEX Classroom, below).
- Contracting / SureLC link.
- How to get help, and who answers.
- The rules link.

## Classroom courses

Every lesson uses the same five-part shape: **outcome → short video → written checklist →
resource → completion action**. A lesson without a completion action produces no receipt,
and a course made of those cannot tell you who is actually ready.

1. **Start Here — First 30 Minutes.** Welcome and expectations · join Discord · the 9:30
   Central standard · systems checklist · support and escalation path.
2. **Licensing Path.** Two entry points that must not be mixed: licensed agents skip
   straight to activation; unlicensed run course → exam scheduling → pass → license
   verification.
3. **Contracting & Transfers.** SureLC/AgentLink profile · new carrier request · the
   transfer process · capturing existing agent numbers per carrier.
4. **Systems Setup.** APEX · Discord · Skool · the dialer and call workflow · carrier and
   case-design tools.
5. **Product Fundamentals.** Term · whole life and final expense · IUL · mortgage
   protection · carrier suitability and when to escalate.
6. **Sales System.** Call structure · needs analysis · presentation · recommendation ·
   close and confirmation.
7. **Objections & Roleplay.** Common objections · call reviews · the roleplay standard.
8. **Case Design, Underwriting & Placement.** Field underwriting · case design handoff ·
   application quality · placement follow-up.
9. **Compliance & Recordkeeping.** Approved claims and representations · consent and
   communication records · client data handling · escalation.
10. **Launch Week.** First call block · the daily activity standard · posting the first
    deal · manager review.
11. **Manager Track.** Private.
12. **Agency Owner Track.** Private.

Access rules (Open / Private / Time Unlock / Level Unlock) are only worth using where there
is a business reason. Default to Open; gate 11 and 12.

### Content hygiene

Kill duplicate recordings and titles like "Recording 1". Keep the best current version of
each lesson and archive the superseded ones — do not delete them, archive. An agent who
finds two versions of the same lesson trusts neither.

## Calendar

One recurring event, 9:30 AM Central, location Discord. Store the timezone as
`America/Chicago`, never a fixed UTC offset — the offset changes twice a year and a
hardcoded one silently moves the whole agency's training by an hour. This matches
`Setup Lists!B35` in the contracting workbook, which is the same value for the same reason.

Do not duplicate this event across multiple calendars. Two calendars disagree eventually,
and then nobody knows which is real.

## The PII rule for Wins & Deals

A deal post carries **only**: agent display name, carrier, product category, face amount
(if approved for display), annualized premium (if approved for display), an optional
agent-written caption, and APEX branding.

It never carries: client name, phone, date of birth, policy or application number,
beneficiary information, or any uploaded document.

This is not advisory. As of 2026-08-11 the current Discord deal post **does** include client
PII despite the documented never-PII scope, so this rule is a live defect to close, not a
standard already met.

## What to build in-product to support this

- `Resources` links out to the Skool classroom rather than duplicating it. The in-app
  Training Hub (shipped `bf7af8d3`) stays — it serves recorded trainings from the live
  content API and is not a duplicate of the Skool curriculum above.
- Integration status per agent shows one of: `Not Sent`, `Queued`, `Sent`,
  `Joined/Completed`, `Failed`, `Manual Action Required` — with timestamp, last error and a
  retry. No other states, and no implied success.
- Capability registry: probe `invite_member`, `unlock_course`, `create_post`,
  `remove_member` at configuration time against a test group, and render each as
  `Supported`, `Not Configured`, or `Unsupported`. The UI must never offer an action the
  account cannot actually perform.
