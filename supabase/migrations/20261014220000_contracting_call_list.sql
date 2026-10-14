-- Contracting call list (Sam, 2026-10-14): "the entire thought process is for me to easily call agents who already
-- have their license and fell off in the contracting process. Easy to read, easy to use, easy to get done."
-- So the screen is a phone list, not a report: licensed agents whose contracting is not done, the next thing each one
-- has to do, their number, and a one-tap log of every call or text so the list works itself down.
--
--   to_call          licensed, not finished, nobody has reached out in 7 days — the list
--   called_recently  a call/text/note was logged in the last 7 days — shown below the list so nobody is called twice
--   not_now          the last outcome was "not interested" inside 30 days — tucked away, comes back after that
--   finished         profile + DOB/address saved, or all four carriers confirmed, or a request submitted/approved
--   unlicensed       counted only: they cannot contract until licensed, so they are not on a contracting call list
-- Excluded entirely: the viewer's own agent row and admin logins (Sam opening the page is not an agent stalling).

create table if not exists public.contracting_followups (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  channel text not null check (channel in ('call','text','note')),
  outcome text check (outcome in ('reached','voicemail','no_answer','will_finish','not_interested')),
  note text,
  acted_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists contracting_followups_agent_at on public.contracting_followups (agent_id, created_at desc);
alter table public.contracting_followups enable row level security;
revoke all on table public.contracting_followups from anon, authenticated;
drop trigger if exists trg_contracting_followups_append_only on public.contracting_followups;
create trigger trg_contracting_followups_append_only before update or delete on public.contracting_followups
  for each row execute function public.fn_append_only_guard();

-- One row per call, text or note. Outcome is optional: tapping Call logs the attempt at once; "how did it go" lands
-- as a second row so the attempt is never lost when the page is closed mid-call.
create or replace function public.log_contracting_followup(p_agent_id uuid, p_channel text, p_outcome text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_id uuid; v_at timestamptz;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('call','text','note') then return jsonb_build_object('ok', false, 'error', 'channel must be call, text or note'); end if;
  if p_outcome is not null and p_outcome not in ('reached','voicemail','no_answer','will_finish','not_interested') then return jsonb_build_object('ok', false, 'error', 'unknown outcome'); end if;
  if not exists (select 1 from public.agents a where a.id = p_agent_id) then return jsonb_build_object('ok', false, 'error', 'no such agent'); end if;
  insert into public.contracting_followups (agent_id, channel, outcome, note, acted_by)
  values (p_agent_id, p_channel, p_outcome, nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid)
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('ok', true, 'id', v_id, 'created_at', v_at);
end;
$$;
revoke all on function public.log_contracting_followup(uuid, text, text, text) from public, anon;
grant execute on function public.log_contracting_followup(uuid, text, text, text) to authenticated;

create or replace function public.contracting_call_list()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_version integer; v_rows jsonb; v_counts jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  with pop as (
    select a.id, a.user_id, coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as display_name,
           a.start_date, a.nipr_number, a.license_status::text as license_status, a.licensed_at, a.license_states,
           coalesce(nullif(btrim(pu.phone), ''), nullif(btrim(pp.phone), ''), nullif(btrim(ap.phone), '')) as phone
      from public.agents a
      join public.fn_contract_review_population() p on p.agent_id = a.id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
      left join public.applications ap on ap.id = a.source_application_id
     where (v_all or public.apex_can_read_agent(a.id))
       and (a.user_id is null or a.user_id <> v_uid)
       and not (a.user_id is not null and public.has_role(a.user_id, 'admin'))
  ), facts as (
    select p.*, o.first_opened_at, o.last_opened_at, coalesce(o.opens, 0) as opens,
           (cp.agent_id is not null and cp.first_name is not null and cp.last_name is not null and cp.email is not null and cp.resident_state is not null
              and nullif(regexp_replace(coalesce(p.nipr_number, ''), '\D', '', 'g'), '') is not null) as profile_saved,
           (cp.dob is not null and cp.address_line1 is not null and cp.city is not null and cp.zip is not null) as details_saved,
           (select count(*) from public.contract_review_marks m where m.agent_id = p.id and m.version = v_version) as marked_count,
           (select r.status from public.contracting_requests r where r.agent_id = p.id and r.status not in ('archived','declined') order by r.created_at desc limit 1) as request_status,
           f.channel as last_channel, f.outcome as last_outcome, f.created_at as last_followup_at, f.acted_by as last_by,
           fp.full_name as last_by_name
      from pop p
      left join public.contracting_link_opens o on o.agent_id = p.id
      left join public.agent_contract_profile cp on cp.agent_id = p.id
      left join lateral (select x.channel, x.outcome, x.created_at, x.acted_by from public.contracting_followups x
                          where x.agent_id = p.id order by x.created_at desc limit 1) f on true
      left join public.profiles fp on fp.user_id = f.acted_by
  ), graded as (
    select f.*,
      case when f.marked_count = 4 or f.request_status in ('submitted','approved') or (f.profile_saved and f.details_saved) then 'finished'
           when f.license_status <> 'licensed' then 'unlicensed'
           when f.last_outcome = 'not_interested' and f.last_followup_at > now() - interval '30 days' then 'not_now'
           when f.last_followup_at > now() - interval '7 days' then 'called_recently'
           else 'to_call' end as bucket,
      case when f.profile_saved then 'missing_details'
           when f.last_opened_at is not null then 'opened_not_saved'
           else 'never_opened' end as reason
      from facts f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', g.id, 'display_name', g.display_name, 'phone', g.phone,
           'license_states', g.license_states, 'licensed_at', g.licensed_at, 'start_date', g.start_date,
           'bucket', g.bucket, 'reason', g.reason,
           'last_opened_at', g.last_opened_at, 'opens', g.opens, 'marked_count', g.marked_count,
           'profile_saved', g.profile_saved, 'details_saved', g.details_saved, 'request_status', g.request_status,
           'followup', case when g.last_followup_at is null then null else jsonb_build_object(
               'channel', g.last_channel, 'outcome', g.last_outcome, 'at', g.last_followup_at,
               'by', g.last_by_name, 'mine', g.last_by = v_uid) end)
         order by case g.bucket when 'to_call' then 0 when 'called_recently' then 1 when 'not_now' then 2 else 3 end,
                  case when g.bucket = 'called_recently' then g.last_followup_at end asc nulls last,
                  case g.reason when 'opened_not_saved' then 0 when 'missing_details' then 1 else 2 end,
                  g.last_opened_at desc nulls last, g.licensed_at asc nulls last, g.start_date asc nulls last, g.display_name)
         filter (where g.bucket <> 'unlicensed'), '[]'::jsonb),
         jsonb_build_object(
           'to_call', count(*) filter (where g.bucket = 'to_call'),
           'called_recently', count(*) filter (where g.bucket = 'called_recently'),
           'not_now', count(*) filter (where g.bucket = 'not_now'),
           'finished', count(*) filter (where g.bucket = 'finished'),
           'unlicensed', count(*) filter (where g.bucket = 'unlicensed'),
           'no_phone', count(*) filter (where g.bucket in ('to_call','called_recently') and g.phone is null),
           'total', count(*))
    into v_rows, v_counts from graded g;
  -- Everything is read in the one statement above: a CTE is not visible to a later statement in the block.
  return jsonb_build_object('ok', true, 'counts', v_counts, 'rows', v_rows);
end;
$$;
revoke all on function public.contracting_call_list() from public, anon;
grant execute on function public.contracting_call_list() to authenticated;

-- Replaced by contracting_call_list(); nothing else called it.
drop function if exists public.contracting_link_activity();
