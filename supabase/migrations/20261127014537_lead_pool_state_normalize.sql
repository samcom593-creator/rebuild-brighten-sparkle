-- MP-LEAD-POOL-STATE-FILTER: the Leads console state filter listed junk codes (TE, NO, YE, LO,
-- SO, PE, US, SA ... 1,082 client_leads rows + 165 readymode_leads rows carry a "state" that is not a
-- state), so a filter by state silently skipped those leads and the picker showed ~150 bogus entries.
-- Both pool views now accept only a real postal code (the 51 in us_area_codes) and otherwise fall
-- back to the state of the phone's area code, the rule the dialer view already used for NULL.
-- Column list and order unchanged; mat_lead_pool picks it up on the next hourly refresh.
--
-- Applied live 2026-11-27 01:45Z through the Supabase MCP apply_migration (version = file name).
-- Spot check through the view: raw TE -> TN / NJ by area code, raw YE -> NC, state_from_area_code=true.
create or replace view public.v_pool_dialer as
 WITH rl AS (
         SELECT DISTINCT ON (l.phone10) l.phone10, l.first_name, l.last_name, l.email, l.state, l.age, l.campaign, l.batch_name
           FROM readymode_leads l
          WHERE (l.phone10 IS NOT NULL)
          ORDER BY l.phone10, l.rm_lead_id DESC
        ), agg AS (
         SELECT l.phone10, max(l.times_called) AS times_called, min(l.first_seen_at) AS first_seen_at,
            to_jsonb(array_agg(DISTINCT l.campaign) FILTER (WHERE (l.campaign IS NOT NULL))) AS campaigns
           FROM readymode_leads l
          WHERE (l.phone10 IS NOT NULL)
          GROUP BY l.phone10
        ), sup AS (
         SELECT s.phone10 FROM v_dialer_client_suppression s WHERE (s.verdict = 'suppress'::text)
        ), valid_state AS (
         SELECT DISTINCT a.state FROM us_area_codes a
        )
 SELECT NULL::uuid AS lead_id,
    COALESCE(q.phone10, rl.phone10) AS phone10,
    COALESCE(rl.first_name, q.first_name) AS first_name,
    COALESCE(rl.last_name, q.last_name) AS last_name,
    COALESCE(rl.email, q.email) AS email,
    COALESCE(
        CASE WHEN upper(rl.state) IN (SELECT v.state FROM valid_state v) THEN upper(rl.state) END,
        ( SELECT upper(a.state) FROM us_area_codes a WHERE (a.area_code = "left"(COALESCE(q.phone10, rl.phone10), 3)) LIMIT 1)) AS state,
    rl.age,
    COALESCE(q.quality_tier,
        CASE
            WHEN (COALESCE(agg.times_called, 0) = 0) THEN 'F'::text
            WHEN (agg.times_called <= 3) THEN 'C'::text
            ELSE 'D'::text
        END) AS tier,
    concat_ws(' · '::text, COALESCE(q.quality_reason,
        CASE
            WHEN (COALESCE(agg.times_called, 0) = 0) THEN 'Fresh: loaded in the dialer, never called'::text
            ELSE (((('Dialed '::text || agg.times_called) || ' time'::text) ||
            CASE WHEN (agg.times_called = 1) THEN ''::text ELSE 's'::text END) || ' before April, no call detail on file'::text)
        END), rl.campaign) AS tags,
    jsonb_strip_nulls(jsonb_build_object(
        'dnc', (COALESCE((q.quality_tier = 'blocked'::text), false) OR (lower(COALESCE(q.last_disposition, ''::text)) = 'do not call'::text)),
        'true_dnc', (COALESCE((q.quality_tier = 'blocked'::text), false) OR (lower(COALESCE(q.last_disposition, ''::text)) = 'do not call'::text)),
        'last_caller', q.last_agent,
        'last_outcome', lead_outcome_key(q.last_disposition),
        'last_touched_at', q.last_dialed_at,
        'policy_standing', CASE WHEN (sup.phone10 IS NOT NULL) THEN 'current_client'::text ELSE 'unverified'::text END,
        'policy_ownership_claim', CASE WHEN (q.quality_tier = 'pos'::text) THEN 'dialer_sale_reported'::text ELSE NULL::text END,
        'source_type', 'readymode',
        'campaign', rl.campaign,
        'campaigns', agg.campaigns,
        'source_file', rl.batch_name,
        'times_called', GREATEST(COALESCE(q.attempts, 0), COALESCE(agg.times_called, 0)),
        'current_client', CASE WHEN (sup.phone10 IS NOT NULL) THEN true ELSE NULL::boolean END,
        'state_from_area_code', CASE WHEN (rl.state IS NULL OR upper(rl.state) NOT IN (SELECT v.state FROM valid_state v)) THEN true ELSE NULL::boolean END)) AS flags,
    COALESCE(q.days_since_dialed, ((now())::date - (agg.first_seen_at)::date)) AS lead_age_days,
    false AS under_9mo
   FROM (((rl
     JOIN agg ON ((agg.phone10 = rl.phone10)))
     FULL JOIN v_readymode_lead_quality q ON ((q.phone10 = rl.phone10)))
     LEFT JOIN sup ON ((sup.phone10 = COALESCE(q.phone10, rl.phone10))));

create or replace view public.v_pool_marketing as
 SELECT s.lead_id,
    COALESCE(f.to_phone10, s.phone10) AS phone10,
    s.first_name,
    s.last_name,
    s.email,
    COALESCE(
        CASE WHEN s.state IN (SELECT DISTINCT a.state FROM us_area_codes a) THEN s.state END,
        ( SELECT upper(a.state) FROM us_area_codes a WHERE (a.area_code = "left"(COALESCE(f.to_phone10, s.phone10), 3)) LIMIT 1)) AS state,
    s.age,
    s.grade AS tier,
    NULLIF(concat_ws(', '::text,
        CASE WHEN s.wants_mortgage THEN 'mortgage'::text ELSE NULL::text END,
        CASE WHEN s.is_veteran THEN 'veteran'::text ELSE NULL::text END,
        CASE WHEN s.is_homeowner THEN 'homeowner'::text ELSE NULL::text END,
        CASE WHEN s.is_policyholder THEN 'supplier-reported policy owner'::text ELSE NULL::text END), ''::text) AS tags,
    jsonb_strip_nulls(jsonb_build_object(
        'mortgage', s.wants_mortgage, 'veteran', s.is_veteran, 'homeowner', s.is_homeowner, 'policyholder', s.is_policyholder,
        'dnc', (s.dnc OR (d_old.phone10 IS NOT NULL) OR COALESCE((q.quality_tier = 'blocked'::text), false)),
        'true_dnc', (s.dnc OR (d_old.phone10 IS NOT NULL) OR COALESCE((q.quality_tier = 'blocked'::text), false)),
        'current_client', ((cs.phone10 IS NOT NULL) OR (cs_old.phone10 IS NOT NULL)),
        'import_review_required', (COALESCE((l.raw ->> 'import_review_required'::text), 'false'::text) = 'true'::text),
        'readymode_number', (f.to_phone10 IS NOT NULL),
        'replaced_phone10', f.from_phone10,
        'original_producer', l.original_agent,
        'source_file', l.source_file,
        'source_batch_id', (l.raw ->> 'source_batch_id'::text),
        'source_type', (l.raw ->> 'source_type'::text),
        'policy_ownership_claim', (l.raw ->> 'policy_ownership_claim'::text),
        'policy_standing', CASE WHEN ((cs.phone10 IS NOT NULL) OR (cs_old.phone10 IS NOT NULL)) THEN 'current_client'::text ELSE 'unverified'::text END,
        'policy_carrier', l.policy_carrier, 'policy_product', l.policy_product,
        'policy_monthly_premium', l.policy_monthly_premium, 'policy_face_amount', l.policy_face_amount,
        'last_caller', CASE WHEN (q.last_dialed_at > COALESCE(s.last_dialed_at, '-infinity'::timestamp with time zone)) THEN q.last_agent ELSE NULL::text END,
        'last_outcome', lead_outcome_key(CASE WHEN (q.last_dialed_at > COALESCE(s.last_dialed_at, '-infinity'::timestamp with time zone)) THEN q.last_disposition ELSE s.last_disposition END),
        'last_touched_at', GREATEST(q.last_dialed_at, s.last_dialed_at),
        'times_called', GREATEST(COALESCE(q.attempts, 0), COALESCE(s.dial_count, 0)),
        'callback_at', l.next_touch_by,
        'next_action', (l.raw ->> 'next_action'::text),
        'state_from_area_code', CASE WHEN (s.state IS NULL OR s.state NOT IN (SELECT DISTINCT a.state FROM us_area_codes a)) THEN true ELSE NULL::boolean END)) AS flags,
    s.lead_age_days,
    (s.lead_age_days < 274) AS under_9mo
   FROM ((((((v_sellable_client_leads s
     JOIN client_leads l ON ((l.id = s.lead_id)))
     LEFT JOIN mat_lead_phone_fix f ON (((f.source = 'marketing'::text) AND (f.from_phone10 = s.phone10) AND (f.name_key = regexp_replace(lower((COALESCE(s.first_name, ''::text) || COALESCE(s.last_name, ''::text))), '[^a-z0-9]'::text, ''::text, 'g'::text)))))
     LEFT JOIN lead_contact_dnc d_old ON ((d_old.phone10 = s.phone10)))
     LEFT JOIN v_readymode_lead_quality q ON ((q.phone10 = COALESCE(f.to_phone10, s.phone10))))
     LEFT JOIN ( SELECT DISTINCT v_dialer_client_suppression.phone10 FROM v_dialer_client_suppression WHERE (v_dialer_client_suppression.verdict = 'suppress'::text)) cs ON ((cs.phone10 = COALESCE(f.to_phone10, s.phone10))))
     LEFT JOIN ( SELECT DISTINCT v_dialer_client_suppression.phone10 FROM v_dialer_client_suppression WHERE (v_dialer_client_suppression.verdict = 'suppress'::text)) cs_old ON ((cs_old.phone10 = s.phone10)));
