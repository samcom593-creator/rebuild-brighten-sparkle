# APEX Function Contract Matrix

Generated: 2026-08-26T00:13:19.127Z
Repository: `/Users/samjames/projects/rebuild-brighten-sparkle`

## Inventory Summary

- Total Local Edge Functions: **245**
- Configured in `config.toml`: **247**
- Invoked Edge Functions in Source: **102**
- Invoked RPC Calls in Source: **109**
- SQL Functions in Migrations: **389**

## Edge Function Auth & Verification Contracts

| Function Name | Local Source | config.toml Entry | verify_jwt | Classification | Status |
| --- | --- | --- | --- | --- | --- |
| `add-agent` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `admin-sql` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `agent-signup` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `agentlink-clients-sync` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `agentlink-cookie-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `agentlink-import` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `ai-assistant` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `ai-lead-insights` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `analyze-call-transcript` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `analyze-content-item` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-ai-nudge` | NO | Yes | `false` | Authenticated JWT | DEBT: no local source; public but not allowlisted |
| `apex-alert-dispatch` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-audit-engine` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-bootstrap` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-evening-report` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-exec` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-mcp` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-morning-brief` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `apex-outbox-dispatcher` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `apex-weekly-report` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `applicant-checkin` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `applicant-magic-link` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `applicant-self-report` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `assistant-add-interview` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `backfill-plaque-images` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `bot-sql` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `bulk-agent-message` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `bulk-resend-course-emails` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `bulk-send-licensing` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `calendly-backfill` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `calendly-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `cfo-notify` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-abandoned-applications` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-churn-risk` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-comeback-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-daily-awards` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-daily-plaques` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-early-performance` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-email-status` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-low-aop-friday` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-monthly-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-overdue-tasks` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-recruiting-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-stale-onboarding` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-streak-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-team-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `check-weekly-milestones` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `claim-account` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `confirm-agent-removal` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `consume-invite-token` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `create-agent-from-leaderboard` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `create-lead-checkout` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `create-new-agent-account` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `daily-brief` | NO | Yes | `false` | Authenticated JWT | DEBT: no local source; public but not allowlisted |
| `dedupe-aged-leads` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `detect-dropped-leads` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `detect-duplicates` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `detect-ghosted-applicants` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `detect-inactive-agents` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `detect-production-gaps` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `discord-leaderboards` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `discord-webhook-notify` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `gcal-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `generate-award-graphics` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `generate-magic-link` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `generate-monthly-awards` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `generate-quiz-questions` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `get-active-managers` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `get-vapid-public-key` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `ics-feed` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `ig-voice-broadcast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `import-production-data` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `increment-lead-counter` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `instagram-auth` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `instagram-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `insuracloud-outbox` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `insuracloud-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `interviews-outcome` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `interviews-pipeline` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `licensing-stage-nudge` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `link-account` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `log-production` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `manager-daily-digest` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `manager-signup` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `manychat-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `merge-agent-records` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `metricool-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `mirror-agents-backfill` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `morning-brief` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `next-step-dispatch` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-admin-daily-summary` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-admin-earnings` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-agent-contracted` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-agent-live-field` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-agent-login` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-all-managers-leaderboard` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-attendance-missing` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-attendance-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-comeback-alert` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-course-complete` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-course-started` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-daily-summary` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-deal-alert` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-deal-submitted` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-evaluation-due` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-evaluation-result` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-fill-numbers` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-hire-announcement` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-lead-assigned` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-lead-closed` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-lead-purchase` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-low-close-rate` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-manager-downline-production` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-manager-referral` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-milestone-congrats` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-missed-dialer` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-module-progress` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-monthly-leaderboard` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-no-deal-today` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-notes-added` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-production-submitted` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-rank-passed` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-seminar-signup` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-set-goals` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-stage-change` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-streak-alert` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-test-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-test-scheduled` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-top-performer` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-top-performers-morning` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-training-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notify-weekly-champion` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `notion-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `nudge-unworked-applications` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `numbers-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `onboarding-nudge-sweep` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `outreach-sender` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `overseer-bot` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `parse-schedule-image` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `poke-pusher` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `poke-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `post-deal` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `post-plaque-to-instagram` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `postmark-approval-monitor` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `process-scheduled-tasks` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `readymode-ingest` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `readymode-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `readymode-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `render-all-plaques` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `request-agent-photos` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `reset-agent-password` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `reset-monthly-goals` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `resolve-ref-slug` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `run-licensing-checkups` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `run-licensing-fasttrack` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `sam-ai-chat` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `sam-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `schedule-auto-populate` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `schedule-interview` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `score-applicant` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `self-enroll-course` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `seminar-confirmation` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `seminar-register` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `seminar-reminder-tick` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `send-abandoned-followup` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-admin-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-aged-lead-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-agent-nudge` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-agent-onboarding-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-agent-portal-login` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-application-notification` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-batch-blast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-bulk-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-bulk-notification-blast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-bulk-portal-logins` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-bulk-unlicensed-outreach` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-calendly-invite` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-candidate-confirmation` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-couldnt-reach-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-course-enrollment-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-course-hurry-emails` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-course-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-daily-checkin-prompt` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-daily-leaderboard-summary` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-daily-producer-spotlight` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-daily-sales-leaderboard` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-followup-emails` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-instagram-dm` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-license-milestone` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-licensing-instructions` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-licensing-sequence` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-login-to-manager` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-manual-followup` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-milestone-reward` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-monthly-motivation` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-notification` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-numbers-reminder` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-outreach-email` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `send-outstanding-performance` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-password-reset` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-plaque-batch` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-plaque-recognition` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-post-call-followup` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-proactive-coaching` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-push-notification` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-push-optin-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-reapply-blast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-sam-morning-report` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-seminar-invite-blast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-sms-auto-detect` | Yes | Yes | `true` | Authenticated JWT | PASS |
| `send-sms-via-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-top5-four-week-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-unlicensed-process-update` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-weekly-analytics` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-weekly-team-summary` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-whatsapp` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-whatsapp-onboarding-blast` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `send-winback-campaign` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `setup-agent-password` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `simple-login` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `siri-command` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `site-shell-watch` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `stripe-sync` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `stripe-webhook-lead-purchase` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `submit-application` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `submit-contracting-intake` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `system-health-autopilot` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `system-health-check` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `telegram-drain` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `telegram-webhook` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `test-email-flows` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `tiktok-dm-drafter` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `track-email-click` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `track-email-open` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `transcribe-call` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `trigger-new-hire-flow` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `unsubscribe` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `update-application-referral` | Yes | Yes | `false` | Public / Webhook In-Code Verified | PASS |
| `update-user-email` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `validate-signup-token` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `verify-magic-link` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `verify-nipr` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `welcome-new-agent` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `xcel-csv-ingest` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `xcel-gmail-pull` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |
| `xcel-import` | Yes | Yes | `false` | Authenticated JWT | DEBT: public but not allowlisted |

## Invoked RPC Coverage (informational)

Absence here is NOT a defect. Postgres functions in this project are routinely
applied by hand through bot-sql and never round-tripped into
`supabase/migrations`, so this directory does not model the deployed database.
`apex-doctor` queries `pg_proc` and is the authority on deployed state.

- Invoked RPCs: **109**
- Also declared in this commit's migrations: **98**
- Declared only in the database: **11**
