-- MP: single-source the GHOST-placeholder predicate, and clear the 6 fabricated
-- onboarding tasks it was leaving on Sam's own work queues.
--
-- WHAT WAS WRONG. ingest_ayro_sales_deal() mints a row in public.agents whenever
-- an Ayro producer name resolves to no real Apex agent (status='active',
-- has_production_access=true, agent_code 'GHOST_AYRO_*'). 6 live rows across 3
-- distinct days -> an ongoing writer, not a one-off backfill. Measured by
-- querying every public view with a joinable uuid agent column (141 candidates),
-- 36 of them actually CONTAIN those rows. Most are correct to: v_production_*,
-- v_ayro_*, v_agent_canonical_map and v_agent_duplicate_candidates exist exactly
-- to see them. This migration fixes the two that fabricate WORK:
--
--   v_queue_active_no_first_sale  73 -> 67 rows (6 of 73 = 8.2% of that queue)
--   v_onboarding_sequence         89 -> 83 rows (6 of 89 = 6.7%)
--
-- Both rendered each placeholder as a live hire owned by 'Samuel James', with a
-- due_at, a days_stuck counter and next_action 'Path to first deal: book field
-- training / first appointment' -- for people who do not exist.
--
-- MEASURED AND REFUSED, so the next reader does not re-raise it: the loud
-- version of this finding is that v_agent_account_gaps feeds the WRITE path
-- supabase/functions/provision-agent-accounts, which creates auth users and
-- sends mail. It does contain all 6. Their verdict column reads
-- gap_kind='needs_an_email' with resolvable_email IS NULL, and that function
-- acts only on gap_kind='fixable_now' && resolvable_email. No account is
-- created and no mail is sent. Presence is the wrong grain; the verdict column
-- is the right one.
--
-- WHY A FUNCTION AND NOT A THIRD INLINE COPY. 20261003182000 (landing_live_stats)
-- and 20261004205500 (v_agent_20k_target_leaderboard) each inlined their own
-- null-safe spelling of this rule. Adding two more copies here would make five
-- hand-maintained spellings of one predicate, which is how curl's --max-time and
-- fn_agentlink_reap_stuck drifted into 36 false pages a day. Both prior copies
-- are retrofitted onto the function below, proven behaviour-neutral:
-- landing_live_stats active_agents 71 -> 71 (verified through the PUBLIC anon key
-- pulled from the deployed bundle, not through bot-sql), leaderboard 22 -> 22.
--
-- NULL-SAFETY IS LOAD-BEARING, NOT DECORATION. 43 of 89 active canonical agents
-- carry agent_code IS NULL. A bare `agent_code NOT LIKE 'GHOST%'` evaluates NULL
-- on every one of them and drops them -- including the REAL licensed Tyler
-- Krejcha that apex-doctor's duplicate-name CRITICAL was actually about.

create or replace function public.is_ghost_agent(p_agent_code text)
returns boolean language sql immutable parallel safe
as $fn$ select coalesce(p_agent_code, '') like 'GHOST%' $fn$;

comment on function public.is_ghost_agent(text) is
'TRUE when an agents.agent_code is an external deal-attribution placeholder (GHOST% prefix) minted by ingest_ayro_sales_deal(). NULL-safe by construction: 43 of 89 active canonical agents have agent_code IS NULL and a bare NOT LIKE would silently drop them. Single source -- do not inline a fifth spelling of this rule.';

-- Each edit asserts its own anchor and asserts the mutation landed before the
-- object is replaced. An anchor that has drifted raises instead of guessing, and
-- an already-patched object is a no-op so this migration is replay-safe.
do $mig$
declare
  d text; nd text; tgt text;
  procedure_note text := 'is_ghost_agent';
begin
  -- 1. v_queue_active_no_first_sale (alias a)
  d := pg_get_viewdef('public.v_queue_active_no_first_sale'::regclass, true);
  if position(procedure_note in d) = 0 then
    tgt := 'WHERE COALESCE(a.is_deactivated, false) = false AND COALESCE(a.is_inactive, false) = false AND a.first_deal_at IS NULL';
    if position(tgt in d) = 0 then
      raise exception 'ABORT: anchor not found in v_queue_active_no_first_sale -- definition drifted, refusing to guess';
    end if;
    nd := replace(d, tgt, tgt || ' AND NOT public.is_ghost_agent(a.agent_code)');
    if nd = d then raise exception 'ABORT: mutation did not land on v_queue_active_no_first_sale'; end if;
    execute 'create or replace view public.v_queue_active_no_first_sale as ' || nd;
  end if;

  -- 2. v_onboarding_sequence (alias ag, inside CTE a)
  d := pg_get_viewdef('public.v_onboarding_sequence'::regclass, true);
  if position(procedure_note in d) = 0 then
    tgt := 'WHERE ag.is_deactivated IS NOT TRUE AND ag.is_inactive IS NOT TRUE AND ag.canonical_agent_id IS NULL';
    if position(tgt in d) = 0 then
      raise exception 'ABORT: anchor not found in v_onboarding_sequence -- definition drifted, refusing to guess';
    end if;
    nd := replace(d, tgt, tgt || ' AND NOT public.is_ghost_agent(ag.agent_code)');
    if nd = d then raise exception 'ABORT: mutation did not land on v_onboarding_sequence'; end if;
    execute 'create or replace view public.v_onboarding_sequence as ' || nd;
  end if;

  -- 3. retrofit landing_live_stats() (public RPC) onto the single source.
  --     pg_get_functiondef returns the body VERBATIM, so the source spelling holds.
  d := pg_get_functiondef('public.landing_live_stats()'::regprocedure);
  if position(procedure_note in d) = 0 then
    tgt := '(agent_code IS NULL OR agent_code NOT LIKE ''GHOST%'')';
    if position(tgt in d) = 0 then
      raise exception 'ABORT: inline predicate not found in landing_live_stats -- refusing to guess';
    end if;
    nd := replace(d, tgt, '(NOT public.is_ghost_agent(agent_code))');
    if nd = d then raise exception 'ABORT: mutation did not land on landing_live_stats'; end if;
    execute nd;
  end if;

  -- 4. retrofit v_agent_20k_target_leaderboard (alias a).
  --     pg_get_viewdef NORMALISES: the source `NOT LIKE 'GHOST%'` renders as
  --     `!~~ 'GHOST%'::text`. The first run of this edit anchored on the source
  --     spelling, found nothing and correctly aborted the whole block. Matching
  --     text you wrote against text the catalog renders is its own bug class.
  d := pg_get_viewdef('public.v_agent_20k_target_leaderboard'::regclass, true);
  if position(procedure_note in d) = 0 then
    tgt := '(a.agent_code IS NULL OR a.agent_code !~~ ''GHOST%''::text)';
    if position(tgt in d) = 0 then
      raise exception 'ABORT: inline predicate not found in v_agent_20k_target_leaderboard -- refusing to guess';
    end if;
    nd := replace(d, tgt, '(NOT public.is_ghost_agent(a.agent_code))');
    if nd = d then raise exception 'ABORT: mutation did not land on the 20k leaderboard'; end if;
    execute 'create or replace view public.v_agent_20k_target_leaderboard as ' || nd;
  end if;
end
$mig$;
