-- ============================================================================
-- MP-CARRIER-BOOK-TRUTH (2026-11-24)
-- Sam: "use the carrier book to count any deals, whether submitted through the
-- website or not ... Ethos or the sub portal ... finances, chargebacks,
-- retention, all of it" + "each profile ... policy to policy status".
--
-- One current-state book per carrier policy (Ethos + Chubb/Combined), fed by
-- ~/business-ops/carrier-harvester through carrier_book_ingest(). From it:
--   * production: carrier policies the site never recorded count through
--     production_external_deals (source carrier_ethos / carrier_chubb), and a
--     native deal the carrier says was never placed stops counting;
--   * chargebacks, lapses, persistency views read the carrier book;
--   * agent_carrier_book() / team_carrier_book_summary() feed the profile
--     drawer and My Team.
-- Idempotent. Additive except the view rewrites (same columns, same options).
-- ============================================================================

-- ---------- tables ----------------------------------------------------------
create table if not exists public.carrier_book_policies (
  carrier          text not null,             -- 'Ethos' | 'Chubb'
  policy_key       text not null,             -- normalized policy number, else 'app:<id>'
  policy_number    text,
  external_id      text,
  underwriter      text,                      -- Ethos carrierType (cuna mutual, lga ...)
  product          text,
  agent_name       text,
  agent_npn        text,
  agent_id         uuid references public.agents(id) on delete set null,
  agent_match      text,                      -- npn | name | null
  client_name      text,
  status_raw       text,
  status_pre       text,
  stage            text,
  status_bucket    text not null default 'unknown',
  close_reason     text,
  monthly_premium  numeric,
  annual_premium   numeric,
  face_amount      numeric,
  sold_on          date,
  sold_on_basis    text,
  effective_on     date,
  site_deal_id     uuid,
  site_match       text,                      -- policy_number | client_agent | agentlink | external | null
  first_seen_on    date not null default current_date,
  last_seen_on     date not null default current_date,
  status_changed_on date,
  issued_on        date,
  lost_on          date,
  updated_at       timestamptz not null default now(),
  primary key (carrier, policy_key)
);
create index if not exists carrier_book_policies_agent_idx on public.carrier_book_policies(agent_id);
create index if not exists carrier_book_policies_deal_idx  on public.carrier_book_policies(site_deal_id);
create index if not exists carrier_book_policies_pn_idx    on public.carrier_book_policies(lower(policy_number));

create table if not exists public.carrier_book_status_events (
  id           bigserial primary key,
  carrier      text not null,
  policy_key   text not null,
  observed_on  date not null,
  from_bucket  text,
  to_bucket    text not null,
  from_raw     text,
  to_raw       text,
  created_at   timestamptz not null default now(),
  unique (carrier, policy_key, observed_on, to_bucket)
);

create table if not exists public.carrier_book_chargebacks (
  carrier         text not null,
  source          text not null,              -- comp_ledger | debt_outstanding
  ref_id          text not null,
  policy_number   text,
  agent_name      text,
  agent_npn       text,
  agent_id        uuid references public.agents(id) on delete set null,
  amount          numeric not null default 0, -- positive dollars clawed / owed
  original_amount numeric,
  chargeback_on   date,
  reason          text,
  status          text,
  first_seen_on   date not null default current_date,
  last_seen_on    date not null default current_date,
  primary key (carrier, source, ref_id)
);
create index if not exists carrier_book_chargebacks_agent_idx on public.carrier_book_chargebacks(agent_id);

create table if not exists public.carrier_book_runs (
  id          bigserial primary key,
  carrier     text not null,
  run_at      timestamptz not null default now(),
  ok          boolean not null,
  policies    integer,
  chargebacks integer,
  note        text
);

-- ---------- vocabulary -----------------------------------------------------
create or replace function public.fn_carrier_status_bucket(p_carrier text, p_raw text, p_pre text, p_stage text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_carrier = 'Ethos' then
      case upper(coalesce(nullif(p_raw,''),'~'))
        when 'PREMIUM_PAYING' then 'active'
        when 'RENEWAL_PREMIUM_PROCESSING' then 'active'
        when 'PENDING_DEATH_CLAIM' then 'claim'
        when 'GRACE_PERIOD' then 'at_risk'
        when 'LATE_OFFER_PERIOD' then 'at_risk'
        when 'PENDING_INITIAL_PREMIUM' then 'pending'
        when 'LAPSED' then 'lapsed'
        when 'CANCELED' then 'lapsed'
        when 'FREE_LOOK_SURRENDERED' then 'lapsed'
        when 'NOT_TAKEN_INITIAL_PREMIUM_FAILED' then 'not_taken'
        when 'UNISSUED_INITIAL_PREMIUM_FAILED' then 'not_taken'
        when 'INVALID_APPLICATION' then 'declined'
        else case upper(coalesce(p_pre,''))
          when 'COMPLETED' then 'pending'
          when 'SUBMITTED_FOR_FUTURE_ISSUANCE' then 'pending'
          when 'APPROVED_INSTANT' then 'pending'
          when 'REROUTED_TRUSTAGE' then 'pending'
          when 'POLICY_ACTIVATED_EXTERNAL_TRUSTAGE' then 'active'
          when 'STARTED' then 'started'
          when 'ABANDONED' then 'abandoned'
          when 'CLOSED_ADMINISTRATIVE' then 'abandoned'
          when 'CLOSED_EXTERNAL_TRUSTAGE' then 'abandoned'
          when 'NOT_TAKEN' then 'not_taken'
          when 'POLICY_UNISSUED' then 'declined'
          when 'DISQUALIFIED_INSTANT_NO_REROUTE' then 'declined'
          else case when lower(coalesce(p_stage,'')) = 'quote' then 'quote' else 'unknown' end
        end
      end
    else
      case regexp_replace(lower(coalesce(p_raw,'')), '[^a-z]', '', 'g')
        when 'inforce' then 'active'
        when 'active' then 'active'
        when 'issued' then 'pending'
        when 'pending' then 'pending'
        when 'submitted' then 'pending'
        when 'lapsepending' then 'at_risk'
        when 'lapsed' then 'lapsed'
        when 'terminated' then 'lapsed'
        when 'cancelled' then 'lapsed'
        when 'canceled' then 'lapsed'
        when 'declined' then 'declined'
        when 'withdrawn' then 'not_taken'
        when 'nottaken' then 'not_taken'
        else 'unknown'
      end
  end
$$;

-- Plain-English label the app shows (one place, so the drawer and the team
-- list can never disagree).
create or replace function public.fn_carrier_status_label(p_bucket text)
returns text language sql immutable as $$
  select case p_bucket
    when 'quote' then 'Quote only'
    when 'started' then 'App started'
    when 'pending' then 'Submitted · awaiting issue/payment'
    when 'active' then 'Approved · in force'
    when 'claim' then 'In force · claim'
    when 'at_risk' then 'At risk · missed payment'
    when 'lapsed' then 'Lapsed · charged back'
    when 'not_taken' then 'Not taken'
    when 'declined' then 'Declined'
    when 'abandoned' then 'Abandoned'
    else 'Unknown' end
$$;

-- Buckets that are a written deal (production) vs a placed policy (retention base).
create or replace function public.fn_carrier_bucket_written(p_bucket text)
returns boolean language sql immutable as $$ select p_bucket in ('pending','active','claim','at_risk','lapsed') $$;
create or replace function public.fn_carrier_bucket_placed(p_bucket text)
returns boolean language sql immutable as $$ select p_bucket in ('active','claim','at_risk','lapsed') $$;

create or replace function public.fn_carrier_pn_key(p text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- order-independent name key: "Smith, John A" = "John A Smith"
create or replace function public.fn_carrier_name_key(p text)
returns text language sql immutable as $$
  select nullif(array_to_string(array(
    select t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p,''), '[^A-Za-z ]', ' ', 'g')), '\s+')) t
    where length(t) > 1 order by t), ' '), '')
$$;

-- ---------- agent resolution (NPN first, then a unique exact name) ----------
create or replace function public.fn_carrier_resolve_agent(p_npn text, p_name text)
returns table(agent_id uuid, how text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid; v_npn text := nullif(regexp_replace(coalesce(p_npn,''),'\D','','g'),'');
begin
  if v_npn is not null then
    select coalesce(a.canonical_agent_id, a.id) into v from (
      select x.agent_id from public.ethos_callsheet_people x where x.npn = v_npn and x.agent_id is not null
      union all select x.agent_id from public.contracting_intakes x where x.npn = v_npn and x.agent_id is not null
      union all select d.agent_id from public.deals d where d.writing_npn = v_npn and d.agent_id is not null
    ) s join public.agents a on a.id = s.agent_id
    group by coalesce(a.canonical_agent_id, a.id) order by count(*) desc limit 1;
    if v is not null then return query select v, 'npn'; return; end if;
  end if;
  if public.fn_carrier_name_key(p_name) is not null then
    select min(c::text)::uuid into v from (
      select distinct coalesce(a.canonical_agent_id, a.id) c
        from public.agents a
       where public.fn_carrier_name_key(a.display_name) = public.fn_carrier_name_key(p_name)
    ) s having count(*) = 1;
    if v is null then
      -- aliases the site already keeps (legal name vs nickname: "Chukwudi" = "Chudi")
      select min(c::text)::uuid into v from (
        select distinct coalesce(a.canonical_agent_id, a.id) c
          from (select x.agent_id, x.full_name n from public.ethos_callsheet_people x where x.agent_id is not null
                union all select x.agent_id, x.first_name || ' ' || x.last_name from public.contracting_intakes x where x.agent_id is not null
                union all select a2.id, pr.full_name from public.agents a2 join public.profiles pr on pr.id = a2.user_id) al
          join public.agents a on a.id = al.agent_id
         where public.fn_carrier_name_key(al.n) = public.fn_carrier_name_key(p_name)
      ) s having count(*) = 1;
    end if;
    if v is not null then return query select v, 'name'; return; end if;
  end if;
  return query select null::uuid, null::text;
end $$;

-- ---------- visibility: owner/admin all, a leader their tree, an agent self --
create or replace function public.fn_carrier_visible_agent_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  with recursive v(id, path) as (
    select a.id, array[a.id] from public.agents a where a.user_id = auth.uid()
    union all
    select c.id, v.path || c.id from v join public.agents c
      on (c.manager_id = v.id or c.invited_by_manager_id = v.id) where not c.id = any(v.path)
  )
  select coalesce(array_agg(distinct x), '{}') from (
    select id x from v
    union select a.id from public.agents a where a.canonical_agent_id in (select id from v)
    union select coalesce(a.canonical_agent_id, a.id) from public.agents a where a.id in (select id from v)
  ) s
$$;

alter table public.carrier_book_policies      enable row level security;
alter table public.carrier_book_status_events enable row level security;
alter table public.carrier_book_chargebacks   enable row level security;
alter table public.carrier_book_runs          enable row level security;

drop policy if exists carrier_book_policies_read on public.carrier_book_policies;
create policy carrier_book_policies_read on public.carrier_book_policies for select to authenticated
  using (public.apex_is_admin() or agent_id in (select unnest(public.fn_carrier_visible_agent_ids())));
drop policy if exists carrier_book_chargebacks_read on public.carrier_book_chargebacks;
create policy carrier_book_chargebacks_read on public.carrier_book_chargebacks for select to authenticated
  using (public.apex_is_admin() or agent_id in (select unnest(public.fn_carrier_visible_agent_ids())));
drop policy if exists carrier_book_runs_read on public.carrier_book_runs;
create policy carrier_book_runs_read on public.carrier_book_runs for select to authenticated
  using (public.apex_is_admin());

revoke all on public.carrier_book_policies, public.carrier_book_status_events,
              public.carrier_book_chargebacks, public.carrier_book_runs from anon, public;
grant select on public.carrier_book_policies, public.carrier_book_chargebacks, public.carrier_book_runs to authenticated;

-- Deal ids the carrier says were never placed. Owner-run view (no RLS) so the
-- production view drops the same deals for every caller; exposes ids only.
create or replace view public.v_carrier_dead_site_deals as
  select distinct site_deal_id as deal_id
    from public.carrier_book_policies
   where site_deal_id is not null and status_bucket in ('not_taken','declined','abandoned');
revoke all on public.v_carrier_dead_site_deals from anon, public;
grant select on public.v_carrier_dead_site_deals to authenticated, service_role;

-- ---------- external-deal channel trigger: carrier-discovered rows are quiet --
create or replace function public.fn_queue_external_deal_channels()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_payload jsonb;
begin
  -- carrier-book rows are discovered after the fact (often weeks old); they are
  -- reported to the owner digest, never celebrated as a fresh post.
  if new.source like 'carrier\_%' then return new; end if;
  if lower(coalesce(new.status, '')) in
     ('lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined') then
    return new;
  end if;
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'dealId', new.id, 'agentId', new.agent_id, 'agentName', new.agent_name,
    'agencyName', new.agency_name, 'carrierName', new.carrier,
    'productCategory', new.product, 'annualPremium', new.annual_premium,
    'openUrl', 'https://apex-financial.org/dashboard/production'));
  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
  values
    ('external_production_deal', new.id, 'deal.posted', 'slack', v_payload,
     'external.deal.posted:' || new.id::text || ':slack', gen_random_uuid()),
    ('external_production_deal', new.id, 'deal.posted', 'discord', v_payload,
     'external.deal.posted:' || new.id::text || ':discord', gen_random_uuid())
  on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  raise warning 'external deal channel queue failed for %: %', new.id, sqlerrm;
  return new;
end;
$function$;

-- ---------- reconcile: agents, site matches, production rows -----------------
create or replace function public.carrier_book_reconcile(p_refresh boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_agent uuid; v_how text; n_ins int := 0; n_dup int := 0;
begin
  -- 1. agents
  for r in select carrier, policy_key, agent_npn, agent_name from public.carrier_book_policies loop
    select x.agent_id, x.how into v_agent, v_how from public.fn_carrier_resolve_agent(r.agent_npn, r.agent_name) x;
    update public.carrier_book_policies set agent_id = v_agent, agent_match = v_how
     where carrier = r.carrier and policy_key = r.policy_key
       and (agent_id is distinct from v_agent or agent_match is distinct from v_how);
  end loop;
  for r in select carrier, source, ref_id, agent_npn, agent_name, agent_id from public.carrier_book_chargebacks loop
    select x.agent_id into v_agent from public.fn_carrier_resolve_agent(r.agent_npn, r.agent_name) x;
    if v_agent is distinct from r.agent_id then
      update public.carrier_book_chargebacks set agent_id = v_agent
       where carrier = r.carrier and source = r.source and ref_id = r.ref_id;
    end if;
  end loop;

  -- 2. site matches (reset, then policy number, then client + agent within 45d)
  update public.carrier_book_policies set site_deal_id = null, site_match = null
   where site_match is not null or site_deal_id is not null;

  update public.carrier_book_policies p set site_deal_id = d.id, site_match = 'policy_number'
    from (select distinct on (public.fn_carrier_pn_key(policy_number)) id, public.fn_carrier_pn_key(policy_number) k
            from public.deals
           where public.fn_carrier_pn_key(policy_number) is not null and length(public.fn_carrier_pn_key(policy_number)) >= 5
           order by public.fn_carrier_pn_key(policy_number), (source::text = 'apex_native') desc, created_at) d
   where d.k = public.fn_carrier_pn_key(p.policy_number);

  update public.carrier_book_policies p set site_deal_id = d.id, site_match = 'client_agent'
    from public.deals d join public.agents a on a.id = d.agent_id
   where p.site_match is null and p.agent_id is not null
     and coalesce(a.canonical_agent_id, a.id) = p.agent_id
     and public.fn_carrier_name_key(p.client_name) is not null
     and public.fn_carrier_name_key(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')) = public.fn_carrier_name_key(p.client_name)
     and abs(coalesce(p.sold_on, p.effective_on) - (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date) <= 45
     and not exists (select 1 from public.carrier_book_policies q where q.site_deal_id = d.id);

  if to_regprocedure('public.carrier_book_match_client_only()') is not null then
    perform public.carrier_book_match_client_only();
  end if;

  update public.carrier_book_policies p set site_match = 'agentlink'
   where p.site_match is null and exists (select 1 from public.agentlink_book b
         where public.fn_carrier_pn_key(b.policy_number) = public.fn_carrier_pn_key(p.policy_number));
  update public.carrier_book_policies p set site_match = 'external'
   where p.site_match is null and exists (select 1 from public.production_external_deals e
         where e.source not like 'carrier\_%' and public.fn_carrier_pn_key(e.policy_number) = public.fn_carrier_pn_key(p.policy_number));

  -- 3. production rows for carrier policies the site never recorded
  insert into public.production_external_deals
    (source, external_ref, agency_name, agent_id, agent_name, carrier, product, policy_number,
     monthly_premium, annual_premium, face_amount, occurred_at, posted_date, status, metadata)
  select 'carrier_' || lower(p.carrier), p.carrier || ':' || p.policy_key, 'Apex Financial',
         p.agent_id, coalesce(a.display_name, p.agent_name, 'Agent'),
         case when p.carrier = 'Chubb' then 'Combined' else p.carrier end,
         p.product, p.policy_number, p.monthly_premium, p.annual_premium, p.face_amount,
         (p.sold_on::timestamp + interval '12 hours') at time zone 'America/Phoenix', p.sold_on,
         case p.status_bucket when 'pending' then 'submitted' when 'lapsed' then 'issued_lapsed'
                              when 'claim' then 'active' else p.status_bucket end,
         jsonb_build_object('carrier_book', true, 'status_raw', p.status_raw, 'sold_on_basis', p.sold_on_basis)
    from public.carrier_book_policies p join public.agents a on a.id = p.agent_id
   where p.site_match is null and p.agent_id is not null and coalesce(p.annual_premium,0) > 0
     and p.sold_on is not null and public.fn_carrier_bucket_written(p.status_bucket)
  on conflict (source, external_ref) do update set
     agent_id = excluded.agent_id, agent_name = excluded.agent_name, product = excluded.product,
     monthly_premium = excluded.monthly_premium, annual_premium = excluded.annual_premium,
     face_amount = excluded.face_amount, status = excluded.status, metadata = excluded.metadata,
     updated_at = now()
   where production_external_deals.status is distinct from excluded.status
      or production_external_deals.annual_premium is distinct from excluded.annual_premium
      or production_external_deals.agent_id is distinct from excluded.agent_id;
  get diagnostics n_ins = row_count;

  -- rows that the site now has, or the carrier says never placed, stop counting
  update public.production_external_deals e
     set status = case when p.site_match is not null then 'duplicate'
                       when p.status_bucket in ('not_taken','abandoned','started','quote') then 'not_taken'
                       when p.status_bucket = 'declined' then 'declined'
                       else 'withdrawn' end,
         updated_at = now()
    from public.carrier_book_policies p
   where e.source = 'carrier_' || lower(p.carrier) and e.external_ref = p.carrier || ':' || p.policy_key
     and (p.site_match is not null or not public.fn_carrier_bucket_written(p.status_bucket) or p.agent_id is null)
     and e.status not in ('duplicate','not_taken','declined','withdrawn');
  get diagnostics n_dup = row_count;

  if p_refresh then perform public.refresh_production_truth(false); end if;
  return jsonb_build_object('production_upserts', n_ins, 'production_retired', n_dup);
end $$;

-- ---------- ingest (harvester entry point; service role only) ---------------
create or replace function public.carrier_book_ingest(
  p_carrier text, p_policies jsonb, p_chargebacks jsonb default '[]'::jsonb,
  p_snapshot date default ((now() at time zone 'America/Phoenix')::date))
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; v_key text; v_bucket text; v_old record; n_pol int := 0; n_cb int := 0; n_ev int := 0; v_rec jsonb;
begin
  if p_carrier not in ('Ethos','Chubb') then raise exception 'unknown carrier %', p_carrier; end if;
  if jsonb_typeof(p_policies) <> 'array' or jsonb_array_length(p_policies) < 3 then
    insert into public.carrier_book_runs(carrier, ok, note) values (p_carrier, false, 'refused: <3 policies');
    raise exception 'refusing a % ingest with fewer than 3 policies', p_carrier;
  end if;

  for x in select * from jsonb_array_elements(p_policies) loop
    v_key := coalesce(public.fn_carrier_pn_key(x->>'policy_number'), 'app:' || nullif(x->>'external_id',''));
    continue when v_key is null;
    v_bucket := public.fn_carrier_status_bucket(p_carrier, x->>'status_raw', x->>'status_pre', x->>'stage');
    select status_bucket, status_raw into v_old from public.carrier_book_policies where carrier = p_carrier and policy_key = v_key;

    insert into public.carrier_book_policies as t
      (carrier, policy_key, policy_number, external_id, underwriter, product, agent_name, agent_npn,
       client_name, status_raw, status_pre, stage, status_bucket, close_reason, monthly_premium,
       annual_premium, face_amount, sold_on, sold_on_basis, effective_on, first_seen_on, last_seen_on,
       status_changed_on, issued_on, lost_on)
    values (p_carrier, v_key, nullif(x->>'policy_number',''), nullif(x->>'external_id',''), nullif(x->>'underwriter',''),
       nullif(x->>'product',''), nullif(x->>'agent_name',''), nullif(x->>'agent_npn',''), nullif(x->>'client_name',''),
       nullif(x->>'status_raw',''), nullif(x->>'status_pre',''), nullif(x->>'stage',''), v_bucket, nullif(x->>'close_reason',''),
       nullif(x->>'monthly_premium','')::numeric,
       coalesce(nullif(x->>'annual_premium','')::numeric, nullif(x->>'monthly_premium','')::numeric * 12),
       nullif(x->>'face_amount','')::numeric,
       case when nullif(x->>'sold_on','')::date between date '2015-01-01' and p_snapshot + 1 then (x->>'sold_on')::date end,
       nullif(x->>'sold_on_basis',''),
       case when nullif(x->>'effective_on','')::date > date '2015-01-01' then (x->>'effective_on')::date end,
       p_snapshot, p_snapshot, p_snapshot,
       case when public.fn_carrier_bucket_placed(v_bucket) then p_snapshot end,
       case when v_bucket = 'lapsed' then p_snapshot end)
    on conflict (carrier, policy_key) do update set
       policy_number = excluded.policy_number, external_id = coalesce(excluded.external_id, t.external_id),
       underwriter = coalesce(excluded.underwriter, t.underwriter), product = coalesce(excluded.product, t.product),
       agent_name = coalesce(excluded.agent_name, t.agent_name), agent_npn = coalesce(excluded.agent_npn, t.agent_npn),
       client_name = coalesce(excluded.client_name, t.client_name), status_raw = excluded.status_raw,
       status_pre = excluded.status_pre, stage = excluded.stage, status_bucket = excluded.status_bucket,
       close_reason = excluded.close_reason,
       monthly_premium = coalesce(excluded.monthly_premium, t.monthly_premium),
       annual_premium = coalesce(excluded.annual_premium, t.annual_premium),
       face_amount = coalesce(excluded.face_amount, t.face_amount),
       -- a sold date only ever moves earlier, so a deal never hops forward a day
       sold_on = least(t.sold_on, excluded.sold_on), sold_on_basis = coalesce(t.sold_on_basis, excluded.sold_on_basis),
       effective_on = coalesce(excluded.effective_on, t.effective_on),
       last_seen_on = p_snapshot,
       status_changed_on = case when t.status_bucket is distinct from excluded.status_bucket then p_snapshot else t.status_changed_on end,
       issued_on = coalesce(t.issued_on, case when public.fn_carrier_bucket_placed(excluded.status_bucket) then p_snapshot end),
       lost_on = case when excluded.status_bucket = 'lapsed' then coalesce(t.lost_on, p_snapshot) else null end,
       updated_at = now();
    n_pol := n_pol + 1;

    if v_old.status_bucket is distinct from v_bucket then
      insert into public.carrier_book_status_events(carrier, policy_key, observed_on, from_bucket, to_bucket, from_raw, to_raw)
      values (p_carrier, v_key, p_snapshot, v_old.status_bucket, v_bucket, v_old.status_raw, x->>'status_raw')
      on conflict do nothing;
      n_ev := n_ev + 1;
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_chargebacks,'[]'::jsonb)) loop
    continue when nullif(x->>'ref_id','') is null;
    insert into public.carrier_book_chargebacks as t
      (carrier, source, ref_id, policy_number, agent_name, agent_npn, amount, original_amount, chargeback_on, reason, status, first_seen_on, last_seen_on)
    values (p_carrier, x->>'source', x->>'ref_id', nullif(x->>'policy_number',''), nullif(x->>'agent_name',''),
            nullif(x->>'agent_npn',''), abs(coalesce(nullif(x->>'amount','')::numeric,0)),
            abs(nullif(x->>'original_amount','')::numeric), nullif(x->>'chargeback_on','')::date,
            nullif(x->>'reason',''), nullif(x->>'status',''), p_snapshot, p_snapshot)
    on conflict (carrier, source, ref_id) do update set
       amount = excluded.amount, original_amount = coalesce(excluded.original_amount, t.original_amount),
       chargeback_on = coalesce(excluded.chargeback_on, t.chargeback_on), reason = coalesce(excluded.reason, t.reason),
       status = excluded.status, agent_name = coalesce(excluded.agent_name, t.agent_name),
       agent_npn = coalesce(excluded.agent_npn, t.agent_npn), last_seen_on = p_snapshot;
    n_cb := n_cb + 1;
  end loop;

  v_rec := public.carrier_book_reconcile(true);
  insert into public.carrier_book_runs(carrier, ok, policies, chargebacks, note)
  values (p_carrier, true, n_pol, n_cb, v_rec::text);
  return jsonb_build_object('carrier', p_carrier, 'policies', n_pol, 'chargebacks', n_cb, 'status_changes', n_ev) || v_rec;
end $$;

create or replace function public.carrier_book_log_failure(p_carrier text, p_note text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.carrier_book_runs(carrier, ok, note) values (p_carrier, false, left(p_note, 500));
$$;

revoke all on function public.carrier_book_ingest(text, jsonb, jsonb, date) from public, anon, authenticated;
revoke all on function public.carrier_book_reconcile(boolean) from public, anon, authenticated;
revoke all on function public.carrier_book_log_failure(text, text) from public, anon, authenticated;
revoke all on function public.fn_carrier_resolve_agent(text, text) from public, anon, authenticated;

-- ---------- freshness -------------------------------------------------------
create or replace view public.v_carrier_book_freshness with (security_invoker = true) as
  select c.carrier,
         (select max(run_at) from public.carrier_book_runs r where r.carrier = c.carrier and r.ok) as last_ok_at,
         round(extract(epoch from now() - (select max(run_at) from public.carrier_book_runs r where r.carrier = c.carrier and r.ok)) / 3600.0, 1) as hours_stale,
         (select note from public.carrier_book_runs r where r.carrier = c.carrier and not r.ok order by run_at desc limit 1) as last_error,
         (select max(run_at) from public.carrier_book_runs r where r.carrier = c.carrier and not r.ok) as last_error_at,
         (select count(*) from public.carrier_book_policies p where p.carrier = c.carrier)::int as policies
    from (values ('Ethos'), ('Chubb')) c(carrier);
grant select on public.v_carrier_book_freshness to authenticated;

-- ---------- production: a native deal the carrier never placed stops counting --
create or replace view public.v_production_canonical with (security_invoker = on) as
SELECT row_key,
    origin,
    agent_id,
    agent_name,
    client_name,
    carrier,
    product,
    policy_number,
    annual_premium,
    posted_date,
    effective_date,
    status,
    synced_at
   FROM ( WITH external_ranked AS (
                 SELECT e.id,
                    e.source,
                    e.external_ref,
                    e.agency_name,
                    e.agent_id,
                    e.agent_name,
                    e.carrier,
                    e.product,
                    e.policy_number,
                    e.monthly_premium,
                    e.annual_premium,
                    e.face_amount,
                    e.occurred_at,
                    e.posted_date,
                    e.status,
                    e.metadata,
                    e.created_at,
                    e.updated_at,
                    COALESCE(m.canonical_agent_id, e.agent_id) AS canonical_agent_id,
                    row_number() OVER (PARTITION BY (COALESCE(m.canonical_agent_id, e.agent_id)), e.posted_date, e.annual_premium, (COALESCE(e.face_amount, 0::numeric)), (lower(btrim(COALESCE(e.carrier, ''::text)))) ORDER BY e.occurred_at, e.external_ref)::integer AS match_rank
                   FROM production_external_deals e
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = e.agent_id
                  WHERE (lower(COALESCE(e.status, ''::text)) <> ALL (ARRAY['duplicate'::text, 'lapsed'::text, 'cancelled'::text, 'charged_back'::text, 'withdrawn'::text, 'not_taken'::text, 'declined'::text])) AND NOT fn_agent_is_roster_excluded(e.agent_id)
                ), agentlink_match_counts AS (
                 SELECT COALESCE(m.canonical_agent_id, b.agent_id) AS canonical_agent_id,
                    b.posted_date,
                    b.annual_premium,
                    COALESCE(b.face_amount, 0::numeric) AS face_amount,
                    lower(btrim(COALESCE(b.carrier, ''::text))) AS carrier_key,
                    count(*)::integer AS matched_rows
                   FROM v_agentlink_book_scoped b
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = b.agent_id
                  WHERE b.is_dead IS NOT TRUE
                  GROUP BY (COALESCE(m.canonical_agent_id, b.agent_id)), b.posted_date, b.annual_premium, (COALESCE(b.face_amount, 0::numeric)), (lower(btrim(COALESCE(b.carrier, ''::text))))
                )
         SELECT b.deal_key AS row_key,
            'agentlink'::text AS origin,
            b.agent_id,
            b.agent_name,
            b.client_name,
            b.carrier,
            b.product,
            b.policy_number,
            b.annual_premium,
            b.posted_date,
            b.effective_date,
            b.status,
            b.imported_at AS synced_at
           FROM v_agentlink_book_scoped b
          WHERE b.is_dead IS NOT TRUE
        UNION ALL
         SELECT d.id::text AS row_key,
            'apex_native'::text AS origin,
            d.agent_id,
            COALESCE(ag.display_name, 'Agent'::text) AS agent_name,
            btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)) AS client_name,
            c_1.name AS carrier,
            d.product_sold AS product,
            d.policy_number,
            d.annual_premium,
            (COALESCE(d.posted_at, d.created_at) AT TIME ZONE 'America/Phoenix'::text)::date AS posted_date,
            d.effective_date,
            d.status,
            d.created_at AS synced_at
           FROM deals d
             LEFT JOIN agents ag ON ag.id = d.agent_id
             LEFT JOIN carriers c_1 ON c_1.id = d.carrier_id
          WHERE d.agent_id IS NOT NULL AND d.annual_premium IS NOT NULL AND d.source::text = 'apex_native'::text AND (lower(COALESCE(d.status, ''::text)) <> ALL (ARRAY['lapsed'::text, 'cancelled'::text, 'charged_back'::text, 'withdrawn'::text, 'not_taken'::text, 'declined'::text])) AND NOT fn_agent_is_roster_excluded(d.agent_id) AND NOT (EXISTS ( SELECT 1 FROM v_carrier_dead_site_deals cdd WHERE cdd.deal_id = d.id)) AND NOT (EXISTS ( SELECT 1
                   FROM v_agentlink_book_scoped b
                  WHERE NULLIF(btrim(COALESCE(b.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(COALESCE(d.policy_number, ''::text))))) AND NOT (EXISTS ( SELECT 1
                   FROM v_agentlink_book_scoped b2
                  WHERE b2.agent_id = d.agent_id AND b2.annual_premium = d.annual_premium AND b2.effective_date = d.effective_date AND lower(btrim(COALESCE(b2.client_name, ''::text))) = lower(btrim((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)))))
        UNION ALL
         SELECT (('external-deal:'::text || e.source) || ':'::text) || e.external_ref AS row_key,
            'discord_external'::text AS origin,
            e.agent_id,
            e.agent_name,
            NULL::text AS client_name,
            e.carrier,
            e.product,
            e.policy_number,
            e.annual_premium,
            e.posted_date,
            NULL::date AS effective_date,
            e.status,
            e.updated_at AS synced_at
           FROM external_ranked e
             LEFT JOIN agentlink_match_counts c_1 ON c_1.canonical_agent_id = e.canonical_agent_id AND c_1.posted_date = e.posted_date AND c_1.annual_premium = e.annual_premium AND c_1.face_amount = COALESCE(e.face_amount, 0::numeric) AND c_1.carrier_key = lower(btrim(COALESCE(e.carrier, ''::text)))
          WHERE e.match_rank > COALESCE(c_1.matched_rows, 0) AND NOT (EXISTS ( SELECT 1
                   FROM v_agentlink_book_scoped b
                  WHERE NULLIF(btrim(COALESCE(e.policy_number, ''::text)), ''::text) IS NOT NULL AND lower(btrim(b.policy_number)) = lower(btrim(e.policy_number))))) c
  WHERE
        CASE
            WHEN origin = 'agentlink'::text AND agent_id IS NULL THEN fn_book_agent_name_known(agent_name)
            ELSE true
        END;


-- ---------- chargebacks (last 30 days): + carrier clawbacks ------------------
create or replace view public.v_chargebacks_30d with (security_invoker = true) as
select * from (
WITH d AS (
         SELECT d.id::text AS source_id,
            'deals'::text AS source,
            d.chargeback_at AS occurred_at,
            d.annual_premium AS amount,
            COALESCE(( SELECT m.canonical_agent_id
                   FROM v_agent_canonical_map m
                  WHERE m.agent_id = d.agent_id), d.agent_id)::text AS agent_id,
            (((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)) || ' · '::text) || "right"(COALESCE(d.client_phone, ''::text), 4) AS customer_email,
            d.chargeback_status AS status_text
           FROM deals d
          WHERE (d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text])) AND d.chargeback_at IS NOT NULL AND d.chargeback_at >= (now() - '30 days'::interval)
        ), lp AS (
         SELECT lp.id::text AS source_id,
            'lead_purchases'::text AS source,
            lp.refunded_at AS occurred_at,
            COALESCE(lp.amount_cents, 0)::numeric / 100.0 AS amount,
            COALESCE(lp.agent_id_ref, ''::text) AS agent_id,
            lp.customer_email,
            'refunded'::text AS status_text
           FROM lead_purchases lp
          WHERE lp.refunded_at IS NOT NULL AND lp.refunded_at >= (now() - '30 days'::interval)
        ), sd AS (
         SELECT e.id::text AS source_id,
            'stripe_disputes'::text AS source,
            e.created_at AS occurred_at,
            NULL::numeric AS amount,
            ''::text AS agent_id,
            e.customer_email,
            e.event_type AS status_text
           FROM stripe_subscription_events e
          WHERE e.event_type ~~* '%dispute%'::text AND e.created_at >= (now() - '30 days'::interval)
        )
 SELECT d.source_id,
    d.source,
    d.occurred_at,
    d.amount,
    d.agent_id,
    d.customer_email,
    d.status_text
   FROM d
UNION ALL
 SELECT lp.source_id,
    lp.source,
    lp.occurred_at,
    lp.amount,
    lp.agent_id,
    lp.customer_email,
    lp.status_text
   FROM lp
UNION ALL
 SELECT sd.source_id,
    sd.source,
    sd.occurred_at,
    sd.amount,
    sd.agent_id,
    sd.customer_email,
    sd.status_text
   FROM sd
) legacy
union all
select c.carrier || ':' || c.source || ':' || c.ref_id,
       'carrier_' || lower(c.carrier),
       (coalesce(c.chargeback_on, c.first_seen_on)::timestamp + interval '12 hours') at time zone 'America/Phoenix',
       c.amount,
       coalesce(c.agent_id::text, ''),
       coalesce(p.client_name, 'policy') || ' · ' || coalesce(c.policy_number, c.ref_id),
       coalesce(c.reason, 'chargeback')
  from public.carrier_book_chargebacks c
  left join public.carrier_book_policies p on p.carrier = c.carrier and p.policy_key = public.fn_carrier_pn_key(c.policy_number)
 where c.source = 'comp_ledger' and coalesce(c.chargeback_on, c.first_seen_on) >= current_date - 30;


-- ---------- lapses: + carrier book lapses / at-risk -------------------------
create or replace view public.v_lapses_30d_detail with (security_invoker = true) as
select * from (
SELECT d.id AS deal_id,
    d.policy_number,
    d.client_first_name,
    d.client_last_name,
    d.client_phone,
    d.face_amount,
    d.monthly_premium,
    d.annual_premium,
    d.effective_date,
    d.status,
    d.policy_status_standard,
    d.status_updated_at AS lapsed_at,
    d.agent_id,
    a.display_name AS agent_name,
    c.name AS carrier_name
   FROM deals d
     LEFT JOIN agents a ON a.id = d.agent_id
     LEFT JOIN carriers c ON c.id = d.carrier_id
  WHERE d.status = 'lapsed'::text OR d.policy_status_standard ~~* '%lapse%'::text
  ORDER BY (COALESCE(d.status_updated_at, d.updated_at)) DESC NULLS LAST
) legacy
union all
select coalesce(p.site_deal_id, md5(p.carrier || ':' || p.policy_key)::uuid),
       p.policy_number,
       split_part(coalesce(p.client_name,''), ' ', 1),
       nullif(regexp_replace(coalesce(p.client_name,''), '^\S+\s*', ''), ''),
       null::text,
       p.face_amount::numeric(12,2), p.monthly_premium::numeric(10,2), p.annual_premium::numeric(10,2),
       p.effective_on,
       case p.status_bucket when 'at_risk' then 'lapse_pending' else 'lapsed' end,
       coalesce(p.status_raw, p.status_bucket),
       (coalesce(p.status_changed_on, p.lost_on, p.last_seen_on)::timestamp + interval '12 hours') at time zone 'America/Phoenix',
       p.agent_id, coalesce(a.display_name, p.agent_name),
       case when p.carrier = 'Chubb' then 'Combined' else p.carrier end
  from public.carrier_book_policies p
  left join public.agents a on a.id = p.agent_id
 where p.status_bucket in ('lapsed','at_risk')
   and coalesce(p.status_changed_on, p.lost_on, p.last_seen_on) >= current_date - 30
   and not exists (select 1 from public.deals d where d.id = p.site_deal_id
                    and (d.status = 'lapsed' or d.policy_status_standard ilike '%lapse%'));


-- ---------- persistency: Ethos + Combined from the live carrier book ---------
create or replace view public.v_book_persistency with (security_invoker = true) as
with b as (
  select agentlink_book.carrier,
         count(*) filter (where agentlink_book.status = any (array['Active','Issued'])) as in_force,
         count(*) filter (where agentlink_book.status = any (array['Lapsed','Lapse Pending','Cancelled'])) as lapsed,
         round(coalesce(sum(agentlink_book.annual_premium) filter (where agentlink_book.status = any (array['Active','Issued'])), 0), 0) as in_force_alp
    from public.agentlink_book
   where coalesce(agentlink_book.carrier,'') not in ('Combined','Ethos')
   group by agentlink_book.carrier
  union all
  select case when p.carrier = 'Chubb' then 'Combined' else p.carrier end,
         count(*) filter (where p.status_bucket in ('active','claim')),
         count(*) filter (where p.status_bucket in ('lapsed','at_risk')),
         round(coalesce(sum(p.annual_premium) filter (where p.status_bucket in ('active','claim')), 0), 0)
    from public.carrier_book_policies p
   group by 1
)
select coalesce(b.carrier, '(unknown)') as carrier, b.in_force::numeric, b.lapsed::numeric, b.in_force_alp,
       (b.in_force + b.lapsed)::numeric as reached_policy,
       case when (b.in_force + b.lapsed) > 0 then round(100.0 * b.in_force / (b.in_force + b.lapsed), 1) end as persistency_pct,
       case when b.carrier in ('Ethos','Combined') then 'LIVE carrier book: in_force / (in_force + lapsed + at_risk)'
            else 'in_force / (in_force + lapsed); legacy AgentLink book (retired 2026-10-17)' end as calc_note
  from b where (b.in_force + b.lapsed) > 0
union all
select '__ALL__', sum(b.in_force), sum(b.lapsed), sum(b.in_force_alp), sum(b.in_force + b.lapsed),
       case when sum(b.in_force + b.lapsed) > 0 then round(100.0 * sum(b.in_force) / sum(b.in_force + b.lapsed), 1) end,
       'overall'
  from b
order by 2 desc nulls last;


-- ---------- chargeback watch: live carrier lapses replace the frozen book ----
create or replace view public.v_chargeback_watch with (security_invoker = on) as
with legacy as (
WITH snap AS (
         SELECT max(agentlink_book.imported_at)::date AS snapshot_at
           FROM agentlink_book
        ), base AS (
         SELECT b.deal_key,
            b.policy_number,
            b.carrier,
            b.status,
            COALESCE(NULLIF(TRIM(BOTH FROM b.client_name), ''::text), TRIM(BOTH FROM (COALESCE(b.client_first_name, ''::text) || ' '::text) || COALESCE(b.client_last_name, ''::text))) AS client_name,
            b.annual_premium,
            b.monthly_premium,
            b.effective_date,
            b.posted_date,
            b.agent_id,
            COALESCE(a.display_name, b.agent_name, '(unmapped)'::text) AS agent_name,
            COALESCE(m.display_name, 'unassigned'::text) AS manager,
            COALESCE(( SELECT p.pct
                   FROM fn_agent_contract_pct(b.agent_id) p(pct, provenance)), 100::numeric) / 100.0 AS contract_rate,
            s.snapshot_at,
            GREATEST(0, s.snapshot_at - b.effective_date)::numeric / 30.44 AS months_in_force
           FROM agentlink_book b
             CROSS JOIN snap s
             LEFT JOIN agents a ON a.id = b.agent_id
             LEFT JOIN agents m ON m.id = a.manager_id
          WHERE (b.status = ANY (ARRAY['Lapse Pending'::text, 'Lapsed'::text, 'Cancelled'::text])) AND b.effective_date IS NOT NULL
        )
 SELECT deal_key,
    policy_number,
    carrier,
    client_name,
    agent_id,
    agent_name,
    manager,
    status,
    effective_date,
    round(months_in_force, 1) AS months_in_force,
    annual_premium,
    round(annual_premium * contract_rate * GREATEST(0::numeric, LEAST(1::numeric, (9::numeric - months_in_force) / 9.0)), 0) AS est_clawback_exposure,
    round(contract_rate * 100::numeric, 0) AS contract_pct,
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 1
            WHEN status = 'Lapse Pending'::text THEN 2
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 3
            ELSE 4
        END AS priority,
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 'ACT NOW — still saveable, and the advance is still partly unearned'::text
            WHEN status = 'Lapse Pending'::text THEN 'Lapse pending, advance already earned out — save the client, not the commission'::text
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 'Already lapsed inside the window — expect a clawback; confirm against the carrier statement'::text
            ELSE 'Lapsed after the window — no clawback expected'::text
        END AS what_this_means,
    'ESTIMATE — annual premium x contract %, straight-line over 9 months. No payout feed exists; confirm against carrier statements.'::text AS basis,
    snapshot_at AS source_snapshot_at,
    CURRENT_DATE - snapshot_at AS days_stale,
        CASE
            WHEN (CURRENT_DATE - snapshot_at) > 7 THEN ((('STALE SNAPSHOT — agentlink_book frozen '::text || snapshot_at) || ' ('::text) || (CURRENT_DATE - snapshot_at)) || 'd). status + months_in_force are AS OF the snapshot, not live; confirm vs carrier before calling a policy "saveable". Live lapse lane is DARK (AgentLink retired 2026-10-17).'::text
            ELSE 'LIVE — book imported within 7d'::text
        END AS freshness_verdict
   FROM base
  ORDER BY (
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 1
            WHEN status = 'Lapse Pending'::text THEN 2
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 3
            ELSE 4
        END), (round(annual_premium * contract_rate * GREATEST(0::numeric, LEAST(1::numeric, (9::numeric - months_in_force) / 9.0)), 0)) DESC NULLS LAST
), live as (
  select p.carrier || ':' || p.policy_key as deal_key, p.policy_number,
         case when p.carrier = 'Chubb' then 'Combined' else p.carrier end as carrier,
         p.client_name, p.agent_id, coalesce(a.display_name, p.agent_name, '(unmapped)') as agent_name,
         coalesce(m.display_name, 'unassigned') as manager,
         case p.status_bucket when 'at_risk' then 'Lapse Pending' else 'Lapsed' end as status,
         p.effective_on as effective_date,
         greatest(0, current_date - coalesce(p.effective_on, p.sold_on))::numeric / 30.44 as mif,
         p.annual_premium,
         coalesce((select x.pct from public.fn_agent_contract_pct(p.agent_id) x(pct, provenance)), 100::numeric) / 100.0 as rate,
         p.last_seen_on
    from public.carrier_book_policies p
    left join public.agents a on a.id = p.agent_id
    left join public.agents m on m.id = a.manager_id
   where p.status_bucket in ('lapsed','at_risk') and coalesce(p.effective_on, p.sold_on) is not null
)
select * from (
  select * from legacy where carrier not in ('Combined','Ethos')
  union all
  select deal_key, policy_number, carrier, client_name, agent_id, agent_name, manager, status, effective_date,
         round(mif, 1),
         annual_premium,
         round(annual_premium * rate * greatest(0::numeric, least(1::numeric, (9::numeric - mif) / 9.0)), 0),
         round(rate * 100, 0),
         case when status = 'Lapse Pending' and mif < 9 then 1 when status = 'Lapse Pending' then 2 when mif < 9 then 3 else 4 end,
         case when status = 'Lapse Pending' and mif < 9 then 'ACT NOW — still saveable, and the advance is still partly unearned'
              when status = 'Lapse Pending' then 'Lapse pending, advance already earned out — save the client, not the commission'
              when mif < 9 then 'Already lapsed inside the window — expect a clawback; confirm against the carrier statement'
              else 'Lapsed after the window — no clawback expected' end,
         'LIVE carrier book (Ethos / Chubb portal pull). Exposure = annual premium x contract %, straight-line over 9 months.',
         last_seen_on, (current_date - last_seen_on)::integer,
         case when current_date - last_seen_on > 2 then 'STALE — carrier pull last succeeded ' || last_seen_on
              else 'LIVE — carrier portal pulled ' || last_seen_on end
    from live
) u
order by priority, est_clawback_exposure desc nulls last;


-- ---------- unaccounted = written in the carrier portal, never on the site ---
create or replace view public.v_carrier_unaccounted as
  select coalesce(p.policy_number, p.policy_key) as policy_number,
         case when p.carrier = 'Chubb' then 'Combined' else p.carrier end as carrier,
         p.underwriter as region,
         coalesce(a.display_name, p.agent_name) as agent,
         coalesce(p.sold_on, p.effective_on) as ref_date,
         p.annual_premium as comp_amount,
         public.fn_carrier_status_label(p.status_bucket) as status
    from public.carrier_book_policies p
    left join public.agents a on a.id = p.agent_id
   where p.site_match is null and public.fn_carrier_bucket_written(p.status_bucket);
revoke all on public.v_carrier_unaccounted from anon, public, authenticated;

-- ---------- one agent's carrier book (profile drawer) -----------------------
create or replace function public.agent_carrier_book(p_agent_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_canon uuid; v_ids uuid[]; v jsonb; v_npns text[];
begin
  if p_agent_id is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(canonical_agent_id, id) into v_canon from public.agents where id = p_agent_id;
  select array_agg(id) into v_ids from public.agents where id = v_canon or canonical_agent_id = v_canon;
  select array_agg(distinct agent_npn) into v_npns from public.carrier_book_policies where agent_id = any(v_ids) and agent_npn is not null;

  with p as (select * from public.carrier_book_policies where agent_id = any(v_ids)),
       cb as (select * from public.carrier_book_chargebacks where agent_id = any(v_ids) and source = 'comp_ledger'),
       debt as (select * from public.carrier_book_chargebacks where agent_id = any(v_ids) and source = 'debt_outstanding')
  select jsonb_build_object(
    'agent_id', v_canon,
    'as_of', (select max(run_at) from public.carrier_book_runs where ok),
    'summary', jsonb_build_object(
      'written', (select count(*) from p where public.fn_carrier_bucket_written(status_bucket)),
      'written_ap', (select coalesce(sum(annual_premium),0) from p where public.fn_carrier_bucket_written(status_bucket)),
      'written_30d', (select count(*) from p where public.fn_carrier_bucket_written(status_bucket) and sold_on >= current_date - 30),
      'written_30d_ap', (select coalesce(sum(annual_premium),0) from p where public.fn_carrier_bucket_written(status_bucket) and sold_on >= current_date - 30),
      'submitted', (select count(*) from p where status_bucket = 'pending'),
      'in_force', (select count(*) from p where status_bucket in ('active','claim')),
      'in_force_ap', (select coalesce(sum(annual_premium),0) from p where status_bucket in ('active','claim')),
      'at_risk', (select count(*) from p where status_bucket = 'at_risk'),
      'lapsed', (select count(*) from p where status_bucket = 'lapsed'),
      'not_placed', (select count(*) from p where status_bucket in ('not_taken','declined','abandoned')),
      'retention_pct', (select case when count(*) filter (where public.fn_carrier_bucket_placed(status_bucket)) > 0
                         then round(100.0 * count(*) filter (where status_bucket in ('active','claim'))
                                  / count(*) filter (where public.fn_carrier_bucket_placed(status_bucket)), 1) end from p),
      'not_on_site', (select count(*) from p where site_match is null and public.fn_carrier_bucket_written(status_bucket)),
      'chargebacks', (select count(*) from cb),
      'chargeback_amount', (select coalesce(sum(amount),0) from cb),
      'debt_outstanding', (select coalesce(sum(amount),0) from debt)
    ),
    'by_carrier', (select coalesce(jsonb_agg(jsonb_build_object('carrier', c, 'written', w, 'in_force', i, 'lapsed', l)), '[]') from (
        select case when carrier='Chubb' then 'Combined' else carrier end c,
               count(*) filter (where public.fn_carrier_bucket_written(status_bucket)) w,
               count(*) filter (where status_bucket in ('active','claim')) i,
               count(*) filter (where status_bucket in ('lapsed','at_risk')) l
          from p group by 1) s),
    'ethos_portal', (select jsonb_build_object('issued_ap', e.issued_annual_premium, 'inforce_ap', e.inforce_issued_premium,
                       'persistency_m4', e.persistency_m4, 'persistency_m13', e.persistency_m13,
                       'outstanding_chargeback', e.outstanding_chargeback, 'advance_pay', e.on_advanced_pay)
                       from public.ethos_live_production e
                      where e.npn = any(v_npns) and e.snapshot_on = (select max(snapshot_on) from public.ethos_live_production)
                      limit 1),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', p.carrier || ':' || p.policy_key,
        'carrier', case when p.carrier='Chubb' then 'Combined' else p.carrier end,
        'underwriter', p.underwriter, 'policy_number', p.policy_number, 'client', p.client_name,
        'product', p.product, 'bucket', p.status_bucket, 'label', public.fn_carrier_status_label(p.status_bucket),
        'status_raw', p.status_raw, 'close_reason', p.close_reason,
        'annual_premium', p.annual_premium, 'face_amount', p.face_amount,
        'sold_on', p.sold_on, 'effective_on', p.effective_on, 'changed_on', p.status_changed_on,
        'on_site', p.site_match is not null,
        'chargeback', (select sum(c.amount) from cb c where public.fn_carrier_pn_key(c.policy_number) = p.policy_key)
      ) order by coalesce(p.sold_on, p.effective_on) desc nulls last), '[]')
      from p where p.status_bucket not in ('quote','started'))
  ) into v;
  return v;
end $$;
revoke all on function public.agent_carrier_book(uuid) from public, anon;
grant execute on function public.agent_carrier_book(uuid) to authenticated;

-- ---------- per-agent carrier stats for every agent the caller can see -------
create or replace function public.team_carrier_book_summary()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(agent_id, s), '{}') from (
    select p.agent_id, jsonb_build_object(
      'written_30d', count(*) filter (where public.fn_carrier_bucket_written(p.status_bucket) and p.sold_on >= current_date - 30),
      'ap_30d', coalesce(sum(p.annual_premium) filter (where public.fn_carrier_bucket_written(p.status_bucket) and p.sold_on >= current_date - 30), 0),
      'submitted', count(*) filter (where p.status_bucket = 'pending'),
      'in_force', count(*) filter (where p.status_bucket in ('active','claim')),
      'at_risk', count(*) filter (where p.status_bucket = 'at_risk'),
      'lapsed', count(*) filter (where p.status_bucket = 'lapsed'),
      'retention_pct', case when count(*) filter (where public.fn_carrier_bucket_placed(p.status_bucket)) > 0
          then round(100.0 * count(*) filter (where p.status_bucket in ('active','claim'))
                   / count(*) filter (where public.fn_carrier_bucket_placed(p.status_bucket)), 1) end,
      'last_sold_on', max(p.sold_on) filter (where public.fn_carrier_bucket_written(p.status_bucket)),
      'chargeback_amount', coalesce((select sum(c.amount) from public.carrier_book_chargebacks c
                                      where c.agent_id = p.agent_id and c.source = 'comp_ledger'), 0)
    ) s
    from public.carrier_book_policies p
   where p.agent_id is not null
     and (public.apex_is_admin() or p.agent_id in (select unnest(public.fn_carrier_visible_agent_ids())))
   group by p.agent_id
  ) t
$$;
revoke all on function public.team_carrier_book_summary() from public, anon;
grant execute on function public.team_carrier_book_summary() to authenticated;

-- ---------- owner command center: + the live book ----------------------------
create or replace function public.carrier_command()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $fn$
declare v jsonb; d date;
begin
  if not public.is_owner() then raise exception 'owner only' using errcode='42501'; end if;
  select max(snapshot_on) into d from public.carrier_live_metrics;
  select jsonb_build_object(
    'as_of', d,
    'carriers', (select coalesce(jsonb_agg(to_jsonb(m) order by m.carrier),'[]') from public.carrier_live_metrics m where m.snapshot_on=d),
    'unaccounted', (select coalesce(jsonb_agg(to_jsonb(u) order by u.ref_date desc nulls last),'[]') from public.v_carrier_unaccounted u),
    'unaccounted_count', (select count(*) from public.v_carrier_unaccounted),
    'unaccounted_by_carrier', (select coalesce(jsonb_object_agg(carrier,n),'{}') from (select carrier,count(*) n from public.v_carrier_unaccounted group by carrier) t),
    'chargebacks', (select coalesce(jsonb_agg(jsonb_build_object('policy_number',c.policy_number,'agent',coalesce(a.display_name,c.agent_name),'amount',c.amount,'reason',c.reason,'date',c.chargeback_on) order by c.chargeback_on desc nulls last),'[]')
                      from public.carrier_book_chargebacks c left join public.agents a on a.id=c.agent_id where c.source='comp_ledger'),
    'production', (select coalesce(jsonb_agg(jsonb_build_object('agent',agent_name,'npn',npn,'issued',issued_annual_premium,'inforce',inforce_issued_premium,'p13',persistency_m13,'chargeback',outstanding_chargeback) order by issued_annual_premium desc nulls last),'[]') from public.ethos_live_production where snapshot_on=(select max(snapshot_on) from public.ethos_live_production)),
    'book', (select coalesce(jsonb_agg(x order by x->>'carrier'),'[]') from (
               select jsonb_build_object('carrier', case when carrier='Chubb' then 'Combined' else carrier end,
                 'written', count(*) filter (where public.fn_carrier_bucket_written(status_bucket)),
                 'written_ap', coalesce(sum(annual_premium) filter (where public.fn_carrier_bucket_written(status_bucket)),0),
                 'submitted', count(*) filter (where status_bucket='pending'),
                 'in_force', count(*) filter (where status_bucket in ('active','claim')),
                 'at_risk', count(*) filter (where status_bucket='at_risk'),
                 'lapsed', count(*) filter (where status_bucket='lapsed'),
                 'not_placed', count(*) filter (where status_bucket in ('not_taken','declined','abandoned')),
                 'retention_pct', case when count(*) filter (where public.fn_carrier_bucket_placed(status_bucket))>0 then
                     round(100.0*count(*) filter (where status_bucket in ('active','claim'))/count(*) filter (where public.fn_carrier_bucket_placed(status_bucket)),1) end) x
                 from public.carrier_book_policies group by carrier) s),
    'unmapped_agents', (select coalesce(jsonb_agg(jsonb_build_object('carrier',carrier,'agent',agent_name,'npn',agent_npn,'policies',n) order by n desc),'[]') from (
               select carrier, agent_name, agent_npn, count(*) n from public.carrier_book_policies
                where agent_id is null and public.fn_carrier_bucket_written(status_bucket) group by 1,2,3) s),
    'freshness', (select coalesce(jsonb_agg(to_jsonb(f)),'[]') from public.v_carrier_book_freshness f),
    'site_not_in_portal', (select coalesce(jsonb_agg(x order by (x->>'ap')::numeric desc),'[]') from (
               select jsonb_build_object('agent', agent_name, 'carrier', carrier, 'deals', count(*), 'ap', round(sum(annual_premium)),
                        'oldest_days', max(days_old), 'agent_has_portal_policies', bool_or(agent_has_portal_policies),
                        'typed_numbers', count(*) filter (where policy_number_grade <> 'ok')) x
                 from public.v_site_deals_not_in_portal where days_old >= 14 group by agent_name, carrier) s),
    'recent_changes', (select coalesce(jsonb_agg(jsonb_build_object('carrier',e.carrier,'policy',e.policy_key,'from',e.from_bucket,'to',e.to_bucket,'on',e.observed_on,'agent',coalesce(a.display_name,p.agent_name)) order by e.id desc),'[]')
                         from (select * from public.carrier_book_status_events where from_bucket is not null order by id desc limit 100) e
                         left join public.carrier_book_policies p on p.carrier=e.carrier and p.policy_key=e.policy_key
                         left join public.agents a on a.id=p.agent_id)
  ) into v; return v;
end $fn$;
revoke all on function public.carrier_command() from public, anon;
grant execute on function public.carrier_command() to authenticated;

-- ---------- owner digest (harvester evening push) ----------------------------
create or replace function public.carrier_book_digest(p_since timestamptz default now() - interval '24 hours')
returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws(E'\n',
    'Carrier book (Ethos + Combined), last 24h',
    'New written: ' || (select count(*) from public.carrier_book_policies where first_seen_on >= (p_since at time zone 'America/Phoenix')::date and public.fn_carrier_bucket_written(status_bucket) and first_seen_on > (select min(first_seen_on) from public.carrier_book_policies)),
    'Newly in force: ' || (select count(*) from public.carrier_book_status_events where created_at >= p_since and to_bucket in ('active','claim') and from_bucket is not null),
    'New lapses / at-risk: ' || (select count(*) from public.carrier_book_status_events where created_at >= p_since and to_bucket in ('lapsed','at_risk') and from_bucket is not null),
    'Not placed: ' || (select count(*) from public.carrier_book_status_events where created_at >= p_since and to_bucket in ('not_taken','declined','abandoned') and from_bucket is not null),
    'Chargebacks: ' || (select count(*) || ' / $' || coalesce(round(sum(amount)),0) from public.carrier_book_chargebacks where first_seen_on >= (p_since at time zone 'America/Phoenix')::date and source='comp_ledger' and first_seen_on > (select min(first_seen_on) from public.carrier_book_chargebacks)),
    'Written in the portal, never posted on the site: ' || (select count(*) from public.v_carrier_unaccounted),
    'Agents the carrier knows that the site cannot match: ' || (select count(distinct agent_name) from public.carrier_book_policies where agent_id is null and public.fn_carrier_bucket_written(status_bucket)))
$$;
revoke all on function public.carrier_book_digest(timestamptz) from public, anon, authenticated;
