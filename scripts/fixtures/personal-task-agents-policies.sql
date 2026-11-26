-- Exact agents policy expressions from the fixed catalog-only preflight, 2026-11-26 UTC.
-- This fixture is used only with synthetic local records. No application RPC was executed
-- and no identity or task row was read to obtain this policy metadata.
alter table public.agents enable row level security;
create policy "Admins can manage all agents" on public.agents as permissive for all to "authenticated"
  using (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
create policy "Admins can update all agents" on public.agents as permissive for update to "authenticated"
  using (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role))
  with check (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
create policy "Agents can update own record" on public.agents as permissive for update to "authenticated"
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "Agents can view own record" on public.agents as permissive for select to "authenticated"
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Agents can view their manager" on public.agents as permissive for select to "authenticated"
  using (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (id = current_manager_agent_id())));
create policy "Authenticated users can view agents for leaderboard" on public.agents as permissive for select to "authenticated"
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "Managers can insert team agents" on public.agents as permissive for insert to "authenticated"
  with check ((has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) AND (invited_by_manager_id = current_agent_id())));
create policy "Managers can update team agent onboarding stage" on public.agents as permissive for update to "authenticated"
  using ((has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) AND (invited_by_manager_id = current_agent_id())))
  with check ((has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) AND (invited_by_manager_id = current_agent_id())));
create policy "Managers can view other manager agents" on public.agents as permissive for select to "authenticated"
  using ((has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) AND (user_id IN ( SELECT user_roles.user_id
   FROM user_roles
  WHERE (user_roles.role = 'manager'::app_role)))));
create policy "Managers can view their team" on public.agents as permissive for select to "authenticated"
  using ((has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (invited_by_manager_id = current_agent_id()) OR (manager_id = current_agent_id()))));
create policy "Staff can insert agents" on public.agents as permissive for insert to "authenticated"
  with check ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role)));
create policy "agents_delete_admin_only" on public.agents as restrictive for delete to "authenticated"
  using (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
create policy "agents_update_scoped" on public.agents as restrictive for update to "authenticated"
  using ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) OR (user_id = ( SELECT auth.uid() AS uid))));
