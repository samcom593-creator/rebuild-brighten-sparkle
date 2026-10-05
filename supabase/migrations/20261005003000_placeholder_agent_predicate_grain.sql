-- 2026-10-05 (website-integrity-bot) — the ghost predicate was at the wrong grain.
--
-- 20261004233000 shipped public.is_ghost_agent(text) as the single source for
-- "this agents row is a fabricated placeholder, keep it off Sam's surfaces", and
-- retrofitted four call sites onto it. The function body is purely LEXICAL:
--   coalesce(p_agent_code,'') like 'GHOST%'
-- Measured against live state, that prefix matches TWO populations, not one:
--
--   6 rows  GHOST_AYRO_*  status=active   user_id IS NULL   0 deals
--             -> true placeholders, minted per policy-feed row by
--                public.ingest_ayro_sales_deal() when an Ayro producer name
--                resolves to no real agent. These are the intended target.
--  10 rows  GHOST_###     status=inactive user_id IS NOT NULL  112 deals
--             -> REAL former producers carrying 112 deals and 109
--                agentlink_book rows, created 2026-05-16. Each is the ONLY
--                agents row for its user_id AND for its display_name (checked:
--                0 duplicates, 0 canonical_agent_id), so excluding one does not
--                hide a duplicate -- it deletes that producer's history from
--                whatever surface excluded it. The GHOST_ prefix on these is a
--                May-2026 naming artifact, not a declaration of placeholder-ness.
--
-- The four shipped call sites are CORRECT TODAY and this is LATENT, not a live
-- defect -- re-measured per site against each site's OWN filters rather than one
-- assumed filter, and 0 of the 10 reach the predicate at any of them. They are
-- excluded for three DIFFERENT reasons (status / is_inactive / first_deal_at),
-- which is why a single assumed filter is not evidence: the first pass of this
-- measurement tested status='active' against all four and returned a comfortable
-- 0 for two sites that never filter status at all.
--
-- What made it worth fixing now is the handoff. 20261004233000's ledger entry
-- names nine more views that still contain the placeholders and states that
-- "each now has a one-line fix available (NOT public.is_ghost_agent(...))".
-- Six of those nine (v_recruiting_pipeline, v_agents_full, v_strike_summary,
-- v_next_step_candidate, v_contracting_audit, v_agent_training_stage) do NOT
-- filter status, and all 10 real producers are live in them today. A worker
-- following that instruction removes 10 real agents and 112 deals from Sam's
-- CRM roster, strike summary and recruiting pipeline, and the counts would move
-- by -16 while the commit message said -6. A predicate whose name and body
-- disagree about its own population is the recorded operand error; the fix is
-- the grain, not another co-filter at each of six call sites.
--
-- BOTH halves of the new predicate are load-bearing, measured:
--   * lexical half: 17 agents have user_id IS NULL and are NOT ghosts (7 of them
--     active), so a bare `user_id IS NULL` test excludes 17 real agents.
--   * null-user half: splits 6 placeholders (0 deals) from 10 producers (112).
-- Truth table asserted below rather than asserted in prose.
--
-- The 1-arg is_ghost_agent is DROPPED, not left beside the new one. Leaving both
-- is how curl --max-time and fn_agentlink_reap_stuck drifted: the over-broad
-- spelling stays reachable and the handoff instruction above stays takeable.
--
-- Replay-safe: every edit asserts its anchor is present AND that replace()
-- actually changed the string; an already-patched object no-ops. Anchors are
-- written against pg_get_viewdef/pg_get_functiondef's NORMALISED rendering, not
-- against this file's source text -- 20261004205500 aborted on exactly that,
-- because the catalog renders `NOT LIKE 'GHOST%'` as `!~~ 'GHOST%'::text`.

begin;

create or replace function public.is_placeholder_agent(p_agent_code text, p_user_id uuid)
returns boolean language sql immutable parallel safe as
$fn$ select coalesce(p_agent_code, '') like 'GHOST%' and p_user_id is null $fn$;

comment on function public.is_placeholder_agent(text, uuid) is
  'TRUE only for fabricated placeholder agents rows (GHOST% agent_code AND no auth user). '
  'Supersedes the lexical-only is_ghost_agent(text), which also matched 10 real former '
  'producers carrying 112 deals. Both arguments are load-bearing -- see migration '
  '20261005003000. Add new call sites here; do not re-inline the rule.';

do $mig$
declare
  r record;
  src text;
  out text;
  n int := 0;
  -- (object, kind, catalog-rendered anchor, replacement)
  edits text[][] := array[
    ['v_agent_20k_target_leaderboard','v','NOT is_ghost_agent(a.agent_code)','NOT public.is_placeholder_agent(a.agent_code, a.user_id)'],
    ['v_onboarding_sequence',         'v','NOT is_ghost_agent(ag.agent_code)','NOT public.is_placeholder_agent(ag.agent_code, ag.user_id)'],
    ['v_queue_active_no_first_sale',  'v','NOT is_ghost_agent(a.agent_code)','NOT public.is_placeholder_agent(a.agent_code, a.user_id)'],
    ['landing_live_stats',            'f','NOT public.is_ghost_agent(agent_code)','NOT public.is_placeholder_agent(agent_code, user_id)']
  ];
begin
  for i in 1 .. array_length(edits, 1) loop
    if edits[i][2] = 'v' then
      select pg_get_viewdef(c.oid, true) into src
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relname = edits[i][1] and c.relkind = 'v';
    else
      select pg_get_functiondef(p.oid) into src
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = edits[i][1];
    end if;

    if src is null then
      raise exception 'MIG ABORT: % % not found', edits[i][2], edits[i][1];
    end if;

    -- already migrated -> no-op, do not treat as failure
    if position(edits[i][3] in src) = 0 then
      if position('is_placeholder_agent' in src) > 0 then
        raise notice 'already patched, skipping: %', edits[i][1];
        continue;
      end if;
      raise exception 'MIG ABORT: anchor % not found in % (and it is not already patched)',
        edits[i][3], edits[i][1];
    end if;

    out := replace(src, edits[i][3], edits[i][4]);
    if out = src then
      raise exception 'MIG ABORT: replace() changed nothing for %', edits[i][1];
    end if;

    if edits[i][2] = 'v' then
      execute format('create or replace view public.%I as %s', edits[i][1], out);
    else
      execute out;  -- functiondef is already a full CREATE OR REPLACE
    end if;
    n := n + 1;
  end loop;

  raise notice 'patched % object(s)', n;

  -- Must be empty before the drop, or the drop breaks a live object at runtime:
  -- Postgres does not record function dependencies for views, so DROP FUNCTION
  -- would succeed and the view would fail on its next read.
  select string_agg(obj, ', ') into out from (
    select c.relname as obj from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'v'
        and pg_get_viewdef(c.oid) ilike '%is\_ghost\_agent%'
    union all
    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname <> 'is_ghost_agent'
        and pg_get_functiondef(p.oid) ilike '%is\_ghost\_agent%'
  ) q;
  if out is not null then
    raise exception 'MIG ABORT: is_ghost_agent still referenced by: %', out;
  end if;
end $mig$;

-- Truth table: the claim that both arguments are load-bearing is tested, not stated.
do $tt$
declare
  bad text;
  u uuid := '00000000-0000-0000-0000-000000000001';
begin
  select string_agg(label, '; ') into bad
  from ( values
      ('null code, null user',       public.is_placeholder_agent(null,                  null), false),
      ('GHOST_AYRO_X, null user',    public.is_placeholder_agent('GHOST_AYRO_TKREJCHA', null), true ),
      ('GHOST_336, real user',       public.is_placeholder_agent('GHOST_336',            u  ), false),
      ('GHOST_336, null user',       public.is_placeholder_agent('GHOST_336',           null), true ),
      ('AG-1024, null user',         public.is_placeholder_agent('AG-1024',             null), false),
      ('AG-1024, real user',         public.is_placeholder_agent('AG-1024',              u  ), false),
      ('empty code, null user',      public.is_placeholder_agent('',                    null), false),
      ('lowercase ghost, null user', public.is_placeholder_agent('ghost_lower',         null), false),
      ('XGHOST_1, null user',        public.is_placeholder_agent('XGHOST_1',            null), false)
  ) as t(label, got, want)
  where got is distinct from want;
  if bad is not null then
    raise exception 'MIG ABORT: truth table failed for: %', bad;
  end if;
  raise notice 'truth table 9/9';
end $tt$;

drop function if exists public.is_ghost_agent(text);

commit;
