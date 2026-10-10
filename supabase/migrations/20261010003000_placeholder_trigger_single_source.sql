-- MP-593 (2026-10-10). apex-doctor Check #90 went CRITICAL: fn_exclude_external_placeholder (20261006080000) carried its
-- own spelling of the placeholder rule — `agent_code like 'GHOST\_AYRO\_%'` — the lexical-only form that is_placeholder_agent
-- exists to replace, because it also matches a real former producer whose code happens to start with GHOST (the rule is
-- GHOST% AND no user). The rule has one home: public.is_placeholder_agent(agent_code, user_id). The trigger now routes
-- through it, so a placeholder of any origin is excluded from the roster at creation and a person never is.
-- The exclusion reason keeps the Ayro wording for Ayro-minted rows (nothing that reads roster_exclusions.reason changes)
-- and says plainly what any other placeholder is. Behaviour otherwise unchanged: a failure to write the bookkeeping
-- row warns and never rolls back the agent insert the ingest depends on.
create or replace function public.fn_exclude_external_placeholder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_placeholder_agent(new.agent_code, new.user_id) then
    insert into public.roster_exclusions (agent_id, reason, excluded_at)
    values (
      new.id,
      case when new.agent_code like 'GHOST\_AYRO\_%' escape '\'
           then 'external producer: unmatched Ayro ingest placeholder (auto at creation)'
           else 'placeholder agent row, not a person (auto at creation)' end,
      now()
    )
    on conflict (agent_id) do nothing;
  end if;
  return new;
exception when others then
  -- Never let a bookkeeping row roll back the agent insert the ingest depends on; say so loudly.
  raise warning 'fn_exclude_external_placeholder(%): %', new.id, sqlerrm;
  return new;
end;
$$;
