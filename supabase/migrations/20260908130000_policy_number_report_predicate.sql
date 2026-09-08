-- 20260908130000_policy_number_report_predicate.sql
-- MP-473. "Is this policy number a placeholder?" is answered by the REPORT path
-- in three places (v_production_integrity, v_policy_number_vocabulary_drift, and
-- the SQL apex-doctor Check #37 prints for Sam to paste). Three independently
-- maintained copies of one rule. This makes it ONE definition.
--
-- The WRITE path (v_insuracloud_push_verdict) is deliberately NOT touched.
-- MP-466 declined to pick a winner between the two vocabularies because that is
-- a behaviour change to a money path; MP-473 measured the question and agrees
-- there is no oracle to pick with: agentlink_book is a MIRROR of this same data
-- (56 distinct digit-free policy numbers, 56 shared, 1:1), so the destination
-- validates nothing and cannot vindicate either rule. It holds 'N/A', '-----',
-- 'Bought state today, will update tmr' and 88 all-zero policy numbers.
-- Single-sourcing the report side is the safe half; it changes no verdict.
create or replace function public.fn_policy_number_report_placeholder(p text)
returns boolean language sql immutable as $$
  select p is null
      or btrim(p) = ''
      or length(btrim(p)) < 5
      or p ~ '\s'
      or (p ~ '^[0-9]+$' and length(btrim(p)) <= 6)
      or btrim(p) ~ '^0+$'
$$;
comment on function public.fn_policy_number_report_placeholder(text) is
  'MP-473. THE ONE DEFINITION of the report-path placeholder rule (apex-doctor Check #37). The WRITE path predicate in v_insuracloud_push_verdict is a DIFFERENT rule and is intentionally not derived from this one — see v_policy_number_predicate_coverage.';

create or replace view public.v_production_integrity as
 WITH u AS (
         SELECT v_production_unified.row_key,
            v_production_unified.origin,
            v_production_unified.agent_id,
            v_production_unified.agent_name,
            v_production_unified.client_name,
            v_production_unified.policy_number,
            v_production_unified.annual_premium,
            v_production_unified.posted_date,
            v_production_unified.synced_at
           FROM v_production_unified
        ), true_dups AS (
         SELECT upper(btrim(u.policy_number)) AS pn,
            lower(btrim(COALESCE(u.client_name, ''::text))) AS cn,
            count(*) AS n,
            sum(u.annual_premium) AS alp,
            max(u.posted_date) AS newest_posted,
            count(DISTINCT u.agent_id) AS agents
           FROM u
          WHERE NULLIF(btrim(u.policy_number), ''::text) IS NOT NULL
          GROUP BY (upper(btrim(u.policy_number))), (lower(btrim(COALESCE(u.client_name, ''::text))))
         HAVING count(*) > 1
        ), placeholder AS (
         SELECT u.row_key,
            u.origin,
            u.agent_id,
            u.agent_name,
            u.client_name,
            u.policy_number,
            u.annual_premium,
            u.posted_date,
            u.synced_at
           FROM u
          WHERE fn_policy_number_report_placeholder(u.policy_number)
        )
 SELECT ( SELECT count(*) AS count
           FROM true_dups) AS dup_groups_all_time,
    ( SELECT COALESCE(sum(true_dups.n), 0::numeric) AS "coalesce"
           FROM true_dups) AS dup_rows_all_time,
    ( SELECT COALESCE(round(sum(true_dups.alp), 2), 0::numeric) AS "coalesce"
           FROM true_dups) AS dup_alp_all_time,
    ( SELECT count(*) AS count
           FROM true_dups
          WHERE true_dups.agents > 1) AS dup_groups_cross_agent,
    ( SELECT count(*) AS count
           FROM true_dups
          WHERE true_dups.newest_posted > fn_production_integrity_anchor()::date) AS dup_groups_since_anchor,
    ( SELECT count(*) AS count
           FROM placeholder) AS placeholder_rows_all_time,
    ( SELECT COALESCE(round(sum(placeholder.annual_premium), 2), 0::numeric) AS "coalesce"
           FROM placeholder) AS placeholder_alp_all_time,
    ( SELECT count(*) AS count
           FROM placeholder
          WHERE placeholder.posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)) AS placeholder_rows_mtd,
    ( SELECT count(*) AS count
           FROM placeholder
          WHERE placeholder.posted_date > fn_production_integrity_anchor()::date) AS placeholder_rows_since_anchor,
    ( SELECT count(*) AS count
           FROM deals d
          WHERE d.source::text = 'apex'::text AND d.status IS DISTINCT FROM 'draft'::text) AS native_source_apex_outside_unified,
    ( SELECT count(*) AS count
           FROM u
          WHERE u.origin = 'external_daily_gap'::text AND u.posted_date < ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 14)) AS gap_rows_older_than_14d,
    fn_production_integrity_anchor() AS anchor,
    now() AS measured_at,
    ( SELECT count(*) AS count
           FROM placeholder p
          WHERE p.posted_date > fn_production_integrity_anchor()::date AND p.origin <> 'external_daily_gap'::text) AS placeholder_rows_chaseable_since_anchor,
    ( SELECT count(*) AS count
           FROM placeholder p
          WHERE p.posted_date > fn_production_integrity_anchor()::date AND p.origin = 'external_daily_gap'::text) AS placeholder_rows_structural_since_anchor,
    ( SELECT count(*) AS count
           FROM placeholder p
          WHERE p.posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) AND p.origin <> 'external_daily_gap'::text) AS placeholder_rows_chaseable_mtd,
    ( SELECT COALESCE(string_agg(DISTINCT p.origin, ', '::text ORDER BY p.origin), 'none'::text) AS "coalesce"
           FROM placeholder p
          WHERE p.posted_date > fn_production_integrity_anchor()::date AND p.origin <> 'external_daily_gap'::text) AS placeholder_chaseable_origins;
;

create or replace view public.v_policy_number_vocabulary_drift as
 WITH evaluated AS (
         SELECT d.id,
            d.policy_number,
            d.push_verdict,
            d.source,
            d.status,
            d.created_at,
            d.client_first_name,
            d.client_last_name,
            d.annual_premium,
            fn_policy_number_report_placeholder(d.policy_number) AS doctor_flags_placeholder
           FROM v_insuracloud_push_verdict d
        )
 SELECT id,
    policy_number,
    push_verdict,
    doctor_flags_placeholder,
    source,
    status,
    client_first_name,
    client_last_name,
    annual_premium,
    created_at,
        CASE
            WHEN doctor_flags_placeholder AND push_verdict = 'eligible'::text THEN 'doctor_flags_writepath_allows'::text
            WHEN NOT doctor_flags_placeholder AND (push_verdict <> ALL (ARRAY['eligible'::text, 'already_in_book'::text])) THEN 'writepath_refuses_doctor_clean'::text
            ELSE 'agree'::text
        END AS drift_class
   FROM evaluated;
;

-- MP-473. Check #64 exists to make the two-vocabulary disagreement "impossible to
-- edit unnoticed" (MP-466). It reads v_policy_number_vocabulary_drift, whose
-- population is v_insuracloud_push_verdict — 47 deals. The two predicates also
-- both apply to v_production_unified, which is 1,440 rows, and they disagree
-- there too. Nothing counted that. This view publishes the coverage.
--
-- report_writepath_sim_* is a SIMULATION and says so: v_production_unified rows
-- have no push_verdict, because the write path governs `deals` only. Running the
-- write-path rule over them answers "would these two rules agree here", not
-- "what did the write path decide".
--
-- Scalar subqueries only: this returns exactly ONE row in every state, including
-- an empty database. A view that can return zero rows reads as green on every
-- surface that renders it.
create or replace view public.v_policy_number_predicate_coverage as
select
  (select count(*) from v_insuracloud_push_verdict)                                   as push_population,
  (select count(*) from v_production_unified where origin <> 'external_daily_gap')    as report_population,
  (select count(*) from v_policy_number_vocabulary_drift
     where drift_class = 'writepath_refuses_doctor_clean')                            as refuse_bucket,
  (select count(*) from v_policy_number_vocabulary_drift d
     where d.drift_class = 'writepath_refuses_doctor_clean'
       and exists (select 1 from v_production_unified u
                   where u.origin <> 'external_daily_gap'
                     and u.policy_number = d.policy_number))                          as refuse_visible_to_report,
  (select count(*) from v_policy_number_vocabulary_drift
     where drift_class = 'doctor_flags_writepath_allows')                             as danger_bucket,
  (select count(*) from v_policy_number_vocabulary_drift d
     where d.drift_class = 'doctor_flags_writepath_allows'
       and exists (select 1 from v_production_unified u
                   where u.origin <> 'external_daily_gap'
                     and u.policy_number = d.policy_number))                          as danger_visible_to_report,
  (select count(*) from v_production_unified u
     where u.origin <> 'external_daily_gap'
       and fn_policy_number_report_placeholder(u.policy_number)
       and not (u.policy_number is null or btrim(u.policy_number) = ''
                or u.policy_number ilike 'PLACEHOLDER-%' or u.policy_number ilike 'ZZTEST%'
                or u.policy_number !~ '[0-9]' or length(btrim(u.policy_number)) < 6))  as report_only_sim,
  (select count(*) from v_production_unified u
     where u.origin <> 'external_daily_gap'
       and not fn_policy_number_report_placeholder(u.policy_number)
       and (u.policy_number is null or btrim(u.policy_number) = ''
            or u.policy_number ilike 'PLACEHOLDER-%' or u.policy_number ilike 'ZZTEST%'
            or u.policy_number !~ '[0-9]' or length(btrim(u.policy_number)) < 6))      as writepath_only_sim,
  now() as measured_at;
comment on view public.v_policy_number_predicate_coverage is
  'MP-473. Publishes what Check #64 does and does not cover. refuse_visible_to_report is the operand that falsified Check #64''s refuse-direction consequence: it was 0 of 7 — Check #37 does not count those rows clean, it never reads them at all.';
