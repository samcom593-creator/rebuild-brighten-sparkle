-- MP-339 — production integrity guard (Sam's directive item 3: "audit and flag
-- duplicate submissions or deals missing policy numbers" across the multi-source
-- production streams). Vantage is ALREADY unified (v_production_unified carries
-- the external_daily_gap origin, 8 policies / $14,078 MTD on 2026-08-27) and
-- crm_today_production() reads the unified view — measured, not assumed. What did
-- not exist was any standing guard: the ad-hoc SQL that found 21 true
-- same-policy+same-client pairs ($45,726) and 347 placeholder policy numbers
-- ($446,454) lived in one chat. This view makes those numbers a permanent,
-- re-measured surface for apex-doctor.
--
-- Scalar subqueries only, so it returns exactly ONE ROW in every state (an empty
-- book reads as zeros, never as "no rows" that a reader mistakes for clean).
-- Graded on MOVEMENT (rows POSTED after the anchor) so a frozen upstream backlog
-- never pins the check red; the all-time totals are reported as context.
-- TRAP caught before this reached the doctor: the first cut keyed movement on
-- synced_at, which is the book's last-sync time — the whole book re-syncs every
-- cycle, so 21 of 21 dup groups and 285 of 296 placeholders read as "new" and the
-- check would have been permanently red. posted_date is the row's own date.
--
-- Refused: dollar figures as "money lost" — a duplicate AgentLink row is upstream
-- InsuraCloud data, not a double payout; placeholder policy numbers are missing
-- metadata, not missing premium. The view says what it measures.

create or replace function public.fn_production_integrity_anchor()
returns timestamptz language sql immutable
as $$ select '2026-08-27T23:00:00Z'::timestamptz $$;

create or replace view public.v_production_integrity as
with u as (
  select row_key, origin, agent_id, agent_name, client_name, policy_number,
         annual_premium, posted_date, synced_at
  from public.v_production_unified
),
true_dups as (
  -- same policy number AND same client: a genuinely repeated submission
  select upper(btrim(policy_number)) pn, lower(btrim(coalesce(client_name,''))) cn,
         count(*) n, sum(annual_premium) alp, max(posted_date) newest_posted,
         count(distinct agent_id) agents
  from u
  where nullif(btrim(policy_number), '') is not null
  group by 1, 2
  having count(*) > 1
),
placeholder as (
  -- policy "numbers" that cannot identify a policy: too short, digit-only stubs,
  -- all-zero, whitespace, or missing entirely
  select *
  from u
  where policy_number is null
     or btrim(policy_number) = ''
     or length(btrim(policy_number)) < 5
     or policy_number ~ '\s'
     or (policy_number ~ '^[0-9]+$' and length(btrim(policy_number)) <= 6)
     or btrim(policy_number) ~ '^0+$'
)
select
  (select count(*) from true_dups)                                              as dup_groups_all_time,
  (select coalesce(sum(n), 0) from true_dups)                                   as dup_rows_all_time,
  (select coalesce(round(sum(alp), 2), 0) from true_dups)                       as dup_alp_all_time,
  (select count(*) from true_dups where agents > 1)                             as dup_groups_cross_agent,
  (select count(*) from true_dups where newest_posted > public.fn_production_integrity_anchor()::date)
                                                                                as dup_groups_since_anchor,
  (select count(*) from placeholder)                                            as placeholder_rows_all_time,
  (select coalesce(round(sum(annual_premium), 2), 0) from placeholder)          as placeholder_alp_all_time,
  (select count(*) from placeholder
     where posted_date >= date_trunc('month', (now() at time zone 'America/Phoenix')::date))
                                                                                as placeholder_rows_mtd,
  (select count(*) from placeholder where posted_date > public.fn_production_integrity_anchor()::date)
                                                                                as placeholder_rows_since_anchor,
  (select count(*) from public.deals d
     where d.source = 'apex' and d.status is distinct from 'draft')             as native_source_apex_outside_unified,
  (select count(*) from u where origin = 'external_daily_gap'
     and posted_date < (now() at time zone 'America/Phoenix')::date - 14)      as gap_rows_older_than_14d,
  public.fn_production_integrity_anchor()                                       as anchor,
  now()                                                                         as measured_at;

grant select on public.v_production_integrity to service_role;
revoke all on public.v_production_integrity from anon, authenticated;
