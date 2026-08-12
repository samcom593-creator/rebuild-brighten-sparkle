-- wave-outbox-verdict-severity (2026-08-12)
--
-- apex-doctor Check #17 was scoped correctly and graded wrongly. It fired
-- CRITICAL whenever every push-eligible deal carried an error. Measured on this
-- date that was 3 deals / $3,835.68, and all three errors were the same class:
-- "no InsuraCloud credential exists for this producer". Two are Kolade Ayedun's,
-- one is Sam's own, 1 of 178 agents holds a token, and the attribution guard in
-- insuracloud-outbox correctly refuses to post one producer's deal under
-- another's session. No code change clears any of them; they resolve only when a
-- human harvests a per-agent connect.sid.
--
-- The set is also frozen. All 3 deals were created 2026-05-14, and the newest
-- native (non-agent_link) deal in the database is 2026-05-14T18:15 — Apex has
-- written no native deals in three months. So the old branch was scheduled to
-- page CRITICAL every Sunday, forever, about a static 3-row set nobody can fix
-- from a keyboard. That is the fifth costume of one disease in four days:
-- 36 false pages/day -> a gate that could not cry at all -> 39 true-but-
-- misleading pages/day -> a permanent-but-pointless Stripe CRITICAL -> this.
--
-- This view separates "broken" from "blocked on a person", and exposes the
-- recency of the eligible set so the check can escalate on MOVEMENT instead of
-- on a fixed count. New production getting stuck is still a CRITICAL; the frozen
-- backlog is a WARN that names the exact producers who must supply a credential.
--
-- Every column is a scalar subquery, so the view returns exactly one row in
-- every state including an empty deals table. It cannot go blank, and therefore
-- cannot go blank-green — the failure mode Check #19 was built on, where a view
-- that filtered to a 30-day window returned zero rows once the pipeline had been
-- dark for longer than the window and read as "nothing wrong".
create or replace view public.v_insuracloud_outbox_verdict as
select
  (select count(*)::int from public.v_insuracloud_push_eligible) as eligible,
  -- Credential-blocked: waiting on a human, not on code. These three strings are
  -- the exact errors insuracloud-outbox emits when it cannot resolve a token it
  -- is allowed to use for that producer.
  (select count(*)::int from public.v_insuracloud_push_eligible
     where insuracloud_sync_error is not null
       and (insuracloud_sync_error like 'No InsuraCloud credential exists anywhere%'
         or insuracloud_sync_error like 'Refusing to push:%'
         or insuracloud_sync_error = 'No InsuraCloud API token configured')) as credential_blocked,
  -- Anything else with an error is a genuine fault and still pages immediately.
  -- A novel error string must never be absorbed into the quiet bucket.
  (select count(*)::int from public.v_insuracloud_push_eligible
     where insuracloud_sync_error is not null
       and not (insuracloud_sync_error like 'No InsuraCloud credential exists anywhere%'
             or insuracloud_sync_error like 'Refusing to push:%'
             or insuracloud_sync_error = 'No InsuraCloud API token configured')) as genuine_failure,
  (select count(*)::int from public.v_insuracloud_push_eligible
     where insuracloud_sync_error is null) as pending_no_error,
  -- The escalation operand: if a deal created recently is stuck, that is live
  -- production going unsynced and outranks the frozen 2026-05-14 backlog.
  (select count(*)::int from public.v_insuracloud_push_eligible
     where created_at >= now() - interval '30 days') as eligible_last_30d,
  (select coalesce(sum(annual_premium),0)::numeric from public.v_insuracloud_push_eligible) as eligible_annual_premium,
  (select max(created_at) from public.v_insuracloud_push_eligible) as newest_eligible_at,
  -- Name the humans, not the uuids. The doctor line is only actionable if it
  -- says whose session has to be harvested.
  (select string_agg(distinct who, ', ')
     from (select coalesce(a.display_name, e.agent_id::text) as who
             from public.v_insuracloud_push_eligible e
             left join public.agents a on a.id = e.agent_id
            where e.insuracloud_sync_error is not null) s(who)) as blocked_producers;

comment on view public.v_insuracloud_outbox_verdict is
  'One-row verdict for apex-doctor Check #17. Splits push-eligible deals into credential_blocked (waiting on a human to harvest a per-agent connect.sid) vs genuine_failure (a real fault that pages). eligible_last_30d is the escalation operand so the check grades on movement, not on a frozen count.';
