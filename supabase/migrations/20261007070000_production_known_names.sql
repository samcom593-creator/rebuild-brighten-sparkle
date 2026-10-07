-- Production: drop only AgentLink rows that belong to nobody at Apex (2026-10-07).
--
-- 20261007010000 dropped EVERY unattributed AgentLink row, but only in
-- v_production_comp_truth. Two problems, both measured live:
-- 1) The leaderboard hero, home cards and producer pulse read v_production_unified ->
--    v_production_canonical, which still carried them: the October hero said
--    $1,866,048.92 of which $1,821,600 was 'Willard Herald' (Newbridge, 2026-10-02),
--    a stranger in the book. Real October-to-date production was ~$44,449.
-- 2) The blanket rule also hid Raheem Sheikh (licensed Apex applicant since
--    2026-05-20; 6 policies, $7,733.64, June-July) because he has no agent row.
-- Fix at the shared base: an unattributed AgentLink row stays when its writing-agent
-- name matches an Apex agent or applicant, and is dropped only when it matches nobody.
-- comp_truth's own blanket filter is removed because the base now decides.

create or replace function public.fn_book_agent_name_known(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with n as (select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) as v)
  select (select v from n) <> '' and (
    exists (select 1 from public.agents a, n
            where lower(regexp_replace(btrim(coalesce(a.display_name, '')), '\s+', ' ', 'g')) = n.v)
    or exists (select 1 from public.applications ap, n
               where lower(regexp_replace(btrim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '')), '\s+', ' ', 'g')) = n.v)
  )
$fn$;
comment on function public.fn_book_agent_name_known(text) is
  'True when a book writing-agent name matches an Apex agent display name or an applicant first+last name (case/space-insensitive). Used to keep real but unlinked producers and drop strangers.';
grant execute on function public.fn_book_agent_name_known(text) to authenticated, service_role;

create or replace view public.v_production_canonical with (security_invoker = on) as
select c.* from (
 WITH external_ranked AS (
         SELECT e.id,
            e.source,
            e.external_ref,
            e.agency_name,
            e.agent_id,
            e.agent_name,
            e.carrier,
            e.product,
            e.policy_number,
            e.monthly_premium,
            e.annual_premium,
            e.face_amount,
            e.occurred_at,
            e.posted_date,
            e.status,
            e.metadata,
            e.created_at,
            e.updated_at,
            COALESCE(m.canonical_agent_id, e.agent_id) AS canonical_agent_id,
            row_number() OVER (PARTITION BY (COALESCE(m.canonical_agent_id, e.agent_id)), e.posted_date, e.annual_premium, (COALESCE(e.face_amount, 0::numeric)), (lower(btrim(COALESCE(e.carrier, ''::text)))) ORDER BY e.occurred_at, e.external_ref)::integer AS match_rank
           FROM production_external_deals e
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = e.agent_id
          WHERE (lower(COALESCE(e.status, ''::text)) <> ALL (ARRAY['duplicate'::text, 'lapsed'::text, 'cancelled'::text, 'charged_back'::text, 'withdrawn'::text, 'not_taken'::text, 'declined'::text])) AND NOT fn_agent_is_roster_excluded(e.agent_id)
        ), agentlink_match_counts AS (
         SELECT COALESCE(m.canonical_agent_id, b.agent_id) AS canonical_agent_id,
            b.posted_date,
            b.annual_premium,
            COALESCE(b.face_amount, 0::numeric) AS face_amount,
            lower(btrim(COALESCE(b.carrier, ''::text))) AS carrier_key,
            count(*)::integer AS matched_rows
           FROM v_agentlink_book_scoped b
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = b.agent_id
          WHERE b.is_dead IS NOT TRUE
          GROUP BY (COALESCE(m.canonical_agent_id, b.agent_id)), b.posted_date, b.annual_premium, (COALESCE(b.face_amount, 0::numeric)), (lower(btrim(COALESCE(b.carrier, ''::text))))
        )
 SELECT b.deal_key AS row_key,
    'agentlink'::text AS origin,
    b.agent_id,
    b.agent_name,
    b.client_name,
    b.carrier,
    b.product,
    b.policy_number,
    b.annual_premium,
    b.posted_date,
    b.effective_date,
    b.status,
    b.imported_at AS synced_at
   FROM v_agentlink_book_scoped b
  WHERE b.is_dead IS NOT TRUE
UNION ALL
 SELECT d.id::text AS row_key,
    'apex_native'::text AS origin,
    d.agent_id,
    COALESCE(ag.display_name, 'Agent'::text) AS agent_name,
    btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)) AS client_name,
    c.name AS carrier,
    d.product_sold AS product,
    d.policy_number,
    d.annual_premium,
    COALESCE(d.posted_at::date, d.created_at::date) AS posted_date,
    d.effective_date,
    d.status,
    d.created_at AS synced_at
   FROM deals d
     LEFT JOIN agents ag ON ag.id = d.agent_id
     LEFT JOIN carriers c ON c.id = d.carrier_id
  WHERE d.agent_id IS NOT NULL AND d.annual_premium IS NOT NULL AND d.source::text = 'apex_native'::text AND (lower(COALESCE(d.status, ''::text)) <> ALL (ARRAY['lapsed'::text, 'cancelled'::text, 'charged_back'::text, 'withdrawn'::text, 'not_taken'::text, 'declined'::text])) AND NOT fn_agent_is_roster_excluded(d.agent_id) AND NOT (EXISTS ( SELECT 1
           FROM v_agentlink_book_scoped b
          WHERE NULLIF(btrim(COALESCE(b.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(COALESCE(d.policy_number, ''::text))))) AND NOT (EXISTS ( SELECT 1
           FROM v_agentlink_book_scoped b2
          WHERE b2.agent_id = d.agent_id AND b2.annual_premium = d.annual_premium AND b2.effective_date = d.effective_date AND lower(btrim(COALESCE(b2.client_name, ''::text))) = lower(btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)))))
UNION ALL
 SELECT (('external-deal:'::text || e.source) || ':'::text) || e.external_ref AS row_key,
    'discord_external'::text AS origin,
    e.agent_id,
    e.agent_name,
    NULL::text AS client_name,
    e.carrier,
    e.product,
    e.policy_number,
    e.annual_premium,
    e.posted_date,
    NULL::date AS effective_date,
    e.status,
    e.updated_at AS synced_at
   FROM external_ranked e
     LEFT JOIN agentlink_match_counts c ON c.canonical_agent_id = e.canonical_agent_id AND c.posted_date = e.posted_date AND c.annual_premium = e.annual_premium AND c.face_amount = COALESCE(e.face_amount, 0::numeric) AND c.carrier_key = lower(btrim(COALESCE(e.carrier, ''::text)))
  WHERE e.match_rank > COALESCE(c.matched_rows, 0) AND NOT (EXISTS ( SELECT 1
           FROM v_agentlink_book_scoped b
          WHERE NULLIF(btrim(COALESCE(e.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(e.policy_number))))
) c
where case when c.origin = 'agentlink' and c.agent_id is null
           then public.fn_book_agent_name_known(c.agent_name)
           else true end;

create or replace view public.v_production_comp_truth with (security_invoker = on) as
 WITH canonical_agents AS (
         SELECT COALESCE(m_1.canonical_agent_id, a.id) AS canon,
            max(COALESCE(p.full_name, a.display_name)) AS display_name,
            max(lvl.pct) FILTER (WHERE lvl.provenance <> 'unknown'::text AND lvl.pct >= 0::numeric AND lvl.pct <= 200::numeric) AS explicit_comp,
            max(
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM user_roles ur
                      WHERE ur.user_id = a.user_id AND (ur.role::text = ANY (ARRAY['admin'::text, 'super_admin'::text, 'owner'::text])))) THEN 120::numeric
                    ELSE NULL::numeric
                END) AS owner_comp
           FROM agents a
             LEFT JOIN v_agent_canonical_map m_1 ON m_1.agent_id = a.id
             LEFT JOIN profiles p ON p.id = a.user_id
             LEFT JOIN LATERAL fn_agent_contract_pct(a.id) lvl(pct, provenance) ON true
          GROUP BY (COALESCE(m_1.canonical_agent_id, a.id))
        )
 SELECT u.row_key,
    u.origin,
    u.agent_id AS raw_agent_id,
    COALESCE(m.canonical_agent_id, u.agent_id) AS agent_id,
        CASE
            WHEN u.origin = 'discord_external'::text THEN u.agent_name
            ELSE COALESCE(ca.display_name, u.agent_name)
        END AS agent_name,
    u.client_name,
    u.carrier,
    u.product,
    u.policy_number,
    u.annual_premium,
    u.posted_date,
    u.effective_date,
    u.status,
    u.synced_at,
        CASE
            WHEN u.origin = 'external_daily_gap'::text THEN 0::numeric
            ELSE COALESCE(ca.explicit_comp, ca.owner_comp, 60::numeric)
        END AS seller_comp_pct,
        CASE
            WHEN u.origin = 'external_daily_gap'::text THEN 0::numeric
            ELSE u.annual_premium * COALESCE(ca.explicit_comp, ca.owner_comp, 60::numeric) / 100.0
        END AS direct_estimate
   FROM v_production_unified u
     LEFT JOIN v_agent_canonical_map m ON m.agent_id = u.agent_id
     LEFT JOIN canonical_agents ca ON ca.canon = COALESCE(m.canonical_agent_id, u.agent_id);
