-- MP-MONDAY-ROLLCALL part 2 (2026-11-22): the two lead paths the morning batch depends on.
--
-- Measured on prod after the pool grew from 125K to 233K rows (LeadVault import, 2026-11-18):
--   * fn_starter_pack_inventory took 50 seconds for one state (WI) and 76 for another (MO). The grant calls it
--     twice per eligible hire. Cause: "not exists (select 1 from v_leads_suppression_all ...)" was planned as a
--     sub-plan re-run for every candidate lead (1,739 runs for WI). The whole view is 1,219 rows in under 2s.
--     Computed once now: MO 76s -> 2.5s. Old and new returned the same 25 leads in the same order for WI and NJ
--     (installed side by side as _v2, compared, then swapped).
--   * lead_pool_assign (Sam's and Aisha's manual drop) runs as authenticated under an 8-second statement limit.
--     sellable_pool('dialer') alone now takes 5 seconds, and the 2026-11-22 16:55 drop logged two 57014 timeouts
--     before the third attempt went through. The function now carries its own 30-second limit, which the API
--     applies to the call (proven with a throwaway function: a 5-second sleep completed under anon's 3-second
--     role limit and reported 20s; the probe is dropped).

CREATE OR REPLACE FUNCTION public.fn_starter_pack_inventory(p_states text[], p_limit integer DEFAULT 25)
 RETURNS TABLE(source text, lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- MP-MONDAY-ROLLCALL (2026-11-22): the suppression list is computed ONCE. As a per-row NOT EXISTS against the view
  -- it was re-planned as a sub-plan for every candidate lead (1,739 runs for one state, 50 to 76 seconds); the whole
  -- view is 1,219 rows and takes under 2 seconds. Same rows out, proven lead-for-lead before this replaced it.
  with sup as materialized (
    select distinct s.lead_id from public.v_leads_suppression_all s where s.lead_id is not null
  )
  select e.source, e.lead_id, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, e.flags, e.lead_age_days, e.under_9mo
    from (
      select p.*,
             row_number() over (partition by p.phone10
                                order by array_position(array['A', 'B'], p.tier), (p.source = 'dialer') desc,
                                         p.lead_age_days asc nulls last) as rn
        from public.mat_lead_pool p
       where p.source in ('marketing', 'dialer')
         and p.tier in ('A', 'B')
         and upper(btrim(p.state)) = any (p_states)
         and p.phone10 ~ '^[0-9]{10}$'
         and not coalesce(p.dnc, false)
         and not coalesce((p.flags ->> 'dnc')::boolean, false)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.removed_at is null)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.status = 'do_not_call')
         and not exists (select 1 from public.readymode_dialer_calls c
                          where c.lead_phone10 = p.phone10 and lower(coalesce(c.disposition, '')) = 'do not call')
         and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = p.phone10)
         and (p.lead_id is null or not exists (select 1 from sup s where s.lead_id = p.lead_id))
    ) e
   where e.rn = 1
   order by array_position(array['A', 'B'], e.tier), (e.source = 'dialer') desc, e.lead_age_days asc nulls last, e.phone10
   limit greatest(1, least(coalesce(p_limit, 25), 25))
$function$;

alter function public.lead_pool_assign(text, jsonb, integer, uuid, text, text) set statement_timeout = '30s';
