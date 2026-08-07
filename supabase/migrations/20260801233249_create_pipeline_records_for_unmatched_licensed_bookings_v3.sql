-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".

-- v3: interview_events.match_method CHECK only allowed
-- instagram/email/phone/manual/none — admit 'booking_backfill' so linkage
-- provenance is honest, then create + link as in v2.

alter table public.interview_events
  drop constraint interview_events_match_method_check;
alter table public.interview_events
  add constraint interview_events_match_method_check
  check (match_method = any (array['instagram','email','phone','manual','none','booking_backfill']));

alter table public.applications disable trigger trg_applicant_autoprovision;
alter table public.applications disable trigger trg_applicant_first_dm;
alter table public.applications disable trigger trg_application_discord;
alter table public.applications disable trigger trg_apps_auto_seminar_register;
alter table public.applications disable trigger trg_auto_nipr_verify;
alter table public.applications disable trigger trg_dm_referral_manager;
alter table public.applications disable trigger trg_high_value_applicant_alert;
alter table public.applications disable trigger trg_inbox_new_applicant;
alter table public.applications disable trigger trg_manager_alerts_licensed_application;
alter table public.applications disable trigger trg_new_app_notify;
alter table public.applications disable trigger trg_post_new_applicant_to_onboarding_chat;
alter table public.applications disable trigger trg_bot_alert_licensed_app;
alter table public.applications disable trigger trg_calendly_for_unlicensed_ins;

with raw as (
  select ie.id,
         trim(split_part(ie.invitee_name, '/', 1))               as clean_name,
         lower(trim(split_part(ie.invitee_name, '/', 1)))        as norm_name,
         ie.invitee_phone,
         case when lower(coalesce(ie.invitee_email,'')) in
              ('n/a@gmail.com','name@noname.com','noname@noname.com','test@test.com','none@none.com','')
              then null else lower(trim(ie.invitee_email)) end   as real_email,
         nullif(lower(regexp_replace(coalesce(ie.instagram_handle,''),
              '^(https?://)?(www\.)?instagram\.com/|/+$|^@+', '', 'g')),'') as norm_ig,
         ie.invitee_status,
         ie.scheduled_at
  from public.interview_events ie
  where ie.application_id is null and ie.canceled_at is null
    and (ie.call_track = 'licensed' or public.fn_status_answer_indicates_licensed(ie.invitee_status))
    and length(trim(split_part(ie.invitee_name, '/', 1))) > 1
),
grp as (
  select norm_name,
         (array_agg(clean_name       order by scheduled_at desc))[1] as display_name,
         (array_agg(invitee_phone    order by scheduled_at desc) filter (where invitee_phone is not null))[1] as phone,
         (array_agg(real_email       order by scheduled_at desc) filter (where real_email is not null))[1]    as email,
         (array_agg(norm_ig          order by scheduled_at desc) filter (where norm_ig is not null))[1]       as ig,
         (array_agg(invitee_status   order by scheduled_at desc) filter (where invitee_status is not null))[1] as status_ans,
         min(scheduled_at) as first_booked,
         count(*)          as n_bookings
  from raw
  group by norm_name
),
ins as (
  insert into public.applications
    (first_name, last_name, email, phone, instagram_handle,
     license_status, licensed_at, source, notes)
  select
    split_part(g.display_name, ' ', 1),
    trim(substr(g.display_name, length(split_part(g.display_name, ' ', 1)) + 1)),
    coalesce(g.email, 'noname+' || substr(md5(g.norm_name), 1, 10) || '@noname.com'),
    g.phone,
    g.ig,
    'licensed'::license_status,
    g.first_booked,
    'calendly_licensed_call_backfill',
    'Created 2026-08-01 from ' || g.n_bookings || ' unmatched Licensed Call booking(s), first booked '
      || to_char(g.first_booked, 'YYYY-MM-DD')
      || coalesce('; status answer: ' || g.status_ans, '')
      || '. Never submitted the apply form — identity from the Calendly booking.'
  from grp g
  where not exists (
    select 1 from public.applications a
     where lower(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,''))) = g.norm_name)
  returning id, lower(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) as norm_name
)
update public.interview_events ie
   set application_id = ins.id,
       match_method   = 'booking_backfill'
  from ins
 where ie.application_id is null
   and ie.canceled_at is null
   and (ie.call_track = 'licensed' or public.fn_status_answer_indicates_licensed(ie.invitee_status))
   and lower(trim(split_part(ie.invitee_name, '/', 1))) = ins.norm_name;

alter table public.applications enable trigger trg_applicant_autoprovision;
alter table public.applications enable trigger trg_applicant_first_dm;
alter table public.applications enable trigger trg_application_discord;
alter table public.applications enable trigger trg_apps_auto_seminar_register;
alter table public.applications enable trigger trg_auto_nipr_verify;
alter table public.applications enable trigger trg_dm_referral_manager;
alter table public.applications enable trigger trg_high_value_applicant_alert;
alter table public.applications enable trigger trg_inbox_new_applicant;
alter table public.applications enable trigger trg_manager_alerts_licensed_application;
alter table public.applications enable trigger trg_new_app_notify;
alter table public.applications enable trigger trg_post_new_applicant_to_onboarding_chat;
alter table public.applications enable trigger trg_bot_alert_licensed_app;
alter table public.applications enable trigger trg_calendly_for_unlicensed_ins;

insert into public.manager_alerts (kind, payload)
select 'licensed_bookings_added_to_pipeline',
       jsonb_build_object(
         'count', count(*),
         'people', jsonb_agg(jsonb_build_object('application_id', a.id,
                     'name', a.first_name || ' ' || coalesce(a.last_name,''),
                     'phone', a.phone)),
         'note', 'Licensed Call bookings that never applied — created as licensed applications from booking identity')
  from public.applications a
 where a.source = 'calendly_licensed_call_backfill'
having count(*) > 0;
