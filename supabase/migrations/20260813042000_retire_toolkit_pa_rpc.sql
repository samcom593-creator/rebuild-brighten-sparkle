-- Contract phase for the NPN Add Agent rollout.
--
-- The production web bundle was verified on the p_npn payload before this
-- migration was applied. Preserve the old implementation for rollback, but
-- remove every client grant so PA-number semantics cannot create new rows.

do $migration$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'create_apex_toolkit_agent'
       and p.proargtypes = '25 25 25 25 25'::oidvector
       and p.proargnames[5] = 'p_pa_number'
  ) and to_regprocedure('public.create_apex_toolkit_agent_legacy(text,text,text,text,text)') is null then
    alter function public.create_apex_toolkit_agent(text, text, text, text, text)
      rename to create_apex_toolkit_agent_legacy;
  end if;
end;
$migration$;

revoke all on function public.create_apex_toolkit_agent_legacy(text, text, text, text, text) from public;
revoke all on function public.create_apex_toolkit_agent_legacy(text, text, text, text, text) from anon;
revoke all on function public.create_apex_toolkit_agent_legacy(text, text, text, text, text) from authenticated;

notify pgrst, 'reload schema';
