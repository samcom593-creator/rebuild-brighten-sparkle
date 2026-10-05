-- 2026-10-05 (website-integrity-bot) — the free-leads decision list was 35%
-- fabricated, and Sam's recruiting pipeline called six of them healthy.
--
-- 20261005003000 fixed the GRAIN of the placeholder predicate and explicitly
-- handed forward nine views that still contain the 6 GHOST_AYRO_* rows
-- public.ingest_ayro_sales_deal() mints when an Ayro producer name resolves to
-- no real agent. This wave takes three of those nine -- the three where the view
-- does not merely CONTAIN the rows but renders a verdict or a decision off them.
-- Presence was the wrong grain in the last wave and it is the wrong grain here:
-- measured per view, v_slack_invite_eligibility and v_agent_account_gaps both
-- contain the placeholders and both already refuse to act on them, so they are
-- deliberately untouched.
--
-- MEASURED BEFORE (live, 2026-10-05T21:3xZ):
--
--   v_free_leads_qualification / v_free_leads_summary -- the loud one.
--     17 producing agents in the trailing-30d window; 6 of them (35.3%) are
--     placeholders. 3 agents cross the $20k/$15k bar; ONE of those 3 is a
--     placeholder ("Dom Yous", 13 deals, $21,409), and OnboardingCommand.tsx
--     sorts qualifies_free_leads DESC then production_30d DESC, so it sat at the
--     TOP of the list Sam reads to decide who gets free leads.
--     NOT claimed as a dollar leak: nothing auto-grants. grep over src/ finds
--     qualifies_free_leads read at exactly one place (OnboardingCommand.tsx:268
--     and :280, both render-only) and no writer anywhere. This is a decision
--     surface telling Sam the truth about a person who does not exist, not money
--     already spent. v_free_leads_summary is derived FROM the base view, so one
--     edit moves both; its qualifying_agents 3 -> 2 is the count Sam sees.
--
--   v_recruiting_pipeline (RecruitingPipeline.tsx) -- 968 rows, 228 on the agent
--     leg, 6 of them placeholders, each rendered monday_status='good',
--     stage='Active Agent', next_action_display='Keep active / check production'
--     while license_status='unlicensed'. The stage CASE reaches 'Active Agent'
--     purely from raw_status='active', which is what the mint writes.
--
--   v_hire_activity (shipped-data/hire board) -- 67 rows, 6 placeholders
--     presented as hires 5-12 days old with activity_state='no activity in
--     30 days'. Already carries NOT fn_agent_is_roster_excluded(a.id) and they
--     come through it, i.e. roster_excluded is false for all 6.
--
-- WHY NOT THE ONE-LEVER FIX, tested and refused: fn_agent_is_roster_excluded is
-- the existing single lever (10 views) and flipping roster_excluded for these 6
-- would clear all three surfaces in one write. It also feeds
-- v_production_canonical, which is where the 36 deals / $66,670 AP these rows
-- carry live -- and v_free_leads_qualification reads production THROUGH that
-- view. The lever cannot separate "keep them off the people surfaces" from
-- "delete their production from the book", so taking it would mutate book-facing
-- totals to fix a label. Asserted below: v_production_canonical's row count is
-- unchanged by this migration.
--
-- Both predicate arguments stay load-bearing here. The 10 GHOST_### rows from
-- May 2026 carry user_id IS NOT NULL and 112 deals; a lexical GHOST% filter at
-- these three sites would have removed 16 rows while this file claimed 6.
-- Asserted below per view, not stated.
--
-- WHY ONE OF THE THREE GETS A WRAPPER INSTEAD OF THE 2-ARG PREDICATE: the two
-- 2-arg call sites already read the agents row they test (v_recruiting_pipeline
-- selects FROM agents g; v_hire_activity FROM agents a), so naming two more of
-- its columns costs nothing and keeps the predicate IMMUTABLE and inlinable.
-- v_free_leads_qualification does NOT -- it aggregates v_production_canonical,
-- which exposes agent_id and no agent_code. It is also security_invoker=true, so
-- an EXISTS over agents is resolved under the READER'S RLS: an invoker who
-- cannot see the agents row gets EXISTS=false and the placeholder is KEPT. That
-- fails open, in the direction of the bug, on the one surface here that is
-- money-adjacent. fn_agent_is_placeholder is the same shape as the lever this
-- file refuses to pull (fn_agent_is_roster_excluded: by-id, STABLE, SECURITY
-- DEFINER) and routes to the same single source, so it is not a fifth spelling
-- of the rule. An agent_id with no agents row is NOT a placeholder (coalesce
-- false), which is the conservative direction: it keeps a row Sam can see.
--
-- Replay-safe: each edit asserts its anchor is present, asserts replace()
-- actually changed the string, and no-ops if the object already carries
-- is_placeholder_agent. Anchors are written against pg_get_viewdef's NORMALISED
-- rendering, not against any file's source text.

begin;

create or replace function public.fn_agent_is_placeholder(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as
$fn$
  select coalesce((select public.is_placeholder_agent(a.agent_code, a.user_id)
                     from public.agents a where a.id = p_agent_id), false);
$fn$;

comment on function public.fn_agent_is_placeholder(uuid) is
  'By-id, RLS-immune form of public.is_placeholder_agent for security_invoker views '
  'that hold an agent_id but not the agents row (e.g. anything aggregating '
  'v_production_canonical). Routes to the same single source -- do not re-inline '
  'the GHOST%/null-user rule. See migration 20261005213000.';

do $mig$
declare
  src text;
  out text;
  n int := 0;
  edits text[][] := array[
    [
      'v_recruiting_pipeline',
      'LEFT JOIN profiles p ON p.user_id = g.user_id',
      'LEFT JOIN profiles p ON p.user_id = g.user_id
          WHERE NOT public.is_placeholder_agent(g.agent_code, g.user_id)'
    ],
    [
      'v_hire_activity',
      'NOT fn_agent_is_roster_excluded(a.id)',
      'NOT fn_agent_is_roster_excluded(a.id) AND NOT public.is_placeholder_agent(a.agent_code, a.user_id)'
    ],
    [
      'v_free_leads_qualification',
      'AND agent_id IS NOT NULL',
      'AND agent_id IS NOT NULL AND NOT public.fn_agent_is_placeholder(c.agent_id)'
    ]
  ];
begin
  for i in 1 .. array_length(edits, 1) loop
    select pg_get_viewdef(c.oid, true) into src
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = edits[i][1] and c.relkind = 'v';

    if src is null then
      raise exception 'MIG ABORT: view % not found', edits[i][1];
    end if;

    if position(edits[i][2] in src) = 0 then
      if position('is_placeholder_agent' in src) > 0 then
        raise notice 'already patched, skipping: %', edits[i][1];
        continue;
      end if;
      raise exception 'MIG ABORT: anchor % not found in % (and it is not already patched)',
        edits[i][2], edits[i][1];
    end if;

    -- an anchor that matches twice would silently patch a second, unexamined
    -- clause; each was measured to occur exactly once before this file was written
    if (select count(*) from regexp_matches(src, replace(replace(replace(edits[i][2], '\', '\\'), '(', '\('), ')', '\)'), 'g')) <> 1 then
      raise exception 'MIG ABORT: anchor is not unique in %', edits[i][1];
    end if;

    out := replace(src, edits[i][2], edits[i][3]);
    if out = src then
      raise exception 'MIG ABORT: replace() changed nothing for %', edits[i][1];
    end if;

    execute format('create or replace view public.%I as %s', edits[i][1], out);
    n := n + 1;
  end loop;

  raise notice 'patched % view(s)', n;
end $mig$;

-- Proof, not prose: the 6 placeholders are gone from all three surfaces, the 10
-- real GHOST_### producers are still on every one of them, and the book-facing
-- production view is untouched.
do $proof$
declare
  ph_rp int; ph_ha int; ph_fl int;
  real_rp int; real_ha int;
  real_total int;
  fl_qual int; fl_prod int;
begin
  select count(*) into real_total from agents
    where coalesce(agent_code,'') like 'GHOST%' and user_id is not null;
  if real_total <> 10 then
    raise exception 'PROOF ABORT: expected 10 real GHOST_### producers, found %', real_total;
  end if;

  select count(*) into ph_rp from v_recruiting_pipeline x
    join agents a on a.id = x.id where public.is_placeholder_agent(a.agent_code, a.user_id);
  select count(*) into ph_ha from v_hire_activity x
    join agents a on a.id = x.agent_id where public.is_placeholder_agent(a.agent_code, a.user_id);
  select count(*) into ph_fl from v_free_leads_qualification x
    join agents a on a.id = x.agent_id where public.is_placeholder_agent(a.agent_code, a.user_id);
  if (ph_rp + ph_ha + ph_fl) <> 0 then
    raise exception 'PROOF ABORT: placeholders still present (rp=% ha=% fl=%)', ph_rp, ph_ha, ph_fl;
  end if;

  -- the half that matters: the fix must not have eaten the real producers
  select count(*) into real_rp from v_recruiting_pipeline x
    join agents a on a.id = x.id
    where coalesce(a.agent_code,'') like 'GHOST%' and a.user_id is not null;
  if real_rp <> 10 then
    raise exception 'PROOF ABORT: v_recruiting_pipeline lost real producers (% of 10 left)', real_rp;
  end if;

  -- v_hire_activity filters status='active' on its own, so 0 of the 10 inactive
  -- producers are expected there; assert the number did not move rather than
  -- asserting a number this view never had.
  select count(*) into real_ha from v_hire_activity x
    join agents a on a.id = x.agent_id
    where coalesce(a.agent_code,'') like 'GHOST%' and a.user_id is not null;
  if real_ha <> 0 then
    raise exception 'PROOF ABORT: v_hire_activity real-producer count changed to %', real_ha;
  end if;

  select qualifying_agents, producing_agents_30d into fl_qual, fl_prod from v_free_leads_summary;
  if fl_qual <> 2 or fl_prod <> 11 then
    raise exception 'PROOF ABORT: free-leads summary expected 2 qualifying / 11 producing, got % / %',
      fl_qual, fl_prod;
  end if;

  -- the wrapper must agree with the predicate on every live agents row, and
  -- must not claim an unknown id is a placeholder
  if exists (select 1 from agents a
             where public.fn_agent_is_placeholder(a.id)
                is distinct from public.is_placeholder_agent(a.agent_code, a.user_id)) then
    raise exception 'PROOF ABORT: fn_agent_is_placeholder disagrees with is_placeholder_agent';
  end if;
  if public.fn_agent_is_placeholder('00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'PROOF ABORT: wrapper called an unknown agent_id a placeholder';
  end if;

  raise notice 'proof: 0 placeholders on 3 surfaces; 10/10 real producers kept; free-leads 3->2 qualifying, 17->11 producing';
end $proof$;

commit;
