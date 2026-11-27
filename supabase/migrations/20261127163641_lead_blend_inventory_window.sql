-- MP-LEAD-BLEND (2026-11-27), second cut of fn_lead_blend_inventory. Measured right after the first:
-- 14.7 s for TX+FL+CA and 7.3 s for AZ, against 5.3 s for the one-pool fn_starter_pack_inventory it
-- replaces, because every exclusion probe (do-not-call marks, dialer dispositions, resale ledger,
-- suppression view) ran over a whole state's candidates (~19k rows for TX). The grant loop calls this
-- once per eligible agent, so it has to be cheap on a 1 GB box. Cheap filters first, then the top of
-- each slice (4x its quota, never fewer than 40), then the expensive probes on those few hundred rows,
-- then the same one-per-phone, quota and spill logic as before. Same rows out for the common case;
-- a slice whose window is mostly excluded under-fills and spills to the next, by design.
-- After: 4.95 s for TX+FL+CA, 2.9 s AZ, 2.7 s DC; TX pack 10 Marketing A / 10 Dialer F / 5 Dialer C;
-- an impossible slice spills to a full 25 from the first; a 7-lead top-up splits 4/2/1.
--
-- Applied live via MCP apply_migration at 2026-11-27 16:36:41Z (this version number is the one the
-- platform recorded); this file is the repo's record.
create or replace function public.fn_lead_blend_inventory(p_states text[], p_limit integer default 25, p_recipe jsonb default null)
returns table(source text, lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
              age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean, slice integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r jsonb := coalesce(p_recipe, public.fn_lead_blend_recipe());
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
begin
  return query
  with recipe as (
    select (t.ord - 1)::integer as slice, t.e->>'source' as source,
           array(select jsonb_array_elements_text(t.e->'tiers')) as tiers,
           (t.e->>'share')::numeric as share,
           coalesce(t.e->>'order', 'newest') as ord
      from jsonb_array_elements(r) with ordinality t(e, ord)
  ), floors as (
    select rc.slice, floor(rc.share * v_limit)::integer as q from recipe rc
  ), quota as (
    -- floors by share; the rounding remainder goes to the first slice
    select f.slice, f.q + case when f.slice = 0 then v_limit - (select sum(q) from floors) else 0 end as q from floors f
  ), window_pick as (
    -- cheap filters only, then the head of each slice
    select w.* from (
      select p.source, p.lead_id, p.phone10, p.first_name, p.last_name, p.email, p.state, p.age, p.tier, p.tags,
             p.flags, p.lead_age_days, p.under_9mo, rc.slice, rc.ord, array_position(rc.tiers, p.tier) as tier_rank,
             row_number() over (partition by rc.slice
                                order by array_position(rc.tiers, p.tier),
                                         case when rc.ord = 'oldest' then -p.lead_age_days else p.lead_age_days end asc nulls last,
                                         p.phone10) as rn0,
             greatest(40, 4 * q.q) as win
        from public.mat_lead_pool p
        join recipe rc on rc.source = p.source and p.tier = any (rc.tiers)
        join quota q on q.slice = rc.slice
       where upper(btrim(p.state)) = any (p_states)
         and p.phone10 ~ '^[0-9]{10}$'
         and not coalesce(p.dnc, false)
         and not coalesce((p.flags->>'dnc')::boolean, false)
         and not coalesce((p.flags->>'true_dnc')::boolean, false)
         and not coalesce((p.flags->>'current_client')::boolean, false)
         and not coalesce((p.flags->>'import_review_required')::boolean, false)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.removed_at is null)
    ) w
    where w.rn0 <= w.win
  ), sup as materialized (
    select distinct s.lead_id from public.v_leads_suppression_all s
     where s.lead_id is not null
       and s.lead_id in (select w.lead_id from window_pick w where w.lead_id is not null)
  ), cand as (
    select w.* from window_pick w
     where not exists (select 1 from public.lead_bundle_items i where i.phone10 = w.phone10 and i.status = 'do_not_call')
       and not exists (select 1 from public.lead_contact_dnc d where d.phone10 = w.phone10)
       and not exists (select 1 from public.readymode_dialer_calls c
                        where c.lead_phone10 = w.phone10 and lower(coalesce(c.disposition, '')) = 'do not call')
       and not exists (select 1 from public.lead_resale_ledger rl where rl.phone10 = w.phone10)
       and (w.lead_id is null or not exists (select 1 from sup s where s.lead_id = w.lead_id))
  ), one as (
    -- one row per phone: the earliest slice that holds it wins, then the best tier in that slice
    select c.*, row_number() over (partition by c.phone10 order by c.slice, c.tier_rank, c.lead_age_days asc nulls last) as pr
      from cand c
  ), ranked as (
    select o.*, row_number() over (
             partition by o.slice
             order by o.tier_rank,
                      case when o.ord = 'oldest' then -o.lead_age_days else o.lead_age_days end asc nulls last,
                      o.phone10) as rn
      from one o where o.pr = 1
  ), primary_pick as (
    select k.* from ranked k join quota q on q.slice = k.slice where k.rn <= q.q
  ), short as (
    select v_limit - count(*) as n from primary_pick
  ), spill as (
    select k.* from ranked k
     where not exists (select 1 from primary_pick pp where pp.phone10 = k.phone10)
     order by k.slice, k.rn
     limit (select greatest(0, n) from short)
  )
  select x.source, x.lead_id, x.phone10, x.first_name, x.last_name, x.email, x.state, x.age, x.tier, x.tags,
         x.flags, x.lead_age_days, x.under_9mo, x.slice
    from (select * from primary_pick union all select * from spill) x
   order by x.slice, x.rn;
end;
$function$;
revoke all on function public.fn_lead_blend_inventory(text[], integer, jsonb) from public, anon, authenticated;
