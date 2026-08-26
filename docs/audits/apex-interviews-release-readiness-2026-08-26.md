# APEX Interviews release-readiness audit — 2026-08-26

## Outcome

The native Interviews workspace, public assistant intake, canonical interview writer, and hire-to-onboarding handoff were audited and repaired as one workflow. The implementation now fails closed when candidate identity cannot resolve to one application, keeps every disposition versioned with an activity receipt, and makes scheduler retries idempotent.

## Production evidence (read-only)

Measured through `bot-sql` on project `xrzweoneiieddzxogewk`:

- 319 active `hh_applicants`; 304 are open.
- 0 active rows are missing every contact identity signal; 205 include Instagram.
- 146 currently resolve to one application by unique email/phone; adding Instagram creates no conflicting production matches today.
- 3 interview rows are hired; 2 resolve to applications. The remaining historical row stays visibly blocked as application-link-needed.
- 771 canonical application rows; 20 licensed active agents currently have no onboarding call.

## Release contracts repaired

- Candidate identity: Instagram handles/URLs are normalized and link safely. Email, phone, and Instagram application matches must resolve unanimously; conflicting signals surface visibly and cannot be hired.
- Contact actions: valid call/text actions use native mobile schemes and Google Voice desktop deep links; desktop links open safely without navigating the APEX SPA away. Email and Instagram actions have accessible names.
- Scheduling: public bookings and reschedules reject past times at UI and server boundaries. Active tabs refresh every minute and the Refresh button refreshes the selected dataset.
- Dispositions/permissions: admin/manager actions and VA-owned actions still use the canonical version-checked edge writer. VAs remain limited to their assigned `va_id` and non-terminal operational actions. Unsupported methods are rejected.
- Hiring: the UI and server refuse a terminal hire without one linked application. Licensed hires require a 5–10 digit self-reported NPN; copy explicitly does not claim NIPR verification. Failed onboarding promotion is retryable from the hired row with NPN capture.
- Onboarding: live call receipts, failed/sent/queued invite states, per-person booking-link queueing, calls/text/email, and reschedule links retain honest states. Loading/error/empty/search states no longer render false zeroes; stale successful data remains visible when refresh fails.
- Intake receipts: `source_request_id` plus a unique token/request index makes retries converge on one manual interview. Replays recover the same receipt, do not duplicate the pipeline mirror, and do not resend a confirmation already receipted.

## Verification

- Focused Vitest suite: 46 tests passed.
- Repository Vitest suite: 817 passed, 6 existing todo, 0 failed.
- TypeScript: `tsc -b --noEmit` passed.
- Deno: both changed edge functions passed `deno check`.
- ESLint on changed UI/helper/test files passed.
- Production build passed.
- Migration collision, external-link safety, accessible icon buttons, empty-catch, metric-truth, and unsafe-Supabase-catch checks passed.
- `git diff --check` passed.

## Remaining release step

The in-app browser had no available browser surface, so interactive signed-in desktop/mobile visual QA could not be executed in this worker. Apply migration `20260826082000_interview_intake_idempotency.sql` before deploying `assistant-add-interview`; deploy `interviews-pipeline` in the same release, then have Claude perform the signed-in desktop/mobile smoke matrix before merge/deploy approval.
