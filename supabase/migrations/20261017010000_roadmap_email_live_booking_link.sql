-- PL-WIB-ROADMAP-BOOKING-LINK (93)
--
-- The licensing roadmap email every unlicensed applicant is queued on /apply
-- (trg_calendly_for_unlicensed_ins/_upd -> outreach_queue, template
-- applicant-onboarding-v2) took its "Book a Licensing Support Call" button
-- from system_settings.seminar_calendly_url. That key holds
-- calendly.com/apexfinancialempire/interview, the seminar event type that was
-- DELETED (Calendly booking lookup: event_type_deleted). Sam retired the
-- seminar on 2026-10-15, so the key now names a retired surface, and the one
-- live email that read it would send every applicant to "this Calendly URL is
-- not valid". The other four buttons (Slack, Discord, XCEL, /get-licensed)
-- were measured live on 2026-10-17.
--
-- Not sending today: cron apex-outreach-sender-5min is inactive (paused for
-- Postmark approval, ledger 2026-10-11 (53)), so 57 rows sit pending, all
-- carrying the dead link. They go out the moment that cron is re-enabled.
--
-- 1. The roadmap email reads its own key, licensing_support_call_url, seeded
--    with the function's own fallback (licensed-prospect-call-clone, live,
--    "Leader Call (15 min)"). The seminar_* keys are left alone: their other
--    readers are seminar surfaces and retire with the seminar.
-- 2. The function body is the live pg_get_functiondef with that one key
--    changed. Nothing else in it moved.
-- 3. Pending applicant-onboarding-v2 rows are rewritten in place, href only.
--    Sent/failed rows are history and are not touched. Pre-image:
--    business-ops/website-integrity-bot/ledger/snapshots/2026-10-16-roadmap-email-interview-pre.json
-- Idempotent: re-running changes nothing.

insert into public.system_settings (key, value)
values ('licensing_support_call_url', 'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone')
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.fn_enqueue_calendly_for_unlicensed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where key = 'licensing_support_call_url'
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
$function$
;

update public.outreach_queue
   set html_body = replace(
         html_body,
         'href="https://calendly.com/apexfinancialempire/interview"',
         'href="' || coalesce(
           (select nullif(trim(both '"' from value), '') from public.system_settings
             where key = 'licensing_support_call_url'),
           'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone') || '"')
 where template_key = 'applicant-onboarding-v2'
   and status = 'pending'
   and html_body like '%href="https://calendly.com/apexfinancialempire/interview"%';
