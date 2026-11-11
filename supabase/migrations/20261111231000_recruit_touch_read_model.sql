-- recruit-touch-read-model (2026-11-11). One shared answer to "who was messaged, when, by what".
--
-- Why: Sam's "do it all yourself, conversion is the metric" went to five chats at once, and at
-- least three of them send to past recruits. Each kept its own idea of "last touch", so on
-- 2026-11-11 one licensed applicant got a one-to-one email from Sam at 00:05Z and the
-- reactivation campaign email at 00:12Z. Separately, notification_log shows the
-- "Still interested in APEX Financial?" re-engagement email went out 19,059 times to 72
-- applicants in June and 25,178 times to 379 in July (about 1 per person per month since August).
--
-- What this adds (read-only over the existing send ledgers; no sender changes, no new writes):
--   recruit_touch_kinds          registry: (source, key_pattern) -> campaign | ladder |
--                                transactional | staff | operational. A new campaign key is one
--                                INSERT, not DDL. Most specific (longest) pattern wins; anything
--                                unmatched reads 'unclassified' and is counted by doctor #53.
--   fn_recruit_touch_kind()      the classifier.
--   v_recruit_touches            one row per recorded send in the last 90 days, nine sources.
--   v_recruit_last_touch         one row per email: last campaign / ladder / any touch, 7-day
--                                campaign count, double_touch_72h.
--   fn_recruit_campaign_touch_ok(email, gap) -> true (no campaign touch inside the gap),
--                                false (there is one), NULL (could not look). Senders gate on it
--                                and treat NULL as do-not-send.
--
-- Counting rules that matter:
--   next_step_messages: parents only (fallback_of_id IS NULL). The dispatcher writes a fallback
--   child row and stamps the parent with the child's sent_at, so a child is not a second email.
--   magic_login_tokens: only rows with a send_status (a minted token is not a send).
--   notification_log: 'skipped' rows are consent/gateway refusals that reached nobody: excluded.
--   Only outcome = 'sent' counts as a touch in v_recruit_last_touch and the gate function.
--
-- Not covered: SMS sent through the carrier gateway has no provider receipt (has_receipt false);
-- anything a sender writes to a table not listed here; email_events (recipients are hashed).
--
-- Access: service role only. Revoked from public, anon, authenticated (rows carry addresses).

create table if not exists public.recruit_touch_kinds (
  source      text not null,
  key_pattern text not null,
  kind        text not null check (kind in ('campaign', 'ladder', 'transactional', 'staff', 'operational')),
  note        text,
  created_at  timestamptz not null default now(),
  primary key (source, key_pattern)
);
alter table public.recruit_touch_kinds enable row level security;
comment on table public.recruit_touch_kinds is
  'Classifies recorded sends for v_recruit_touches. Longest matching key_pattern (ILIKE) per source wins. Register a new campaign key with one INSERT. kind: campaign = outreach to past recruits; ladder = automated per-stage nudge; transactional = owed by an action the person took; staff = to Galaxy staff; operational = routine agent ops mail/texts.';

insert into public.recruit_touch_kinds (source, key_pattern, kind, note) values
  ('next_step_messages', 'reactivation%', 'campaign', 'Book of Business reactivation campaign (stage_key reactivation_*)'),
  ('next_step_messages', '%', 'ladder', 'every other next-step stage: applied, licensed_book_call, call_booked, contacted, hired, course_*, first_deal ...'),
  ('email_delivery_log', 'sam-licensed-followup-%', 'campaign', 'one-to-one emails from Sam to licensed never-hired applicants (2026-11-10)'),
  ('email_delivery_log', 'sam-aisha-%', 'staff', 'notes to Aisha'),
  ('email_delivery_log', 'submit-application-admin', 'staff', 'new-application alert to staff'),
  ('email_delivery_log', 'submit-application-applicant', 'transactional', 'day-0 welcome after applying'),
  ('email_delivery_log', 'seminar-confirmation', 'transactional', 'seminar booking confirmation'),
  ('email_delivery_log', 'followup-%', 'ladder', 'send-followup-emails day-1 / day-3 / follow-up nudges'),
  ('outreach_queue', 'sam_comeback%', 'campaign', 'June 2026 comeback blast'),
  ('outreach_queue', 'interview_last_call%', 'campaign', 'June 2026 last-call blast'),
  ('outreach_queue', 'reissue-%', 'campaign', 're-sends to 40-day-old prospects'),
  ('outreach_queue', 'prospect-%', 'campaign', 'prospect outreach (email / WhatsApp)'),
  ('outreach_queue', 'gap-apply-ack%', 'transactional', 'application acknowledgement'),
  ('outreach_queue', 'calendly%invite%', 'transactional', 'booking invite'),
  ('outreach_queue', 'applicant-onboarding%', 'ladder', 'day-0 roadmap (retired by WP2, rows superseded)'),
  ('outreach_queue', 'gap-course-%', 'ladder', 'course progress nudges'),
  ('agent_onboarding_queue', 'onboarding_call_reminder%', 'ladder', 'new-hire onboarding-call reminders d2/d5/d10'),
  ('agent_onboarding_queue', '%', 'transactional', 'new-hire onboarding mail: course, Slack invite (email_kind discord), get_licensed, onboarding_call, scripts_packet'),
  ('magic_login_tokens', '%', 'transactional', 'portal / numbers / course login links (rows with a send receipt only)'),
  ('applicant_touchpoints', '%', 'ladder', 'legacy day0/3/7/14 applicant sequence (last send 2026-09-07)'),
  ('contact_history', 'email:licensing_sequence%', 'campaign', 'licensing drip (767-email burst 2026-10-14; paused)'),
  ('notification_log', 'email:Still interested in%', 'campaign', 're-engagement question sent by send-notification'),
  ('notification_log', 'email:%magic login%', 'transactional', 'dashboard login link'),
  ('notification_log', 'email:%one-click login%', 'transactional', 'dashboard login link'),
  ('notification_log', 'email:%dashboard is ready%', 'transactional', 'dashboard ready'),
  ('notification_log', 'email:contracting_followup', 'ladder', 'contracting reminder to agents'),
  ('notification_log', 'email:Deal broadcast', 'operational', 'deal broadcast to agents'),
  ('notification_log', 'sms:%', 'operational', 'texts to agents'),
  ('notification_log', 'sms-auto:%', 'operational', 'carrier-gateway texts (numbers reminders, milestones); no provider receipts'),
  ('notification_log', 'push:%', 'operational', 'app push to agents and staff'),
  ('numbers_reminder_delivery_log', '%', 'operational', 'nightly numbers reminder to agents')
on conflict (source, key_pattern) do nothing;

create or replace function public.fn_recruit_touch_kind(p_source text, p_key text)
returns text
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(
    (select k.kind
       from public.recruit_touch_kinds k
      where k.source = p_source
        and coalesce(p_key, '') ilike k.key_pattern
      order by length(k.key_pattern) desc, k.key_pattern
      limit 1),
    'unclassified')
$fn$;

create or replace view public.v_recruit_touches with (security_invoker = true) as
with raw as (
  -- 1. next-step messages: parents only
  select case when m.agent_id is not null then 'agent' else 'applicant' end as person_kind,
         m.application_id,
         m.agent_id,
         lower(btrim(coalesce(case when m.channel = 'email' and m.recipient like '%@%' then m.recipient end,
                              a.email, pa.email))) as email_lower,
         coalesce(nullif(btrim(a.first_name), ''), split_part(coalesce(pa.full_name, ''), ' ', 1)) as first_name,
         m.channel,
         'next_step_messages'::text as source,
         coalesce(m.stage_key, '') as source_key,
         coalesce(m.sent_at, m.failed_at, m.created_at) as sent_at,
         case when m.sent_at is not null then 'sent' when m.failed_at is not null then 'failed' else 'unknown' end as outcome,
         (m.external_id is not null) as has_receipt
    from public.next_step_messages m
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

create or replace view public.v_recruit_last_touch with (security_invoker = true) as
with t as (
  select * from public.v_recruit_touches
   where outcome = 'sent' and email_lower is not null and email_lower <> ''
), gaps as (
  select email_lower,
         sent_at - lag(sent_at) over (partition by email_lower order by sent_at) as gap
    from t
   where kind = 'campaign' and sent_at > now() - interval '7 days'
), dbl as (
  select email_lower, bool_or(gap < interval '72 hours') as double_touch_72h
    from gaps group by email_lower
)
select t.email_lower,
       max(t.first_name) as first_name,
       max(t.sent_at) filter (where t.kind = 'campaign') as last_campaign_at,
       (array_agg(t.source_key order by t.sent_at desc) filter (where t.kind = 'campaign'))[1] as last_campaign_source_key,
       (array_agg(t.source order by t.sent_at desc) filter (where t.kind = 'campaign'))[1] as last_campaign_source,
       max(t.sent_at) filter (where t.kind = 'ladder') as last_ladder_at,
       max(t.sent_at) as last_any_at,
       (count(*) filter (where t.kind = 'campaign' and t.sent_at > now() - interval '7 days'))::int as campaign_touches_7d,
       coalesce(max(dbl.double_touch_72h::int)::boolean, false) as double_touch_72h
  from t
  left join dbl on dbl.email_lower = t.email_lower
 group by t.email_lower;

comment on view public.v_recruit_last_touch is
  'One row per recipient email: last campaign / ladder / any touch (sent only), campaign touches in 7 days, and double_touch_72h (two campaign touches under 72h apart inside the last 7 days). Service role only.';

create or replace function public.fn_recruit_campaign_touch_ok(p_email text, p_min_gap interval default interval '7 days')
returns boolean
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_hit boolean;
begin
  if p_email is null or btrim(p_email) = '' or p_min_gap is null then
    return null;
  end if;
  select exists (
    select 1 from public.v_recruit_touches t
     where t.email_lower = lower(btrim(p_email))
       and t.kind = 'campaign'
       and t.outcome = 'sent'
       and t.sent_at > now() - p_min_gap
  ) into v_hit;
  return not v_hit;
exception when others then
  -- "Could not look" must never read as "ok to send".
  raise warning 'fn_recruit_campaign_touch_ok could not look: %', sqlerrm;
  return null;
end
$fn$;

comment on function public.fn_recruit_campaign_touch_ok(text, interval) is
  'true = no campaign touch to this email inside p_min_gap (default 7 days); false = there is one; NULL = could not look (treat as do-not-send).';

revoke all on table public.recruit_touch_kinds from public, anon, authenticated;
revoke all on public.v_recruit_touches from public, anon, authenticated;
revoke all on public.v_recruit_last_touch from public, anon, authenticated;
revoke all on function public.fn_recruit_touch_kind(text, text) from public, anon, authenticated;
revoke all on function public.fn_recruit_campaign_touch_ok(text, interval) from public, anon, authenticated;
