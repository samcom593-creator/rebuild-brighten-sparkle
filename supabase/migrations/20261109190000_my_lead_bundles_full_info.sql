-- MP-LEAD-MANAGER-11 (2026-11-09): "they should only be the leads I give them
-- with full info ready." Scoping was already enforced and proven (grant-holders
-- only, DNC stripped); what agents were MISSING was the info: my_lead_bundles
-- returned no state, no age, no qualifier flags, and never surfaced the note Sam
-- typed on the pack. An agent dialing blind is a wasted drop. The function now
-- returns the complete item record the assign already copies into
-- lead_bundle_items, plus the bundle's note. Return type changes, so drop first.
drop function if exists public.my_lead_bundles();
create function public.my_lead_bundles()
returns table(
  item_id uuid, bundle_id uuid, bundle_name text, bundle_note text, format text,
  phone10 text, first_name text, last_name text, email text, state text, age integer,
  quality_tier text, quality_reason text, attrs jsonb, attempts integer,
  last_dialed_at timestamptz, last_disposition text,
  status text, status_note text, status_at timestamptz, granted_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $function$
  select i.id, b.id, b.name, b.note, b.format, i.phone10, i.first_name, i.last_name, i.email,
         i.state, i.age, i.quality_tier, i.quality_reason, coalesce(i.attrs, '{}'::jsonb), i.attempts,
         i.last_dialed_at, i.last_disposition, i.status, i.status_note, i.status_at, g.granted_at
  from public.lead_bundle_grants g
  join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
  join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
  where g.user_id = auth.uid() and g.revoked_at is null
    and not exists (select 1 from public.readymode_dialer_calls c where c.lead_phone10 = i.phone10 and c.disposition = 'Do Not Call')
  order by b.created_at desc, array_position(array['pos', 'A', 'B', 'C', 'D'], i.quality_tier), i.last_dialed_at desc nulls last
$function$;
grant execute on function public.my_lead_bundles() to authenticated;
