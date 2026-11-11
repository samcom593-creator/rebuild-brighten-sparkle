-- 20261112140517_reactivation_v2_claim_alias_fix.sql
-- MP-BOB-CONVERSION v2: the first armed tick (2026-11-11 23:00Z) failed with `record "r" is not assigned yet`.
-- 20261112131529 added a STOP-rate query to fn_reactivation_claim_next that aliased reactivation_replies as `r`,
-- and the function also declares a loop record named `r`: PL/pgSQL bound r.application_id to the unassigned
-- variable. Nothing was sent (the tick rolls back as one unit; the engine was paused at 23:01Z). Fixed by renaming
-- the alias (rp) and the loop record (cand), so no single-letter record is left for a later alias to shadow.
-- Proven before re-arming by executing fn_reactivation_dispatch_inner() with the cap raised inside a transaction
-- that is rolled back (pg_net only sends requests committed to net.http_request_queue).
-- Hand-applied with bot-sql and recorded in schema_migrations together with this file landing on main.

begin;

create or replace function public.fn_reactivation_claim_next()
returns table(application_id uuid, touch smallint, track text, variant text, email text, first_name text,
              last_name text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_sent_today int; v_n int; v_bounced int; v_complained int;
  v_cov_n int; v_cov_hit int; v_sent7 int; v_stop7 int; v_fail1h int;
  v_poll timestamptz; v_b record; v_guard text;
  cand record; v_gate text; v_track text; v_variant text;
begin
  select coalesce(nullif(btrim(s.value), '')::int, 0) into v_cap from public.system_settings s where s.key = 'reactivation_daily_cap';
  v_cap := coalesce(v_cap, 0);
  if v_cap <= 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_cap_0'::text;
    return;
  end if;
  v_guard := public.fn_reactivation_canary_guard(v_cap);
  if v_guard is not null then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, v_guard;
    return;
  end if;
  select * into v_b from public.fn_reactivation_breaker_state();
  if v_b.is_open then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text,
                        ('paused_breaker: ' || coalesce(v_b.reason, '?'))::text;
    return;
  end if;
  if exists (select 1 from public.reactivation_sequence s where s.status = 'active' and s.claimed_at is not null) then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'claim_outstanding'::text;
    return;
  end if;
  v_poll := public.fn_reactivation_reply_last_ok();
  if v_poll is null or v_poll < now() - interval '24 hours' then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_reply_reader_stale'::text;
    return;
  end if;
  select count(*) into v_sent_today from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and (m.sent_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date;
  if v_sent_today >= v_cap then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'daily_cap_reached'::text;
    return;
  end if;
  select count(*), count(*) filter (where e.last_event = 'bounced'), count(*) filter (where e.last_event = 'complained')
    into v_n, v_bounced, v_complained
    from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days';
  if v_complained > 0 then
    perform public.fn_reactivation_trip('spam complaint on a reactivation email', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_complaint'::text;
    return;
  end if;
  if v_n >= 25 and v_bounced::numeric / v_n >= 0.08 then
    perform public.fn_reactivation_trip('bounce rate ' || v_bounced || ' of ' || v_n || ' in 14 days', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_bounce_8pct'::text;
    return;
  end if;
  select count(*), count(e.resend_id) into v_cov_n, v_cov_hit
    from public.next_step_messages m left join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and m.sent_at >= now() - interval '7 days' and m.sent_at < now() - interval '2 hours';
  if v_cov_n >= 5 and v_cov_hit::numeric / v_cov_n < 0.5 then
    perform public.fn_reactivation_trip('events_blind: ' || v_cov_hit || ' of ' || v_cov_n || ' sends have a provider event', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_events_blind'::text;
    return;
  end if;
  select count(*) into v_sent7 from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at >= now() - interval '7 days';
  select count(*) into v_stop7 from public.reactivation_replies rp
   where rp.classification = 'stop' and rp.created_at >= now() - interval '7 days'
     and exists (select 1 from public.next_step_messages m
                  where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
                    and (m.application_id = rp.application_id or lower(btrim(m.recipient)) = rp.email_lower));
  if v_sent7 >= 20 and v_stop7::numeric / v_sent7 >= 0.05 then
    perform public.fn_reactivation_trip('stop_rate: ' || v_stop7 || ' STOP replies on ' || v_sent7 || ' sends in 7 days', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_stop_rate'::text;
    return;
  end if;
  select count(*) into v_fail1h from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.failed_at >= now() - interval '1 hour'
     and coalesce((m.metadata->>'retryable')::boolean, false);
  if v_fail1h >= 3 then
    perform public.fn_reactivation_trip(v_fail1h || ' retryable send failures in 1 hour', interval '1 hour');
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_failures'::text;
    return;
  end if;

  for cand in
    select s.application_id, s.current_touch, s.track, s.variant, s.enrolled_at, a.email, a.first_name, a.last_name, a.state
      from public.reactivation_sequence s join public.applications a on a.id = s.application_id
     where s.status = 'active' and s.next_due_at <= now() and s.claimed_at is null
     order by s.current_touch desc, s.next_due_at
     limit 40
       for update of s skip locked
  loop
    if not public.fn_reactivation_in_window(cand.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(cand.application_id, cand.enrolled_at);
    if v_gate is null then
      update public.reactivation_sequence set claimed_at = now(), claim_request_id = null, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
      return query select cand.application_id, (cand.current_touch + 1)::smallint, cand.track, cand.variant, cand.email::text,
                          cand.first_name::text, cand.last_name::text, 'claimed'::text;
      return;
    elsif v_gate like 'hold:%' then
      update public.reactivation_sequence set next_due_at = now() + interval '6 hours', last_error = v_gate, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
    else
      update public.reactivation_sequence set status = 'stopped', stop_reason = v_gate, claimed_at = null, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
    end if;
  end loop;

  for cand in
    select c.application_id, c.email, c.first_name, c.last_name, c.state, c.track
      from public.v_reactivation_cohort c
     where not exists (select 1 from public.reactivation_sequence s
                        where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))
     order by c.send_rank
     limit 40
  loop
    if not public.fn_reactivation_in_window(cand.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(cand.application_id, null);
    v_track := coalesce(cand.track, public.fn_reactivation_track(cand.application_id));
    v_variant := public.fn_reactivation_variant(cand.application_id);
    insert into public.reactivation_sequence (application_id, email_lower, track, variant, current_touch, next_due_at,
                                              status, stop_reason, enrolled_from, claimed_at)
    values (cand.application_id, lower(btrim(cand.email)), v_track, v_variant, 0,
            case when v_gate like 'hold:%' then now() + interval '6 hours' else now() end,
            case when v_gate is null or v_gate like 'hold:%' then 'active' else 'stopped' end,
            case when v_gate is null or v_gate like 'hold:%' then null else v_gate end,
            'cohort', case when v_gate is null then now() else null end)
    on conflict do nothing;
    if v_gate is null and found then
      return query select cand.application_id, 1::smallint, v_track, v_variant, cand.email::text,
                          cand.first_name::text, cand.last_name::text, 'claimed_new'::text;
      return;
    end if;
  end loop;
  return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'nothing_due'::text;
end $$;

revoke all on function public.fn_reactivation_claim_next() from public, anon, authenticated;
grant execute on function public.fn_reactivation_claim_next() to service_role;

commit;
