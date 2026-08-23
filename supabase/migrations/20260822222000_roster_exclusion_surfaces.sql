-- Roster-excluded agents disappear from every headline Sam reads.

-- Predicate is single-sourced in fn_agent_is_roster_excluded so the

-- leaderboard list and the hero total can never disagree again.


create or replace function public.fn_agent_is_roster_excluded(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.roster_exclusions x
    where x.agent_id = coalesce(
      (select m.canonical_agent_id from public.v_agent_canonical_map m where m.agent_id = p_agent_id),
      p_agent_id)
  );
$$;
grant execute on function public.fn_agent_is_roster_excluded(uuid) to authenticated, anon;


create or replace view public.v_agentlink_book_truth as  WITH p AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS d
        )
 SELECT count(*)::integer AS total_deals,
    sum(b.annual_premium) AS total_annual_premium,
    count(*) FILTER (WHERE b.posted_date = p.d)::integer AS deals_today,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date = p.d), 0::numeric) AS premium_today,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d)::integer AS deals_this_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_week,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d)::integer AS deals_this_month,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_month,
    max(b.imported_at) AS last_synced_at,
    count(*) FILTER (WHERE b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7) AND b.posted_date <= (p.d - 7))::integer AS deals_prior_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7) AND b.posted_date <= (p.d - 7)), 0::numeric) AS premium_prior_week,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d)::integer AS deals_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d), 0::numeric) AS premium_30d,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30))::integer AS deals_prior_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30)), 0::numeric) AS premium_prior_30d
   FROM agentlink_book b,
    p
  WHERE b.is_dead IS NOT TRUE
      and not public.fn_agent_is_roster_excluded(b.agent_id);;

create or replace view public.v_top_producers_mtd as  WITH ph AS (
         SELECT date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AS month_start
        ), book AS (
         SELECT b.agent_id,
            b.user_id,
            b.agent_name,
            b.annual_premium
           FROM agentlink_book b
             CROSS JOIN ph
          WHERE b.is_dead IS NOT TRUE
      and not public.fn_agent_is_roster_excluded(b.agent_id) AND b.posted_date >= ph.month_start
        ), resolved AS (
         SELECT COALESCE(b.agent_id, ( SELECT a_1.id
                   FROM agents a_1
                  WHERE a_1.al_user_id = b.user_id
                  ORDER BY (a_1.canonical_agent_id IS NULL) DESC, a_1.created_at
                 LIMIT 1)) AS raw_agent_id,
            b.agent_name,
            b.annual_premium
           FROM book b
        ), canon AS (
         SELECT COALESCE(m.canonical_agent_id, r.raw_agent_id) AS agent_id,
            max(r.agent_name) AS book_name,
            count(*)::integer AS deals_mtd,
            sum(r.annual_premium) AS alp_mtd
           FROM resolved r
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = r.raw_agent_id
          GROUP BY (COALESCE(m.canonical_agent_id, r.raw_agent_id))
        )
 SELECT c.agent_id,
    COALESCE(a.display_name, c.book_name) AS display_name,
    c.deals_mtd,
    c.alp_mtd,
    COALESCE(mgr.display_name, '(direct to Sam)'::text) AS manager_name
   FROM canon c
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN agents mgr ON mgr.id = a.invited_by_manager_id
  WHERE COALESCE(a.is_inactive, false) = false AND COALESCE(a.is_deactivated, false) = false AND c.deals_mtd > 0
  ORDER BY c.alp_mtd DESC
 LIMIT 20;;

create or replace view public.v_team_analytics_producers as  WITH canonical AS (
         SELECT a.id AS canonical_id,
            a.display_name,
            a.agent_code,
            a.al_user_id
           FROM agents a
          WHERE a.canonical_agent_id IS NULL AND COALESCE(a.is_deactivated, false) = false
        ), book_30d AS (
         SELECT c.canonical_id,
            c.display_name,
            c.agent_code,
            count(*)::integer AS deals_30d,
            COALESCE(sum(s.annual_premium), 0::numeric) AS premium_30d,
            COALESCE(sum(s.monthly_premium), 0::numeric) AS monthly_30d,
            COALESCE(avg(s.annual_premium), 0::numeric)::numeric(12,2) AS avg_deal_size,
            max(s.posted_date) AS last_deal_date,
            c.al_user_id AS user_id
           FROM canonical c
             JOIN agentlink_book s ON s.user_id = c.al_user_id
          WHERE s.is_dead IS NOT TRUE
      and not public.fn_agent_is_roster_excluded(s.agent_id) AND s.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
          GROUP BY c.canonical_id, c.display_name, c.agent_code, c.al_user_id
        ), local_30d AS (
         SELECT c.canonical_id,
            c.display_name,
            c.agent_code,
            count(*)::integer AS deals_30d,
            COALESCE(sum(d.annual_premium), 0::numeric) AS premium_30d,
            COALESCE(sum(d.monthly_premium), 0::numeric) AS monthly_30d,
            COALESCE(avg(d.annual_premium), 0::numeric)::numeric(12,2) AS avg_deal_size,
            max(d.posted_at::date) AS last_deal_date,
            '-1'::integer AS user_id
           FROM canonical c
             JOIN deals d ON d.agent_id = c.canonical_id
          WHERE c.al_user_id IS NULL AND d.posted_at >= (now() - '30 days'::interval)
          GROUP BY c.canonical_id, c.display_name, c.agent_code
        )
 SELECT book_30d.user_id,
    book_30d.display_name AS agent_name,
    book_30d.agent_code,
    book_30d.deals_30d,
    book_30d.premium_30d,
    book_30d.monthly_30d,
    book_30d.avg_deal_size,
    book_30d.last_deal_date
   FROM book_30d
UNION ALL
 SELECT local_30d.user_id,
    local_30d.display_name AS agent_name,
    local_30d.agent_code,
    local_30d.deals_30d,
    local_30d.premium_30d,
    local_30d.monthly_30d,
    local_30d.avg_deal_size,
    local_30d.last_deal_date
   FROM local_30d
UNION ALL
 SELECT b.user_id,
    b.agent_name,
    NULL::text AS agent_code,
    count(*)::integer AS deals_30d,
    COALESCE(sum(b.annual_premium), 0::numeric) AS premium_30d,
    COALESCE(sum(b.monthly_premium), 0::numeric) AS monthly_30d,
    COALESCE(avg(b.annual_premium), 0::numeric)::numeric(12,2) AS avg_deal_size,
    max(b.posted_date) AS last_deal_date
   FROM agentlink_book b
  WHERE b.is_dead IS NOT TRUE AND b.agent_id IS NULL AND b.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
  GROUP BY b.user_id, b.agent_name
  ORDER BY 5 DESC NULLS LAST;;


CREATE OR REPLACE FUNCTION public.leaderboard_book_hero()
 RETURNS TABLE(total_ap numeric, producers bigint, deal_count bigint, prior_ap numeric, day_of_month integer, days_in_month integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- True current-month MTD. The 2026-08-01 launch guard (days 1-5 showed the prior
  -- month) made this header disagree with the rows underneath it, which run on the
  -- selected period — two different months on one screen. The public postable board
  -- (/board, leaderboard_board) owns its own milestone framing, so this one is honest.
  with nowp as (select (now() at time zone 'America/Phoenix')::date d),
  bounds as (
    select date_trunc('month', d)::date cur_start,
           (date_trunc('month', d) + interval '1 month')::date cur_end,
           (date_trunc('month', d) - interval '1 month')::date prior_start,
           date_trunc('month', d)::date prior_end,
           extract(day from d)::int dom,
           extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int dim
    from nowp),
  cur as (
    select coalesce(sum(annual_premium),0) ap, count(*) dc,
           count(distinct coalesce(agent_id::text,'name:'||lower(trim(agent_name)))) prod
    from public.agentlink_book, bounds
    where is_dead is not true and not public.fn_agent_is_roster_excluded(agentlink_book.agent_id) and posted_date >= bounds.cur_start and posted_date < bounds.cur_end),
  prior as (
    select coalesce(sum(annual_premium),0) ap
    from public.agentlink_book, bounds
    where is_dead is not true and not public.fn_agent_is_roster_excluded(agentlink_book.agent_id) and posted_date >= bounds.prior_start and posted_date < bounds.prior_end)
  select cur.ap, cur.prod, cur.dc, prior.ap, bounds.dom, bounds.dim from cur, prior, bounds
$function$
;


create or replace view public.v_imo_by_agency as  WITH vantage_ids AS (
         SELECT '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid AS id
        UNION
         SELECT agents.id
           FROM agents
          WHERE agents.manager_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
        ), scoped AS (
         SELECT b.annual_premium,
            b.posted_date,
            (a.id IN ( SELECT vantage_ids.id
                   FROM vantage_ids)) AS is_vantage
           FROM agentlink_book b
             JOIN agents a ON a.id = b.agent_id
          WHERE NOT COALESCE(b.is_dead, false) AND NOT public.fn_agent_is_roster_excluded(b.agent_id)
        )
 SELECT
        CASE
            WHEN is_vantage THEN 'Vantage Financial'::text
            ELSE 'APEX Financial'::text
        END AS agency,
    NOT is_vantage AS is_primary,
    count(*)::integer AS policies,
    round(sum(annual_premium), 0) AS alp,
    round(COALESCE(sum(annual_premium) FILTER (WHERE posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)), 0::numeric), 0) AS alp_mtd
   FROM scoped
  GROUP BY (
        CASE
            WHEN is_vantage THEN 'Vantage Financial'::text
            ELSE 'APEX Financial'::text
        END), (NOT is_vantage)
  ORDER BY (round(sum(annual_premium), 0)) DESC;;

CREATE OR REPLACE FUNCTION public.leaderboard_book(p_start date, p_end date, p_include_dead boolean DEFAULT false)
 RETURNS TABLE(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scoped as (
    select b.agent_name, b.annual_premium,
           coalesce(m.canonical_agent_id, b.agent_id) as canon
    from public.agentlink_book b
    left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
    where b.posted_date >= p_start and b.posted_date < p_end
      and (p_include_dead or not b.is_dead)
      and not public.fn_agent_is_roster_excluded(b.agent_id)
  ),
  grouped as (
    select coalesce(canon::text, 'name:' || lower(trim(agent_name))) as agent_key,
           canon as agent_id,
           min(agent_name) as raw_name,
           count(*) as deals,
           sum(annual_premium) as ap
    from scoped
    group by 1, 2
  )
  select g.agent_key, g.agent_id,
         coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name,
         pr.avatar_url, g.deals, g.ap
  from grouped g
  left join public.agents a on a.id = g.agent_id
  left join public.profiles pr on pr.id = a.user_id
  order by g.ap desc, g.deals desc;
$function$
;
