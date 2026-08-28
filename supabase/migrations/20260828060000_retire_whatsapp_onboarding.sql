-- Retire WhatsApp from licensed + unlicensed onboarding without erasing
-- historical delivery receipts. Slack is the agent-facing workspace; the
-- legacy `discord` queue kind now represents the primary community email,
-- while the private Discord remains an internal contracting destination.

-- Pending legacy rows become terminal and unsendable. sent_at stays NULL so
-- the database never claims these messages were delivered.
update public.agent_onboarding_queue
set attempt_count = 5,
    last_error = 'retired_channel: WhatsApp removed from onboarding; use Slack'
where email_kind = 'hired_whatsapp'
  and sent_at is null
  and attempt_count < 5;

update public.outreach_queue
set status = 'skipped',
    attempt_count = greatest(attempt_count, 3),
    last_error = 'retired_channel: WhatsApp removed from onboarding; use Slack',
    error_message = 'retired_channel: WhatsApp removed from onboarding; use Slack'
where sent_at is null
  and status in ('pending', 'snoozed', 'error')
  and (
    source_run in ('prospect_whatsapp', 'prospect-combined')
    or template_key in ('prospect-whatsapp-v1', 'prospect-combined-v1')
  );

-- One durable unlicensed applicant email: account/course setup, live roadmap,
-- Slack, and the support call. No retired-channel lookup or CTA remains.
create or replace function public.fn_enqueue_calendly_for_unlicensed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_calendly_url text;
  v_slack_url text;
  v_discord_url text;
  v_first_name text;
  v_html text;
begin
  if new.email is null or new.email = '' or position('@' in new.email) = 0 then
    return new;
  end if;

  if new.license_status is not null
     and lower(new.license_status::text) <> 'unlicensed' then
    return new;
  end if;

  select value into v_calendly_url
  from public.system_settings
  where key = 'seminar_calendly_url'
  limit 1;
  v_calendly_url := coalesce(
    nullif(trim(both '"' from v_calendly_url), ''),
    'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone'
  );

  select value into v_slack_url
  from public.system_settings
  where key = 'slack_community_invite_url'
  limit 1;
  v_slack_url := coalesce(
    nullif(trim(both '"' from v_slack_url), ''),
    'https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ'
  );

  select value into v_discord_url
  from public.system_settings
  where key = 'discord_invite_url'
  limit 1;
  v_discord_url := coalesce(
    nullif(trim(both '"' from v_discord_url), ''),
    'https://discord.gg/JpUWA73UZX'
  );

  v_first_name := split_part(coalesce(new.first_name, 'there'), ' ', 1);
  v_html := '<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#1a1a2e;border-radius:14px;padding:28px;border:1px solid rgba(20,184,166,0.25);">
      <h1 style="font-size:21px;margin:0 0 14px;color:#fff;">Hey ' || v_first_name || ', here is your licensing roadmap</h1>
      <p style="font-size:15px;line-height:1.6;color:#d1d5db;">Complete these steps in order:</p>
      <ol style="font-size:14px;line-height:1.9;color:#d1d5db;padding-left:20px;">
        <li><strong>Join the APEX Slack</strong> for team support and updates.</li>
        <li><strong>Join the APEX Discord</strong> for the live community and deal celebrations.</li>
        <li><strong>Create your XCEL account</strong> using the legal name on your ID.</li>
        <li><strong>Complete pre-licensing training</strong> and prepare for the state exam.</li>
        <li><strong>Update your APEX roadmap</strong> at course, exam, fingerprints, and license milestones.</li>
        <li><strong>Add your NPN and book onboarding</strong> after your license posts.</li>
      </ol>
      <p><a href="' || v_slack_url || '" style="display:block;background:#4A154B;color:#fff;text-decoration:none;padding:13px 18px;border-radius:8px;text-align:center;font-weight:700;margin:10px 0;">Join Team Slack</a></p>
      <p><a href="' || v_discord_url || '" style="display:block;background:#5865F2;color:#fff;text-decoration:none;padding:13px 18px;border-radius:8px;text-align:center;font-weight:700;margin:10px 0;">Join APEX Discord</a></p>
      <p><a href="https://partners.xcelsolutions.com/afe" style="display:block;background:#14b8a6;color:#07111b;text-decoration:none;padding:13px 18px;border-radius:8px;text-align:center;font-weight:700;margin:10px 0;">Create XCEL Account &amp; Start Training</a></p>
      <p><a href="https://apex-financial.org/get-licensed" style="display:block;background:#D4AF37;color:#111;text-decoration:none;padding:13px 18px;border-radius:8px;text-align:center;font-weight:700;margin:10px 0;">Open My APEX Roadmap</a></p>
      <p><a href="' || v_calendly_url || '" style="display:block;border:1px solid #14b8a6;color:#14b8a6;text-decoration:none;padding:13px 18px;border-radius:8px;text-align:center;font-weight:700;margin:10px 0;">Book a Licensing Support Call</a></p>
      <p style="font-size:13px;color:#9ca3af;margin-top:18px;">— Samuel James, APEX Financial</p>
    </div>
  </div>
</body></html>';

  insert into public.outreach_queue (
    channel, source_run, application_id, to_email, subject,
    template_key, html_body, status, scheduled_for, idempotency_key
  ) values (
    'email', 'applicant-onboarding', new.id, new.email,
    'Your APEX licensing roadmap and account setup',
    'applicant-onboarding-v2', v_html, 'pending', now(),
    'applicant-onboarding-v2-' || new.id::text
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$function$;

comment on function public.fn_enqueue_calendly_for_unlicensed() is
  'Queues one unlicensed onboarding email with Slack, Discord, XCEL account setup, training, APEX roadmap, and support-call steps.';

-- Day-zero inserts should only enter the licensed queue when the row is
-- already licensed. Unlicensed applicants are owned by the function above.
create or replace function public.fn_enqueue_agent_onboarding_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  target timestamptz;
begin
  if new.license_status is distinct from 'licensed' then
    return new;
  end if;

  target := public.fn_next_onboarding_window();
  insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  values
    (new.id, 'course', target),
    (new.id, 'discord', target)
  on conflict (agent_id, email_kind) do nothing;

  return new;
end;
$function$;

comment on function public.fn_enqueue_agent_onboarding_emails() is
  'Queues licensed online-training + primary Slack community emails on agent insert. Unlicensed onboarding uses the applicant roadmap email.';

-- Preserve the current licensed transition + onboarding-call behavior while
-- removing the retired third channel from every future enqueue.
create or replace function public.fn_enqueue_hired_licensed_onboarding()
returns trigger
language plpgsql
security definer
as $function$
declare
  should_fire boolean;
begin
  if new.license_status is distinct from 'licensed' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_fire := (new.onboarding_stage = 'live') or (new.status = 'active');
  else
    should_fire := (
         (old.onboarding_stage is distinct from new.onboarding_stage and new.onboarding_stage = 'live')
      or (old.status is distinct from new.status and new.status = 'active' and coalesce(old.status::text, '') not in ('active', 'live'))
      or (old.license_status is distinct from new.license_status and new.license_status = 'licensed')
    );
  end if;

  if not should_fire then
    return new;
  end if;

  if pg_trigger_depth() = 1 and coalesce(new.has_training_course, false) = false then
    update public.agents
    set has_training_course = true,
        updated_at = now()
    where id = new.id
      and coalesce(has_training_course, false) = false;
  end if;

  insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  values
    (new.id, 'course', now()),
    (new.id, 'discord', now())
  on conflict (agent_id, email_kind) do nothing;

  begin
    perform public.fn_enqueue_onboarding_call_booking(new.id, 'trigger:' || tg_op);
  exception when others then
    raise warning 'fn_enqueue_onboarding_call_booking failed for agent %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

comment on function public.fn_enqueue_hired_licensed_onboarding() is
  'Queues licensed training, primary Slack community, and one onboarding-call booking email. No retired messaging-channel enqueue.';

-- Guardrail truth now expects the two active licensed email kinds only.
create or replace view public.v_hired_licensed_missing_course as
select
  a.id,
  coalesce(p.full_name, a.display_name, a.agent_code, 'unknown') as name,
  p.email,
  a.status,
  a.onboarding_stage,
  a.license_status,
  a.has_training_course,
  a.stage_changed_at,
  a.contracted_at,
  a.created_at,
  (
    select count(*)::int
    from (values ('course'), ('discord')) as k(kind)
    where not exists (
      select 1 from public.agent_onboarding_queue q
      where q.agent_id = a.id and q.email_kind = k.kind
    )
  ) as missing_queue_row_count,
  (
    coalesce(a.has_training_course, false) = false
    or exists (
      select 1
      from (values ('course'), ('discord')) as k(kind)
      where not exists (
        select 1 from public.agent_onboarding_queue q
        where q.agent_id = a.id and q.email_kind = k.kind
      )
    )
  ) as is_routing_gap
from public.agents a
left join public.profiles p on p.user_id = a.user_id
where coalesce(a.is_deactivated, false) = false
  and a.license_status = 'licensed'
  and (a.onboarding_stage = 'live' or a.status = 'active')
  and (
    coalesce(a.has_training_course, false) = false
    or exists (
      select 1
      from (values ('course'), ('discord')) as k(kind)
      where not exists (
        select 1 from public.agent_onboarding_queue q
        where q.agent_id = a.id and q.email_kind = k.kind
      )
    )
  );

comment on view public.v_hired_licensed_missing_course is
  'Healthy when empty: every active licensed hire has training entitlement plus course and primary Slack community queue receipts.';
