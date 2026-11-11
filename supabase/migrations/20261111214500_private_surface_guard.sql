-- PRIVATE SURFACE GUARD (2026-11-11). Sam's DMs, Instagram data, camera/media library and Money Inbox
-- are readable by Sam ONLY. This is the bot that keeps it that way:
--   * public.private_surface_registry  - what is private (tables + gate functions) and what was reviewed as not private
--   * public.fn_private_surface_audit() - static audit: returns one row per hole, empty = sealed
--   * public.fn_private_surface_alert() - pg_cron every 15 min; on any hole -> critical bot_alert + ntfy page
-- Behavioural twin: ~/business-ops/scripts/private-surface-guard.sh impersonates every non-Sam login hourly.
-- Repo twin: scripts/check-private-surfaces.mjs (nav + route gates) in pre-commit.
-- Origin: the manager role had an "Instagram" tab + fn_ig_thread access to every DM and full read/write on
-- 11,456 camera-roll clips. Sam: "why would I want anyone on my team besides me to have access to my DMs".
begin;

-- The camera-library invite list is itself a door: only Sam may add people to it.
drop policy if exists content_access_admin_all on public.content_access;
drop policy if exists content_access_sam_only on public.content_access;
create policy content_access_sam_only on public.content_access for all to authenticated
  using (public.is_sam()) with check (public.is_sam());

create table if not exists public.private_surface_registry (
  kind text not null check (kind in ('private_table', 'private_function', 'reviewed_not_private')),
  name text not null,
  why text not null,
  added_at timestamptz not null default now(),
  primary key (kind, name)
);
alter table public.private_surface_registry enable row level security;
drop policy if exists private_surface_registry_sam on public.private_surface_registry;
create policy private_surface_registry_sam on public.private_surface_registry for select to authenticated using (public.is_sam());

insert into public.private_surface_registry (kind, name, why) values
  ('private_table', 'inbox_messages', 'every inbound/outbound IG DM body'),
  ('private_table', 'instagram_events', 'raw Instagram webhook payloads (DMs, comments)'),
  ('private_table', 'instagram_dm_threads', 'Sam''s IG DM threads'),
  ('private_table', 'instagram_connections', 'Sam''s Instagram access token'),
  ('private_table', 'ig_thread_actions', 'actions taken on Sam''s DM threads'),
  ('private_table', 'ig_comment_events', 'Instagram comment payloads'),
  ('private_table', 'instagram_pause_refusals', 'blocked IG sends incl. message bodies'),
  ('private_table', 'youtube_comment_events', 'YouTube comment payloads'),
  ('private_table', 'content_clips', 'camera roll / media library: paths, phone_url, transcripts, download links'),
  ('private_table', 'content_shares', 'share links into the camera library'),
  ('private_table', 'content_access', 'who is invited into the camera library'),
  ('private_table', 'money_inbox_threads', 'iMessage + DM conversations (Money Inbox)'),
  ('private_table', 'money_inbox_sources', 'Money Inbox source connections'),
  ('private_function', 'fn_ig_thread', 'opens one DM conversation'),
  ('private_function', 'fn_ig_dashboard', 'lists all DM threads'),
  ('private_function', 'fn_ig_thread_action', 'acts on a DM thread'),
  ('private_function', 'content_can_access', 'camera-library gate (Sam or Sam''s own invite list)'),
  ('reviewed_not_private', 'instagram_subscriptions', 'agents'' own IG subscription rows, owner-scoped'),
  ('reviewed_not_private', 'instagram_dm_templates', 'owner-scoped reply templates, no message content'),
  ('reviewed_not_private', 'ig_reels_cache', 'public reels metadata cache'),
  ('reviewed_not_private', 'ig_trial_reel_queue', 'service-only publish queue, no RLS grants'),
  ('reviewed_not_private', 'fn_ig_automation_pause_status', 'returns pause flag + counts only, no message content')
on conflict (kind, name) do update set why = excluded.why;

create or replace function public.fn_private_surface_audit()
returns table (violation text, object text, detail text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  sam constant text := '71826bba-5577-4810-a226-1f6f2ad5288a';
  role_grant_re constant text := '(has_role\s*\(|apex_is_admin\s*\(|is_owner\s*\(|current_agent_id\s*\(|is_manager|my_downline)';
begin
  -- 1. A registered private table is missing or has RLS off.
  return query
    select 'rls_off_or_missing', r.name, 'private table has no row level security (or was dropped)'
    from private_surface_registry r
    left join pg_class c on c.relname = r.name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    where r.kind = 'private_table' and (c.oid is null or not c.relrowsecurity);

  -- 2. A policy on a private table lets anyone but Sam in. Allowed predicates: is_sam(), Sam's uid
  --    (without OR), content_can_access() (itself audited below), or false.
  return query
    select 'policy_not_sam_only', p.tablename || '.' || p.policyname,
           p.cmd || ' to ' || p.roles::text || ': ' || left(coalesce(p.qual, '') || ' | check: ' || coalesce(p.with_check, ''), 300)
    from pg_policies p
    join private_surface_registry r on r.kind = 'private_table' and r.name = p.tablename
    cross join lateral (select unnest(array[p.qual, p.with_check]) as q) x
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and p.roles && array['public', 'anon', 'authenticated']::name[]
      and x.q is not null
      and not (
        x.q ~* '^[\s(]*(select\s+)?(public\.)?is_sam\(\)(\s+as\s+is_sam)?[\s)]*$'
        or x.q ~* '^[\s(]*(select\s+)?(public\.)?content_can_access\(\)(\s+as\s+content_can_access)?[\s)]*$'
        or x.q ~* '^[\s(]*false[\s)]*$'
        or (position(sam in x.q) > 0 and x.q !~* '\mor\M' and x.q !~* role_grant_re)
      )
    group by p.tablename, p.policyname, p.cmd, p.roles, p.qual, p.with_check;

  -- 3. A registered gate function stopped checking is_sam() or grants by role.
  return query
    select 'gate_fn_not_sam_only', r.name,
           case when p.oid is null then 'function missing'
                when p.prosrc !~* 'is_sam\(\)' then 'no is_sam() check'
                else 'grants by role: ' || substring(p.prosrc from role_grant_re) end
    from private_surface_registry r
    left join pg_proc p on p.proname = r.name and p.pronamespace = 'public'::regnamespace
    where r.kind = 'private_function'
      and (p.oid is null or p.prosrc !~* 'is_sam\(\)' or p.prosrc ~* role_grant_re);

  -- 4. A SECURITY DEFINER function callable by a signed-in user (or anon) reads a private table without
  --    the is_sam() gate: that bypasses every policy above (the 2026-11 definer-view disease).
  return query
    select distinct 'definer_fn_backdoor', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           'reads ' || t.name || ' and is executable by '
             || case when has_function_privilege('anon', p.oid, 'execute') then 'anon' else 'authenticated' end
    from pg_proc p
    join private_surface_registry t on t.kind = 'private_table' and p.prosrc ~* ('\m' || t.name || '\M')
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and p.prosrc !~* 'is_sam\(\)'
      and position(sam in p.prosrc) = 0
      and p.proname not in (select name from private_surface_registry where kind = 'reviewed_not_private')
      and p.proname not in ('fn_private_surface_audit', 'fn_private_surface_alert');

  -- 5. A view over a private table runs as its owner (bypassing RLS) and a signed-in user can select it.
  return query
    select distinct 'definer_view_backdoor', c.relname::text, 'selects ' || t.name || ' without security_invoker'
    from pg_class c
    join private_surface_registry t on t.kind = 'private_table' and pg_get_viewdef(c.oid) ~* ('\m' || t.name || '\M')
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
      and coalesce(array_to_string(c.reloptions, ','), '') !~* 'security_invoker=(true|on|1)'
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'));

  -- 6. A new table that looks private was created and nobody classified it.
  return query
    select 'unregistered_private_looking_table', c.relname::text, 'name looks private; add it to private_surface_registry'
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and c.relname ~* '(instagram|imessage|^dm_|^ig_|money_inbox|camera|content_clip|content_share|content_access|mailbox|gmail|inbox_message)'
      and c.relname not in (select name from private_surface_registry);
end $$;
revoke all on function public.fn_private_surface_audit() from public, anon, authenticated;

create or replace function public.fn_private_surface_alert()
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer; v_detail text;
begin
  select count(*), string_agg(violation || ': ' || object, ' | ') into n, v_detail from public.fn_private_surface_audit();
  if n > 0 and not exists (
    select 1 from public.bot_alerts where event_type = 'private_surface_violation' and created_at > now() - interval '6 hours'
  ) then
    insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    values ('cron', 'private_surface_violation', 'critical',
            format('SECURITY: %s door(s) open to your private data', n),
            format('<p>Someone other than Sam can reach DMs / Instagram / camera library / Money Inbox.</p><p>%s</p><p>Run: select * from fn_private_surface_audit();</p>', left(coalesce(v_detail, ''), 1500)),
            format('APEX SECURITY: %s door(s) open to your DMs/camera. %s', n, left(coalesce(v_detail, ''), 200)),
            array['email']::text[]);
    perform net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic', 'sams-agent-yrkv9kbqp9e987nb',
        'title', 'APEX SECURITY: private data exposed',
        'message', format('%s door(s) open to your DMs/camera/Money Inbox: %s', n, left(coalesce(v_detail, ''), 400)),
        'priority', 5,
        'tags', jsonb_build_array('rotating_light')));
  end if;
  return n;
end $$;
revoke all on function public.fn_private_surface_alert() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'apex-private-surface-watch') then
    perform cron.unschedule('apex-private-surface-watch');
  end if;
  perform cron.schedule('apex-private-surface-watch', '*/15 * * * *', 'select public.fn_private_surface_alert()');
end $$;

commit;

-- ============================================================================================================
-- 2026-11-11 13:45 MST - the actual door. Edge logs proved the reader was not using the manager account at all:
-- she logged into SAM'S OWN account with his password (grant_type=password from Madison, WI, 147.219.148.111,
-- 18:30Z and 20:09Z) and twice fired logout?scope=global, which also signed Sam out. Both sessions were
-- revoked, the password rotated, and these gates now require a LIVE session so a revoked token is dead
-- immediately instead of at JWT expiry.
-- ============================================================================================================
begin;

create or replace function public.is_sam() returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.uid() = '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid, false)
     and exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid)
$$;

drop policy if exists money_inbox_sam_select on public.money_inbox_threads;
create policy money_inbox_sam_select on public.money_inbox_threads for select to authenticated using (public.is_sam() and private = false and classified_at is not null);
drop policy if exists money_inbox_sam_update on public.money_inbox_threads;
create policy money_inbox_sam_update on public.money_inbox_threads for update to authenticated using (public.is_sam() and private = false and classified_at is not null);
drop policy if exists money_sources_sam on public.money_inbox_sources;
create policy money_sources_sam on public.money_inbox_sources for select to authenticated using (public.is_sam());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  -- 2026-11-11: Sam's own roles only count on a LIVE session. A token whose session was revoked
  -- (someone logged in with his password) stops being admin immediately, not at JWT expiry.
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
     AND (_user_id <> '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid
          OR auth.uid() IS DISTINCT FROM _user_id
          OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid));
$function$;

-- Every new login to Sam's account pages his phone with the IP and device. Never blocks the login.
create or replace function public.trg_sam_new_session_alert() returns trigger
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if new.user_id = '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid then
    begin
      perform net.http_post(
        url := 'https://ntfy.sh/',
        body := jsonb_build_object(
          'topic', 'sams-agent-yrkv9kbqp9e987nb',
          'title', 'New login to YOUR APEX account',
          'message', format('IP %s - %s. Not you? Tell Claude "kill session %s".',
                            coalesce(host(new.ip), '?'), left(coalesce(new.user_agent, 'unknown device'), 110), left(new.id::text, 8)),
          'priority', 5,
          'tags', jsonb_build_array('warning')));
      insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
      values ('trigger', 'sam_account_new_login', 'critical',
              format('New login to your APEX account from %s', coalesce(host(new.ip), '?')),
              format('<p>Session %s</p><p>IP %s</p><p>%s</p>', new.id, coalesce(host(new.ip), '?'), coalesce(new.user_agent, '')),
              format('APEX: new login to YOUR account from %s', coalesce(host(new.ip), '?')),
              array['email']::text[]);
    exception when others then
      raise warning 'trg_sam_new_session_alert failed: %', sqlerrm;  -- a login is never blocked by its alarm
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_sam_new_session_alert on auth.sessions;
create trigger trg_sam_new_session_alert after insert on auth.sessions
  for each row execute function public.trg_sam_new_session_alert();

commit;
