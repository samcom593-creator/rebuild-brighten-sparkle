-- PERF-LOAD-TIMES part 4 (2026-11-12). The onboarding stepper's own-row read.
--
-- AgentOnboardingStepper (rendered only on an agent's OWN pages: AgentPortal and
-- AgentCommandDashboard) read
--   agents.select(display_name,user_id,profile_id,license_status,nipr_number,eft_ready,
--                 eo_certificate_url,eo_expires_at,contracted_at).eq(id, <own agent id>)
-- nipr_number and eo_certificate_url have not been SELECTable by authenticated since
-- 20260827150000 (MP-328 comp/NIPR lockdown); the stepper was written 4 days later
-- (b1bcee95, 2026-08-31), so this read has returned 403 on every load since it shipped.
-- React Query retried each 403 with backoff and a realtime subscription on agents re-fired it
-- on every agent-row change: edge logs show 58 failing reads for one agent in a single day.
--
-- Column grants cannot express "your own row", so MP-328 necessarily hid an agent's own
-- NIPR/E&O from that agent too. This RPC returns exactly those nine fields for ONE agent, and
-- only to that agent (agents.user_id = auth.uid()) or an admin -- the 2026-11-09 own-rows-only
-- rule. It widens nothing for anyone else: a caller asking about another agent gets NULL,
-- exactly what the locked columns give them today. Not executable by anon.
create or replace function public.agent_launch_details(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select to_jsonb(x)
  from (
    select a.display_name, a.user_id, a.profile_id, a.license_status, a.nipr_number,
           a.eft_ready, a.eo_certificate_url, a.eo_expires_at, a.contracted_at
    from public.agents a
    where a.id = p_agent_id
      and (select auth.uid()) is not null
      and (a.user_id = (select auth.uid())
           or public.has_role((select auth.uid()), 'admin'::public.app_role))
  ) x;
$function$;

revoke all on function public.agent_launch_details(uuid) from public, anon;
grant execute on function public.agent_launch_details(uuid) to authenticated;

comment on function public.agent_launch_details(uuid) is
  'Onboarding stepper launch fields (incl. NIPR + E&O, column-locked since MP-328) for ONE agent, returned only to that agent or an admin. NULL for anyone else.';
