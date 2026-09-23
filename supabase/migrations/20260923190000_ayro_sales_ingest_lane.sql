-- Ayro Financial (el.ayrofinancial.com/sales) external-production ingest lane.
-- Mirrors the Vantage AgentCloud pattern: deals land in production_external_deals
-- (source='ayro_sales'), which feeds v_production_canonical (production totals)
-- and fires Slack+Discord via trg_queue_external_deal_channels. Producers are
-- resolved to a real apex agent by display_name; an unmatched producer gets a
-- GHOST_AYRO_ agent (excluded from crm roster + hire broadcasts) so the FK on
-- production_external_deals.agent_id is satisfied and the deal counts by name.
create or replace function public.ingest_ayro_sales_deal(
  p_policy_number  text,
  p_agent_name     text,
  p_carrier        text,
  p_annual_premium numeric,
  p_monthly_premium numeric default null,
  p_face_amount    numeric default null,
  p_occurred_at    timestamptz default now(),
  p_posted_date    date default (now() at time zone 'America/Phoenix')::date,
  p_status         text default 'active',
  p_product        text default null,
  p_external_ref   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := nullif(btrim(p_agent_name), '');
  v_policy text := nullif(btrim(p_policy_number), '');
  v_ref text;
  v_agent uuid;
  v_minted boolean := false;
  v_id uuid;
  v_new boolean;
begin
  if v_name is null or p_annual_premium is null or p_annual_premium <= 0 then
    raise exception 'ayro ingest: agent name and positive annual premium required (got name=%, ap=%)', p_agent_name, p_annual_premium;
  end if;

  -- Stable external ref: policy number when it is a real one, else a
  -- name+date+amount composite so a placeholder ('na') cannot collide.
  v_ref := coalesce(
    nullif(btrim(p_external_ref), ''),
    case when v_policy is not null and lower(v_policy) not in ('na','n/a','none','tbd','pending')
         then 'ayro:' || v_policy
         else 'ayro:' || lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
                     || ':' || p_posted_date::text || ':' || round(p_annual_premium)::text end);

  -- Resolve producer -> real apex agent (prefer a genuine, non-ghost agent).
  select id into v_agent from public.agents
   where lower(btrim(display_name)) = lower(v_name)
     and coalesce(agent_code,'') not like 'GHOST_%'
     and coalesce(is_deactivated,false) = false
   order by (status = 'active') desc, created_at
   limit 1;

  if v_agent is null then
    select id into v_agent from public.agents
     where lower(btrim(display_name)) = lower(v_name)
       and coalesce(agent_code,'') like 'GHOST_AYRO_%'
     limit 1;
  end if;

  if v_agent is null then
    insert into public.agents (display_name, agent_code, status, has_production_access, metadata)
    values (v_name,
      'GHOST_AYRO_' || upper(substring(regexp_replace(v_name,'[^a-zA-Z0-9]','','g') from 1 for 12))
                    || '_' || substring(md5(random()::text) from 1 for 4),
      'active', true,
      jsonb_build_object('external_source','ayro_sales','origin_url','https://el.ayrofinancial.com/sales',
                         'note','Ayro producer, deal-attribution only'))
    returning id into v_agent;
    v_minted := true;
    -- The agents-insert triggers enqueue onboarding / next-step / getting-started
    -- as if this were a hire. It is not; strip that noise (hire broadcasts are
    -- already suppressed by the GHOST_ agent_code).
    delete from public.agent_onboarding_queue where agent_id = v_agent;
    delete from public.getting_started_progress where agent_id = v_agent;
    update public.agents set next_step_stage_key = null, next_step_due_at = null where id = v_agent;
  end if;

  insert into public.production_external_deals
    (source, external_ref, agency_name, agent_id, agent_name, carrier, product,
     policy_number, monthly_premium, annual_premium, face_amount, occurred_at, posted_date, status, metadata)
  values
    ('ayro_sales', v_ref, 'Ayro Financial', v_agent, v_name,
     nullif(btrim(p_carrier),''), nullif(btrim(p_product),''),
     v_policy, coalesce(p_monthly_premium, round(p_annual_premium/12.0, 2)),
     p_annual_premium, p_face_amount, coalesce(p_occurred_at, now()),
     coalesce(p_posted_date, (now() at time zone 'America/Phoenix')::date),
     coalesce(nullif(btrim(p_status),''),'active'),
     jsonb_build_object('policy_number', v_policy, 'source_url','https://el.ayrofinancial.com/sales'))
  on conflict (source, external_ref) do update
    set annual_premium = excluded.annual_premium,
        monthly_premium = excluded.monthly_premium,
        carrier = excluded.carrier,
        agent_id = excluded.agent_id,
        agent_name = excluded.agent_name,
        status = excluded.status,
        updated_at = now()
  returning id, (xmax = 0) into v_id, v_new;

  return jsonb_build_object('id', v_id, 'agent_id', v_agent, 'agent_name', v_name,
    'external_ref', v_ref, 'is_new_insert', v_new, 'minted_agent', v_minted);
end;
$function$;

revoke all on function public.ingest_ayro_sales_deal(text,text,text,numeric,numeric,numeric,timestamptz,date,text,text,text) from public, anon, authenticated;
