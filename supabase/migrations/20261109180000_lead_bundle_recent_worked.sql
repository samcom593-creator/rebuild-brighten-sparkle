-- MP-LEAD-MANAGER-10 (2026-11-09): Sam asked to see, from Lead Manager, whether a
-- dropped pack's leads are actually IN the agent's portal and BEING WORKED.
-- lead_bundle_recent now reports the working truth per pack and per holder:
--   worked         items whose status moved off 'new' (same operand the closers
--                  leaderboard uses), last_worked_at the newest status_at/last_dialed_at
--   holders[].worked / holders[].dialed  that agent's own touches on this pack
-- Nothing is inferred: an untouched pack reads worked 0, last_worked_at null.
create or replace function public.lead_bundle_recent(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    select b.id as bundle_id, b.name, b.format, b.criteria, b.note, b.created_at, b.archived_at,
      count(i.id) filter (where i.removed_at is null)::int as live_items,
      count(i.id) filter (where i.removed_at is null and i.status = 'sold')::int as sold,
      count(i.id) filter (where i.removed_at is null and i.status <> 'new')::int as worked,
      count(i.id) filter (where i.removed_at is null and i.last_dialed_at is not null)::int as dialed,
      greatest(max(i.status_at) filter (where i.removed_at is null and i.status <> 'new'),
               max(i.last_dialed_at) filter (where i.removed_at is null)) as last_worked_at,
      count(i.id) filter (where (i.attrs->>'under_9mo')::boolean is true and i.removed_at is null)::int as under_9mo,
      exists(select 1 from public.lead_resale_ledger r where r.bundle_id = b.id) as resold,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', g.user_id, 'granted_at', g.granted_at,
          'name', (select a2.display_name from public.agents a2
                   where a2.user_id = g.user_id
                   order by (a2.canonical_agent_id is null) desc, a2.created_at limit 1),
          'worked', (select count(*)::int from public.lead_bundle_items i2
                     where i2.bundle_id = b.id and i2.removed_at is null
                       and i2.status <> 'new' and i2.status_by = g.user_id),
          'dialed', (select count(*)::int from public.lead_bundle_items i3
                     where i3.bundle_id = b.id and i3.removed_at is null
                       and i3.last_dialed_at is not null))
        order by g.granted_at), '[]'::jsonb)
        from public.lead_bundle_grants g where g.bundle_id = b.id and g.revoked_at is null) as holders
    from public.lead_bundles b
    left join public.lead_bundle_items i on i.bundle_id = b.id
    where b.format = 'client_leads'
    group by b.id
    order by b.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) t;
  return v;
end $function$;
