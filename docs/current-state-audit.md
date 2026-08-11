# APEX Rebuild Current-State Audit

Date: 2026-08-11
Repository: `rebuild-brighten-sparkle`
Production Supabase project: `xrzweoneiieddzxogewk`

## Executive finding

APEX already contains substantial production workflows, but its user experience had grown into more than 200 routable surfaces with overlapping recruiting, production, training, analytics, and community entry points. Production also depended on direct notification side effects in places where a failed vendor could make the user unsure whether the durable business record existed. The safe rebuild path is additive: retain the working React/Supabase stack, consolidate navigation, introduce canonical identity and integration primitives beside legacy tables, and migrate source-by-source with reconciliation.

This branch implements the first deployable slice. Nothing in this audit claims that the two new migrations, Edge Function, or Vercel routes have been applied to production.

## Evidence inspected

- React route tree and sidebar/action components.
- Supabase migrations, RLS policies, triggers, cron wrappers, and Edge Functions.
- Existing verification scripts and the repository's TypeScript-error ratchet.
- Read-only live schema checks through `bot-sql`; the new canonical tables were absent before this slice.
- Approved master prompt and its named source workbook path.

## Baseline risks and disposition

| Risk | Evidence | Slice disposition |
|---|---|---|
| Duplicate workspaces | Applicants, CRM, onboarding, courses, analytics, announcements, and leaderboards had separate persistent or deep-linked surfaces | Ten-or-fewer role-aware destinations now lead to canonical workspace URLs; high-value legacy URLs redirect while preserving query strings |
| Deal save coupled to delivery | Legacy deal entry and announcement paths invoked notification-oriented flows directly | Native draft/submit RPC persists deal, history, audit, and redacted outbox in one transaction |
| No canonical identity spine | Existing auth, profile, agent, application, and AgentLink identifiers are separate | Additive `people`, `external_identities`, memberships, and hierarchy tables preserve legacy IDs without guessing merges |
| Metrics could drift | Several pages aggregate different production sources and dates | Seeded metric registry defines owner, grain, timezone, version, and freshness; authoritative production ledger added |
| Integration state was implicit | Vendor failures were mostly function/log outcomes | Capability, event, outbox, delivery-attempt, and dead-letter tables make state explicit |
| Health contract incomplete | Internal health page existed, but no simple deploy liveness/readiness contract | `/healthz` and `/readiness` handlers added; readiness checks database and required migration only |
| Evidence privacy | Policy evidence needed a durable private path and review state | Private bucket, owner/admin RLS, 10 MB/MIME UI validation, and pending-scan metadata added |
| Compensation editing boundary | Workbook is the required source of truth, but web guardrails were only policy | Canonical comp tables expose read-only user access and no web mutation; service-role imports are audit/effective-date ready |
| Contact controls could lie | Licensed Inbox text was log-only, email bypassed the backend, and legacy provider functions accepted unauthenticated recipient input | Server-resolved contact-action RPC, consent/opt-out checks, idempotent outbox dispatch, provider receipts, truthful device fallback, and JWT enforcement added |

## Route and action inventory

Persistent sidebar destinations are bounded by role and never exceed ten:

| Destination | Canonical URL | Role visibility | Current implementation |
|---|---|---|---|
| Command Center | `/dashboard` | authenticated | Existing role-aware dashboard |
| Recruiting | `/dashboard/recruiting` | staff | Existing applications workspace behind canonical route |
| Call Center | `/dashboard/call-center` | staff | Existing calling workflow |
| Team | `/dashboard/team` | staff | Existing team workspace |
| Contracting | `/dashboard/contracting` | authenticated | Existing carrier contracting workflow |
| Production | `/dashboard/production` | authenticated | Existing deals page plus native Submit Deal action |
| Analytics | `/dashboard/analytics` | authenticated | Existing analytics surface behind canonical route |
| Community | `/dashboard/community` | authenticated | Existing announcements/community surface |
| Resources | `/dashboard/resources` | authenticated | Existing training/resources surface |
| Admin | `/dashboard/admin` | admin | Existing admin hub |

Persistent actions are `Add Agent` and `Submit Deal`; mobile exposes the same actions through one labelled `Actions` control. Licensed Inbox shows the authorized row phone/email and routes Call/Text/Email and dispositions through server commands. Old applicant, CRM, training, analytics, announcements, and leaderboard URLs use React redirects so saved links continue to resolve.

## Data sources and ownership

- `deals.posted_at` remains the canonical legacy deal date during coexistence.
- `production_ledger` becomes the authoritative approved/issued/in-force event stream after native submission is enabled.
- AgentLink/InsuraCloud stays a downstream system of record for its own book data until a reviewed mapping and reconciliation is complete.
- Workbook-approved, effective-dated compensation remains the only compensation mutation source.
- `America/Chicago` is the business timezone for daily/weekly scorecards and training schedules.

## Release boundary

The slice is implemented locally and intentionally stops before production mutation. Owner authorization is required before database migration, function deployment, secret configuration, or Vercel release. Workbook cell and structure protection also remains a release blocker because the required spreadsheet authoring runtime was unavailable in this worker session; the original workbook was not modified.
