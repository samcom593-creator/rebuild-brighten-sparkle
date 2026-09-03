-- MP-394: the Vantage Discord deal feed has been credential-blocked since
-- 2026-07-29 (discord-bot.token is a 0-byte file) and NOTHING Sam looks at
-- said so. v_discord_deal_ingestion_health exists but the authenticated role
-- cannot read it (permission denied as Sam, measured 2026-09-03), so no
-- dashboard could render it. This RPC is the read path for staff surfaces:
-- SECURITY DEFINER, gated on admin/manager, never a status literal invented
-- client-side. The grant table shows only postgres/service_role on the view;
-- the anon revoke below is belt-and-braces (a no-op today, measured).
create or replace function public.discord_deal_feed_health()
returns table (
  source text,
  agency_name text,
  status text,
  detail text,
  last_heartbeat_at timestamptz,
  last_message_at timestamptz,
  last_ingested_at timestamptz,
  unresolved_24h bigint,
  measured_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select h.source, h.agency_name, h.status, h.detail,
         h.last_heartbeat_at, h.last_message_at, h.last_ingested_at,
         h.unresolved_24h::bigint, h.measured_at
  from public.v_discord_deal_ingestion_health h
  where public.apex_is_admin() or public.apex_has_any_role(array['manager'])
  order by h.agency_name;
$$;
revoke all on function public.discord_deal_feed_health() from public;
grant execute on function public.discord_deal_feed_health() to authenticated;
revoke select on public.v_discord_deal_ingestion_health from anon;
