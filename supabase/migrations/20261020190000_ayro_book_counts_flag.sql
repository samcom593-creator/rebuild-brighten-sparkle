-- Ayro book: say on every row whether the deal counts in our production (2026-10-20).
-- Five Ayro-only producers (Dom Yous, snow flake, Travis N, Nels r, David Agbebaku) are
-- roster-excluded (adbb5731), so their policies are in Ayro's book but not in our totals.
-- The page marks each row with the same rule the totals use, instead of guessing from the name.

-- The page's one read. Admin only: this is another agency's production.
create or replace function public.ayro_book()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_deals jsonb;
  v_sync jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'::app_role), false) then
    raise exception 'The Ayro book is admin only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'policy_number', d.policy_number,
      'carrier', coalesce(d.carrier, 'Carrier not given'),
      'carrier_entered', coalesce(d.metadata->>'carrier_entered', d.carrier),
      'agent_name', d.agent_name,
      'apex_agent_id', d.agent_id,
      'apex_agent_name', a.display_name,
      'on_apex_team', a.id is not null and not public.is_placeholder_agent(a.agent_code, a.user_id),
      -- The production rule (adbb5731): a deal counts only when its agent identity is in roster scope.
      'counts_in_production', a.id is not null and not public.fn_agent_is_roster_excluded(coalesce(a.canonical_agent_id, a.id)),
      'annual_premium', d.annual_premium,
      'monthly_premium', d.monthly_premium,
      'face_amount', d.face_amount,
      'product', d.product,
      'status', d.status,
      'ayro_status', d.metadata->>'ayro_status',
      'submitted_at', coalesce((d.metadata->>'ayro_created_at')::timestamptz, d.occurred_at),
      'posted_date', d.posted_date,
      'first_seen_at', d.created_at
    ) order by coalesce((d.metadata->>'ayro_created_at')::timestamptz, d.occurred_at) desc), '[]'::jsonb)
    into v_deals
    from public.production_external_deals d
    left join public.agents a on a.id = d.agent_id
   where d.source = 'ayro_sales';

  select case when s.value is null then null
              else s.value::jsonb || jsonb_build_object('updated_at', s.updated_at) end
    into v_sync
    from public.system_settings s
   where s.key = 'ayro_sync_status';

  return jsonb_build_object('deals', v_deals, 'sync', v_sync);
end;
$function$;

revoke all on function public.ayro_book() from public, anon;
grant execute on function public.ayro_book() to authenticated, service_role;
