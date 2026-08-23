# APEX Operations Runbook

## Current incident finding & remediation status

The August 10, 2026 live request returned `502 Bad Gateway` with connection refused. That proves the upstream application was unavailable, but it does not identify whether the cause was a failed build, crashed runtime, bad route, missing environment value, or platform networking. This slice adds `/healthz` and `/readiness`; the required readiness marker is migration `20260811222000`. The proposed `20260811223000` remediation is preserved only as a rejected audit artifact and is not a deployed migration.

## Health contract

- `GET /healthz`: process liveness only; no vendor dependency.
- `GET /readiness`: required Supabase configuration, database reachability, and migration `20260811222000`.
- Admin health should separately display optional integration capability, outbox lag, oldest pending event, dead letters, and worker heartbeat.
- Never return secrets, recipients, message bodies, client identity, policy data, or documents.

## Edge Function & Function Contract Safeguards

- All new edge functions default to `verify_jwt = true` in `supabase/config.toml`.
- Public functions and webhooks are restricted to an explicit, audited `PUBLIC_ALLOWLIST`.
- In-code webhooks (`poke-webhook`, `calendly-webhook`, `instagram-webhook`) fail closed with HTTP 503 if verification credentials are missing and HTTP 401 on signature mismatch.
- Privileged endpoints (`send-email`, `ai-lead-insights`, `score-applicant`, `verify-nipr`, `notify-notes-added`, `notify-stage-change`, `check-overdue-tasks`, `create-va-account`, `set-va-account`) enforce caller JWT and role verification (`requireAuth` / `requireRole`).
- Deployed VA edge functions (`create-va-account`, `set-va-account`) are source-controlled, authenticated, and role-guarded.

## Release procedure

1. Confirm clean review scope and preserve unrelated local changes.
2. Create/verify a restore point.
3. Apply migrations and functions to staging only.
4. Configure placeholders with staging secrets; set `APEX_CONTACT_DRY_RUN=true` for contact smoke tests.
5. Require `npm run check:migration-versions`, `npm run check:function-contracts`, lint, TypeScript ratchet, tests, production build, Deno checks, `/healthz`, and `/readiness`.
6. Smoke role access, Add Agent, call logging, SMS/email preview and dry-run receipt, deal draft recovery, evidence upload, duplicate submit, and deal status transition.
7. Review logs for PII and unhandled errors.
8. Obtain explicit owner authorization before production migration/deployment or a real outbound send.

## Rollback triggers

Rollback immediately for failed readiness, auth/RLS bypass, duplicate deal/contact action, provider resend on retry, lost draft, incorrect metric attribution, PII in an outbound payload/log, or sustained 5xx responses.

## Rollback procedure

1. Stop traffic promotion and dispatcher cron.
2. Disable the new entry points with the release feature gate or redeploy the last known-good web/functions release.
3. Do not delete additive data. Preserve action receipts/outbox/audit rows.
4. Reconcile any `processing` events older than ten minutes; move exhausted work to dead letter.
5. Verify the restored release through liveness, readiness, sign-in, and one read-only role smoke test.
6. Record incident window, commit, migration version, affected IDs, and recovery evidence without PII.

## Contact incident recovery

- `provider_accepted` means the provider accepted the request, not confirmed delivery.
- Retry the same action ID/idempotency key. If a provider receipt already exists, the dispatcher logs/reconciles without resending.
- `fallback_required` means no provider send occurred. Device SMS must never be displayed as sent automatically.
- Respect phone-bad, SMS-consent, and email-unsubscribe state on every retry.

## Production verification still required

External uptime monitor creation, alert routing, staging rollback rehearsal, production platform-log root cause, post-deploy screenshots, and real provider/webhook delivery verification require owner-authorized external access. They are not claimed complete here.
