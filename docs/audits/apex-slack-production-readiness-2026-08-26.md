# APEX Slack production-readiness audit — 2026-08-26

## Verdict

**NOT production-ready as APEX's primary team communication app.**

The Slack transport foundation is healthy: the production bot authenticates, all seven enabled channels are reachable, all nine enabled event routes have templates and emitters, and the durable receipt ledger has no retry/dead-letter backlog. The operating layer is not ready: the workspace has one human member, no APEX user has an identity link, daily-number DMs cannot reach anyone, two candidate channels expose recruiting data to every future workspace member, the reminder function is anonymously callable, and the explicitly terminated KJ identity is active in production.

This audit made no application-code, database, Slack, or outbound-message mutations. That follows this repository's Codex-analysis/Claude-execution contract and the worker prohibition on unsolicited outbound.

## Readiness matrix

| Area | Verdict | Live evidence |
|---|---|---|
| Workspace connection | PASS | `auth.test` connected APEX Pulse (`U0BSNN7681L`) to Apex Financial (`T0BSN03M2AJ`) at 2026-08-26T13:25:58Z. |
| Channels | TECHNICAL PASS / OPERATING FAIL | 7/7 enabled destinations reachable and bot-joined; 8 unused destinations disabled. Every enabled channel has exactly two members: Sam and APEX Pulse. |
| Role routing | FAIL | 9 event types map one-to-one to semantic channels, but all routes use `audience_scope=organization` with empty hierarchy rules. No manager, recruiter, contracting worker, licensing worker, or agent besides Sam is in Slack. |
| Auto-invites | FAIL / UNPROVEN | Shared invite URL is configured in DB and UI. The only invite outbox row is a synthetic invalid-email dead letter; no real invite has delivered. Three agents created after Slack installation have no invite outbox row. |
| Recruiting | PARTIAL | Application and no-show messages posted, and route is live. `#apex-recruiting-growth` is public and only Sam receives it. |
| Contracting | CONFIGURED / UNPROVEN | Private channel reachable; trigger, route, and template exist. No contracting message or provider receipt has delivered yet. |
| Licensing | DELIVERY PASS / AUDIENCE FAIL | Seven real milestone events delivered. They were duplicated into recruiting and licensing before cleanup; the recruiting duplicate route is now disabled. Licensing channel is public and only Sam receives it. |
| Sales wins | CONFIGURED / UNPROVEN | Public channel reachable; trigger and PII-minimized template exist. No `deal.posted` delivery exists yet. |
| Daily numbers | FAIL | Live dry-run: 20 licensed agents due, Slack token present, 20/20 `no_slack_link`. New tri-channel version has not completed a scheduled production run. |
| Delivery receipts | PASS for channel posts | 17/17 receipts delivered, max one attempt, no pending/retrying/dead-letter/stale lease; 10/10 Slack outbox events delivered in 24h. |
| Security | FAIL | Anonymous reminder endpoint, KJ active/unbanned, zero verified Slack identities, candidate channels public, and shared invite goes to every applicant. |
| Health verdict | FALSE GREEN | `slack-integration-health` returns `ok:true` because it measures bot/channel transport only; it ignores human membership, identities, invite failures, numbers delivery, channel privacy, and offboarding invariants. |

## Critical findings

### P0 — departed KJ identity is live

Production row `431dff0d-7c82-4134-a85e-457e5226fc7f` is `status=active`, `is_deactivated=false`, `is_inactive=false`; auth user `75b17131-e565-49c9-9da4-8480a35b06a3` has no ban; there is no roster exclusion. He qualifies for today's numbers reminder and still owns seven active children. He has no Slack membership or identity link, but the stale source state already emitted a manager-ops bounty qualification/reversal today and remains eligible for other live automations.

Claude must atomically: snapshot the row/children; ban the auth user; set the agent to terminated/deactivated/inactive and remove live access; add a roster exclusion; reassign the seven active children to the canonical Sam agent `7c3c5581-3544-437f-bfe2-91391afb217d` for current routing; preserve historical deal/recruiting attribution; then prove every invariant by query.

### P0 — `numbers-reminder` is anonymously callable

`supabase/config.toml` sets `verify_jwt=false`, while `supabase/functions/numbers-reminder/index.ts` performs no in-code authorization. An unauthenticated POST `{ "dry_run": true }` returned HTTP 200 and a 20-entry plan containing agent IDs and names. The same endpoint accepts `force:true`, which can trigger email/SMS/Slack outbound outside the schedule.

Add a POST-only fail-closed guard before body parsing. Accept only the configured `APEX_BOT_TOKEN` (the pg_cron caller) or service-role key. Return 503 when the bot token is absent and 401 for missing/wrong tokens. Make dry-run output aggregate-only. Add regression tests that anonymous dry-run and force both return 401.

### P1 — Slack has no team

Slack's all-workspace `#general` contains one human (Sam) plus the bot. The seven enabled operational channels have the same two members. Production has 27 active agent rows (20 licensed, 7 unlicensed), including three DB users with manager role besides Sam, yet `messaging_identity_links` has zero rows.

Before any broad invitation, define the eligible population and channel membership policy. The current application trigger invites every applicant, not only accepted hires. Because recruiting and licensing are public, a future applicant can join and read other candidates' names, states, and milestones. Move recruiting/licensing traffic to private staff channels (or remove candidate identifiers), add the actual recruiting/licensing/contracting/manager staff, then invite the approved active-team population. Do not bulk-send without Sam/Claude outbound approval.

### P1 — identity linking is not implemented end to end

The installation grants `chat:write`, `chat:write.public`, `channels:read`, and `groups:read`, but no user lookup/email scopes. There is no OAuth/event/signature workflow and `signing_secret_ref` is null. The reminder code also accepts every non-revoked link whose status is not the impossible value `rejected`; the table's real states are `pending`, `verified`, `conflict`, and `revoked`.

Create an admin-verified or OAuth linking flow, request only necessary user scopes, and DM only `verification_status='verified' AND revoked_at IS NULL`. Add a uniqueness/conflict proof and explicit KJ exclusion.

### P1 — health ignores the operating layer

Extend `slack-integration-health` to grade: human workspace/channel membership; actual channel privacy versus intended audience; active-agent verified-link coverage; auto-invite outbox including dead letters; latest numbers-reminder channel health; per-event real traffic/no-traffic; and the KJ offboarding invariant. `ok` must be false when a primary-communication workspace has no team.

### P2 — reminder heartbeat write is broken

`numbers-reminder` inserts `automation_run_log.message`, but that table has no `message` column. The error is ignored, so the latest recorded run remains 2026-05-02 even though `last_numbers_reminder` was stamped on 2026-08-25. Write the supported `triggered_at`, `completed_at`, `status`, `response_body`, `error`, and `duration_ms` fields and fail/flag a heartbeat write error.

## Verified implementation strengths

- Slack tokens are environment-backed; the database stores only `SLACK_BOT_TOKEN` as a reference.
- Messaging tables use RLS, admin-scoped reads, service-role writes, idempotency keys, and per-destination receipt leases.
- Channel post routes are deterministic: 9 enabled routes, 9 distinct event types, no duplicate enabled routes, and no route to a disabled destination.
- Templates refuse unknown event types and minimize message content. Sales wins exclude policyholder/contact/medical/banking fields; interview no-show excludes phone/email.
- Dispatcher runs every minute; personal records and recruiter bounties run every 15 minutes; weekly free-leads summary and the two DST-safe numbers schedules are active.
- KJ is absent from Slack and has no Slack identity link. Historical production/recruiting attribution can therefore be preserved while live access/routing is removed.

## Checks run

- Deployed `slack-integration-health`: HTTP success, `ok:true`, 7 enabled/7 reachable, 9 routes healthy, coverage `ok`, delivery `ok`.
- Slack connector: workspace identity, actual public/private channel types, member lists, and channel histories.
- Production bot-sql: installations, destinations, routes, route integrity, receipts, outbox, cron, invite coverage, roster roles, numbers health, KJ state, and auth state.
- Anonymous live dry-run against `numbers-reminder` (send disabled): HTTP 200 reproduced the authorization/data-exposure defect.
- `npx vitest run src/tests/lib/slackMessagingFoundation.test.ts src/tests/components/AgentCloudParity.test.tsx src/tests/lib/inviteAccountLifecycle.test.ts --reporter=verbose`: 29/29 passed.
- `deno check` for `slack-integration-health`, `numbers-reminder`, and `apex-outbox-dispatcher`: passed.

## Claude repair order and closure proof

1. Emergency-offboard KJ and reassign current routing while preserving history.
2. Authenticate and minimize `numbers-reminder`; fix verified-link filtering and heartbeat logging; deploy; prove anonymous 401 and tokenized dry-run 200.
3. Lock candidate channels to staff before sending any new/bulk invites. Decide applicants-versus-hires eligibility explicitly.
4. Build and backfill verified Slack identities; add intended humans to role channels; keep KJ excluded.
5. Extend health so today's empty-workspace state is red, then make it green only after membership and link thresholds are met.
6. Prove real recruiting, contracting, licensing, sales, invite, and daily-number deliveries with provider receipts. Do not fabricate canonical deals or send unsolicited tests.
