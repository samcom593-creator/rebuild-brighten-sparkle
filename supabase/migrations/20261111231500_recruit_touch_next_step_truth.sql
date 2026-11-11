-- recruit-touch next-step truth (2026-11-11). Follow-up to 20261111231000_recruit_touch_read_model.
--
-- The next-step dispatcher tries Telegram, then SMS, then email, and stamps the PARENT row with the
-- sent_at of whichever fallback child delivered. v_recruit_touches read channel and receipt off the
-- parent, so 202 parents reported channel 'telegram' with no receipt when a fallback EMAIL child
-- actually delivered with a Resend id, and a carrier-gateway marker ('gateway:<carrier>') counted as
-- a provider receipt. Peer samjames-13 flagged the reactivation rows; measured before changing:
--   * the 2 reactivation parents with email_rung = 'skipped_terminal' carry numeric Telegram message
--     ids (1683, 1684, 11-11 17:00Z), so those people WERE reached, by Telegram: still a touch.
--   * the gateway SMS parent (email bounced) has no provider receipt: still counted as a touch (a
--     gateway send usually lands and the gate must err toward holding), but has_receipt is now false.
-- Counting is unchanged (a parent is a touch when sent_at is set). Only channel, the address used
-- and has_receipt now come from the row that delivered. No column change, so senders are unaffected.

create or replace view public.v_recruit_touches with (security_invoker = true) as
with delivered_child as (
  -- The row that actually delivered: a parent's latest sent fallback child (one pass, no per-row
  -- lookup; next_step_messages has no index on fallback_of_id).
  select distinct on (c.fallback_of_id) c.fallback_of_id, c.channel, c.recipient, c.external_id
    from public.next_step_messages c
   where c.fallback_of_id is not null
     and c.sent_at is not null
     and c.created_at > now() - interval '91 days'
   order by c.fallback_of_id, c.sent_at desc
), raw as (
  -- 1. next-step messages: parents only; channel / address / receipt from the row that delivered
  select case when m.agent_id is not null then 'agent' else 'applicant' end as person_kind,
         m.application_id,
         m.agent_id,
         lower(btrim(coalesce(case when dc.recipient like '%@%' then dc.recipient end,
                              case when m.recipient like '%@%' then m.recipient end,
                              a.email, pa.email))) as email_lower,
         coalesce(nullif(btrim(a.first_name), ''), split_part(coalesce(pa.full_name, ''), ' ', 1)) as first_name,
         coalesce(dc.channel, m.channel) as channel,
         'next_step_messages'::text as source,
         coalesce(m.stage_key, '') as source_key,
         coalesce(m.sent_at, m.failed_at, m.created_at) as sent_at,
         case when m.sent_at is not null then 'sent' when m.failed_at is not null then 'failed' else 'unknown' end as outcome,
         (coalesce(dc.external_id, m.external_id) is not null
            and coalesce(dc.external_id, m.external_id) not like 'gateway:%') as has_receipt
    from public.next_step_messages m
    left join delivered_child dc on dc.fallback_of_id = m.id
    left join public.applications a on a.id = m.application_id
    left join public.agents ag on ag.id = m.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where m.fallback_of_id is null
     and m.created_at > now() - interval '90 days'
  union all
  -- 2. email_delivery_log
  select case when e.agent_id is not null then 'agent' else 'applicant' end,
         case when e.related_record_type = 'application' then e.related_record_id end,
         e.agent_id,
         lower(btrim(e.recipient_email)),
         coalesce(nullif(btrim(a.first_name), ''), split_part(coalesce(pa.full_name, ''), ' ', 1)),
         'email',
         'email_delivery_log',
         coalesce(e.template, ''),
         coalesce(e.sent_at, e.created_at),
         case when e.status in ('sent', 'delivered') then 'sent'
              when e.status in ('error', 'failed', 'bounced') then 'failed'
              when e.status in ('skipped', 'refused', 'suppressed') then 'refused'
              else 'unknown' end,
         (e.provider_message_id is not null)
    from public.email_delivery_log e
    left join public.applications a on a.id = case when e.related_record_type = 'application' then e.related_record_id end
    left join public.agents ag on ag.id = e.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where e.created_at > now() - interval '90 days'
  union all
  -- 3. outreach_queue
  select case when o.agent_id is not null then 'agent' else 'applicant' end,
         o.application_id,
         o.agent_id,
         lower(btrim(coalesce(o.to_email, a.email))),
         nullif(btrim(a.first_name), ''),
         o.channel,
         'outreach_queue',
         coalesce(o.template_key, ''),
         coalesce(o.sent_at, o.last_attempted_at, o.created_at),
         case when o.sent_at is not null then 'sent'
              when o.status in ('failed', 'error') then 'failed'
              when o.status in ('skipped', 'superseded', 'expired_undelivered', 'cancelled', 'suppressed', 'do_not_contact') then 'refused'
              else 'unknown' end,
         (o.provider_message_id is not null)
    from public.outreach_queue o
    left join public.applications a on a.id = o.application_id
   where o.created_at > now() - interval '90 days'
  union all
  -- 4. agent_onboarding_queue (new-hire onboarding mail)
  select 'agent',
         ag.source_application_id,
         q.agent_id,
         lower(btrim(pa.email)),
         split_part(coalesce(pa.full_name, ag.display_name, ''), ' ', 1),
         'email',
         'agent_onboarding_queue',
         coalesce(q.email_kind, ''),
         coalesce(q.sent_at, q.target_send_at, q.created_at),
         case when q.sent_at is not null then 'sent'
              when q.last_error ilike 'skipped%' or q.last_error ilike 'terminal%' or q.last_error ilike '%rollback%' or q.last_error ilike 'refused%' then 'refused'
              when q.last_error is not null then 'failed'
              else 'unknown' end,
         (q.resend_message_id is not null)
    from public.agent_onboarding_queue q
    left join public.agents ag on ag.id = q.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where q.created_at > now() - interval '90 days'
  union all
  -- 5. magic_login_tokens (only rows that recorded a send)
  select case when t.agent_id is not null then 'agent' else 'applicant' end,
         null::uuid,
         t.agent_id,
         lower(btrim(t.email)),
         split_part(coalesce(pa.full_name, ''), ' ', 1),
         'email',
         'magic_login_tokens',
         coalesce(t.destination, ''),
         coalesce(t.sent_at, t.created_at),
         case when t.send_status = 'sent' then 'sent'
              when t.send_status = 'failed' then 'failed'
              when t.send_status = 'refused' then 'refused'
              else 'unknown' end,
         (t.send_message_id is not null)
    from public.magic_login_tokens t
    left join public.agents ag on ag.id = t.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where t.send_status is not null
     and t.created_at > now() - interval '90 days'
  union all
  -- 6. applicant_touchpoints (legacy applicant sequence)
  select 'applicant',
         tp.application_id,
         null::uuid,
         lower(btrim(a.email)),
         nullif(btrim(a.first_name), ''),
         coalesce(tp.channel, 'email'),
         'applicant_touchpoints',
         coalesce(tp.touch_type, ''),
         tp.sent_at,
         case when tp.ok then 'sent' else 'failed' end,
         false
    from public.applicant_touchpoints tp
    left join public.applications a on a.id = tp.application_id
   where tp.sent_at > now() - interval '90 days'
  union all
  -- 7. contact_history (automated email records only)
  select case when ch.agent_id is not null then 'agent' else 'applicant' end,
         ch.application_id,
         ch.agent_id,
         lower(btrim(coalesce(a.email, pa.email))),
         coalesce(nullif(btrim(a.first_name), ''), split_part(coalesce(pa.full_name, ''), ' ', 1)),
         'email',
         'contact_history',
         'email:' || coalesce(ch.email_template, ''),
         ch.created_at,
         'sent',
         false
    from public.contact_history ch
    left join public.applications a on a.id = ch.application_id
    left join public.agents ag on ag.id = ch.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where ch.contact_type = 'email'
     and ch.created_at > now() - interval '90 days'
  union all
  -- 8. notification_log (refused 'skipped' attempts reached nobody: excluded)
  select case when n.agent_id is not null then 'agent' else 'unknown' end,
         null::uuid,
         n.agent_id,
         lower(btrim(coalesce(n.recipient_email, pu.email))),
         split_part(coalesce(pu.full_name, ''), ' ', 1),
         n.channel,
         'notification_log',
         coalesce(n.channel, '') || ':' || coalesce(nullif(n.notification_type, ''), coalesce(n.title, n.subject, '')),
         n.created_at,
         case when n.status in ('sent', 'delivered') then 'sent'
              when n.status = 'failed' then 'failed'
              else 'unknown' end,
         false
    from public.notification_log n
    left join public.profiles pu on pu.user_id = n.recipient_user_id
   where n.created_at > now() - interval '90 days'
     and coalesce(n.status, '') <> 'skipped'
  union all
  -- 9. numbers_reminder_delivery_log (nightly agent numbers reminder)
  select 'agent',
         null::uuid,
         r.agent_id,
         lower(btrim(r.email)),
         split_part(coalesce(pa.full_name, ag.display_name, ''), ' ', 1),
         'email',
         'numbers_reminder_delivery_log',
         'numbers_reminder',
         coalesce(r.sent_at, r.updated_at),
         case when r.email_status = 'sent' then 'sent'
              when r.email_status = 'failed' then 'failed'
              when r.email_status in ('skipped', 'refused') then 'refused'
              else 'unknown' end,
         (r.email_receipt is not null)
    from public.numbers_reminder_delivery_log r
    left join public.agents ag on ag.id = r.agent_id
    left join public.profiles pa on pa.user_id = ag.user_id
   where coalesce(r.sent_at, r.updated_at) > now() - interval '90 days'
)
select raw.person_kind,
       raw.application_id,
       raw.agent_id,
       raw.email_lower,
       raw.first_name,
       raw.channel,
       raw.source,
       raw.source_key,
       public.fn_recruit_touch_kind(raw.source, raw.source_key) as kind,
       raw.sent_at,
       raw.outcome,
       raw.has_receipt
  from raw;

comment on view public.v_recruit_touches is
  'One row per recorded send in the last 90 days across 9 ledgers, classified by recruit_touch_kinds. Parents only for next_step_messages. Service role only.';

revoke all on public.v_recruit_touches from public, anon, authenticated;
