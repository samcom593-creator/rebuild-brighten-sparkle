-- MP-LEAD-MANAGER-13 (2026-11-09): Sam — "the only people who I'm gonna possibly
-- get leads will be agents who are marked as live, in the field." The obvious
-- operand (onboarding_stage = 'live') was measured and REFUSED: exactly 2 roster
-- rows carry it and both are Sam himself, while every recipient he actually
-- dropped packs to this week (Chudi/Obiajulu = 'evaluated', Jazz = 'pre_licensed')
-- would be hidden — the stage column lags reality. is_live is therefore DERIVED:
--   field stages ('live', 'in_field_training')  OR  lead-grant history (anyone
--   ever handed a pack, revoked or not).
-- Granting through the dropdown's "Show all" escape hatch creates the grant row,
-- so the short list maintains itself; no new table, no marking chore.
drop function if exists public.lead_assignable_agents(text);
create function public.lead_assignable_agents(p_search text default null)
returns table(user_id uuid, agent_id uuid, display_name text, subagency text, is_live boolean)
language sql stable security definer
set search_path to 'public'
as $function$
  select * from (
    select distinct on (a.user_id)
      a.user_id, a.id as agent_id, a.display_name,
      public.fn_agent_subagency(a.id) as subagency,
      (a.onboarding_stage::text in ('live', 'in_field_training')
       or exists (select 1 from public.lead_bundle_grants g where g.user_id = a.user_id)) as is_live
    from public.agents a
    where public.can_view_sold_calls()
      and a.user_id is not null
      and a.status = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and not public.fn_agent_is_roster_excluded(a.id)
      and (nullif(btrim(p_search), '') is null
           or a.display_name ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    order by a.user_id, (a.canonical_agent_id is null) desc, a.created_at
  ) t
  order by t.display_name
$function$;
grant execute on function public.lead_assignable_agents(text) to authenticated;
