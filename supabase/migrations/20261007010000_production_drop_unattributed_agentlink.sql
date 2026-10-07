-- Sam 2026-10-06: "we don't use AgentLink at all ... a guy who just did a million in production, I don't know who that is".
-- The stranger was 'Willard Herald': 2 AgentLink rows ($1,800,000 + $21,600) with no Apex agent behind them.
-- Drop AgentLink rows that match no agent from the one production view every board/home/hero reads.
-- Apex agents' own pre-August AgentLink history (1,087 attributed rows) is kept.
do $$
declare d text; o text[];
begin
  select pg_get_viewdef('public.v_production_comp_truth'::regclass), c.reloptions into d, o
    from pg_class c where c.oid = 'public.v_production_comp_truth'::regclass;
  if d ilike '%u.agent_id IS NULL%' then return; end if;  -- already applied
  d := regexp_replace(d, ';\s*$', '');
  execute 'create or replace view public.v_production_comp_truth '
    || coalesce('with (' || array_to_string(o, ',') || ') ', '')
    || 'as ' || d || E'\n  WHERE NOT (u.origin = ''agentlink'' AND u.agent_id IS NULL)';
end $$;
