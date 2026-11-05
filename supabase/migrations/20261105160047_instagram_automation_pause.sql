-- instagram_automation_pause — Sam's kill switch for every automated action on Instagram (2026-11-04).
--
-- "pause all automations on Instagram as a whole. All automated messaging on Instagram as a
-- whole. I'm not taking any risks with Instagram." Meta stamped a fresh link refusal at
-- 2026-11-03T11:59Z (system_settings.instagram_links_blocked_at); the automated lanes move to
-- ManyChat. The flag is one system_settings row, instagram_automation_paused_at (ISO timestamp;
-- absent or empty = not paused), read at runtime by supabase/functions/_shared/instagram-pause.ts
-- in every function that can write to Instagram. This migration adds the receipt table, the
-- desk's status RPC, and teaches the social-lane pager and view that a paused lane is paused,
-- not dead. Flip the flag with business-ops/scripts/instagram-pause.sh (pause | resume | status).
--
-- Applied live through the Supabase MCP on 2026-11-05 (recorded version 20261105160047); this
-- file is the verbatim mirror so `supabase db push` treats it as applied.

create table if not exists public.instagram_pause_refusals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  external_id text,
  comment_id text,
  message text,
  caller text,
  meta jsonb not null default '{}'::jsonb
);
comment on table public.instagram_pause_refusals is 'One row per automated Instagram send the pause refused (kind: dm | private_reply | public_reply | dm_brain | comment_brain | nudge | replay | backfill | publish). Service role only; the desk reads counts through fn_ig_automation_pause_status().';
create index if not exists instagram_pause_refusals_created_idx on public.instagram_pause_refusals (created_at desc);
alter table public.instagram_pause_refusals enable row level security;
revoke all on public.instagram_pause_refusals from anon, authenticated;

-- The desk's one read: paused or not, since when, why, and what the pause has refused.
create or replace function public.fn_ig_automation_pause_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at text;
  v_reason text;
  v_since timestamptz;
begin
  if auth.uid() is null or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select nullif(btrim(value, '" '), '') into v_at from public.system_settings where key = 'instagram_automation_paused_at';
  select nullif(btrim(value), '') into v_reason from public.system_settings where key = 'instagram_automation_paused_reason';
  begin
    v_since := v_at::timestamptz;
  exception when others then
    v_since := null;
  end;
  return jsonb_build_object(
    'paused', v_at is not null,
    'since', v_since,
    'since_raw', v_at,
    'reason', v_reason,
    'refusals_24h', (select count(*)::int from public.instagram_pause_refusals where created_at > now() - interval '24 hours'),
    'refusals_total', (select count(*)::int from public.instagram_pause_refusals),
    'last_refusal_at', (select max(created_at) from public.instagram_pause_refusals),
    'inbound_24h', (select count(*)::int from public.inbox_messages where source = 'instagram' and direction = 'inbound' and created_at > now() - interval '24 hours'),
    'crons', (select coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'active', active) order by jobname), '[]'::jsonb)
                from cron.job where jobname in ('apex-instagram-comments-backfill', 'apex-instagram-dm-nudge', 'apex-ig-trial-reels')),
    'checked_at', now()
  );
end $$;
revoke all on function public.fn_ig_automation_pause_status() from public, anon;
grant execute on function public.fn_ig_automation_pause_status() to authenticated;

-- v_social_lane_health: the four lanes the pause silences on purpose read 'paused', never 'dead'.
-- Rewritten from the live definition so the lane list is not restated here; a later migration that
-- re-emits the view from scratch must carry this CASE forward (grep instagram_automation_paused_at).
do $$
declare
  v_def text;
begin
  v_def := pg_get_viewdef('public.v_social_lane_health'::regclass, true);
  if position('instagram_automation_paused_at' in v_def) = 0 then
    v_def := replace(v_def,
      $x$WHEN last_seen IS NULL AND expires_at IS NULL THEN 'never'::text$x$,
      $x$WHEN (EXISTS (SELECT 1 FROM public.system_settings s WHERE s.key = 'instagram_automation_paused_at' AND NULLIF(btrim(s.value, '" '), '') IS NOT NULL)) AND lane = ANY (ARRAY['instagram_dm_replies'::text, 'instagram_brain_answers'::text, 'instagram_comments'::text, 'ig_trial_reels'::text]) THEN 'paused'::text
            WHEN last_seen IS NULL AND expires_at IS NULL THEN 'never'::text$x$);
    if position('instagram_automation_paused_at' in v_def) = 0 then
      raise exception 'v_social_lane_health: anchor for the pause CASE not found; view left unchanged';
    end if;
    execute 'create or replace view public.v_social_lane_health as ' || v_def;
  end if;
end $$;

-- fn_social_lane_alert: never page about a lane Sam paused, whatever the view says.
create or replace function public.fn_social_lane_alert()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_new text[] := '{}';
  v_due text[] := '{}';
  v_lines text := '';
  v_subject text;
  v_dead integer := 0;
  v_verdict text;
  v_ig_paused boolean := false;
  v_paused_lanes constant text[] := array['instagram_dm_replies', 'instagram_brain_answers', 'instagram_comments', 'ig_trial_reels'];
begin
  -- Sam's Instagram pause (2026-11-04): these lanes are silent because he said so. Grading them
  -- dead would page him every 24h about the thing he asked for.
  select exists (
    select 1 from public.system_settings s
    where s.key = 'instagram_automation_paused_at' and nullif(btrim(s.value, '" '), '') is not null
  ) into v_ig_paused;

  for r in select * from public.v_social_lane_health loop
    v_verdict := case when v_ig_paused and r.lane = any(v_paused_lanes) then 'paused' else r.verdict end;
    insert into public.social_lane_alert_state as s (lane, tier, verdict, dead_since, checked_at)
    values (r.lane, r.tier, v_verdict, case when v_verdict = 'dead' then coalesce(r.last_seen, now()) end, now())
    on conflict (lane) do update set
      tier = excluded.tier,
      verdict = excluded.verdict,
      dead_since = case when excluded.verdict = 'dead' then coalesce(s.dead_since, excluded.dead_since) else null end,
      last_alerted_at = case when excluded.verdict = 'dead' then s.last_alerted_at else null end,
      checked_at = now();
  end loop;

  for r in select s.lane, s.dead_since, s.last_alerted_at, h.hours_silent, h.hours_left, h.fix
           from public.social_lane_alert_state s join public.v_social_lane_health h using (lane)
           where s.tier = 'page' and s.verdict = 'dead' order by s.dead_since loop
    v_dead := v_dead + 1;
    if r.last_alerted_at is null then v_new := v_new || r.lane;
    elsif r.last_alerted_at < now() - interval '24 hours' then v_due := v_due || r.lane; end if;
    v_lines := v_lines || format('<li><b>%s</b>: %s. %s</li>', r.lane,
      case when r.hours_left is not null then format('token expires in %sh', r.hours_left) else format('silent for %sh', r.hours_silent) end,
      coalesce(r.fix, ''));
  end loop;

  if cardinality(v_new) > 0 or cardinality(v_due) > 0 then
    v_subject := format('Social lane%s dead: %s', case when v_dead > 1 then 's' else '' end, array_to_string(v_new || v_due, ', '));
    insert into public.bot_alerts(source, event_type, severity, subject, body, sms_body, action_link, channels)
    values ('cron', 'social_lane_dead', 'critical', v_subject,
      format('<p>%s social lane(s) that used to work are dead. Each carries its fix.</p><ul>%s</ul><p>Social Command Center: https://apex-financial.org/dashboard/social-command</p>', v_dead, v_lines),
      left(format('APEX: %s. Fix: apex-financial.org/dashboard/social-command', v_subject), 300),
      'https://apex-financial.org/dashboard/social-command',
      array['email']::text[]);
    update public.social_lane_alert_state set last_alerted_at = now() where lane = any(v_new || v_due);
  end if;

  return jsonb_build_object('dead_page_lanes', v_dead, 'paged_new', to_jsonb(v_new), 'paged_reminder', to_jsonb(v_due),
                            'instagram_paused', v_ig_paused, 'paused_lanes', case when v_ig_paused then to_jsonb(v_paused_lanes) else '[]'::jsonb end,
                            'checked_at', now());
end $function$;
