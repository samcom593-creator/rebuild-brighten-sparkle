-- PERF-LOAD-TIMES part 3 (2026-11-12). The Book of Business itself.
--
-- After parts 1-2, v_book_of_business still could not finish for Sam: `select * ... limit 150`
-- exceeded 30s. The plan showed why: placed.list_state is a correlated lookup
--   (select us_state_code(l.state) from client_leads l where l.phone_digits = located.phone10)
-- and because `located` was inlined, located.phone10 arrived inside that lookup as the raw
-- COALESCE(NULLIF(right(regexp_replace(...)))) expression over deals/agentlink_clients columns.
-- client_leads has row-level security (the view became security_invoker on 11-10), and Postgres
-- will not push a qual containing non-leakproof functions through an RLS barrier into an index
-- condition. So the unique index client_leads_phone_uniq was unusable and every book row did a
-- SEQUENTIAL scan of client_leads (106,572 rows, 57 MB) -- twice, since list_state feeds both
-- client_state and client_state_source: ~3,300 full scans per page load. Before 11-10 the view
-- ran as its owner (no RLS), the qual was promotable, and the index was used; that is why this
-- page went from working to timing out with no change to its SQL.
--
-- The fix is ONE word: `located AS MATERIALIZED (`. Materialized, located.phone10 is a plain
-- column of a CTE scan, the lookup qual is `phone_digits = $param` (texteq is leakproof), and the
-- index is used again. A MATERIALIZED CTE computes the same rows as the inlined one -- it only
-- stops the planner from merging it into the outer query -- so the view returns the same rows.
-- Proven at apply time: owner-side fingerprint (count, states, area-code fallbacks, md5 over
-- row_key|state|source|standing|status|premium|agent) identical before and after.
--
-- Body below is pg_get_viewdef() of the LIVE view at apply time with only that token changed,
-- so this file cannot reintroduce drift from hand-applied edits since 20261030120000.
create or replace view public.v_book_of_business
  with (security_barrier = true, security_invoker = true)
as
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
    synced_at,
    status_key,
    standing,
    client_state,
    client_state_source
   FROM ( WITH on_books AS (
                 SELECT u.row_key,
                    u.origin,
                    u.agent_id,
                    u.agent_name,
                    u.client_name,
                    u.carrier,
                    u.product,
                    u.policy_number,
                    u.annual_premium,
                    u.posted_date,
                    u.effective_date,
                        CASE
                            WHEN u.origin = 'apex_native'::text THEN COALESCE(NULLIF(btrim(nd.policy_status_standard), ''::text), u.status)
                            ELSE u.status
                        END AS status,
                    u.synced_at,
                    false AS is_dead
                   FROM v_production_unified u
                     LEFT JOIN deals nd ON nd.id =
                        CASE
                            WHEN u.origin = 'apex_native'::text THEN u.row_key::uuid
                            ELSE NULL::uuid
                        END
                ), off_books_agentlink AS (
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
                    b.imported_at AS synced_at,
                    true AS is_dead
                   FROM v_agentlink_book_scoped b
                  WHERE b.is_dead IS TRUE AND
                        CASE
                            WHEN b.agent_id IS NULL THEN fn_book_agent_name_known(b.agent_name)
                            ELSE true
                        END
                ), off_books_native AS (
                 SELECT d.id::text AS row_key,
                    'apex_native'::text AS origin,
                    d.agent_id,
                    COALESCE(ag.display_name, 'Agent'::text) AS agent_name,
                    btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)) AS client_name,
                    c.name AS carrier,
                    d.product_sold AS product,
                    d.policy_number,
                    d.annual_premium,
                    (COALESCE(d.posted_at, d.created_at) AT TIME ZONE 'America/Phoenix'::text)::date AS posted_date,
                    d.effective_date,
                    COALESCE(NULLIF(btrim(d.policy_status_standard), ''::text), d.status) AS status,
                    d.created_at AS synced_at,
                    true AS is_dead
                   FROM deals d
                     LEFT JOIN agents ag ON ag.id = d.agent_id
                     LEFT JOIN carriers c ON c.id = d.carrier_id
                  WHERE d.agent_id IS NOT NULL AND d.annual_premium IS NOT NULL AND d.source::text = 'apex_native'::text AND (lower(COALESCE(d.status, ''::text)) = ANY (ARRAY['lapsed'::text, 'cancelled'::text, 'charged_back'::text, 'withdrawn'::text, 'not_taken'::text, 'declined'::text])) AND NOT fn_agent_is_roster_excluded(d.agent_id) AND NOT (EXISTS ( SELECT 1
                           FROM v_agentlink_book_scoped b
                          WHERE NULLIF(btrim(COALESCE(b.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(COALESCE(d.policy_number, ''::text))))) AND NOT (EXISTS ( SELECT 1
                           FROM v_agentlink_book_scoped b2
                          WHERE b2.agent_id = d.agent_id AND b2.annual_premium = d.annual_premium AND b2.effective_date = d.effective_date AND lower(btrim(COALESCE(b2.client_name, ''::text))) = lower(btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)))))
                ), book AS (
                 SELECT on_books.row_key,
                    on_books.origin,
                    on_books.agent_id,
                    on_books.agent_name,
                    on_books.client_name,
                    on_books.carrier,
                    on_books.product,
                    on_books.policy_number,
                    on_books.annual_premium,
                    on_books.posted_date,
                    on_books.effective_date,
                    on_books.status,
                    on_books.synced_at,
                    on_books.is_dead
                   FROM on_books
                UNION ALL
                 SELECT off_books_agentlink.row_key,
                    off_books_agentlink.origin,
                    off_books_agentlink.agent_id,
                    off_books_agentlink.agent_name,
                    off_books_agentlink.client_name,
                    off_books_agentlink.carrier,
                    off_books_agentlink.product,
                    off_books_agentlink.policy_number,
                    off_books_agentlink.annual_premium,
                    off_books_agentlink.posted_date,
                    off_books_agentlink.effective_date,
                    off_books_agentlink.status,
                    off_books_agentlink.synced_at,
                    off_books_agentlink.is_dead
                   FROM off_books_agentlink
                UNION ALL
                 SELECT off_books_native.row_key,
                    off_books_native.origin,
                    off_books_native.agent_id,
                    off_books_native.agent_name,
                    off_books_native.client_name,
                    off_books_native.carrier,
                    off_books_native.product,
                    off_books_native.policy_number,
                    off_books_native.annual_premium,
                    off_books_native.posted_date,
                    off_books_native.effective_date,
                    off_books_native.status,
                    off_books_native.synced_at,
                    off_books_native.is_dead
                   FROM off_books_native
                ), located AS MATERIALIZED (
                 SELECT book.row_key,
                    book.origin,
                    book.agent_id,
                    book.agent_name,
                    book.client_name,
                    book.carrier,
                    book.product,
                    book.policy_number,
                    book.annual_premium,
                    book.posted_date,
                    book.effective_date,
                    book.status,
                    book.synced_at,
                    book.is_dead,
                    COALESCE(NULLIF("right"(regexp_replace(COALESCE(nd2.client_phone, ''::text), '\D'::text, ''::text, 'g'::text), 10), ''::text), NULLIF("right"(regexp_replace(COALESCE(rec.phone, ''::text), '\D'::text, ''::text, 'g'::text), 10), ''::text), dp.phone10) AS phone10,
                    us_state_code(rec.state) AS record_state
                   FROM book
                     LEFT JOIN deals nd2 ON nd2.id =
                        CASE
                            WHEN book.origin = 'apex_native'::text THEN book.row_key::uuid
                            ELSE NULL::uuid
                        END
                     LEFT JOIN agentlink_book rab ON rab.deal_key =
                        CASE
                            WHEN book.origin = 'agentlink'::text THEN book.row_key
                            ELSE NULL::text
                        END
                     LEFT JOIN agentlink_clients rec ON rec.insuracloud_pipeline_client_id = rab.pipeline_client_id
                     LEFT JOIN ( SELECT DISTINCT ON ((btrim(d.policy_number)), (book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text))) btrim(d.policy_number) AS policy_number,
                            book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text) AS client_key,
                            NULLIF("right"(regexp_replace(d.client_phone, '\D'::text, ''::text, 'g'::text), 10), ''::text) AS phone10
                           FROM deals d
                          WHERE NULLIF(btrim(d.policy_number), ''::text) IS NOT NULL AND NULLIF(btrim(d.client_phone), ''::text) IS NOT NULL
                          ORDER BY (btrim(d.policy_number)), (book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text)), d.updated_at DESC NULLS LAST, d.id) dp ON book.origin = 'agentlink'::text AND dp.policy_number = btrim(book.policy_number) AND dp.client_key = book_flip_client_key(book.client_name, NULL::integer, NULL::text)
                ), placed AS (
                 SELECT located.row_key,
                    located.origin,
                    located.agent_id,
                    located.agent_name,
                    located.client_name,
                    located.carrier,
                    located.product,
                    located.policy_number,
                    located.annual_premium,
                    located.posted_date,
                    located.effective_date,
                    located.status,
                    located.synced_at,
                    located.is_dead,
                    located.phone10,
                    located.record_state,
                    pk.state AS packet_state,
                    ( SELECT us_state_code(l.state) AS us_state_code
                           FROM client_leads l
                          WHERE l.phone_digits = located.phone10) AS list_state,
                    ac.state AS area_state
                   FROM located
                     LEFT JOIN ( SELECT DISTINCT ON (k_1.phone10) k_1.phone10,
                            k_1.state
                           FROM ( SELECT NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '\D'::text, ''::text, 'g'::text), 10), ''::text) AS phone10,
                                    us_state_code(p.client_state) AS state,
                                    p.call_at,
                                    p.id
                                   FROM readymode_booking_packets p) k_1
                          WHERE k_1.phone10 IS NOT NULL AND k_1.state IS NOT NULL
                          ORDER BY k_1.phone10, k_1.call_at DESC NULLS LAST, k_1.id) pk ON pk.phone10 = located.phone10
                     LEFT JOIN us_area_codes ac ON ac.area_code =
                        CASE
                            WHEN located.phone10 ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'::text THEN "left"(located.phone10, 3)
                            ELSE NULL::text
                        END
                )
         SELECT placed.row_key,
            placed.origin,
            placed.agent_id,
            placed.agent_name,
            placed.client_name,
            placed.carrier,
            placed.product,
            placed.policy_number,
            placed.annual_premium,
            placed.posted_date,
            placed.effective_date,
            placed.status,
            placed.synced_at,
            placed.is_dead,
            k.status_key,
                CASE
                    WHEN k.status_key = ANY (ARRAY['active'::text, 'approved'::text, 'issued'::text, 'in_force'::text, 'paid'::text]) THEN 'active'::text
                    WHEN k.status_key = ANY (ARRAY['lapse_pending'::text, 'lapsed'::text, 'grace_period'::text]) THEN 'lapsing'::text
                    WHEN (k.status_key = ANY (ARRAY['declined'::text, 'withdrawn'::text, 'not_taken'::text, 'cancelled'::text, 'terminated'::text, 'postponed'::text, 'rescinded'::text, 'surrendered'::text, 'deceased'::text, 'closed'::text, 'incomplete'::text, 'charged_back'::text, 'not_in_force'::text])) OR placed.is_dead THEN 'gone'::text
                    WHEN k.status_key = ANY (ARRAY['pending'::text, 'in_review'::text, 'submitted'::text, 'underwriting'::text, 'issued_not_paid'::text, 'approved_not_issued'::text, 'needs_review'::text]) THEN 'pending'::text
                    ELSE 'unknown'::text
                END AS standing,
            COALESCE(placed.record_state, placed.packet_state, placed.list_state, placed.area_state) AS client_state,
                CASE
                    WHEN COALESCE(placed.record_state, placed.packet_state, placed.list_state) IS NOT NULL THEN 'on_file'::text
                    WHEN placed.area_state IS NOT NULL THEN 'area_code'::text
                    ELSE NULL::text
                END AS client_state_source
           FROM placed
             CROSS JOIN LATERAL ( SELECT
                        CASE r.raw_key
                            WHEN 'canceled'::text THEN 'cancelled'::text
                            WHEN 'chargeback'::text THEN 'charged_back'::text
                            WHEN 'inforce'::text THEN 'in_force'::text
                            WHEN 'dead'::text THEN 'not_in_force'::text
                            WHEN ''::text THEN 'unknown'::text
                            ELSE r.raw_key
                        END AS status_key
                   FROM ( SELECT lower(regexp_replace(btrim(COALESCE(placed.status, ''::text)), '[[:space:],_-]+'::text, '_'::text, 'g'::text)) AS raw_key) r) k) q
  WHERE (CURRENT_USER <> ALL (ARRAY['anon'::name, 'authenticated'::name])) OR ( SELECT api_is_full_reader() AS api_is_full_reader) OR (agent_id = ANY ((( SELECT api_scope_agent_ids() AS api_scope_agent_ids))::uuid[]));
