-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 5 of 11: who the nightly numbers reminder is for.
--
-- WHAT
--   v_numbers_reminder_audience: one row per agent row the live sender (supabase/functions/numbers-reminder, crons
--   83/84 at 18:00 Chicago) may remind. An agent is in it only if they can produce today:
--     * a live My Leads pack (unrevoked grant on an unarchived bundle with at least one live lead), or
--     * a deal in the last 60 days (mat_production_unified, any agent row of the same person), or
--     * hired within 21 days and licensed (the onboarding window)
--   and they are active, licensed, not deactivated / inactive, and NOT suspended on any login of the person.
--   reason says which rule let them in. The edge function reads this view instead of re-deriving the audience.
--
-- WHY
--   message_map H13 + timeline D11: 1,214 reminders went to 47 agents in 30 days, 64% to 29 agents who never had a
--   deal; Nathan and Vincent received nothing else for a month. shipped_vs_live 7.5: Luiza (30e3ed5a, suspended
--   09-07) got 10 reminders since 11-01 while banned. DECISIONS: numbers reminder only to agents who can produce.
--   send-numbers-reminder has no caller (no cron, no trigger, no UI) and is left alone.

create or replace view public.v_numbers_reminder_audience with (security_barrier = true) as
with base as (
  select a.id as agent_id,
         a.user_id,
         a.display_name,
         a.created_at,
         coalesce(nullif(a.canonical_agent_id, a.id), a.id) as person_id
    from public.agents a
   where a.status::text = 'active'
     and coalesce(a.is_deactivated, false) = false
     and coalesce(a.is_inactive, false) = false
     and a.license_status::text = 'licensed'
), flags as (
  select b.*,
         exists (select 1
                   from public.lead_bundle_grants g
                   join public.lead_bundles lb on lb.id = g.bundle_id and lb.archived_at is null
                  where g.user_id = b.user_id and b.user_id is not null and g.revoked_at is null
                    and exists (select 1 from public.lead_bundle_items i where i.bundle_id = lb.id and i.removed_at is null)) as has_active_pack,
         exists (select 1
                   from public.mat_production_unified m
                   join public.agents x on x.id = m.agent_id
                  where coalesce(nullif(x.canonical_agent_id, x.id), x.id) = b.person_id
                    and coalesce(m.posted_date, m.effective_date) >= current_date - 60) as has_deal_60d,
         b.created_at >= now() - interval '21 days' as new_hire_21d,
         exists (select 1
                   from public.agents g
                   join public.agent_access_suspensions s on s.user_id = g.user_id and s.lifted_at is null
                  where coalesce(nullif(g.canonical_agent_id, g.id), g.id) = b.person_id) as suspended,
         -- a login auth has banned or deleted gets nothing either
         exists (select 1
                   from auth.users u
                  where u.id = b.user_id
                    and ((u.banned_until is not null and u.banned_until > now()) or u.deleted_at is not null)) as login_blocked
    from base b
)
select f.agent_id,
       f.user_id,
       f.display_name,
       case when f.has_active_pack then 'active_pack'
            when f.has_deal_60d then 'deal_60d'
            else 'new_hire_21d' end as reason,
       f.has_active_pack,
       f.has_deal_60d,
       f.new_hire_21d
  from flags f
 where not f.suspended
   and not f.login_blocked
   and (f.has_active_pack or f.has_deal_60d or f.new_hire_21d)
   and (current_user = any (array['postgres'::name, 'service_role'::name, 'supabase_admin'::name]) or public.apex_is_admin());

revoke all on public.v_numbers_reminder_audience from public, anon, authenticated;
grant select on public.v_numbers_reminder_audience to service_role;

comment on view public.v_numbers_reminder_audience is
  'PKG2 (2026-11-12): the numbers-reminder audience. Active licensed agents who can produce (live My Leads pack, a deal in 60 days, or hired <= 21 days) and are not suspended on any login. Read by supabase/functions/numbers-reminder through fn_numbers_reminder_audience(). Service role only.';

-- The edge function reads the audience through this RPC (one definition, the view above).
create or replace function public.fn_numbers_reminder_audience()
returns table(agent_id uuid, user_id uuid, display_name text, reason text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.agent_id, n.user_id, n.display_name, n.reason from public.v_numbers_reminder_audience n
$$;

comment on function public.fn_numbers_reminder_audience() is
  'PKG2: rows of v_numbers_reminder_audience for supabase/functions/numbers-reminder. Service role only.';

revoke all on function public.fn_numbers_reminder_audience() from public, anon, authenticated;
grant execute on function public.fn_numbers_reminder_audience() to service_role;
