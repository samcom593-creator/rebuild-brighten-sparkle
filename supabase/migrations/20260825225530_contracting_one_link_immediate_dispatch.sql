-- Claim only one contracting intake so the one-link flow can deliver now
-- without draining or racing unrelated outbox work.

begin;

create or replace function public.claim_contracting_intake_events(p_intake_id uuid)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with claimable as (
    select oe.id
    from public.outbox_events oe
    where oe.aggregate_type = 'contracting_intake'
      and oe.aggregate_id = p_intake_id
      and (
        oe.status in ('pending', 'failed')
        or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes')
      )
      and oe.available_at <= now()
      and oe.attempts < 5
    order by oe.created_at
    for update skip locked
  )
  update public.outbox_events oe
  set status = 'processing',
      attempts = oe.attempts + 1,
      locked_at = now(),
      updated_at = now()
  from claimable c
  where oe.id = c.id
  returning oe.*;
end;
$$;

revoke all on function public.claim_contracting_intake_events(uuid) from public, anon, authenticated;
grant execute on function public.claim_contracting_intake_events(uuid) to service_role;

commit;
