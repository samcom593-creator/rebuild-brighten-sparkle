-- Mirror of a migration applied live 2026-08-07 via Supabase MCP (recorded
-- remotely as 20260807064411_phc_admin_leads_rpc). Content recovered from
-- pg_get_functiondef on the live database. See 20260806214858 header for why
-- these mirrors exist.
--
-- Admin-only read surface for Policy Help Center leads (/admin/policy-leads).

CREATE OR REPLACE FUNCTION public.phc_admin_lead_stats()
 RETURNS TABLE(total bigint, today bigint, uncalled bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*) filter (where l.status <> 'spam'),
    count(*) filter (where l.status <> 'spam' and l.created_at >= (now() at time zone 'America/Chicago')::date),
    count(*) filter (where l.status = 'new')
  from public.phc_leads l
  where public.has_role(auth.uid(), 'admin'::app_role);
$function$;

CREATE OR REPLACE FUNCTION public.phc_admin_leads()
 RETURNS TABLE(lead_code text, created_at timestamp with time zone, first_name text, phone_e164 text, email text, state text, help_category text, callback_time text, current_carrier text, utm_source text, utm_campaign text, gclid text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.lead_code, l.created_at, l.first_name, l.phone_e164, l.email,
         l.state, l.help_category, l.callback_time, l.current_carrier,
         l.utm_source, l.utm_campaign, l.gclid, l.status
  from public.phc_leads l
  where public.has_role(auth.uid(), 'admin'::app_role)
    and l.status <> 'spam'
  order by l.created_at desc
  limit 500;
$function$;
