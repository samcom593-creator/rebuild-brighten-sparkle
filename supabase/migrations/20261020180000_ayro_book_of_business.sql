-- Ayro Financial book of business (2026-10-20).
-- Sam: "give me a book of business screen for Ayro Financial ... all names, carriers ... arrange by carriers".
--
-- 1. ayro_carrier_name(): Ayro agents type the carrier by hand ("trans", "trans america",
--    "ethos", "amirico"), so one carrier showed up under 4 spellings. One canonical name per
--    carrier; what the agent typed is kept in metadata.carrier_entered.
-- 2. ingest_ayro_sales_deal() gains p_metadata (Ayro's own record id + created time) and stops
--    rewriting unchanged rows. The sync now reads Ayro's All Time feed every run, and an upsert
--    that rewrites every row on every run is the MP-431 database storm.
-- 3. ayro_book(): admin-only read for /dashboard/ayro-book, with Ayro's own all-time totals
--    (written by the sync into system_settings) so the page can show both sides of the count.

create or replace function public.ayro_carrier_name(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p is null or btrim(p) = '' then null
    when k in ('ethos', 'ethoslife') then 'Ethos'
    when k in ('trans', 'transamerica', 'transam', 'transamerican') then 'Transamerica'
    when k in ('aetna', 'accendo', 'aetnaaccendo', 'cvs', 'cvsaetna') then 'Aetna'
    when k in ('americo', 'amirico', 'amerco', 'americolife') then 'Americo'
    when k in ('americanamicable', 'amam', 'amamicable') then 'American Amicable'
    when k = 'chubb' then 'Chubb'
    when k = 'aflac' then 'Aflac'
    when k in ('mutualofomaha', 'moo', 'mutual') then 'Mutual of Omaha'
    when k in ('baltimorelife', 'baltimore') then 'Baltimore Life'
    -- A product typed where the carrier belongs: the carrier is unknown, not "Whole life".
    when k in ('wholelife', 'termlife', 'term', 'iul', 'finalexpense', 'fex') then 'Carrier not given'
    else btrim(p)
  end
  from (select lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z]', '', 'g')) as k) s
$$;

drop function if exists public.ingest_ayro_sales_deal(text, text, text, numeric, numeric, numeric, timestamptz, date, text, text, text);

create or replace function public.ingest_ayro_sales_deal(
  p_policy_number text,
  p_agent_name text,
  p_carrier text,
  p_annual_premium numeric,
  p_monthly_premium numeric default null,
  p_face_amount numeric default null,
  p_occurred_at timestamptz default now(),
  p_posted_date date default ((now() at time zone 'America/Phoenix'))::date,
  p_status text default 'active',
  p_product text default null,
  p_external_ref text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := nullif(btrim(p_agent_name), '');
  v_policy text := nullif(btrim(p_policy_number), '');
  v_carrier text := public.ayro_carrier_name(p_carrier);
  v_meta jsonb;
  v_ref text;
  v_agent uuid;
  v_minted boolean := false;
  v_id uuid;
  v_new boolean;
begin
  if v_name is null or p_annual_premium is null or p_annual_premium <= 0 then
    raise exception 'ayro ingest: agent name and positive annual premium required (got name=%, ap=%)', p_agent_name, p_annual_premium;
  end if;

  if v_policy is not null and lower(v_policy) in ('na', 'n/a', 'none', 'tbd', 'pending') then
    v_policy := null;
  end if;

  -- Stable external ref: the real policy number, else the caller's ref (the sync sends Ayro's
  -- own record id), else a name+date+amount composite so a placeholder cannot collide.
  v_ref := coalesce(
    nullif(btrim(p_external_ref), ''),
    case when v_policy is not null then 'ayro:' || v_policy
         else 'ayro:' || lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
                     || ':' || p_posted_date::text || ':' || round(p_annual_premium)::text end);

  v_meta := jsonb_strip_nulls(jsonb_build_object(
      'policy_number', v_policy,
      'source_url', 'https://el.ayrofinancial.com/sales',
      'carrier_entered', nullif(btrim(p_carrier), '')))
    || coalesce(p_metadata, '{}'::jsonb);

  -- Resolve producer -> real apex agent (prefer a genuine, non-placeholder agent).
  select id into v_agent from public.agents
   where lower(btrim(display_name)) = lower(v_name)
     and not public.is_placeholder_agent(agent_code, user_id)
     and coalesce(is_deactivated, false) = false
   order by (status = 'active') desc, created_at
   limit 1;

  if v_agent is null then
    select id into v_agent from public.agents
     where lower(btrim(display_name)) = lower(v_name)
       and coalesce(agent_code, '') like 'GHOST_AYRO_%'
     limit 1;
  end if;

  if v_agent is null then
    insert into public.agents (display_name, agent_code, status, has_production_access, metadata)
    values (v_name,
      'GHOST_AYRO_' || upper(substring(regexp_replace(v_name, '[^a-zA-Z0-9]', '', 'g') from 1 for 12))
                    || '_' || substring(md5(random()::text) from 1 for 4),
      'active', true,
      jsonb_build_object('external_source', 'ayro_sales', 'origin_url', 'https://el.ayrofinancial.com/sales',
                         'note', 'Ayro producer, deal-attribution only'))
    returning id into v_agent;
    v_minted := true;
    -- The agents-insert triggers enqueue onboarding / next-step / getting-started
    -- as if this were a hire. It is not; strip that noise (hire broadcasts are
    -- already suppressed by the GHOST_ agent_code).
    delete from public.agent_onboarding_queue where agent_id = v_agent;
    delete from public.getting_started_progress where agent_id = v_agent;
    update public.agents set next_step_stage_key = null, next_step_due_at = null where id = v_agent;
  end if;

  insert into public.production_external_deals as d
    (source, external_ref, agency_name, agent_id, agent_name, carrier, product,
     policy_number, monthly_premium, annual_premium, face_amount, occurred_at, posted_date, status, metadata)
  values
    ('ayro_sales', v_ref, 'Ayro Financial', v_agent, v_name,
     v_carrier, nullif(btrim(p_product), ''),
     v_policy, coalesce(p_monthly_premium, round(p_annual_premium / 12.0, 2)),
     p_annual_premium, p_face_amount, coalesce(p_occurred_at, now()),
     coalesce(p_posted_date, (now() at time zone 'America/Phoenix')::date),
     coalesce(nullif(btrim(p_status), ''), 'active'),
     v_meta)
  on conflict (source, external_ref) do update
    set annual_premium = excluded.annual_premium,
        monthly_premium = excluded.monthly_premium,
        carrier = excluded.carrier,
        agent_id = excluded.agent_id,
        agent_name = excluded.agent_name,
        status = excluded.status,
        metadata = d.metadata || excluded.metadata,
        updated_at = now()
    -- Unchanged rows are left alone: the sync re-reads Ayro's whole feed every run.
    where (d.annual_premium, d.carrier, d.agent_id, d.agent_name, d.status)
            is distinct from (excluded.annual_premium, excluded.carrier, excluded.agent_id, excluded.agent_name, excluded.status)
       or not (d.metadata @> excluded.metadata)
  returning d.id, (d.xmax = 0) into v_id, v_new;

  if v_id is null then
    select d.id into v_id from public.production_external_deals d
     where d.source = 'ayro_sales' and d.external_ref = v_ref;
    return jsonb_build_object('id', v_id, 'agent_id', v_agent, 'agent_name', v_name,
      'external_ref', v_ref, 'is_new_insert', false, 'changed', false, 'minted_agent', v_minted);
  end if;

  return jsonb_build_object('id', v_id, 'agent_id', v_agent, 'agent_name', v_name,
    'external_ref', v_ref, 'is_new_insert', v_new, 'changed', true, 'minted_agent', v_minted);
end;
$function$;

revoke all on function public.ingest_ayro_sales_deal(text, text, text, numeric, numeric, numeric, timestamptz, date, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_ayro_sales_deal(text, text, text, numeric, numeric, numeric, timestamptz, date, text, text, text, jsonb) to service_role;

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
