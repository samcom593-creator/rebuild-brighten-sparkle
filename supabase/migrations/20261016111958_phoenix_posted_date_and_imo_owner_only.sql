-- PL-HOME-PHOENIX-DAY + PL-SEC-IMO-OWNER-ONLY (2026-10-16), from the overnight review.
--
-- 1. Deals posted in the app after 5 PM Phoenix were dated the next day. v_production_canonical
--    (and the Book Flips worklist's native branch) cast posted_at, a timestamptz, straight to date
--    with the database in UTC, so 00:00 UTC = 5 PM Phoenix became the day boundary. 18 of 165 app
--    deals (7 in the last 30 days) sat on the wrong day: an evening sale was missing from Today
--    and counted in tomorrow's window. Both now take the Phoenix calendar date, the business day
--    every other surface uses. Views are replaced with their existing options restated
--    (security_invoker), since a replace without WITH drops them.
create or replace view public.v_production_canonical with (security_invoker = on) as
SELECT row_key,
    origin,
    agent_id,
    agent_name,
    client_name,
    carrier,
    product,
    policy_number,
    annual_premium,
    posted_date,
    effective_date,
    status,
    synced_at
   FROM ( WITH external_ranked AS (
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
            c_1.name AS carrier,
            d.product_sold AS product,
            d.policy_number,
            d.annual_premium,
            (COALESCE(d.posted_at, d.created_at) AT TIME ZONE 'America/Phoenix'::text)::date AS posted_date,
            d.effective_date,
            d.status,
            d.created_at AS synced_at
           FROM deals d
             LEFT JOIN agents ag ON ag.id = d.agent_id
             LEFT JOIN carriers c_1 ON c_1.id = d.carrier_id
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
             LEFT JOIN agentlink_match_counts c_1 ON c_1.canonical_agent_id = e.canonical_agent_id AND c_1.posted_date = e.posted_date AND c_1.annual_premium = e.annual_premium AND c_1.face_amount = COALESCE(e.face_amount, 0::numeric) AND c_1.carrier_key = lower(btrim(COALESCE(e.carrier, ''::text)))
          WHERE e.match_rank > COALESCE(c_1.matched_rows, 0) AND NOT (EXISTS ( SELECT 1
                   FROM v_agentlink_book_scoped b
                  WHERE NULLIF(btrim(COALESCE(e.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(e.policy_number))))) c
  WHERE
        CASE
            WHEN origin = 'agentlink'::text AND agent_id IS NULL THEN fn_book_agent_name_known(agent_name)
            ELSE true
        END;

create or replace view public.v_book_flip_worklist with (security_invoker = true) as
SELECT concat_ws('|'::text, r.carrier, r.policy_number, r.client_key) AS flip_key,
    r.carrier,
    r.policy_number,
    r.client_key,
    r.product,
    COALESCE(NULLIF(btrim(r.status), ''::text), 'Unknown'::text) AS book_status,
    COALESCE(r.is_dead, false) AS is_dead,
    sg.status_group = 'active'::text AS is_book_active,
    sg.status_group,
    r.client_name,
    r.client_first_name,
    r.client_last_name,
    COALESCE(NULLIF(btrim(cl.phone), ''::text), NULLIF(btrim(dl.client_phone), ''::text)) AS phone,
        CASE
            WHEN NULLIF(btrim(cl.phone), ''::text) IS NOT NULL THEN 'client_record'::text
            WHEN NULLIF(btrim(dl.client_phone), ''::text) IS NOT NULL THEN 'posted_deal'::text
            ELSE NULL::text
        END AS phone_source,
    COALESCE(cl.date_of_birth, dl.client_dob) AS dob,
        CASE
            WHEN COALESCE(cl.date_of_birth, dl.client_dob) IS NULL OR COALESCE(cl.date_of_birth, dl.client_dob) > t.today THEN NULL::integer
            ELSE EXTRACT(year FROM age(t.today::timestamp with time zone, COALESCE(cl.date_of_birth, dl.client_dob)::timestamp with time zone))::integer
        END AS age_years,
    NULLIF(btrim(cl.state), ''::text) AS state,
    NULLIF(btrim(cl.city), ''::text) AS city,
    COALESCE(cl.any_dnc, false) AS do_not_call,
    NULLIF(btrim(cl.best_time_to_call), ''::text) AS best_time_to_call,
    NULLIF(btrim(cl.client_timezone), ''::text) AS client_timezone,
    r.face_amount,
    r.monthly_premium,
    r.annual_premium,
    r.effective_date,
    r.posted_date,
        CASE
            WHEN r.effective_date IS NULL OR r.effective_date < '1990-01-01'::date THEN NULL::integer
            WHEN r.effective_date > t.today THEN 0
            ELSE (EXTRACT(year FROM age(t.today::timestamp with time zone, r.effective_date::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(t.today::timestamp with time zone, r.effective_date::timestamp with time zone)))::integer
        END AS months_in_force,
    r.agent_id,
    COALESCE(NULLIF(btrim(ag.display_name), ''::text), NULLIF(btrim(r.agent_name), ''::text)) AS agent_name,
    ag.status AS agent_status,
    COALESCE((ag.status = ANY (ARRAY['inactive'::text, 'terminated'::text])) OR ag.is_inactive OR ag.is_deactivated, false) AS agent_gone,
    r.imported_at,
    r.book_rows::integer AS book_rows,
    r.clients_on_number::integer AS clients_on_number,
    COALESCE(fl.flip_status, 'to_call'::text) AS flip_status,
    COALESCE(fl.attempts, 0) AS attempts,
    fl.last_contact_at,
    fl.callback_at,
    fl.notes,
    fl.resold_deal_id,
    fl.resold_policy_number,
    fl.resold_carrier,
    fl.resold_annual_premium,
    fl.updated_at AS flip_updated_at
   FROM ( SELECT k.deal_key,
            k.carrier,
            k.policy_number,
            k.client_key,
            k.product,
            k.status,
            k.is_dead,
            k.client_name,
            k.client_first_name,
            k.client_last_name,
            k.agent_id,
            k.agent_name,
            k.face_amount,
            k.monthly_premium,
            k.annual_premium,
            k.effective_date,
            k.posted_date,
            k.imported_at,
            k.pipeline_client_id,
            k.raw_policy_number,
            row_number() OVER (PARTITION BY k.carrier, k.policy_number, k.client_key ORDER BY (k.status IS NOT NULL AND (lower(btrim(k.status)) <> ALL (ARRAY[''::text, 'unknown'::text]))) DESC, k.posted_date DESC NULLS LAST, k.imported_at DESC NULLS LAST, (COALESCE(k.is_dead, false)), k.deal_key) AS rn,
            count(*) OVER (PARTITION BY k.carrier, k.policy_number, k.client_key) AS book_rows,
            array_agg(k.pipeline_client_id) OVER (PARTITION BY k.carrier, k.policy_number, k.client_key) AS pipeline_client_ids,
            dense_rank() OVER (PARTITION BY k.carrier, k.policy_number ORDER BY k.client_key) + dense_rank() OVER (PARTITION BY k.carrier, k.policy_number ORDER BY k.client_key DESC) - 1 AS clients_on_number
           FROM ( SELECT b.deal_key,
                    b.carrier,
                    btrim(b.policy_number) AS policy_number,
                    book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) AS client_key,
                    b.product,
                    b.status,
                    b.is_dead,
                    b.client_name,
                    b.client_first_name,
                    b.client_last_name,
                    b.agent_id,
                    b.agent_name,
                    b.face_amount,
                    b.monthly_premium,
                    b.annual_premium,
                    b.effective_date,
                    b.posted_date,
                    b.imported_at,
                    b.pipeline_client_id,
                    b.policy_number AS raw_policy_number
                   FROM agentlink_book b
                  WHERE NULLIF(btrim(b.policy_number), ''::text) IS NOT NULL
                UNION ALL
                 SELECT 'deal:'::text || d.id::text AS deal_key,
                    c.name AS carrier,
                    btrim(d.policy_number) AS policy_number,
                    book_flip_client_key(btrim(concat_ws(' '::text, d.client_first_name, d.client_last_name)), NULL::integer, 'deal:'::text || d.id::text) AS client_key,
                    d.product_sold AS product,
                    d.status,
                    false AS is_dead,
                    btrim(concat_ws(' '::text, d.client_first_name, d.client_last_name)) AS client_name,
                    d.client_first_name,
                    d.client_last_name,
                    d.agent_id,
                    NULL::text AS agent_name,
                    d.face_amount,
                    d.monthly_premium,
                    d.annual_premium,
                    d.effective_date,
                    (COALESCE(d.posted_at, d.created_at) AT TIME ZONE 'America/Phoenix'::text)::date AS posted_date,
                    d.created_at AS imported_at,
                    d.pipeline_client_id,
                    d.policy_number AS raw_policy_number
                   FROM deals d
                     JOIN carriers c ON c.id = d.carrier_id
                  WHERE (d.source::text = ANY (ARRAY['apex_native'::text, 'apex'::text])) AND NULLIF(btrim(d.policy_number), ''::text) IS NOT NULL AND d.duplicate_of_deal_id IS NULL AND NOT (EXISTS ( SELECT 1
                           FROM agentlink_book b2
                          WHERE lower(btrim(b2.policy_number)) = lower(btrim(d.policy_number))))) k) r
     CROSS JOIN LATERAL ( SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS today) t
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['active'::text, 'issued'::text, 'approved'::text, 'in force'::text, 'inforce'::text, 'in-force'::text]) THEN 'active'::text
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['lapsed'::text, 'lapse pending'::text, 'lapse-pending'::text, 'grace period'::text]) THEN 'lapsing'::text
                    WHEN (lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['declined'::text, 'withdrawn'::text, 'not taken'::text, 'cancelled'::text, 'canceled'::text, 'terminated'::text, 'postponed'::text, 'rescinded'::text, 'surrendered'::text, 'deceased'::text, 'closed'::text, 'incomplete'::text])) OR COALESCE(r.is_dead, false) THEN 'dead'::text
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['pending'::text, 'in review'::text, 'submitted'::text, 'underwriting'::text, 'issued, not paid'::text, 'approved, not issued'::text]) THEN 'pending'::text
                    ELSE 'unknown'::text
                END AS status_group) sg
     LEFT JOIN LATERAL ( SELECT a.display_name,
            a.status::text AS status,
            a.is_inactive,
            a.is_deactivated
           FROM agents a
          WHERE a.id = r.agent_id
          ORDER BY a.id
         LIMIT 1) ag ON true
     LEFT JOIN LATERAL ( SELECT c.phone,
            c.date_of_birth,
            c.state,
            c.city,
            c.best_time_to_call,
            c.client_timezone,
            bool_or(c.do_not_call) OVER () AS any_dnc
           FROM agentlink_clients c
          WHERE c.insuracloud_pipeline_client_id = ANY (r.pipeline_client_ids)
          ORDER BY (NULLIF(btrim(c.phone), ''::text) IS NOT NULL) DESC, (c.insuracloud_pipeline_client_id = r.pipeline_client_id) DESC, c.updated_at DESC NULLS LAST, c.id
         LIMIT 1) cl ON true
     LEFT JOIN LATERAL ( SELECT d.client_phone,
            d.client_dob
           FROM deals d
          WHERE (NULLIF(btrim(cl.phone), ''::text) IS NULL OR cl.date_of_birth IS NULL) AND (d.policy_number = ANY (ARRAY[r.policy_number, r.raw_policy_number])) AND book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text) = r.client_key
          ORDER BY (NULLIF(btrim(d.client_phone), ''::text) IS NOT NULL) DESC, d.updated_at DESC NULLS LAST, d.id
         LIMIT 1) dl ON true
     LEFT JOIN LATERAL ( SELECT f.flip_status,
            f.attempts,
            f.last_contact_at,
            f.callback_at,
            f.notes,
            f.resold_deal_id,
            f.resold_policy_number,
            f.resold_carrier,
            f.resold_annual_premium,
            f.updated_at
           FROM book_flips f
          WHERE f.carrier = r.carrier AND f.policy_number = r.policy_number AND f.client_key = r.client_key
          ORDER BY f.updated_at DESC
         LIMIT 1) fl ON true
  WHERE r.rn = 1 AND ( SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name])));

-- 2. imo_by_agency_period is SECURITY DEFINER and executable by every signed-in login, and returned
--    the IMO's agency-wide ALP and the owner override to anyone who called it; only the card hid it
--    (ImoByAgency.tsx renders for admins). It now returns rows to admins only.
CREATE OR REPLACE FUNCTION public.imo_by_agency_period(p_start date, p_end date)
 RETURNS TABLE(agency text, is_primary boolean, policies integer, alp numeric, owner_override_pct numeric, est_owner_override_alp numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select x.agency, x.is_primary, x.policies, x.alp, x.owner_override_pct, x.est_owner_override_alp
  -- Owner-only: agency-wide ALP and Sam's override on each sub-agency. Anyone else gets no rows,
  -- and the expensive read is never started for them.
  from jsonb_to_recordset(case when public.api_is_admin_role() then public.fn_rpc_single_flight(
    'imo_by_agency_period:' || coalesce(p_start::text, '') || ':' || coalesce(p_end::text, '') || ':' || coalesce(auth.uid()::text, 'anon'),
    15,
    format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.imo_by_agency_period_uncached(%L::date, %L::date) t', p_start, p_end)) else '[]'::jsonb end)
  as x(agency text, is_primary boolean, policies integer, alp numeric, owner_override_pct numeric, est_owner_override_alp numeric);
$function$;
