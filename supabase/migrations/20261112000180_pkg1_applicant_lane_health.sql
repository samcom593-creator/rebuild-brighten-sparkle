-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 9/9: health read model for apex-doctor drop-in 54.
--
-- WHAT
--   public.v_applicant_lane_pkg1_health: ONE row in every state (scalar subqueries over a
--   SECURITY DEFINER function, never blank-green). Graded operands are things this package
--   controls, measured only for activity after fn_anchor_pkg1_cutoff() so history from before
--   the fix can never pin the check yellow:
--     ladder_email_no_reply_to_24h  ladder emails in 24h whose child row records no live
--                                   Reply-To (next-step-dispatch writes metadata.reply_to)
--     retry_overdue_1h              rows left retryable/deferred whose not_before passed more
--                                   than 1 hour ago (the drain stopped, or the cron is gone)
--     suspended_messaged_7d         applicant-stage emails in 7d to a login whose suspension
--                                   was already open when the email went out
--     same_day_double_7d            recipient-days in 7d with 2+ automated applicant emails
--                                   (ladder emails + the day-0 welcome), in the recipient's zone
--   plus structure (gate, claim, drain cron, cron 108 gone, sweep gate, dead mailto, cadence,
--   Telegram opt-outs) and published context (sends, skips by reason, deferrals, retries,
--   re-applications made live, post-call and re-arm sends). The welcome email's Reply-To is
--   set in code (submit-application) and is not recorded per send, so it is NOT measured here;
--   welcome.test.ts and the vitest contract hold it.
-- ROLLBACK
--   drop view public.v_applicant_lane_pkg1_health; drop function public.fn_applicant_lane_pkg1_health();

create or replace function public.fn_applicant_lane_pkg1_health()
returns table (
  cutoff_at                       timestamptz,
  gate_fn_present                 boolean,
  claim_fn_present                boolean,
  drain_cron_active               boolean,
  followup_cron_present           boolean,
  sweep_gate_present              boolean,
  dead_mailto_pkg1_stages         integer,
  dead_mailto_other_stages        integer,
  cadence_ok                      boolean,
  telegram_linked_not_optout      integer,
  ladder_email_no_reply_to_24h    integer,
  retry_overdue_1h                integer,
  retry_pending                   integer,
  suspended_messaged_7d           integer,
  same_day_double_7d              integer,
  welcome_sent_24h                integer,
  ladder_emails_24h               integer,
  skips_7d                        jsonb,
  deferred_7d                     integer,
  gave_up_7d                      integer,
  reapplications_live_since       integer,
  postcall_sent_since             integer,
  rearm_sent_since                integer,
  measured_at                     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select public.fn_anchor_pkg1_cutoff() as cutoff
  ), pkg1_stages as (
    select unnest(array['applied', 'watched_vsl', 'completed_application', 'contacted', 'licensed_book_call',
                        'call_booked', 'booked_seminar', 'attended_seminar']) as stage_key
  ), applicant_email_children as (
    -- email children of applicant-audience stages, with the recipient's zone
    select c.id, c.sent_at, lower(btrim(c.recipient)) as recipient, c.metadata,
           coalesce(p.metadata->'send_zones'->>0,
                    (public.fn_next_step_send_zones(c.application_id, c.agent_id))[1],
                    'America/Chicago') as zone
      from public.next_step_messages c
      join public.next_step_stages s on s.stage_key = c.stage_key and s.audience in ('applicant', 'both')
      left join public.next_step_messages p on p.id = c.fallback_of_id
      cross join cfg
     where c.channel = 'email' and c.sent_at is not null and c.fallback_of_id is not null
       and c.sent_at >= greatest(cfg.cutoff, now() - interval '7 days')
  ), welcome as (
    select l.sent_at, lower(btrim(l.recipient_email)) as recipient,
           coalesce((public.fn_next_step_send_zones(l.related_record_id, null))[1], 'America/Chicago') as zone
      from public.email_delivery_log l cross join cfg
     where l.template = 'submit-application-applicant' and l.status = 'sent'
       and l.sent_at >= greatest(cfg.cutoff, now() - interval '7 days')
  ), automated as (
    select recipient, (sent_at at time zone zone)::date as local_day from applicant_email_children
    union all
    select recipient, (sent_at at time zone zone)::date from welcome
  )
  select
    cfg.cutoff,
    to_regprocedure('public.fn_next_step_send_gate(uuid,text)') is not null,
    to_regprocedure('public.fn_next_step_claim(uuid)') is not null,
    exists (select 1 from cron.job j where j.jobname = 'next_step_retry_drain' and j.active),
    exists (select 1 from cron.job j where j.jobname = 'apex-followup-emails-daily'),
    strpos(pg_get_functiondef('public.fn_next_step_nudge_sweep()'::regprocedure), 'fn_anchor_pkg1_cutoff') > 0,
    (select count(*)::int from public.next_step_stages s join pkg1_stages k using (stage_key)
      where strpos(coalesce(s.email_body_template, ''), 'mailto:hello@apex-financial.org') > 0),
    (select count(*)::int from public.next_step_stages s
      where s.stage_key not in (select stage_key from pkg1_stages)
        and strpos(coalesce(s.email_body_template, ''), 'mailto:hello@apex-financial.org') > 0),
    coalesce((select bool_and(case s.stage_key
                                 when 'call_booked' then s.reminder_cadence = 'hour:24'
                                 else s.reminder_cadence = 'hour:24,72,168' end)
                from public.next_step_stages s
               where s.stage_key in ('applied', 'licensed_book_call', 'call_booked')), false),
    (select count(*)::int from public.applications a
      where a.telegram_chat_id is not null and not coalesce(a.telegram_opt_out, false)),
    (select count(*)::int from public.next_step_messages c
      where c.channel = 'email' and c.fallback_of_id is not null
        and c.sent_at >= now() - interval '24 hours' and c.created_at >= cfg.cutoff
        and (coalesce(c.metadata->>'reply_to', '') = ''
             or lower(c.metadata->>'reply_to') like '%@apex-financial.org%')),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.sent_at is null and m.failed_at is null
        and m.created_at >= cfg.cutoff and m.metadata ? 'not_before'
        and (m.metadata->>'not_before')::timestamptz < now() - interval '1 hour'),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.sent_at is null and m.failed_at is null
        and m.created_at >= cfg.cutoff and m.metadata ? 'not_before'),
    (select count(*)::int from applicant_email_children c
      where exists (
        select 1 from public.agent_access_suspensions s
         where s.suspended_at <= c.sent_at and (s.lifted_at is null or s.lifted_at > c.sent_at)
           and s.user_id in (select p.user_id from public.profiles p where lower(btrim(p.email)) = c.recipient
                             union select u.id from auth.users u where lower(btrim(u.email)) = c.recipient))),
    (select count(*)::int from (select recipient, local_day from automated
                                 group by recipient, local_day having count(*) >= 2) d),
    (select count(*)::int from public.email_delivery_log l
      where l.template = 'submit-application-applicant' and l.status = 'sent'
        and l.sent_at >= now() - interval '24 hours'),
    (select count(*)::int from public.next_step_messages c
      where c.channel = 'email' and c.fallback_of_id is not null and c.sent_at >= now() - interval '24 hours'),
    coalesce((select jsonb_object_agg(r, n) from (
                select m.metadata->>'skip_reason' as r, count(*) as n
                  from public.next_step_messages m
                 where m.fallback_of_id is null and m.failed_at >= greatest(cfg.cutoff, now() - interval '7 days')
                   and m.metadata ? 'skip_reason'
                 group by 1) x), '{}'::jsonb),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.created_at >= greatest(cfg.cutoff, now() - interval '7 days')
        and m.metadata ? 'deferred'),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.failed_at >= greatest(cfg.cutoff, now() - interval '7 days')
        and m.error like 'gave up after%'),
    (select count(*)::int from public.applications a
      where a.created_at >= cfg.cutoff and 'reapplication' = any (coalesce(a.tags, '{}'::text[]))
        and a.is_duplicate is not true),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.stage_key = 'call_booked' and m.sent_at is not null
        and m.created_at >= cfg.cutoff),
    (select count(*)::int from public.next_step_messages m
      where m.fallback_of_id is null and m.metadata->>'variant' = 'rearm' and m.sent_at is not null),
    now()
  from cfg
$$;

comment on function public.fn_applicant_lane_pkg1_health() is
  'MP-ONBOARD-ANCHOR-PKG1: one-row health read model behind v_applicant_lane_pkg1_health (apex-doctor drop-in 54-applicant-lane.sh). Service role only.';

revoke all on function public.fn_applicant_lane_pkg1_health() from public, anon, authenticated;
grant execute on function public.fn_applicant_lane_pkg1_health() to service_role;

create or replace view public.v_applicant_lane_pkg1_health
with (security_invoker = true) as
select h.* from public.fn_applicant_lane_pkg1_health() h;

comment on view public.v_applicant_lane_pkg1_health is
  'MP-ONBOARD-ANCHOR-PKG1: one row in every state. Read by ~/business-ops/scripts/apex-doctor.d/54-applicant-lane.sh.';

revoke all on public.v_applicant_lane_pkg1_health from public, anon, authenticated;
grant select on public.v_applicant_lane_pkg1_health to service_role;
