Goal:
Audit the APEX Discord and notification pipeline for recruiting usefulness, data safety, spam resistance, and operational accuracy. Do not spend time on UI polish first. Start with event routing, webhook safety, and message logic.

What matters:
- Notifications should support recruiting, licensing follow-up, and agent activation.
- Recruiting-facing Discord messages must avoid sensitive data, ugly spam, and internal production details that hurt recruiting perception.
- Unlicensed follow-up should push people through the licensing process with clear next steps.
- A single config mistake or metric regression should not silently corrupt downstream notifications again.

Critical findings already confirmed in the repo:
1. `src/pages/admin/IntegrationsSettings.tsx` previously exposed a real Discord webhook in client-side code and setup SQL. Frontend leak has been removed, but backend fallback cleanup still needs verification.
2. `supabase/functions/discord-webhook-notify/index.ts` contains a hardcoded `BOOTSTRAP_WEBHOOK` fallback.
3. `supabase/functions/discord-leaderboards/index.ts` also contains a hardcoded `BOOTSTRAP_WEBHOOK` fallback.
4. `src/pages/AgentPipeline.tsx` only sends `agent_activated` when a candidate reaches `licensed`; interim stage changes intentionally skip Discord because unsupported event types had been failing silently.
5. The website truth layer now expects sales-facing numbers to come from posted deals, not `daily_production.aop`. Discord leaderboard and deal alerts must match that same source-of-truth logic.

Audit these surfaces:
- `supabase/functions/discord-webhook-notify/index.ts`
- `supabase/functions/discord-leaderboards/index.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/send-unlicensed-process-update/index.ts`
- `supabase/functions/send-followup-emails/index.ts`
- `supabase/functions/send-post-call-followup/index.ts`
- `supabase/functions/welcome-new-agent/index.ts`
- `supabase/functions/send-course-enrollment-email/index.ts`
- `supabase/functions/system-health-check/index.ts`
- `supabase/functions/overseer-bot/index.ts`
- `src/pages/AgentPipeline.tsx`
- `src/pages/NotificationHub.tsx`
- `src/pages/admin/IntegrationsSettings.tsx`
- `src/components/callcenter/CallCenterVoiceRecorder.tsx`
- `src/components/callcenter/ResendLicensingButton.tsx`

What to fix:
1. Remove hardcoded Discord webhook fallbacks from code and move them to safe server-side config only.
2. Make every Discord entrypoint fail loudly in logs and audits if the webhook is missing, invalid, or rate-limited.
3. Verify each event type actually maps to a supported Discord payload and channel.
4. Ensure recruiting-facing Discord posts are clean:
   - no sensitive applicant info
   - no ugly debug text
   - no spam loops
   - no misleading team production numbers in recruiting channels
5. Ensure licensing follow-up automation is stage-aware:
   - unlicensed people get licensing next steps
   - licensed people get activation/onboarding next steps
   - meeting/test/course reminders point to the correct next action
6. Add replay-safe logging and dedupe where duplicate notifications are possible.
7. Add guardrails so new notification changes cannot silently drift from the sales truth layer.

Deliverables:
- root causes
- exact files changed
- which channels/events are now trusted
- what still needs secret rotation
- what still needs live backend verification after deploy
