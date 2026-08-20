# APEX function audit — 2026-08-11

Repository: `/Users/samjames/projects/rebuild-brighten-sparkle`  
Production: `https://apex-financial.org`  
Supabase project: `xrzweoneiieddzxogewk`  
Audited commit: `e63cbf77f292`

## Verdict

The released Add Agent, Licensed Inbox contact actions, and native Add Deal slice is present and its repository contract checks pass. Production liveness/readiness and every public route in the smoke inventory are healthy. The whole platform cannot yet be described as “all functions work”: the audit reproduced authorization, source-control drift, RPC, database-function, webhook, and monitoring defects that must be closed before that claim is accurate.

This audit corrects the earlier automated report. Its 22 CORS findings and `AgedLeadEmailPreview` XSS finding were false positives: most listed functions use `createHandler`, which supplies CORS, OPTIONS, exception handling, validation responses, rate limiting, and audit logging through shared middleware; the email preview already sanitizes HTML; the external-link gate reports no tab-nabbing traps.

## Evidence that passed

- `npx tsc --noEmit` — pass.
- `npm run build` — pass; production assets generated.
- `npm test -- --reporter=dot` — 35 files, 566 tests passed, 6 todo.
- `npm run smoke:prod` — all 26 public routes returned HTTP 200.
- `npm run check:contact-actions` — 24 backend/UI/security contracts present.
- `npm run check:native-deals` — 14 workflow/security contracts present.
- `npm run check:external-link-noopener` — 551 files scanned, zero traps.
- `npm run check:unsafe-supabase-catch` — pass.
- `https://apex-financial.org/healthz` — HTTP 200, version `e63cbf77f292`.
- `https://apex-financial.org/readiness` — HTTP 200, database reachable, migration `20260811222000`.
- The core gate passed every check reached before its deliberately slow forced project-graph typecheck; that long duplicate typecheck was interrupted after the separate `npx tsc --noEmit` passed.
- Latest run for all 39 active `pg_cron` jobs was `succeeded`. This proves SQL execution/enqueue, not downstream HTTP delivery.
- Production notification evidence for the prior 24 hours includes 4 sent emails and 8 `sms-auto` sends.
- Production `outbox_events`, `delivery_attempts`, and dead-letter counts were empty at audit time.

## Miller / Redesign Deal Posting requirement reconciliation

The current repository contains the requested five-field quick Add Agent form: first name, last name, email, phone, and PA number. It calls `create_apex_toolkit_agent`, validates input, persists the record, and refreshes the Licensed Inbox.

The Licensed Inbox contains working UI paths for:

- phone-number display and `tel:` calling;
- text composer and native SMS fallback;
- email composer;
- Called, Voicemail, Hired, and Passed dispositions;
- durable contact-action recording and dispatcher integration;
- visible accepted-versus-delivered messaging.

The native deal workflow contains Add Deal, validation, evidence, approval/rejection, official ledger posting, audit history, and redacted outbox events. The repository contract tests for both contact actions and native deals pass. Authenticated production browser smoke was previously completed for Add Agent, Add Deal, text/email composers, and the Licensed Inbox.

## Confirmed defects

### P0 — edge-function authorization defaults are unsafe

`scripts/sync-functions-config.sh` automatically registers every new function with `verify_jwt = false`. Current configuration has 241 function blocks: only 5 use gateway JWT verification and 236 disable it. Some of those 236 correctly implement their own user, service-token, or webhook checks, but the default makes a newly added privileged function public unless its author remembers to build a second gate.

Required correction: registration must default to JWT verification, and every exception must be named in an explicit reviewed allowlist with an in-code auth mode and contract test. Do not flip all functions blindly: cron/service/webhook/public endpoints need staged, tested handling.

### P0 — anonymous email dispatch

`send-email` has `verify_jwt = false` and performs no in-code authentication or authorization. A production anonymous POST reached its application validation and returned HTTP 400 for missing recipient/content, rather than HTTP 401. A valid anonymous body could therefore attempt an external email and spend provider quota.

Required correction: require a valid user or service identity, restrict user callers to authorized roles and allowed recipient scope, rate-limit by actor, require idempotency, and record an audit receipt. Unauthorized requests must return 401; authenticated but disallowed users must return 403.

### P0 — privileged public functions need an explicit auth pass

The following confirmed examples use service-role access or paid providers while `verify_jwt = false` and lack an effective caller gate in their handler:

- `ai-lead-insights` — reads applicant/agent details and spends AI-provider quota.
- `score-applicant` — writes applicant scores.
- `verify-nipr` — writes application data and may spend NIPR quota.
- `notify-notes-added` and `notify-stage-change` — send external notifications.
- `check-overdue-tasks` — performs administrative writes.

These are examples, not the complete boundary. Every one of the 239 local edge-function directories must receive an auth-mode classification and executable negative tests. Existing safe manual gates such as `add-agent`, `admin-sql`, `bot-sql`, and `apex-exec` must be preserved and normalized rather than removed.

### P0 — webhooks fail open or have no verification

- `poke-webhook` has no shared-secret/signature verification and is deployed with `verify_jwt = false`. An empty anonymous production request produced a worker error rather than a clean 401.
- `calendly-webhook` accepts POSTs when both its signing key and shared secret are unset.
- `instagram-webhook` skips signature verification when `META_APP_SECRET` is unset.
- `discord-webhook-notify` accepts any valid Supabase user token, although its observed callers are trusted server paths; role/event authorization must be explicit.

`manychat-webhook`, `readymode-webhook`, `telegram-webhook`, and `stripe-webhook-lead-purchase` contain fail-closed verification. Stripe also contains provider-event idempotency. Preserve those controls and add replay/idempotency tests across every webhook.

### P1 — two frontend RPCs are absent from production

Both calls return production PostgREST `PGRST202` / HTTP 404:

- `get_just_hired_30d()`
- `next_step_message_stats_24h(since_ts)`

Their UIs currently fall back to direct table queries, so the pages remain usable, but the primary contract is broken. Implement the exact shapes expected by `JustHiredPanel.tsx` and `AdminFunnelHealth.tsx`, use least-privilege grants, and test both primary and fallback paths.

### P1 — production database functions are not reproducible from migrations

The earlier scanner reported 12 missing RPC definitions in local SQL. Production proves 10 of them exist remotely and are therefore schema drift, not missing live functionality:

- `agent_call_activity`
- `finance_snapshot`
- `fn_readymode_ingest`
- `landing_recent_hires`
- `leaderboard_book`
- `leaderboard_book_hero`
- `my_referral_status`
- `sam_todo_list`
- `sam_todo_dismiss`
- `sam_todo_snooze`

Backfill their current reviewed definitions, ownership, grants, comments, and dependent objects into additive migrations. A fresh local database created only from migrations must expose every statically invoked RPC.

### P1 — two deployed VA functions are missing from the repository

The frontend invokes `create-va-account` and `set-va-account`; neither function directory exists locally. Production returns HTTP 401 without a JWT for both, proving deployed copies exist and are protected, but they cannot be reproduced, reviewed, or redeployed from source control. Export the deployed source through an authorized management path, security-review it, and commit exact local copies with tests and config.

### P1 — broken commission recovery function

Production `fn_commission_recovery_next_batch(1)` fails with `column a.email does not exist`. The function selects and filters `agents.email`, while the canonical email lives in the linked profile/auth model. Fix the join and return shape, add a migration, and add a runtime contract test.

### P1 — additional database-function defects

- `generate_invite_token` sets `search_path = public` but calls `gen_random_bytes`; qualify the installed extension function or include the extension schema safely. Preserve caller authorization, rate limit, URL-safe token generation, expiry, and grants.
- `telegram_sync_stages` has an output parameter named `chat_id` and unqualified `chat_id` references in SQL, creating PL/pgSQL ambiguity. Qualify all table columns and test a rollback-only transition fixture.
- `sum_plaque_amounts()` now safely returns zero when the optional table is absent and passed its production runtime check. Do not recreate the earlier static reference.
- The historical `cc_dispose` lint finding was not reproduced from its current production definition; keep it in the regression suite instead of applying an invented cast.

### P1 — system health contains false signals and repeated failed work

- System health reports “No SMS in 999hrs,” while production logged 8 `sms-auto` sends in the prior 24 hours. The monitor filters `notification_type ILIKE '%sms%'`; current senders identify SMS in `channel`. Query the canonical channel/status fields.
- The latest health run reports 7 stalled applicants, zero contacted, and 7 HTTP 500 responses from `send-notification`. Health checks should observe and enqueue durable work, not directly retry external messages every 15 minutes. Route this through an idempotent outbox, retain provider errors, cap retries, dead-letter repeated failures, and expose operator recovery.
- The 11 “agents with no profile” warning may include intentional pre-auth quick-add roster records. Split “pending account provisioning” from genuinely orphaned active agents using lifecycle state and age thresholds.
- Active `pg_cron` rows report successful SQL execution, but `net.http_post` success can mean only that a request was queued. Health must correlate `pg_net` response status/body, automation receipt, and worker heartbeat.

## False positives to avoid fixing

- Do not add duplicate CORS code to functions already wrapped by `createHandler`; fix shared middleware once and contract-test it.
- Do not add a second sanitizer to `AgedLeadEmailPreview`; it already uses `sanitize-html` before `dangerouslySetInnerHTML`.
- Do not blanket grant new RPCs to `anon` or `authenticated`. Derive grants from the actual caller and data sensitivity.
- Do not invent RPC signatures. The production schema and TypeScript callers are the contract inputs.
- Do not add arbitrary `POSTMARK_API_KEY`/`RESEND_API_KEY` fallbacks. Provider adapters must preserve provider-specific payloads and delivery semantics.
- Do not treat a successful build, a successful cron enqueue, or a provider “accepted” response as proof of final delivery.

## Definition of “all functions work”

The statement is allowed only when the implementation prompt in `docs/prompt-pack/APEX_FUNCTION_PERFECTION_EXECUTION.md` is complete and its evidence matrix has no unwaived red rows. Tests that could send messages, charge money, modify outside accounts, or expose PII must run against local fixtures, provider sandboxes, or rollback-only transactions unless the owner separately authorizes a named production canary.
