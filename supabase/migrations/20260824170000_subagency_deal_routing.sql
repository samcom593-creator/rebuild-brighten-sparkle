-- wave-vantage-feed — Vantage Financial's deals never reached Vantage's Discord.
--
-- MEASURED. Vantage Financial is not a carrier (that was my first wrong read of
-- "Vantage deals aren't posting"); it is a SUB-AGENCY, and a large one:
-- 245 policies, $334,172 ALP, $23,330 MTD. Its membership rule already exists,
-- hardcoded inside v_imo_by_agency — agent 431dff0d (KJ Vaughn) plus everyone
-- whose manager_id is that agent.
--
-- The webhook was already configured. system_settings.discord_webhook_url_subagency_deals
-- holds a valid, live webhook pointing at a channel named "Daily Sales"
-- (verified against Discord's API: channel 1537486131329896506). It has simply
-- never had a consumer: grepping the repo AND pg_get_functiondef across every
-- function in public returns ZERO references to it. A configured credential
-- that nothing reads looks exactly like a broken integration from the outside,
-- which is why this read as "deals aren't posting" rather than as "nothing was
-- ever wired".
--
-- Every deal currently goes to discord_webhook_url — the APEX channel — because
-- _shared/apex.ts knows only two audiences, production and recruiting. So
-- Vantage's deals do post; they post into APEX's channel and never into
-- Vantage's own.
--
-- This migration provides the membership rule as a function so the routing and
-- v_imo_by_agency cannot drift apart (the same single-source discipline as
-- fn_alert_sms_fix_anchor), and rewrites the view to call it. The delivery
-- fan-out itself lives in discord-webhook-notify.
--
-- ADDITIVE ON PURPOSE: a Vantage deal now posts to Vantage's channel IN
-- ADDITION to the existing APEX post, not instead of it. Sam loses no
-- visibility he has today; Vantage gains the feed they were missing. Making it
-- exclusive is a one-line change once Sam says he wants that.

begin;

create or replace function public.fn_agent_subagency(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_agent_id is null then null
    when p_agent_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid then 'vantage'
    when exists (
      select 1 from public.agents a
      where a.id = p_agent_id
        and a.manager_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    ) then 'vantage'
    else null
  end;
$$;

comment on function public.fn_agent_subagency(uuid) is
  'Sub-agency slug for an agent, or NULL for the primary agency. Single source '
  'for BOTH v_imo_by_agency and Discord deal routing — the rule was previously '
  'hardcoded inside the view only, so a router written separately would have '
  'drifted the first time the roster changed. Slug maps to the system_settings '
  'key discord_webhook_url_<slug>_deals.';

revoke all on function public.fn_agent_subagency(uuid) from public, anon;
grant execute on function public.fn_agent_subagency(uuid) to authenticated, service_role;

-- Rewrite the view onto the shared rule. Column list, types and grants are
-- unchanged, so every dashboard reading it keeps working.
create or replace view public.v_imo_by_agency as
with scoped as (
  select b.annual_premium,
         b.posted_date,
         -- coalesce is load-bearing: fn_agent_subagency returns NULL for the
         -- primary agency, and `NULL = 'vantage'` is NULL, not false. Without
         -- it `is_primary` came back NULL instead of true for APEX Financial
         -- (caught by reading the view's output, not by the totals, which
         -- matched exactly either way) and any dashboard filtering
         -- `is_primary = true` would have silently dropped the APEX row.
         coalesce(public.fn_agent_subagency(a.id) = 'vantage', false) as is_vantage
  from public.agentlink_book b
  join public.agents a on a.id = b.agent_id
  where not coalesce(b.is_dead, false)
    and not public.fn_agent_is_roster_excluded(b.agent_id)
)
select
  case when is_vantage then 'Vantage Financial'::text else 'APEX Financial'::text end as agency,
  (not is_vantage) as is_primary,
  count(*)::integer as policies,
  round(sum(annual_premium), 0) as alp,
  round(coalesce(sum(annual_premium) filter (
    where posted_date >= date_trunc('month', ((now() at time zone 'America/Phoenix')::date)::timestamptz)
  ), 0::numeric), 0) as alp_mtd
from scoped
group by 1, 2
order by (round(sum(annual_premium), 0)) desc;

commit;
