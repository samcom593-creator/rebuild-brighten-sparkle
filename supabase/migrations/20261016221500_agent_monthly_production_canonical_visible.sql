-- PL-WIB-DRAWER-MONTHLY-VISIBLE: the agent drawer's IT / AV "this month" tiles.
--
-- Two defects in one view, measured 2026-10-16 22:20Z (rolled back, as each caller):
--
-- 1. Source. The view counted legacy `deals` by posted_at in the UTC month. That table has no
--    Discord-posted deals and keys merged twins on the twin, so as Sam: Jontay Taylor 11 / $21,713
--    (canonical 17 / $34,333), Cari Mullen 0 (4 / $10,164, posted on her twin login), Michael
--    Kayembe 0 (2 / $3,179), Tyler Krejcha 0 (1 / $1,411). Now v_production_canonical folded through
--    v_agent_canonical_map, Phoenix month, like every other production surface re-sourced today.
--
-- 2. Visibility. The view is security_invoker (20260824120000 remedy A, kept), so a caller whose RLS
--    hides an agent's deals got COALESCE(..., 0): a manager or agent opening a colleague's drawer read
--    "0 items this month" as fact for 33 caller x seller pairs who had sold. production_visible is
--    now true only when the caller can read EVERY source row for that agent: a book reader / admin,
--    or the agent's own row, or a manager's downline (the deals/agentlink_book policies), AND every
--    merged twin id folded into the row is readable too. Otherwise the money columns are NULL and the
--    drawer shows the same dash it already shows for lifetime_visible. The predicate is the strict
--    side of the per-table policies, so it can show a dash where a partial number was readable, and
--    never a partial number as fact. Cari's own login reads a dash on her canonical row (its deals sit
--    on the other login); her manager reads 4 / $10,164.
--
-- monthly_premium_this_month: canonical carries annual premium only, and annual = 12 x monthly holds
-- for 1,384/1,384 book rows but 35/106 external rows, so deriving it would invent numbers. Nothing
-- reads the column (only the drawer selects from this view, and not that column); it is NULL.
--
-- Proof: website-integrity-bot/scripts/prove-monthly-production-visibility.sh (8 probes, M1 pre-image
-- flips source + 0-as-fact, M2 visibility-forced-true flips only 0-as-fact).
CREATE OR REPLACE VIEW public.v_agent_monthly_production WITH (security_invoker = true) AS
 WITH me AS (
         SELECT api_is_full_reader() AS full_reader
        ), ph AS (
         SELECT date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text))::date AS month_start
        ), prod AS (
         SELECT COALESCE(cm.canonical_agent_id, p_1.agent_id) AS seller_id,
            count(*) AS month_deals,
            sum(p_1.annual_premium) AS month_av
           FROM v_production_canonical p_1
             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p_1.agent_id,
            ph
          WHERE p_1.posted_date >= ph.month_start
          GROUP BY (COALESCE(cm.canonical_agent_id, p_1.agent_id))
        ), vis_raw AS (
         SELECT own.id
           FROM agents own
          WHERE own.user_id = auth.uid()
        UNION
         SELECT dl.agent_id
           FROM my_downline_agent_ids() dl(agent_id)
          WHERE has_role(auth.uid(), 'manager'::app_role)
        )
 SELECT a.id AS agent_id,
    COALESCE(a.display_name, p.full_name, a.agent_code, '—'::text) AS display_name,
        CASE
            WHEN v.visible THEN COALESCE(pr.month_deals, 0::bigint)::integer
            ELSE NULL::integer
        END AS items_this_month,
        CASE
            WHEN v.visible THEN COALESCE(pr.month_av, 0::numeric)
            ELSE NULL::numeric
        END AS annual_volume_this_month,
    NULL::numeric AS monthly_premium_this_month,
    COALESCE(l.legs_count, 0::bigint)::integer AS legs,
    v.visible AS production_visible
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN prod pr ON pr.seller_id = a.id
     CROSS JOIN LATERAL ( SELECT (( SELECT me.full_reader
                   FROM me)) OR (a.id IN ( SELECT vis_raw.id
                   FROM vis_raw)) AND NOT (EXISTS ( SELECT 1
                   FROM v_agent_canonical_map tw
                  WHERE tw.canonical_agent_id = a.id AND NOT (tw.agent_id IN ( SELECT vis_raw.id
                           FROM vis_raw)))) AS visible) v
     LEFT JOIN LATERAL ( SELECT count(*) AS legs_count
           FROM agents
          WHERE agents.manager_id = a.id AND agents.canonical_agent_id IS NULL) l ON true
  WHERE a.canonical_agent_id IS NULL;
