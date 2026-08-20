# APEX function-perfection execution prompt

Paste this entire prompt into Claude Code in VS Code at the repository root.

---

You are the execution engineer for APEX. Work directly in:

`/Users/samjames/projects/rebuild-brighten-sparkle`

Your objective is to make every user-visible action and every supporting RPC, edge function, database function, webhook, cron, queue, and provider adapter work end to end. Do not return another plan or generic audit. Inspect, implement, test, deploy through the existing safe workflow, and leave evidence.

## Required sources

Read these before editing:

1. `AGENTS.md`
2. `docs/audits/APEX_FUNCTION_AUDIT_2026-08-11.md`
3. `docs/prompt-pack/MASTER_APEX_WEBSITE_PERFECTION.md`
4. `docs/operations-runbook.md`
5. `supabase/migrations/20260811220000_apex_unified_os_foundation.sql`
6. `supabase/migrations/20260811221000_apex_native_deal_workflow.sql`
7. `supabase/migrations/20260811222000_apex_contact_actions.sql`
8. `/Users/samjames/business-ops/ai-orchestrator/artifacts/ai-20260811T020522Z-review-miller-s-recent-imessages-ext-1ace/execution-prompt-checklist.md`
9. `/Users/samjames/business-ops/ai-orchestrator/artifacts/ai-20260811T020522Z-review-miller-s-recent-imessages-ext-1ace/miller-request-review.md`
10. `/Users/samjames/Downloads/APEX_Backend_Contracting_Comp_Control.xlsx`
11. `/Users/samjames/Downloads/Redesign-Deal-Posting-08-10-2026_08_21_PM.png`

The working tree contains the user-owned untracked file `tmp-route-sweep.mjs`. Do not edit, delete, stage, or overwrite it. Preserve all valid work already shipped at commit `e63cbf77f292`.

## Non-negotiable boundaries

- Never claim success from compilation alone.
- Never expose or commit secrets.
- Never send real email, SMS, WhatsApp, push, Discord, Telegram, Skool, or social posts during testing.
- Never create a real charge, subscription, refund, bank action, dispute, or paid provider event.
- Use fixtures, provider sandboxes, stub transports, rollback-only SQL, and explicitly labeled test recipients.
- Do not delete production data or rewrite migration history. Use additive, reversible migrations and record rollback SQL.
- Do not grant `anon` or `authenticated` broadly. Derive every grant from the caller and data classification.
- Preserve the working Add Agent, Licensed Inbox, Add Deal, health, readiness, and outbox behavior while hardening it.
- “Accepted by provider” and “delivered” are different states everywhere.
- No item is complete without authorization, validation, persistence, feedback, auditability, error behavior, and an executable test.

## Phase 1 — create the authoritative function contract inventory

Add a deterministic repository check that inventories:

- every `supabase.functions.invoke()` call, including approved dynamic names;
- every edge-function directory and `supabase/config.toml` block;
- every `supabase.rpc()` call in frontend and edge code;
- every SQL function created by migrations;
- every webhook and its verification mechanism;
- every `pg_cron` job, queue/outbox producer, dispatcher, and provider adapter;
- caller surface, auth mode, allowed roles, request schema, response schema, side effects, idempotency key, retry policy, and owner.

The check must fail CI when:

- an invoked edge function lacks local source or configuration;
- an invoked RPC cannot be created by a fresh migration-only database;
- a privileged function has no explicit auth mode;
- a public webhook has no fail-closed verifier;
- a provider write lacks idempotency/audit status;
- a new function is silently registered as public.

Commit the generated human-readable matrix at `docs/audits/apex-function-contract-matrix.md`. Keep generated secrets and PII out of it.

## Phase 2 — repair the edge-function authorization model

Fix `scripts/sync-functions-config.sh`. New functions must default to `verify_jwt = true`. Public exceptions must live in a small explicit allowlist that states why the route is public and names the in-code verifier. Add fail-injection tests showing an unclassified public function fails CI.

Introduce or extend shared middleware so every function declares exactly one mode:

- authenticated user plus allowed role(s);
- trusted service caller;
- signed/shared-secret webhook;
- deliberately public read-only/form endpoint with rate limit and narrow schema.

There must be no permissive default. Preserve legitimate manual gates already implemented in `add-agent`, `admin-sql`, `bot-sql`, and `apex-exec`, then migrate them to the common contract without weakening them.

Immediately close and test these confirmed gaps:

1. `send-email`: require user/service identity; restrict user roles and recipient scope; add rate limit, idempotency, and audit receipt. Anonymous valid-looking requests must return 401 without touching Resend.
2. `ai-lead-insights`: require an authorized user who can view the requested person; prevent arbitrary-ID PII access; rate-limit provider spend.
3. `score-applicant`: admin/manager only; authorize bulk scoring separately; audit writes.
4. `verify-nipr`: admin/authorized workflow only; validate the application is in scope; idempotency and provider-cost guard.
5. `notify-notes-added` and `notify-stage-change`: trusted service or authorized actor only; validate entity scope; prevent arbitrary recipients.
6. `check-overdue-tasks`: service/admin only; make repeat runs idempotent.

Run the same classification against all 239 local function directories. Do not assume the static examples are exhaustive.

For every hardened function, test OPTIONS, wrong method, missing auth, invalid auth, wrong role, malformed JSON, invalid fields, authorized success with a stubbed provider, idempotent replay, provider timeout, provider 4xx/5xx, and audit/error receipt.

## Phase 3 — secure and de-duplicate webhooks

1. `poke-webhook`: require a configured secret or signed token; fail closed with 503 when missing and 401 when wrong; never log an unverified payload.
2. `calendly-webhook`: if both signing key and shared secret are absent, return 503. Prefer timestamped signature verification, constant-time comparison, replay window, and provider-event deduplication. Keep the GET/verification behavior separate where required.
3. `instagram-webhook`: keep Meta verification GET, but make POST return 503 when `META_APP_SECRET` is absent and 401 when the signature is invalid. Add provider-event dedupe before side effects.
4. `discord-webhook-notify`: restrict each event type to trusted service callers or explicit roles. A generic authenticated user must not fabricate administrative/hire/deal events.
5. Preserve and test the existing fail-closed gates in ManyChat, ReadyMode, Telegram, and Stripe.
6. Return 200/202 for verified duplicate webhook events after proving no side effect was repeated.

## Phase 4 — eliminate RPC and schema drift

Create additive migrations whose names sort after `20260811222000`.

Implement and contract-test the two confirmed missing live RPCs from actual caller shapes and real schema:

- `get_just_hired_30d()` for `src/components/dashboard/JustHiredPanel.tsx`;
- `next_step_message_stats_24h(since_ts timestamptz)` for `src/pages/AdminFunnelHealth.tsx`.

Backfill reviewed production definitions and least-privilege grants for these live-but-unmigrated functions:

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

Do not copy production blindly. Compare every definition to the current tables, RLS model, caller shape, and PII boundary. Add `SET search_path`, ownership, comments, revokes, and grants deliberately.

Fix these production functions:

- `fn_commission_recovery_next_batch`: replace invalid `agents.email` references with the canonical profile/auth join; keep return columns stable and restrict access.
- `generate_invite_token`: safely qualify the pgcrypto random-byte function; preserve active-agent authorization, 20/hour limit, expiry cap, URL-safe token, and one-time behavior.
- `telegram_sync_stages`: qualify `telegram_users.chat_id` and every colliding identifier; prove stage transitions and dedupe in a rolled-back fixture.

Keep the current safe dynamic implementation of `sum_plaque_amounts()`. Add a regression test for the absent optional table. Re-test `cc_dispose` from current production/migration truth; do not add an invented cast unless a test reproduces the failure.

Build a clean local Supabase database only from committed migrations. The function inventory must show zero frontend/edge RPC calls missing from that clean database.

## Phase 5 — restore deployed VA source

Production has protected deployments for `create-va-account` and `set-va-account`, but the repository has no directories for them.

Export the deployed source through an authorized Supabase management path. Do not reconstruct sensitive logic from comments alone. Review that each function:

- derives caller identity from JWT;
- permits admin or `va_manager` as intended;
- restricts a VA manager to owned child accounts;
- creates only the `va` role;
- returns a one-time credential exactly once;
- uses real auth ban/unban for disable/enable;
- records an audit receipt without credential leakage.

Commit both function directories, config entries, tests, and deployment manifest. Diff the rebuilt deployment against the existing behavior before promotion.

## Phase 6 — make health, cron, queue, and delivery truth accurate

Fix `system-health-check`:

- SMS health must read canonical `notification_log.channel`/status. It currently reports 999 hours despite 8 `sms-auto` sends in the previous 24 hours.
- A health probe must not directly send repeated applicant messages. Enqueue one idempotent outbox event per applicant/template/window, then let a dispatcher handle retry/backoff/dead-letter.
- Persist sanitized provider rejection details so the current 7 repeated `send-notification` HTTP 500s have an actionable cause.
- Split newly quick-added/pending-provisioning agents from true orphaned active agents; use lifecycle state and a reasonable age threshold.
- For `pg_net` cron jobs, correlate enqueue ID to HTTP status/body, automation receipt, and worker heartbeat. A `cron.job_run_details.status = succeeded` row is insufficient.

Verify every active cron has one intended owner, one schedule, a staleness threshold, bounded batch size, idempotency, observable duration/result, and an alert route. Disabled jobs must have a documented reason and must not be silently relied upon by UI copy.

Verify queues/outboxes for pending, processing, delivered, retryable failure, permanent failure, and dead letter. Prove stale locks are reclaimed and concurrent dispatchers cannot double-send.

## Phase 7 — prove every requested user action

Preserve and test Miller’s requested Licensed Inbox flow:

- cards show name, phone, email, and PA/NIPR state;
- phone tap launches the correct `tel:` URI and records a call action without claiming completion;
- Text opens a composer, validates opt-out language, writes the durable action, dispatches through the approved provider, falls back to the native `sms:` composer only when configured behavior requires it, and distinguishes accepted/delivered/failed;
- Email opens a composer, requires subject/body, writes the durable action, dispatches through the approved provider, and distinguishes accepted/delivered/failed;
- Called, Voicemail, Hired, and Passed persist, refresh immediately, survive reload, and are audited;
- duplicate clicks and retries do not create duplicate provider sends.

Preserve and test Add Agent with exactly these five quick inputs: first name, last name, email, phone, PA number. Validate normalization, authorization, duplicate handling, persistence, Licensed Inbox appearance, and post-create journey. Do not send invitations or external messages merely because the agent was added.

Preserve and test Add Deal from submit through evidence, approval/rejection, immutable ledger, recalculated metrics, privacy-safe community payload, outbox delivery state, and rollback. No customer PII may enter Discord, Skool, logs, analytics, or fixtures.

Use Playwright or the existing browser harness for authenticated desktop and mobile tests. Cover loading, empty, validation, permission denied, provider unavailable, offline/retry, success, and reload persistence. Buttons that are intentionally unavailable must be disabled with a reason; no dead clicks or fake success toasts.

## Phase 8 — verification gates

Run and retain output for:

```bash
git status --short --branch
npx tsc --noEmit
npm test -- --reporter=dot
npm run build
npm run check:contact-actions
npm run check:native-deals
npm run verify:core
npm run smoke
npm run smoke:prod
supabase db lint --local --level error
supabase db push --dry-run --linked
```

Also run:

- clean migration-only database creation;
- generated edge/RPC/auth contract inventory;
- edge-function contract tests with stubbed providers;
- rollback-only SQL fixtures for mutating database functions;
- authenticated desktop/mobile browser tests for Add Agent, call, text, email, disposition, and Add Deal;
- anonymous and wrong-role negative tests for every privileged edge function;
- verified duplicate/replay tests for every webhook;
- cron-to-HTTP-response correlation tests;
- queue concurrency, retry, and dead-letter tests;
- PII scans over outbound community payloads and logs.

Do not use a real outbound message as a generic smoke test. A named production canary requires separate owner authorization, a named recipient, an exact cost/side effect, and cleanup instructions.

## Phase 9 — deploy safely and prove production

Before deployment:

1. Back up affected schema objects and record current function versions.
2. Produce migration and edge-function rollback commands.
3. Apply to staging or an isolated branch database first.
4. Run all gates and authenticated browser tests.
5. Confirm no uncommitted user work is included.

Promote only a verified commit. Gate traffic on `/readiness`. After deployment, prove:

- `/healthz` and `/readiness` return 200 with the new commit/migration;
- all public routes pass;
- missing RPC probes no longer return `PGRST202`;
- `fn_commission_recovery_next_batch(1)` runs without error;
- anonymous `send-email`, Poke, Calendly POST, Instagram POST, AI insights, scoring, NIPR, notification, and admin task probes fail with the intended 401/403/503 before side effects;
- VA create/set function source matches deployed behavior;
- SMS health reflects canonical recent sends;
- cron HTTP responses and worker receipts are visible;
- no new provider send, webhook duplicate, dead letter, or PII leak was introduced.

Rollback immediately on readiness failure, migration incompatibility, authorization regression, duplicate side effects, unexplained provider sends, or loss of auditability.

## Required deliverables

Create:

1. `docs/audits/apex-function-contract-matrix.md`
2. `docs/audits/apex-function-remediation-results.md`
3. additive SQL migrations and rollback notes;
4. restored VA edge-function source;
5. auth/webhook/RPC/health regression tests;
6. updated `docs/operations-runbook.md`;
7. a final evidence table with every requirement marked Pass, Blocked, or Not Applicable.

Your final response must state the deployed commit, migration version, production health/readiness results, tests run, exact remaining blockers, and rollback location. Do not say “all functions work” while any required row is untested, failing, or only inferred.

Begin now. Inspect first, then execute until every safe in-scope acceptance row is proven.
