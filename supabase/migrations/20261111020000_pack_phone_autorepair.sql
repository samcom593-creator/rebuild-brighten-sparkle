-- MP-LEAD-PHONE-READYMODE-b (2026-11-10). Sam: "make flawless".
--
-- e8ccf16e fixed the pools and repaired the 4 live pack leads that existed at ship time, once.
-- But mat_lead_phone_fix changes as ReadyMode evidence arrives (the call puller is about to
-- backfill 13 days), and a pack already sitting in an agent's portal would keep the book's wrong
-- number. fn_repair_pack_phones() applies the same rules to every live pack item on every
-- 10-minute snapshot refresh: win-back/marketing items by (source, from_phone10, name_key) in
-- mat_lead_phone_fix, re-write items by the packet's call link. It skips an item whose new number
-- is already live elsewhere (the one-live-item-per-phone index), never touches an item already
-- flagged, and puts items already marked no_answer/wrong_number on the bad number back in the
-- call queue with a note. Idempotent: a second run changes nothing (proven).
create or replace function public.fn_repair_pack_phones()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
with live as (
  select i.*, regexp_replace(lower(coalesce(i.first_name, '') || coalesce(i.last_name, '')), '[^a-z0-9]', '', 'g') as k
  from public.lead_bundle_items i
  join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
  where i.removed_at is null and coalesce(i.attrs->>'readymode_number', 'false') <> 'true'
),
cand as (
  select l.id, l.bundle_id, l.source_kind, l.status, l.phone10 as old_p, f.to_phone10 as new_p, 'name+' || f.reason as why
  from live l join public.mat_lead_phone_fix f on f.source = l.source_kind and f.from_phone10 = l.phone10 and f.name_key = l.k
  where l.source_kind in ('winback', 'marketing')
  union all
  select l.id, l.bundle_id, l.source_kind, l.status, l.phone10, dc.lead_phone10, 'rewrite_call_link'
  from live l
  join public.readymode_booking_packets p
    on right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10) = l.phone10
   and regexp_replace(lower(coalesce(p.client_first_name, '') || coalesce(p.client_last_name, '')), '[^a-z0-9]', '', 'g') = l.k
  join public.readymode_dialer_calls dc on dc.id = p.call_id
  where l.source_kind = 'rewrite' and dc.lead_phone10 ~ '^[0-9]{10}$' and dc.lead_phone10 <> l.phone10
),
one as (select distinct on (id) * from cand order by id, why),
fix as (
  select o.*, exists (select 1 from public.lead_bundle_items x where x.phone10 = o.new_p and x.removed_at is null and x.id <> o.id) as collides
  from one o
),
upd as (
  update public.lead_bundle_items i
     set phone10 = fix.new_p,
         attrs = coalesce(i.attrs, '{}'::jsonb) || jsonb_build_object('readymode_number', true, 'replaced_phone10', fix.old_p,
                   'number_fixed_at', now(), 'number_fixed_why', fix.why, 'status_before_fix', i.status),
         status = case when i.status in ('no_answer', 'wrong_number') then 'new' else i.status end,
         status_note = case when i.status in ('no_answer', 'wrong_number')
                            then 'Number corrected to the ReadyMode number (the old one never answered). Call again.'
                            else i.status_note end
    from fix
   where i.id = fix.id and not fix.collides
  returning i.id
)
select count(*)::int from upd
$function$;
revoke all on function public.fn_repair_pack_phones() from public, anon, authenticated;
grant execute on function public.fn_repair_pack_phones() to service_role;

CREATE OR REPLACE FUNCTION public.refresh_lead_pool_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t0 timestamptz := clock_timestamp(); n integer; ms integer;
begin
  update public.lead_pool_snapshot_meta set started_at = t0 where id;
  refresh materialized view concurrently public.mat_lead_phone_fix;
  refresh materialized view concurrently public.mat_lead_pool;
  -- MP-LEAD-PHONE-READYMODE-b: packs already handed out pick up new ReadyMode-number evidence.
  perform public.fn_repair_pack_phones();
  select count(*)::int into n from public.mat_lead_pool;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  update public.lead_pool_snapshot_meta
     set refreshed_at = clock_timestamp(), rows = n, duration_ms = ms, last_error = null
   where id;
  return jsonb_build_object('rows', n, 'duration_ms', ms);
exception when others then
  update public.lead_pool_snapshot_meta set last_error = sqlerrm, error_at = now() where id;
  return jsonb_build_object('error', sqlerrm);
end $function$;
