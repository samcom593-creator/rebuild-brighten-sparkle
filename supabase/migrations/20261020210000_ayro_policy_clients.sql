-- Ayro book: client names per policy (2026-10-20).
-- Sam: "add filters by agent that show their policies like this with carriers", pasting
-- "Robert burns-1812AP ... All Ethos". Ayro's feed has no client names, so they are entered here
-- (pasted in that same format on the page). Kept in their own table so the 20-minute sync, which
-- upserts production_external_deals, can never overwrite or blank a name. Admin only: no RLS
-- policies, read through ayro_book(), written through ayro_set_client_names().

create table if not exists public.ayro_policy_clients (
  deal_id uuid primary key references public.production_external_deals(id) on delete cascade,
  client_name text not null check (btrim(client_name) <> ''),
  source text not null default 'page',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.ayro_policy_clients enable row level security;
revoke all on table public.ayro_policy_clients from public, anon, authenticated;
grant all on table public.ayro_policy_clients to service_role;

-- p_rows: [{"deal_id": uuid, "client_name": text}]. A blank name removes the row.
create or replace function public.ayro_set_client_names(p_rows jsonb, p_source text default 'page')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_saved int := 0;
  v_cleared int := 0;
  r jsonb;
  v_deal uuid;
  v_name text;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'::app_role), false) then
    raise exception 'Ayro client names are admin only' using errcode = '42501';
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
$function$;

revoke all on function public.ayro_set_client_names(jsonb, text) from public, anon;
grant execute on function public.ayro_set_client_names(jsonb, text) to authenticated, service_role;

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
$function$;

revoke all on function public.ayro_book() from public, anon;
grant execute on function public.ayro_book() to authenticated, service_role;
