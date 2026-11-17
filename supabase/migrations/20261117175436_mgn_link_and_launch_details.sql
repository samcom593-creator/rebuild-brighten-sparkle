-- Per-agent MGN contracting link + roadmap appointment truth (MP-CONTRACTING-MGN-LINK, Sam 2026-11-17).
--
-- 1) agents.mgn_link: that agent's own MGN Agent Hub contracting link. NULL means "use the shared
--    hub URL" (CONTRACTING_LINK_URL in the app). SELECT on agents is column-granted since the
--    2026-08-27 read-leak closure, so the new column needs its own grant or every client read 403s.
alter table public.agents add column if not exists mgn_link text;
comment on column public.agents.mgn_link is
  'Per-agent MGN Agent Hub contracting link; null = the shared hub URL (CONTRACTING_LINK_URL in the app).';
grant select (mgn_link) on public.agents to authenticated;

-- 2) agent_launch_details gains first_deal_at and mgn_link.
--    first_deal_at: a posted deal proves a carrier appointed the agent. Measured 2026-11-17:
--    16 producing agents carried a NULL contracted_at and their own roadmap showed
--    "Carrier contracting" incomplete. The stepper now reads either stamp.
--    mgn_link: the agent's roadmap opens their personal MGN link when one is set.
create or replace function public.agent_launch_details(p_agent_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select to_jsonb(x)
  from (
    select a.display_name, a.user_id, a.profile_id, a.license_status, a.nipr_number,
           a.eft_ready, a.eo_certificate_url, a.eo_expires_at, a.contracted_at,
           a.first_deal_at, a.mgn_link
    from public.agents a
    where a.id = p_agent_id
      and (select auth.uid()) is not null
      and (a.user_id = (select auth.uid())
           or public.has_role((select auth.uid()), 'admin'::public.app_role))
  ) x;
$function$;
