-- PL-SEC-PRODUCTION-SCOPE (2026-10-16): production numbers follow the book rule.
--
-- The production book is Sam's and Aisha's (book_readers / api_is_full_reader); everyone else sees
-- their own production and their downline's (apex_can_read_agent). Four SECURITY DEFINER functions
-- still used the pre-lockdown staff set instead:
--   leaderboard_board / leaderboard_book_hero / producer_profile_detail gated on
--   crm_can_read_agent_scope (admin OR va OR va_manager OR own team), and production_period_totals
--   on is_agency_staff (admin, va, va_manager).
-- So a VA or VA manager got the whole agency's board, hero and period totals ($86,843.84 / 50
-- deals, the same as Sam) and any producer's recent deals and contracts, while Aisha got her own
-- downline only (2 producers, $14,456.52) and production_period_totals refused her.
--
-- production_can_read_agent = full-book reader OR own team. It replaces crm_can_read_agent_scope in
-- these three functions only (CRM functions keep the VA scope they need for onboarding and
-- contracting). The external-gap rows (agency production with no Apex agent) follow the same book
-- rule: full-book readers, not admins only, so Aisha's totals equal Sam's.
--
-- Also: Aisha reads production_external_daily_snapshots (the gap rows behind Agency Production,
-- admin-only until now, which left her $28,959 short) and every agentlink_clients record (she saw
-- 141 of 2,025, so most book rows had no phone or birth date for her).

create or replace function public.production_can_read_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.api_is_full_reader() or public.apex_can_read_agent(p_agent_id)
$fn$;
comment on function public.production_can_read_agent(uuid) is
  'Production visibility for one agent: full-book readers (admins and book_readers) see every agent; everyone else sees themselves and their downline (apex_can_read_agent). Not for CRM scope.';
revoke all on function public.production_can_read_agent(uuid) from public, anon;
grant execute on function public.production_can_read_agent(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leaderboard_board(p_start date, p_end date)
 RETURNS TABLE(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric, est_earnings numeric, lead_cost numeric, first_policy_date date, tenure_label text, weeks_with_agency integer, agency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible as (
    select t.* from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (public.api_is_full_reader() or (t.agent_id is not null and public.production_can_read_agent(t.agent_id)))
  ), grouped as (
    select coalesce(v.agent_id::text, 'name:' || lower(btrim(v.agent_name))) as agent_key, v.agent_id,
           min(v.agent_name) as raw_name, count(*) as deals, sum(v.annual_premium) as ap,
           sum(v.direct_estimate) as est_earnings, mode() within group (order by m.agency) as agency
    from visible v left join public.mv_production_comp_truth m on m.row_key = v.row_key
    where v.posted_date >= p_start and v.posted_date < p_end group by 1, 2
  ), lifetime as (
    select coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key, min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) in (select g.agent_key from grouped g) group by 1
  ), producers as (
    select g.agent_key, g.agent_id, coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name, pr.avatar_url,
      g.deals, g.ap, g.est_earnings, 0::numeric as lead_cost, l.first_policy_date,
      case when l.first_policy_date is null then 'New'
        when current_date - l.first_policy_date < 7 then (current_date - l.first_policy_date)::int || ' days in'
        when current_date - l.first_policy_date < 56 then ((current_date - l.first_policy_date) / 7)::int || ' weeks in'
        when current_date - l.first_policy_date < 365 then ((current_date - l.first_policy_date) / 30)::int || ' months in'
        else round(((current_date - l.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in' end as tenure_label,
      greatest(((current_date - l.first_policy_date) / 7)::int, 0) as weeks_with_agency, g.agency
    from grouped g left join lifetime l on l.agent_key = g.agent_key
    left join public.agents a on a.id = g.agent_id left join public.profiles pr on pr.id = a.profile_id
  ), gap as (
    -- Agency-level production not yet attributed to a seller. Visible to admins,
    -- and to anyone who can see the agency head (Vantage gap belongs to the head).
    select c.agency, count(*) as deals, sum(c.annual_premium) as ap, max(c.posted_date) as last_posted
    from public.mv_production_comp_truth c
    where c.origin = 'external_daily_gap' and c.posted_date >= p_start and c.posted_date < p_end
      and public.api_is_full_reader()
    group by c.agency
  )
  select * from producers
  union all
  select 'gap:' || g.agency, null::uuid, g.agency || ' · agency total (sellers not synced yet)', null,
         g.deals, g.ap, 0::numeric, 0::numeric, null::date, 'agency', 0, g.agency
  from gap g
  order by ap desc nulls last, deals desc, agent_name asc;
$function$;

CREATE OR REPLACE FUNCTION public.leaderboard_book_hero()
 RETURNS TABLE(total_ap numeric, producers bigint, deal_count bigint, prior_ap numeric, day_of_month integer, days_in_month integer, external_gap_ap numeric, external_gap_deals bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with nowp as (
    select (now() at time zone 'America/Phoenix')::date d
  ), bounds as (
    select date_trunc('month', d)::date cur_start,
      (date_trunc('month', d) + interval '1 month')::date cur_end,
      (date_trunc('month', d) - interval '1 month')::date prior_start,
      date_trunc('month', d)::date prior_end,
      extract(day from d)::int dom,
      extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int dim
    from nowp
  ), visible as (
    select u.*
    from public.v_production_unified u
    where (
      u.origin = 'external_daily_gap' and public.api_is_full_reader()
    ) or (
      u.origin is distinct from 'external_daily_gap'
      and (
        public.api_is_full_reader()
        or (u.agent_id is not null and public.production_can_read_agent(u.agent_id))
      )
    )
  ), cur as (
    select
      coalesce(sum(u.annual_premium) filter (
        where u.origin is distinct from 'external_daily_gap'), 0) ap,
      count(*) filter (
        where u.origin is distinct from 'external_daily_gap') dc,
      count(distinct coalesce(m.canonical_agent_id, u.agent_id))
        filter (where u.origin is distinct from 'external_daily_gap') prod,
      coalesce(sum(u.annual_premium) filter (
        where u.origin = 'external_daily_gap'), 0) gap_ap,
      count(*) filter (where u.origin = 'external_daily_gap') gap_dc
    from visible u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    cross join bounds
    where u.posted_date >= bounds.cur_start and u.posted_date < bounds.cur_end
  ), prior as (
    select coalesce(sum(u.annual_premium) filter (
      where u.origin is distinct from 'external_daily_gap'), 0) ap
    from visible u cross join bounds
    where u.posted_date >= bounds.prior_start and u.posted_date < bounds.prior_end
  )
  select cur.ap, cur.prod, cur.dc, prior.ap, bounds.dom, bounds.dim,
         cur.gap_ap, cur.gap_dc
  from cur, prior, bounds;
$function$;

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
begin
  if p_agent_id is null then return null; end if;

  select exists(select 1 from public.agents where id=p_agent_id and user_id=auth.uid()) into v_self;
  if not (v_self or public.production_can_read_agent(p_agent_id)) then
    raise exception 'not authorised to read this producer profile';
  end if;

  select * into v_row from public.crm_agent_roster_unguarded(p_agent_id);
  if not found then return null; end if;

  select jsonb_build_object(
    'agent',to_jsonb(v_row),
    'monthly',coalesce((
      select jsonb_agg(m order by m.month) from (
        select to_char(date_trunc('month',b.posted_date),'YYYY-MM') as month,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.v_production_unified b
        where b.agent_id=p_agent_id and b.posted_date is not null
          and b.posted_date >= (date_trunc('month',(now() at time zone 'America/Phoenix')::date)-interval '11 months')::date
        group by 1
      ) m
    ),'[]'::jsonb),
    'carriers',coalesce((
      select jsonb_agg(c order by c.alp desc) from (
        select coalesce(b.carrier,'(no carrier on file)') as carrier,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.v_production_unified b where b.agent_id=p_agent_id group by 1
      ) c
    ),'[]'::jsonb),
    'recent_deals',coalesce((
      select jsonb_agg(d order by d.posted_date desc) from (
        select b.posted_date,b.carrier,b.product,b.status,
               round(b.annual_premium)::numeric as annual_premium
        from public.v_production_unified b
        where b.agent_id=p_agent_id and b.posted_date is not null
        order by b.posted_date desc limit 10
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
               coalesce((select round(sum(b.annual_premium)) from public.v_production_unified b
                 where b.agent_id=d.id and b.posted_date >= date_trunc('month',(now() at time zone 'America/Phoenix')::date)::date),0)::numeric as mtd_alp
        from public.agents d left join public.profiles pd on pd.user_id=d.user_id
        where coalesce(d.manager_id,d.invited_by_manager_id)=p_agent_id
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

CREATE OR REPLACE FUNCTION public.production_period_totals()
 RETURNS TABLE(week_alp numeric, week_deals integer, month_alp numeric, month_deals integer, year_alp numeric, year_deals integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.api_is_full_reader() then
    raise exception 'production_period_totals: caller cannot read the full book'
      using errcode = '42501';
  end if;

  return query
  with b as (
    select (now() at time zone 'America/Phoenix')::date as d
  ),
  bounds as (
    select
      d - extract(dow from d)::int as week_start,
      date_trunc('month', d)::date as month_start,
      date_trunc('year',  d)::date as year_start
    from b
  ),
  u as (
    select annual_premium, posted_date
    from public.v_production_unified
    where origin <> 'external_daily_gap'
      and agent_id is not null
  )
  select
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.week_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.week_start)::integer,
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.month_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.month_start)::integer,
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.year_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.year_start)::integer
  from u cross join bounds;
end;
$function$;

drop policy if exists production_external_daily_snapshots_book_readers_read on public.production_external_daily_snapshots;
create policy production_external_daily_snapshots_book_readers_read on public.production_external_daily_snapshots
  for select to authenticated using ((select public.api_is_full_reader()));

drop policy if exists agentlink_clients_book_readers_read on public.agentlink_clients;
create policy agentlink_clients_book_readers_read on public.agentlink_clients
  for select to authenticated using ((select public.api_is_full_reader()));
