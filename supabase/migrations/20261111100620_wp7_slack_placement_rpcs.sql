-- WP7 (onboarding audit 2026-11-10): Slack placement goes through two
-- service-role RPCs instead of the edge function touching tables directly.
-- The forward-only boundary (system_settings.slack_placement_cutoff_at) is now
-- enforced in the database: only people who ENTERED the state after the cutoff
-- (applied, were hired, or got licensed) are ever candidates. A missing cutoff
-- raises instead of silently sweeping the backlog.
--
-- These run only once Sam grants users:read.email + channels:manage (N4);
-- until then slack-unlicensed-welcome logs blocked_scope and never calls them.
--
-- Applied live by WP7, recorded in supabase_migrations.schema_migrations.

create or replace function public.fn_slack_placement_candidates(p_limit integer default 40)
returns table(subject_kind text, subject_id uuid, email text, target text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select nullif(btrim(value), '')::timestamptz into v_cutoff
    from public.system_settings where key = 'slack_placement_cutoff_at';
  if v_cutoff is null then
    raise exception 'slack_placement_cutoff_at missing; placement refused (no forward boundary)' using errcode = 'P0002';
  end if;

  return query
  with done as (
    select l.subject_kind, l.subject_id, l.target
    from public.slack_placement_ledger l
    where l.lookup_state = 'found' or l.looked_up_at >= now() - interval '3 days'
  ), pool as (
    select 'application'::text as kind, a.id, lower(btrim(a.email)) as addr, 'unlicensed'::text as tgt,
           a.created_at as entered_at
    from public.applications a
    where a.created_at >= greatest(v_cutoff, now() - interval '120 days')
      and a.terminated_at is null and a.contracted_at is null and a.closed_at is null
      and coalesce(a.license_status::text, '') <> 'licensed'
      and coalesce(a.is_duplicate, false) = false
      and a.email like '%@%'
    union all
    select 'agent'::text, e.agent_id, lower(btrim(e.email)),
           case when ag.license_status::text = 'licensed' then 'licensed' else 'unlicensed' end,
           case when ag.license_status::text = 'licensed' then ag.licensed_at else ag.created_at end
    from public.v_slack_invite_eligibility e
    join public.agents ag on ag.id = e.agent_id
    where e.is_eligible and e.email like '%@%'
      and (case when ag.license_status::text = 'licensed' then ag.licensed_at else ag.created_at end) >= v_cutoff
  )
  select p.kind, p.id, p.addr, p.tgt
  from pool p
  where not exists (
    select 1 from done d where d.subject_kind = p.kind and d.subject_id = p.id and d.target = p.tgt)
  order by p.entered_at
  limit greatest(1, least(coalesce(p_limit, 40), 100));
end;
$function$;
revoke all on function public.fn_slack_placement_candidates(integer) from public, anon, authenticated;
grant execute on function public.fn_slack_placement_candidates(integer) to service_role;

create or replace function public.fn_record_slack_placement(
  p_subject_kind text,
  p_subject_id uuid,
  p_target text,
  p_lookup_state text,
  p_slack_user_id text default null,
  p_invited_channels text[] default '{}'::text[],
  p_invite_errors jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.slack_placement_ledger(
    subject_kind, subject_id, target, lookup_state, slack_user_id,
    invited_channels, invite_errors, looked_up_at, invited_at, updated_at)
  values (
    p_subject_kind, p_subject_id, p_target, p_lookup_state, nullif(btrim(coalesce(p_slack_user_id, '')), ''),
    coalesce(p_invited_channels, '{}'::text[]), coalesce(p_invite_errors, '{}'::jsonb), now(),
    case when coalesce(array_length(p_invited_channels, 1), 0) > 0 then now() end, now())
  on conflict (subject_kind, subject_id, target) do update
    set lookup_state = excluded.lookup_state,
        slack_user_id = coalesce(excluded.slack_user_id, slack_placement_ledger.slack_user_id),
        invited_channels = (select array(select distinct c from unnest(slack_placement_ledger.invited_channels || excluded.invited_channels) c)),
        invite_errors = excluded.invite_errors,
        looked_up_at = now(),
        invited_at = coalesce(excluded.invited_at, slack_placement_ledger.invited_at),
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.fn_record_slack_placement(text, uuid, text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.fn_record_slack_placement(text, uuid, text, text, text, text[], jsonb) to service_role;
