-- MP-509 (2026-09-10): the hire-notification gap check was true about the row,
-- false about the person, and its remedy published a lie.
--
-- 20260827030000 built v_hire_notification_gaps on one premise, written into its
-- own header: "a gap can only appear if the trigger is disabled/dropped". That is
-- exactly what happened on 2026-09-10T03:33:26Z -- and the disable was DELIBERATE,
-- CORRECT, and transactional. postgres_logs holds the writing statement verbatim:
--
--   -- Marlyn Johnson: Vantage producer reported by the Agent Cloud API with no
--   -- agents row. Modeled on David Ladd's row (2026-08-20).
--   -- Outbound "new hire" triggers are disabled for this one insert: she is not
--   -- a new APEX hire and no channel should be told she is.
--   alter table public.agents disable trigger trg_notify_agent_hired;  (+4 more)
--   insert into public.agents (...) ...
--   alter table public.agents enable  trigger trg_notify_agent_hired;  (+4 more)
--
-- All five triggers were re-enabled inside the same transaction, and real hires
-- kept notifying through it: Dylan Harvey (17:31Z) and Larneal Holman (18:17Z)
-- both carry their 2 agent.hired events. So the check's SET was right and its
-- SENTENCE was wrong -- and apex-doctor's printed remedy ("Queue their
-- agent.hired outbox event (destination slack) + a direct Discord post") would
-- have announced a person who is not an APEX hire to Slack and Discord as one.
-- A remedy that publishes to live channels is the most expensive kind of wrong
-- alert this repo can ship; it is hard limit #2 with a green light painted on it.
--
-- WHY THIS DID NOT SURFACE SOONER: the precedent row (David Ladd, 2026-08-20)
-- predates the view's 2026-08-27 anchor, so the class was invisible until the
-- second instance. It will recur every time the Agent Cloud production API
-- reports a producer with no agents row.
--
-- WHAT THIS DOES NOT DO: it does not hide a row. Every gap row still appears --
-- hiding one is how a genuinely dropped notification gets lost. The view now
-- CLASSIFIES, and apex-doctor grades on the class.
--
-- THE DISCRIMINATOR IS STRUCTURAL, NOT PROSE. The operator's reason lives in
-- agents.notes, and grading on a prose substring is the footnote bug this repo
-- has already paid for twice (MP-277, MP-288): a comment that mentions a word is
-- not a fact. The fact is the ordering of two timestamps -- an attribution stub
-- is an agents row created to satisfy a vantage_producer_map row that ALREADY
-- EXISTED, so agents.created_at >= vantage_producer_map.created_at. Measured on
-- all 6 linked producers: the 5 real agents were matched to the map long after
-- they were hired (created 06-08, 06-16, 08-20 x3 vs a map created 09-10T03:23),
-- and only Marlyn inverts it. The looser predicate "is in vantage_producer_map"
-- would today exclude 5 real agents from a hire check on the strength of a
-- coincidence, so the ordering is load-bearing, not decoration.
--
-- RESIDUAL HOLE, NAMED NOT DENIED: a real APEX hire who is ALSO a Vantage
-- producer whose map row happened to land before their agents row would be
-- classified as a stub and would not page. Zero of the 15 correctly-notified
-- post-anchor hires are in the map at all, so the class is empty today; it is
-- not structurally impossible. notes is carried through so the human reading the
-- OK line sees the operator's own sentence and can refuse it.
create or replace view public.v_hire_notification_gaps as
select
  a.id                                       as agent_id,
  a.display_name,
  a.created_at,
  case
    when exists (
      select 1 from public.vantage_producer_map m
      where m.apex_agent_id = a.id
        and a.created_at >= m.created_at
    ) then 'attribution_stub'
    else 'unnotified_hire'
  end                                        as gap_class,
  (
    select 'vantage_producer_map ' || m.agentcloud_agent_id::text
           || ' created ' || to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           || ', agents row created after it'
    from public.vantage_producer_map m
    where m.apex_agent_id = a.id and a.created_at >= m.created_at
    limit 1
  )                                          as stub_evidence,
  left(coalesce(a.notes, ''), 240)           as operator_notes
from public.agents a
where a.status = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and coalesce(a.agent_code, '') not like 'GHOST_%'
  and a.created_at > timestamptz '2026-08-27 02:00:00+00'
  and not exists (
    select 1 from public.outbox_events o
    where o.idempotency_key = 'agent.hired:' || a.id::text || ':slack'
  );

comment on view public.v_hire_notification_gaps is
  'MP-509 verdict for apex-doctor Check #12b-hire. One row per active post-2026-08-27 agent with no agent.hired:<id>:slack outbox event. gap_class=unnotified_hire means a real hire''s notification dropped and the remedy is to queue the event; gap_class=attribution_stub means the agents row was created to satisfy an already-existing vantage_producer_map row (production attribution, no login, no outreach) and publishing a hire announcement for it would be false. Rows are never hidden -- hiding a gap is how a dropped notification gets lost. operator_notes is HUMAN CONTEXT ONLY and never votes; the classification is the timestamp ordering.';

grant select on public.v_hire_notification_gaps to authenticated, service_role;
