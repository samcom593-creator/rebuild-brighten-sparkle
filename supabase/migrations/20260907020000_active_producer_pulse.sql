-- Keep historical attribution while excluding departed agents from live action queues.
CREATE OR REPLACE VIEW public.v_producer_pulse AS
 WITH today AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS d
        ), sales AS (
         SELECT COALESCE(m.canonical_agent_id, b.agent_id) AS canon,
            max(b.posted_date) AS last_sale,
            count(*) FILTER (WHERE b.posted_date = (( SELECT today.d
                   FROM today))) AS deals_today,
            COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date = (( SELECT today.d
                   FROM today))), 0::numeric) AS ap_today,
            count(*) FILTER (WHERE b.posted_date >= ((( SELECT today.d
                   FROM today)) - 7)) AS deals_7d,
            COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= ((( SELECT today.d
                   FROM today)) - 7)), 0::numeric) AS ap_7d,
            count(*) FILTER (WHERE b.posted_date >= date_trunc('month'::text, (( SELECT today.d
                   FROM today))::timestamp with time zone)::date) AS deals_mtd,
            COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('month'::text, (( SELECT today.d
                   FROM today))::timestamp with time zone)::date), 0::numeric) AS ap_mtd
           FROM public.v_production_canonical b
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = b.agent_id
          WHERE NOT fn_agent_is_roster_excluded(b.agent_id)
          GROUP BY (COALESCE(m.canonical_agent_id, b.agent_id))
        )
 SELECT r.id AS agent_id,
    r.display_name AS agent_name,
    r.agent_code,
    r.manager_id,
    COALESCE(mgr.display_name, 'Direct to Sam'::text) AS leg,
    r.license_status,
    r.roster_state,
    s.last_sale,
    (( SELECT today.d
           FROM today)) - s.last_sale AS days_since_sale,
    (( SELECT count(*) AS count
           FROM generate_series((COALESCE(s.last_sale, ( SELECT today.d
                   FROM today)) + 1)::timestamp with time zone, (( SELECT today.d
                   FROM today))::timestamp with time zone, '1 day'::interval) g(day)
          WHERE EXTRACT(isodow FROM g.day) < 6::numeric))::integer AS business_days_quiet,
    COALESCE(s.deals_today, 0::bigint)::integer AS deals_today,
    COALESCE(s.ap_today, 0::numeric) AS ap_today,
    COALESCE(s.deals_7d, 0::bigint)::integer AS deals_7d,
    COALESCE(s.ap_7d, 0::numeric) AS ap_7d,
    COALESCE(s.deals_mtd, 0::bigint)::integer AS deals_mtd,
    COALESCE(s.ap_mtd, 0::numeric) AS ap_mtd,
        CASE
            WHEN COALESCE(s.deals_today, 0::bigint) > 0 THEN 'sold_today'::text
            WHEN s.last_sale IS NULL THEN 'never_sold'::text
            ELSE
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM generate_series((s.last_sale + 1)::timestamp with time zone, (( SELECT today.d
                           FROM today))::timestamp with time zone, '1 day'::interval) g(day)
                  WHERE EXTRACT(isodow FROM g.day) < 6::numeric)) >= 10 THEN 'cold'::text
                WHEN (( SELECT count(*) AS count
                   FROM generate_series((s.last_sale + 1)::timestamp with time zone, (( SELECT today.d
                           FROM today))::timestamp with time zone, '1 day'::interval) g(day)
                  WHERE EXTRACT(isodow FROM g.day) < 6::numeric)) >= 5 THEN 'slipping'::text
                WHEN (( SELECT count(*) AS count
                   FROM generate_series((s.last_sale + 1)::timestamp with time zone, (( SELECT today.d
                           FROM today))::timestamp with time zone, '1 day'::interval) g(day)
                  WHERE EXTRACT(isodow FROM g.day) < 6::numeric)) >= 1 THEN 'quiet'::text
                ELSE 'quiet'::text
            END
        END AS pulse
   FROM v_apex_roster r
     LEFT JOIN sales s ON s.canon = r.id
     LEFT JOIN agents mgr ON mgr.id = r.manager_id
  WHERE r.is_producing
    AND r.id <> '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    AND NOT public.fn_agent_is_roster_excluded(r.id)
    AND EXISTS (SELECT 1 FROM public.agents active_agent
      WHERE active_agent.id = r.id
        AND active_agent.is_deactivated IS NOT TRUE
        AND active_agent.is_inactive IS NOT TRUE
        AND lower(coalesce(active_agent.status::text, '')) NOT IN ('terminated', 'inactive', 'deactivated'))
  ORDER BY (COALESCE(s.deals_today, 0::bigint) > 0) DESC, s.last_sale DESC NULLS LAST;
