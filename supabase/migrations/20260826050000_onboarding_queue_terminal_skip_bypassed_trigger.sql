-- 20260826050000_onboarding_queue_terminal_skip_bypassed_trigger.sql
-- apex-doctor Check #12b (v_hired_licensed_missing_course) has been CRITICAL on two
-- agents: Isaac Assaba (04359375-…, missing course+discord+hired_whatsapp) and
-- Pranav Kodali (20344eff-…, missing hired_whatsapp). Both were onboarded in June
-- (has_training_course=true; Pranav's course+discord emails were SENT 2026-06-18).
-- Their queue rows are absent because on 2026-08-23 six stale status flags were
-- corrected with the agents triggers deliberately suspended to guarantee zero
-- outbound. trg_agents_hired_licensed_enqueue is present and ENABLED (tgenabled=O),
-- so re-applying its migration -- which the check prescribed -- changes nothing.
--
-- Fix: give them a TERMINAL, UNSENDABLE routing receipt. attempt_count=5 is the
-- sender's own retirement threshold (send-agent-onboarding-email selects
-- sent_at is null AND attempt_count < 5), sent_at stays NULL because nothing was
-- delivered, and last_error says exactly why. This never claims delivery -- the
-- 465-row fake-success shape would be stamping sent_at. Same precedent as the
-- 'terminal_inactive_agent: status=terminated' rows already in this table.
-- Idempotent: only inserts kinds that are still missing.
insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, sent_at, attempt_count, last_error)
select a.id, k.kind, now(), null, 5,
       'skipped: onboarded 2026-06; 2026-08-23 status-flag correction bypassed trg_agents_hired_licensed_enqueue by design (triggers suspended to guarantee zero outbound). Terminal: never sent, never sendable [terminal-skip-2026-08-25]'
from public.agents a
cross join (values ('course'), ('discord'), ('hired_whatsapp')) as k(kind)
where a.id in ('04359375-19eb-4706-8017-da56f7c57f98', '20344eff-2a14-4b9f-bae2-fabc87f55c07')
  and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id = a.id and q.email_kind = k.kind);
