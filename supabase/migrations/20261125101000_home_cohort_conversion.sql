-- Recruiting activity counts and conversion rates answer different questions.
-- Keep the existing event lists, add explicitly linked outcomes for one intake cohort.
begin;

create or replace function public.home_application_cohort(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $cohort$
declare v_today date := (now() at time zone 'America/Phoenix')::date; v_result jsonb;
begin
  if auth.uid() is null or not public.apex_is_admin()
    or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end > v_today + 1 or p_end-p_start > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  with application_records as materialized (
    select a.id,a.created_at,coalesce(a.is_duplicate,false) as duplicate,
      coalesce('email:' || lower(nullif(btrim(a.email),'')),
        case when length(regexp_replace(coalesce(a.phone,''),'\D','','g'))>=10
          then 'phone:' || right(regexp_replace(a.phone,'\D','','g'),10) end,
        'application:' || a.id::text) as person_key
      from public.applications a
     where a.record_type='application' and not coalesce(a.tags @> array['xcel_roster']::text[],false)
       and a.created_at <= now()
  ), first_applications as (
    select distinct on (person_key) person_key,id,created_at
      from application_records where not duplicate order by person_key,created_at,id
  ), cohort as materialized (
    select f.*,array(select a.id from application_records a where a.person_key=f.person_key) as application_ids
      from first_applications f
     where f.created_at >= (p_start::timestamp at time zone 'America/Phoenix')
       and f.created_at < ((p_end+1)::timestamp at time zone 'America/Phoenix')
  ), linked as materialized (
    select c.*,
      array(select distinct coalesce(a.canonical_agent_id,a.id) from public.agents a
        where a.source_application_id=any(c.application_ids) and a.created_at<=now()
          and not public.is_placeholder_agent(a.agent_code,a.user_id)) as agent_ids,
      exists(select 1 from public.interview_events i
        where i.application_id=any(c.application_ids) and i.call_track in ('licensed','leader')
          and i.canceled_at is null and i.created_at>=c.created_at and i.created_at<=now()) as booked
      from cohort c
  ), outcomes as (
    select l.*,exists(select 1 from public.mv_production_comp_truth p
      where p.agent_id=any(l.agent_ids) and p.origin<>'external_daily_gap'
        and p.posted_date >= (l.created_at at time zone 'America/Phoenix')::date
        and p.posted_date<=v_today
        and (p.origin<>'apex_native' or exists(select 1 from public.deals nd
          where nd.id::text=p.row_key and nd.posted_at<=now()))) as posted
      from linked l
  )
  select jsonb_build_object(
    'viewer_user_id',auth.uid(),'start',p_start,'end',p_end,'observed_through',now(),
    'applications',count(*),
    'booked',count(*) filter(where booked),
    'linked_producers',count(*) filter(where cardinality(agent_ids)>0),
    'posted',count(*) filter(where posted),
    'without_producer_link',count(*) filter(where cardinality(agent_ids)=0),
    'basis','First genuine application per email, otherwise phone, otherwise application ID in the selected Phoenix dates. Bookings require an application ID link and creation after intake. Producer outcomes require source_application_id; production is posted on or after the intake business day. Each numerator is a subset of these applicants. Outcomes are observed through this read; unlinked events are not inferred.'
  ) into v_result from outcomes;
  return v_result;
end $cohort$;
revoke all on function public.home_application_cohort(date,date) from public, anon, authenticated;

-- Preserve the deployed single-flight wrapper and its per-account cache key.
do $patch$
declare old_definition text; new_definition text;
begin
  select pg_get_functiondef('public.home_conversion_people_range_uncached(date,date)'::regprocedure) into old_definition;
  if position('return v_out;' in old_definition)=0 then
    raise exception 'Home conversion contract changed; review the cohort extension';
  end if;
  new_definition := replace(old_definition,'return v_out;',
    'return v_out || jsonb_build_object(''viewer_user_id'',auth.uid(),''cohort'',public.home_application_cohort(p_start,p_end));');
  execute new_definition;
end $patch$;

commit;
