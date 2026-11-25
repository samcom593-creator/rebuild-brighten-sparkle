-- Operational producer truth: separate carrier outcomes from posting status,
-- preserve canonical personal scope, and stop future dates/agency scope leaking into pace.
begin;

create or replace function public.fn_carrier_status_label(p_bucket text)
returns text language sql immutable as $$
  select case p_bucket
    when 'quote' then 'Quote only' when 'started' then 'Application started'
    when 'pending' then 'Pending' when 'active' then 'In force'
    when 'claim' then 'Claim pending' when 'at_risk' then 'At risk'
    when 'lapsed' then 'Lapsed / cancelled' when 'not_taken' then 'Not taken'
    when 'declined' then 'Declined' when 'abandoned' then 'Abandoned' else 'Status unknown' end
$$;

CREATE OR REPLACE FUNCTION public.producer_profile_detail(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_self boolean;
  v_row record;
  v_result jsonb;
  v_requested uuid := p_agent_id;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_totals record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_agent_id is null then return null; end if;
  if public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  select coalesce(a.canonical_agent_id, a.id) into p_agent_id from public.agents a where a.id = v_requested;
  if p_agent_id is null then return null; end if;

  select exists(select 1 from public.agents where coalesce(canonical_agent_id,id)=p_agent_id and user_id=auth.uid()) into v_self;
  if not (v_self or public.production_can_read_agent(p_agent_id)) then
    raise exception 'not authorised to read this producer profile';
  end if;

  select * into v_row from public.crm_agent_roster_unguarded(p_agent_id);
  if not found then return null; end if;

  select
    coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('month',v_today)::date),0) as mtd_alp,
    count(*) filter (where b.posted_date >= date_trunc('month',v_today)::date) as mtd_deals,
    coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('month',v_today)::date and b.posted_date < v_today),0) as completed_ap,
    count(distinct b.posted_date) filter (where b.posted_date >= date_trunc('month',v_today)::date and b.posted_date < v_today and b.annual_premium > 0) as completed_active_days,
    coalesce(sum(b.annual_premium) filter (where b.posted_date >= v_today - 29),0) as l30_alp,
    count(*) filter (where b.posted_date >= v_today - 29) as l30_deals,
    coalesce(sum(b.annual_premium),0) as lifetime_alp, count(*) as lifetime_deals,
    coalesce(sum(b.direct_estimate),0) as lifetime_estimated_commission,
    min(b.posted_date) as first_posted_date, max(b.posted_date) as last_posted_date,
    max(b.synced_at) as source_updated_at
    into v_totals
    from public.mv_production_comp_truth b
   where b.agent_id = p_agent_id and b.origin <> 'external_daily_gap' and b.posted_date <= v_today
        and (b.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=b.row_key and nd.posted_at <= now()));

  select jsonb_build_object(
    'agent',to_jsonb(v_row) || (to_jsonb(v_totals) - 'lifetime_estimated_commission' - 'source_updated_at'),
    'requested_agent_id',v_requested,'viewer_user_id',auth.uid(),
    'production_summary',jsonb_build_object('lifetime_estimated_commission',v_totals.lifetime_estimated_commission,
      'source_updated_at',v_totals.source_updated_at,'as_of',v_today,
      'mtd_ap',v_totals.mtd_alp,'mtd_policies',v_totals.mtd_deals,
      'lifetime_ap',v_totals.lifetime_alp,'lifetime_policies',v_totals.lifetime_deals,
      'completed_ap',v_totals.completed_ap,'completed_active_days',v_totals.completed_active_days,
      'completed_calendar_days',extract(day from v_today)::integer-1,
      'days_in_month',extract(day from (date_trunc('month',v_today)+interval '1 month - 1 day'))::integer,
      'basis','Personal posted ALP; Phoenix dates; excludes future dates and unattributed agency totals'),
    'monthly',coalesce((
      select jsonb_agg(m order by m.month) from (
        select to_char(date_trunc('month',b.posted_date),'YYYY-MM') as month,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.mv_production_comp_truth b
        where b.agent_id=p_agent_id and b.origin <> 'external_daily_gap' and b.posted_date <= v_today
        and (b.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=b.row_key and nd.posted_at <= now()))
          and b.posted_date >= (date_trunc('month',(now() at time zone 'America/Phoenix')::date)-interval '11 months')::date
        group by 1
      ) m
    ),'[]'::jsonb),
    'carriers',coalesce((
      select jsonb_agg(c order by c.alp desc) from (
        select coalesce(b.carrier,'(no carrier on file)') as carrier,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.mv_production_comp_truth b where b.agent_id=p_agent_id and b.origin <> 'external_daily_gap' and b.posted_date <= v_today
        and (b.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=b.row_key and nd.posted_at <= now())) group by 1
      ) c
    ),'[]'::jsonb),
    'recent_deals',coalesce((
      select jsonb_agg(d order by d.posted_date desc) from (
        select b.row_key,b.client_name,b.policy_number,b.posted_date,b.carrier,b.product,
               b.status as submission_status,
               case when cp.matches = 1 then coalesce(cp.status_raw,cp.status_pre) end as status,
               case when cp.matches = 1 then coalesce(cp.status_raw,cp.status_pre) end as carrier_status,
               case when cp.matches = 1 then cp.status_bucket end as carrier_bucket,
               case when cp.matches = 1 then 'carrier' else 'unverified' end as status_source,
               round(b.annual_premium,2)::numeric as annual_premium
        from public.mv_production_comp_truth b
        left join lateral (
          select count(*) as matches,min(p.status_raw) as status_raw,min(p.status_pre) as status_pre,min(p.status_bucket) as status_bucket
            from public.carrier_book_policies p
            join public.agents pa on pa.id = p.agent_id
           where coalesce(pa.canonical_agent_id,pa.id)=p_agent_id
             and p.site_deal_id::text=b.row_key
             and (lower(p.carrier)=lower(b.carrier)
               or (p.carrier='Chubb' and lower(b.carrier) ~ '(combined|chubb)')
               or (p.carrier='Ethos' and lower(b.carrier) like '%ethos%'))
        ) cp on true
        where b.agent_id=p_agent_id and b.origin <> 'external_daily_gap' and b.posted_date <= v_today
        and (b.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=b.row_key and nd.posted_at <= now()))
        order by b.posted_date desc,b.row_key limit 25
      ) d
    ),'[]'::jsonb),
    'contracts',coalesce((
      select jsonb_agg(k order by k.status,k.carrier) from (
        select coalesce(car.name,'Carrier #'||c.insuracloud_carrier_id::text,'(unnamed carrier)') as carrier,
               coalesce(c.status,'unknown') as status,c.writing_number,c.commission_level,c.activated_date
        from public.agentlink_contracts c
        left join public.carriers car on car.id=c.carrier_id
        where c.agent_id=p_agent_id
      ) k
    ),'[]'::jsonb),
    'upline',(
      select jsonb_build_object('agent_id',u.id,'name',coalesce(pu.full_name,u.display_name,'(unnamed)'),'status',u.status::text)
      from public.agents me join public.agents u on u.id=coalesce(me.manager_id,me.invited_by_manager_id)
      left join public.profiles pu on pu.user_id=u.user_id where me.id=p_agent_id
    ),
    'downline',coalesce((
      select jsonb_agg(x order by x.mtd_alp desc nulls last,x.name) from (
        select d.id as agent_id,coalesce(pd.full_name,d.display_name,'(unnamed)') as name,
               d.status::text as status,d.license_status::text as license_status,
               coalesce((select round(sum(b.annual_premium)) from public.mv_production_comp_truth b
                 where b.agent_id=d.id and b.origin <> 'external_daily_gap' and b.posted_date <= v_today
        and (b.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=b.row_key and nd.posted_at <= now())) and b.posted_date >= date_trunc('month',(now() at time zone 'America/Phoenix')::date)::date),0)::numeric as mtd_alp
        from public.agents d left join public.profiles pd on pd.user_id=d.user_id
        where coalesce(d.manager_id,d.invited_by_manager_id)=p_agent_id and d.canonical_agent_id is null and not public.fn_agent_is_roster_excluded(d.id)
      ) x
    ),'[]'::jsonb),
    'training',(
      select jsonb_build_object(
        'modules_total',(select count(*)::int from public.onboarding_modules where is_active=true),
        'modules_passed',(select count(*)::int from public.onboarding_progress where agent_id=p_agent_id and passed=true),
        'last_activity',(select max(completed_at) from public.onboarding_progress where agent_id=p_agent_id)
      )
    )
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.producer_profile_detail(uuid) from public, anon;
grant execute on function public.producer_profile_detail(uuid) to authenticated;

-- Add identity provenance and pre-issue status without changing carrier rows or receipts.
do $patch$
declare old_definition text; new_definition text;
begin
  select pg_get_functiondef('public.agent_carrier_book(uuid)'::regprocedure) into old_definition;
  new_definition := replace(old_definition, '''agent_id'', v_canon,', '''agent_id'', v_canon, ''requested_agent_id'', p_agent_id,');
  new_definition := replace(new_definition, '''status_raw'', p.status_raw,', '''status_raw'', p.status_raw, ''status_pre'', p.status_pre, ''last_seen_on'', p.last_seen_on,');
  new_definition := replace(new_definition,
    'from cb c where public.fn_carrier_pn_key(c.policy_number) = p.policy_key',
    'from cb c where c.carrier = p.carrier and public.fn_carrier_pn_key(c.policy_number) = p.policy_key');
  new_definition := replace(new_definition, '''policies'', (select coalesce(jsonb_agg(jsonb_build_object(',
    '''carrier_sources'', (select coalesce(jsonb_agg(jsonb_build_object(''carrier'',s.carrier,''policy_count'',s.policy_count,''last_seen_on'',s.last_seen_on)),''[]''::jsonb) from (select case when carrier=''Chubb'' then ''Combined'' else carrier end as carrier,count(*) as policy_count,min(last_seen_on) as last_seen_on from p group by 1) s), ''policies'', (select coalesce(jsonb_agg(jsonb_build_object(');
  if new_definition = old_definition
    or position('''requested_agent_id''' in new_definition)=0
    or position('''status_pre'', p.status_pre' in new_definition)=0
    or position('c.carrier = p.carrier and public.fn_carrier_pn_key(c.policy_number) = p.policy_key' in new_definition)=0
    or position('''carrier_sources''' in new_definition)=0 then raise exception 'agent_carrier_book contract changed; review patch'; end if;
  execute new_definition;
end $patch$;

CREATE OR REPLACE FUNCTION public.scoped_production_projection_uncached()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month')::date;
  v_elapsed_days integer := extract(day from v_today)::integer;
  v_days_in_month integer := extract(day from (v_month_end - interval '1 day'))::integer;
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[] := '{}'::uuid[];
  v_hier_ids uuid[] := '{}'::uuid[];
  v_scope_ids uuid[] := '{}'::uuid[];
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_gap_visible boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'authentication required';
  end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid())
    into v_has_profile;

  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_personal_ids
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  where a.user_id = auth.uid();

  select coalesce(array_agg(distinct h.member)
    filter (where not public.fn_agent_is_roster_excluded(h.member)), '{}'::uuid[])
    into v_hier_ids
  from public.fn_hierarchy_first_hops(v_personal_ids) h;

  if v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
      into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    select coalesce(array_agg(distinct t.id), '{}'::uuid[])
      into v_scope_ids
    from unnest(v_personal_ids || v_hier_ids) as t(id);
  end if;

  -- A legacy aggregate Vantage snapshot is visible to the owner/admin only.
  -- It contributes to agency/IMO pace, but never to a named producer's pace.
  v_gap_visible := v_is_admin;

  with production as (
    select
      c.origin,
      c.agent_id,
      c.raw_agent_id,
      c.annual_premium,
      c.posted_date,
      (c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_self,
      c.agency, c.synced_at,
      (c.agent_id = any(v_hier_ids) and not c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_downline
    from public.mv_production_comp_truth c
    where c.posted_date >= v_month_start
      and c.posted_date <= v_today
      and (c.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=c.row_key and nd.posted_at <= now()))
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (c.origin = 'external_daily_gap' and v_gap_visible)
      )
  ), buckets as (
    select 'personal'::text as bucket, 'Personal'::text as label,
      annual_premium, posted_date
    from production where is_self
    union all
    select 'team', 'Downline only', annual_premium, posted_date from production where is_downline
    union all
    select 'imo', 'Full IMO', annual_premium, posted_date from production
      where v_is_admin
  ), bucket_metrics as (
    select bucket, label,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date) filter (where annual_premium > 0)::integer as active_days,
      coalesce(sum(annual_premium) filter (where posted_date < v_today),0) as completed_ap,
      count(distinct posted_date) filter (where posted_date < v_today and annual_premium > 0)::integer as completed_active_days
    from buckets
    group by bucket, label
  ), bucket_complete as (
    select seed.bucket, seed.label,
      coalesce(m.policies, 0) as policies,
      coalesce(m.mtd_ap, 0) as mtd_ap,
      coalesce(m.active_days, 0) as active_days,
      coalesce(m.completed_ap,0) as completed_ap,
      coalesce(m.completed_active_days,0) as completed_active_days
    from (values ('personal', 'Personal'), ('team', 'Downline only'), ('imo', 'Full IMO')) seed(bucket, label)
    left join bucket_metrics m on m.bucket = seed.bucket
    where seed.bucket <> 'imo' or v_is_admin
  ), bucket_json as (
    select jsonb_object_agg(bucket, jsonb_build_object(
      'label', label,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'completed_ap', completed_ap, 'completed_active_days', completed_active_days,
      'projected_ap', case
        when v_elapsed_days <= 3 or completed_active_days < 3 or completed_ap <= 0 then null
        else round(greatest(mtd_ap, completed_ap / (v_elapsed_days - 1) * v_days_in_month), 2)
      end,
      'estimate_status', case when v_elapsed_days <= 3 or completed_active_days < 3 or completed_ap <= 0 then 'insufficient_history' else 'run_rate' end
    )) as value
    from bucket_complete
  ), agency_metrics as (
    select agency,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date) filter (where annual_premium > 0)::integer as active_days,
      coalesce(sum(annual_premium) filter (where posted_date < v_today),0) as completed_ap,
      count(distinct posted_date) filter (where posted_date < v_today and annual_premium > 0)::integer as completed_active_days
    from production
    group by agency
  ), agencies as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'completed_ap', completed_ap, 'completed_active_days', completed_active_days,
      'projected_ap', case
        when v_elapsed_days <= 3 or completed_active_days < 3 or completed_ap <= 0 then null
        else round(greatest(mtd_ap, completed_ap / (v_elapsed_days - 1) * v_days_in_month), 2)
      end,
      'estimate_status', case when v_elapsed_days <= 3 or completed_active_days < 3 or completed_ap <= 0 then 'insufficient_history' else 'run_rate' end
    ) order by mtd_ap desc), '[]'::jsonb) as value
    from agency_metrics
  )
  select jsonb_build_object(
    'as_of', v_today,
    'month_start', v_month_start,
    'month_end_exclusive', v_month_end,
    'elapsed_calendar_days', v_elapsed_days,
    'completed_calendar_days', greatest(v_elapsed_days - 1,0),
    'method', 'completed_calendar_run_rate',
    'team_includes_personal', false,
    'last_synced_at', (select max(synced_at) from production),
    'days_in_month', v_days_in_month,
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when cardinality(v_hier_ids) = 0 then 'Personal book'
      else 'You + ' || cardinality(v_hier_ids) || ' downline'
    end,
    'personal', coalesce((select value -> 'personal' from bucket_json), '{}'::jsonb),
    'team', coalesce((select value -> 'team' from bucket_json), '{}'::jsonb),
    'imo', case when v_is_admin then (select value -> 'imo' from bucket_json) else null end,
    'agencies', (select value from agencies),
    'basis', 'Arithmetic run rate = posted ALP through yesterday / completed Phoenix calendar days x days in the month, at least current MTD. Requires three completed days with posted production. Today is excluded from the pace sample; future-dated rows are excluded. Downline excludes personal production. This estimate does not predict issued or paid business.'
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.scoped_production_projection_uncached() from public, anon, authenticated;

-- Keep the established scoreboard/earnings contract, but add an explicit personal-excluded
-- team total derived from exactly its authorized and deduplicated producer rows.
do $rename$
begin
  if to_regprocedure('public.scoped_production_scoreboard_before_outcomes(date,date)') is null then
    alter function public.scoped_production_scoreboard_uncached(date,date) rename to scoped_production_scoreboard_before_outcomes;
  end if;
end $rename$;
revoke all on function public.scoped_production_scoreboard_before_outcomes(date,date) from public, anon, authenticated;
create or replace function public.scoped_production_scoreboard_uncached(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb; downline jsonb;
begin
  v := public.scoped_production_scoreboard_before_outcomes(p_start,p_end);
  select jsonb_build_object('ap',coalesce(sum((r->>'ap')::numeric),0),
    'policies',coalesce(sum((r->>'policies')::integer),0), 'agents',count(*)) into downline
    from jsonb_array_elements(coalesce(v->'by_agent','[]'::jsonb)) r
   where coalesce((r->>'is_self')::boolean,false)=false
     and coalesce((r->>'external')::boolean,false)=false
     and nullif(r->>'first_hop_id','') is not null;
  return v || jsonb_build_object('downline_only',downline);
end $fn$;
revoke all on function public.scoped_production_scoreboard_uncached(date,date) from public, anon, authenticated;

-- The existing per-user 15-second cache expires normally; no source records are changed.


-- A bounded submission cohort: distinct native site deals posted in the requested
-- Phoenix dates. Persisted site_deal_id + carrier + canonical writer matching only. No name matching,
-- no default Submitted status, no active=>paid inference, no source-record rewrites.
create or replace function public.production_policy_cohort(p_start date,p_end date,p_agent_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_admin boolean := public.apex_is_admin();
  v_personal uuid[] := '{}'; v_downline uuid[] := '{}'; v_target uuid; v_result jsonb;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end > v_today + 1 or p_end-p_start > 3660 then
    raise exception 'Invalid Phoenix date window' using errcode = '22023';
  end if;
  if p_agent_id is not null then
    select coalesce(canonical_agent_id,id) into v_target from public.agents where id=p_agent_id;
    if v_target is null or not (exists(select 1 from public.agents a
      where coalesce(a.canonical_agent_id,a.id)=v_target and a.user_id=auth.uid())
      or public.production_can_read_agent(v_target)) then
      raise exception 'Producer not found or access denied' using errcode = '42501';
    end if;
    v_personal := array[v_target];
  else
    select coalesce(array_agg(distinct coalesce(canonical_agent_id,id)),'{}'::uuid[]) into v_personal
      from public.agents where user_id=auth.uid();
    select coalesce(array_agg(distinct h.member) filter (where not h.member=any(v_personal)),'{}'::uuid[]) into v_downline
      from public.fn_hierarchy_first_hops(v_personal) h;
  end if;

  with native_rows as materialized (
    select d.id,coalesce(a.canonical_agent_id,a.id) as agent_id,d.annual_premium,
      (d.posted_at at time zone 'America/Phoenix')::date as posted_date,
      d.posted_at, d.carrier_id, c.name as carrier
    from public.deals d
    join public.agents a on a.id=d.agent_id
    left join public.carriers c on c.id=d.carrier_id
    where d.source::text='apex_native' and d.posted_at is not null and d.posted_at <= now()
      and lower(coalesce(d.status,'')) not in ('draft','duplicate')
      and (d.posted_at at time zone 'America/Phoenix')::date <= v_today
      and (coalesce(a.canonical_agent_id,a.id)=any(v_personal || v_downline)
        or (p_agent_id is null and v_admin))
  ), cohort as materialized (
    select * from native_rows where posted_date >= p_start and posted_date < p_end
  ), matched as materialized (
    select d.*,m.matches,
      case when m.matches=1 then m.status_bucket end as source_bucket,
      case when m.matches=1 then m.pre_status end as pre_status,
      case when m.matches=1 then m.raw_status end as raw_status,
      case when m.matches=1 then m.carrier_premium end as carrier_premium,
      case when m.matches=1 then m.last_seen_on end as last_seen_on,
      case when m.matches=1 then m.carrier end as matched_carrier
      from cohort d
      left join lateral (
        select count(*) as matches,min(p.status_bucket) as status_bucket,min(p.status_raw) as raw_status,min(p.status_pre) as pre_status,
          min(p.annual_premium) as carrier_premium,min(p.last_seen_on) as last_seen_on,min(p.carrier) as carrier
          from public.carrier_book_policies p
          join public.agents pa on pa.id=p.agent_id
         where coalesce(pa.canonical_agent_id,pa.id)=d.agent_id
           and p.site_deal_id=d.id
           and (lower(p.carrier)=lower(d.carrier)
             or (p.carrier='Chubb' and lower(d.carrier) ~ '(combined|chubb)')
             or (p.carrier='Ethos' and lower(d.carrier) like '%ethos%'))
      ) m on true
  ), evidence as (
    select m.*,
      coalesce(nullif(public.fn_carrier_status_bucket(matched_carrier,raw_status,pre_status,null),'unknown'),source_bucket) as bucket,
      case when source_bucket in ('lapsed','declined','not_taken','abandoned')
        and ((public.fn_carrier_status_bucket(matched_carrier,raw_status,pre_status,null) not in ('unknown',source_bucket))
          or upper(coalesce(raw_status,'')) in ('PAID','ISSUED AND PAID','ISSUED_AND_PAID')) then true
        else false end as conflict,
      case when source_bucket='active' and ((matched_carrier='Ethos' and upper(btrim(raw_status))='PREMIUM_PAYING')
        or upper(btrim(raw_status)) in ('PAID','ISSUED AND PAID','ISSUED_AND_PAID')) then true else false end as paying
      from matched m
  ), supported as (
    select e.*,
      matches=1 and not conflict and bucket in ('pending','active','claim','at_risk','lapsed','declined','not_taken','abandoned') as status_known,
      matches=1 and not conflict and (paying
        or (bucket='pending' and upper(btrim(raw_status)) in ('PENDING_INITIAL_PREMIUM','ISSUED_NOT_PAID','ISSUED, NOT PAID'))
        or bucket in ('declined','not_taken','abandoned')) as payment_supported
      from evidence e
  ), scoped as (
    select 'personal'::text as scope,s.* from supported s where agent_id=any(v_personal)
    union all select 'downline',s.* from supported s where p_agent_id is null and agent_id=any(v_downline)
    union all select 'agency',s.* from supported s where p_agent_id is null and v_admin
  ), totals as (
    select scope,count(*) as posted_policies,
      case when count(*) filter (where annual_premium is null)=0 then coalesce(sum(annual_premium),0) end as posted_ap,
      count(*) filter (where matches=1) as matched_policies,
      count(*) filter (where matches=0) as unmatched_policies,
      count(*) filter (where matches>1) as ambiguous_policies,
      count(*) filter (where status_known) as status_known_policies,
      count(*) filter (where payment_supported) as payment_supported_policies,
      count(*) filter (where paying and not conflict) as paying_status_policies,
      case when count(*) filter (where matches=1)>0
        and count(*) filter (where paying and not conflict and carrier_premium is null)=0
        then coalesce(sum(carrier_premium) filter (where paying and not conflict),0) end as paying_status_ap,
      count(*) filter (where status_known and bucket in ('active','claim')) as in_force_policies,
      count(*) filter (where status_known and bucket='pending') as pending_policies,
      count(*) filter (where status_known and bucket in ('declined','not_taken','abandoned')) as not_placed_policies,
      count(*) filter (where status_known and bucket='at_risk') as at_risk_policies,
      count(*) filter (where status_known and bucket='lapsed') as lapsed_policies,
      count(*) filter (where conflict) as conflicting_policies,
      min(last_seen_on) as oldest_observed_on,max(last_seen_on) as newest_observed_on
      from scoped group by scope
  ), complete as (
    select seed.scope,coalesce(t.posted_policies,0) as posted_policies,
      case when t.scope is null then 0 else t.posted_ap end as posted_ap,
      coalesce(t.matched_policies,0) as matched_policies,coalesce(t.unmatched_policies,0) as unmatched_policies,
      coalesce(t.ambiguous_policies,0) as ambiguous_policies,coalesce(t.status_known_policies,0) as status_known_policies,
      coalesce(t.payment_supported_policies,0) as payment_supported_policies,coalesce(t.paying_status_policies,0) as paying_status_policies,
      t.paying_status_ap,coalesce(t.in_force_policies,0) as in_force_policies,coalesce(t.pending_policies,0) as pending_policies,
      coalesce(t.not_placed_policies,0) as not_placed_policies,coalesce(t.at_risk_policies,0) as at_risk_policies,
      coalesce(t.lapsed_policies,0) as lapsed_policies,coalesce(t.conflicting_policies,0) as conflicting_policies,
      t.oldest_observed_on,t.newest_observed_on
      from (values ('personal'),('downline'),('agency')) seed(scope)
      left join totals t using(scope)
      where seed.scope='personal' or (p_agent_id is null and (seed.scope='downline' or v_admin))
  )
  select jsonb_build_object('viewer_user_id',auth.uid(),'requested_agent_id',p_agent_id,'agent_id',v_target,
    'window',jsonb_build_object('start',p_start,'end_exclusive',p_end),'as_of',now(),'timezone','America/Phoenix',
    'scopes',(select jsonb_object_agg(scope,to_jsonb(c)-'scope') from complete c),
    'basis','Distinct native site deal IDs by posted Phoenix date, excluding persisted draft/duplicate statuses and future timestamps. Current carrier status requires one exact persisted site_deal_id, canonical writer and carrier link. Policy numbers never merge applications or infer links. Paying-status rate is unavailable unless every application has supported payment evidence. Status observations are not dated premium receipts.') into v_result;
  return v_result;
end $fn$;
revoke all on function public.production_policy_cohort(date,date,uuid) from public, anon;
grant execute on function public.production_policy_cohort(date,date,uuid) to authenticated;

commit;
