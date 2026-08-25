-- ReadyMode supplies display names (often just first names), not emails.
-- Match only when the normalized name resolves to exactly one active agent;
-- ambiguous and external dialer users deliberately remain unmapped.

create or replace function public.fn_match_readymode_calls()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email integer := 0;
  v_exact integer := 0;
  v_first integer := 0;
  v_prefix integer := 0;
  v_leads integer := 0;
begin
  update public.readymode_dialer_calls c
  set agent_id = a.id
  from public.agents a
  join auth.users u on u.id = a.user_id
  where c.agent_id is null and c.agent_raw ilike '%@%'
    and lower(u.email) = lower(trim(c.agent_raw));
  get diagnostics v_email = row_count;

  with raw_names as (
    select distinct c.agent_raw,
      regexp_replace(lower(trim(c.agent_raw)), '[^a-z0-9]+', '', 'g') as norm
    from public.readymode_dialer_calls c
    where c.agent_id is null and nullif(trim(c.agent_raw), '') is not null
  ), candidates as (
    select r.agent_raw, a.id
    from raw_names r
    join public.agents a on a.is_inactive is not true and a.is_deactivated is not true
    left join public.profiles p on p.id = a.profile_id
    where r.norm = regexp_replace(lower(trim(coalesce(a.display_name, p.full_name, ''))), '[^a-z0-9]+', '', 'g')
  ), unique_match as (
    select agent_raw, (array_agg(id order by id))[1] as agent_id from candidates group by agent_raw having count(distinct id) = 1
  )
  update public.readymode_dialer_calls c set agent_id = u.agent_id
  from unique_match u where c.agent_id is null and c.agent_raw = u.agent_raw;
  get diagnostics v_exact = row_count;

  with raw_names as (
    select distinct c.agent_raw,
      regexp_replace(lower(trim(c.agent_raw)), '[^a-z0-9]+', '', 'g') as norm
    from public.readymode_dialer_calls c
    where c.agent_id is null and nullif(trim(c.agent_raw), '') is not null
      and trim(c.agent_raw) not like '% %'
  ), candidates as (
    select r.agent_raw, a.id
    from raw_names r
    join public.agents a on a.is_inactive is not true and a.is_deactivated is not true
    left join public.profiles p on p.id = a.profile_id
    where r.norm = regexp_replace(lower(split_part(trim(coalesce(a.display_name, p.full_name, '')), ' ', 1)), '[^a-z0-9]+', '', 'g')
  ), unique_match as (
    select agent_raw, (array_agg(id order by id))[1] as agent_id from candidates group by agent_raw having count(distinct id) = 1
  )
  update public.readymode_dialer_calls c set agent_id = u.agent_id
  from unique_match u where c.agent_id is null and c.agent_raw = u.agent_raw;
  get diagnostics v_first = row_count;

  with raw_names as (
    select distinct c.agent_raw,
      regexp_replace(lower(trim(c.agent_raw)), '[^a-z0-9]+', '', 'g') as norm
    from public.readymode_dialer_calls c
    where c.agent_id is null and nullif(trim(c.agent_raw), '') is not null
  ), candidates as (
    select r.agent_raw, a.id
    from raw_names r
    join public.agents a on a.is_inactive is not true and a.is_deactivated is not true
    left join public.profiles p on p.id = a.profile_id
    where length(r.norm) >= 3
      and regexp_replace(lower(trim(coalesce(a.display_name, p.full_name, ''))), '[^a-z0-9]+', '', 'g') like r.norm || '%'
  ), unique_match as (
    select agent_raw, (array_agg(id order by id))[1] as agent_id from candidates group by agent_raw having count(distinct id) = 1
  )
  update public.readymode_dialer_calls c set agent_id = u.agent_id
  from unique_match u where c.agent_id is null and c.agent_raw = u.agent_raw;
  get diagnostics v_prefix = row_count;

  update public.readymode_dialer_calls c
  set matched_lead_id = l.id
  from public.aged_leads l
  where c.matched_lead_id is null and c.lead_phone is not null
    and regexp_replace(c.lead_phone, '\D', '', 'g') = regexp_replace(l.phone, '\D', '', 'g')
    and length(regexp_replace(c.lead_phone, '\D', '', 'g')) >= 10;
  get diagnostics v_leads = row_count;

  return jsonb_build_object(
    'matched_agents', v_email + v_exact + v_first + v_prefix,
    'by_email', v_email, 'by_exact_name', v_exact,
    'by_unique_first_name', v_first, 'by_unique_prefix', v_prefix,
    'matched_leads', v_leads
  );
end;
$$;

revoke all on function public.fn_match_readymode_calls() from public, anon;
grant execute on function public.fn_match_readymode_calls() to authenticated, service_role;
