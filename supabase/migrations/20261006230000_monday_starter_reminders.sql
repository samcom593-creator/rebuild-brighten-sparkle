-- Sunday reminders for people starting Monday (Sam 2026-10-06).
-- Digest (name/phone/email/manager) to Sam, OB and every active manager; a reminder
-- email + text to each starter. The log makes every send idempotent per Monday.
create table if not exists public.monday_starter_notifications (
  id bigserial primary key,
  monday date not null,
  kind text not null check (kind in ('digest','starter_email','starter_sms')),
  recipient text not null,
  status text not null default 'pending',
  detail text,
  created_at timestamptz not null default now(),
  unique (monday, kind, recipient)
);
alter table public.monday_starter_notifications enable row level security;

create or replace function public.monday_starters(p_monday date)
returns table (name text, email text, phone text, manager text, source text)
language sql stable set search_path = public as $$
  select a.display_name,
         nullif(p.email, ''),
         coalesce(nullif(p.phone, ''),
                  (select ap.phone from applications ap
                    where p.email is not null and lower(ap.email) = lower(p.email) and nullif(ap.phone,'') is not null
                    order by ap.created_at desc limit 1)),
         m.display_name, 'agent'
    from agents a
    left join profiles p on p.id = a.profile_id
    left join agents m on m.id = a.manager_id
   where a.start_date = p_monday
     and a.status::text not in ('terminated','inactive')
     and coalesce(p.email,'') not like 'DEDUP_%'
  union all
  select trim(coalesce(ap.first_name,'') || ' ' || coalesce(ap.last_name,'')), nullif(ap.email,''),
         nullif(ap.phone,''), null, 'application'
    from applications ap
   where ap.start_date = p_monday
     and not exists (select 1 from agents a join profiles p on p.id = a.profile_id
                      where lower(p.email) = lower(ap.email))
$$;

create or replace function public.active_manager_emails()
returns table (name text, email text)
language sql stable set search_path = public as $$
  select distinct on (lower(p.email)) a.display_name, p.email
    from agents a join profiles p on p.id = a.profile_id
   where a.is_manager and a.status::text = 'active'
     and p.email like '%@%' and p.email not like 'DEDUP_%'
   order by lower(p.email), a.display_name
$$;

revoke all on function public.monday_starters(date) from public, anon, authenticated;
revoke all on function public.active_manager_emails() from public, anon, authenticated;
grant execute on function public.monday_starters(date) to service_role;
grant execute on function public.active_manager_emails() to service_role;

-- Caller secret for the Sunday cron (generated in-DB; never in a file).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'monday_reminder_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'monday_reminder_secret');
  end if;
end $$;
create or replace function public.check_monday_reminder_secret(p text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p = (select decrypted_secret from vault.decrypted_secrets where name = 'monday_reminder_secret' limit 1), false)
$$;
revoke all on function public.check_monday_reminder_secret(text) from public, anon, authenticated;
grant execute on function public.check_monday_reminder_secret(text) to service_role;

-- Every Sunday 10:00 America/Phoenix (17:00 UTC).
select cron.schedule('monday-starter-reminders-sunday', '0 17 * * 0', $c$
  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/monday-starter-reminders',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='monday_reminder_secret' limit 1),'Content-Type','application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$c$);
