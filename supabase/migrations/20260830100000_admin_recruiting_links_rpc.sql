-- MP-342 — "make me able to send out links under managers".
--
-- Every active agent already carries a stable ref_slug (trg_agents_autogen_ref_slug),
-- and /apply?ref=<slug> + /r/<slug> attribute recruiter_id / referral_manager_id /
-- referral_recruiter_id on submit, with add-agent placing the hire under that
-- manager (agents.manager_id). What did NOT exist was any surface where Sam
-- (admin) could see ANOTHER person's link — my_recruiting_link() is
-- auth.uid()-scoped by design. This RPC is the admin read: the full active
-- roster with slugs, managers first, gated in-body on apex_is_admin() so a
-- non-admin caller gets zero rows rather than an error (proven live: bot-sql
-- context → 0 rows; Sam's claims via set_config → full roster).
create or replace function public.admin_recruiting_links()
returns table(agent_id uuid, display_name text, account_mode text, is_manager boolean, ref_slug text, avatar_url text)
language sql stable security definer set search_path to 'public'
as $fn$
  select a.id, a.display_name, coalesce(a.account_mode,'agent'), coalesce(a.is_manager,false),
         nullif(btrim(a.ref_slug),''), p.avatar_url
  from public.agents a
  left join public.profiles p on p.user_id = a.user_id
  where a.status = 'active'
    and coalesce(a.is_deactivated,false) = false
    and coalesce(a.is_inactive,false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
    and public.apex_is_admin()
  order by coalesce(a.is_manager,false) desc, a.display_name
$fn$;

revoke all on function public.admin_recruiting_links() from public, anon;
grant execute on function public.admin_recruiting_links() to authenticated, service_role;
