-- Ayro book: Sam + Aisha (2026-10-25, Sam: "make sure it's just me and Aisha"). can_view_sold_calls() = admins + Aisha's login.

CREATE OR REPLACE FUNCTION public.ayro_book()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deals jsonb;
  v_sync jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'The Ayro book is for Sam and Aisha only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'policy_number', d.policy_number,
      'carrier', coalesce(d.carrier, 'Carrier not given'),
      'carrier_entered', coalesce(d.metadata->>'carrier_entered', d.carrier),
      'agent_name', d.agent_name,
      'client_name', c.client_name,
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
    left join public.ayro_policy_clients c on c.deal_id = d.id
   where d.source = 'ayro_sales';

  select case when s.value is null then null
              else s.value::jsonb || jsonb_build_object('updated_at', s.updated_at) end
    into v_sync
    from public.system_settings s
   where s.key = 'ayro_sync_status';

  return jsonb_build_object('deals', v_deals, 'sync', v_sync);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ayro_set_client_names(p_rows jsonb, p_source text DEFAULT 'page'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_saved int := 0;
  v_cleared int := 0;
  r jsonb;
  v_deal uuid;
  v_name text;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Ayro client names are for Sam and Aisha only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_deal := (r->>'deal_id')::uuid;
    v_name := nullif(regexp_replace(btrim(coalesce(r->>'client_name', '')), '\s+', ' ', 'g'), '');
    if not exists (select 1 from public.production_external_deals d where d.id = v_deal and d.source = 'ayro_sales') then
      raise exception 'Not an Ayro policy: %', v_deal using errcode = '22023';
    end if;
    if v_name is null then
      delete from public.ayro_policy_clients where deal_id = v_deal;
      v_cleared := v_cleared + 1;
    else
      insert into public.ayro_policy_clients (deal_id, client_name, source, updated_by, updated_at)
      values (v_deal, v_name, coalesce(nullif(btrim(p_source), ''), 'page'), auth.uid(), now())
      on conflict (deal_id) do update
        set client_name = excluded.client_name, source = excluded.source,
            updated_by = excluded.updated_by, updated_at = now();
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object('saved', v_saved, 'cleared', v_cleared);
end;
$function$
;
