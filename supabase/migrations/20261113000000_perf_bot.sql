-- MP-PERF-BOT (2026-11-13). The agent performance bot: goal pace ($20K floor, $25K target a month per agent),
-- lead type and lead list yield, agents past 90 days with no downline, and deals that never got a real
-- policy number. Everything is SQL: a daily pg_cron job calls fn_perf_bot_run(), which writes findings and
-- pushes one digest. No model is called anywhere, so it costs no tokens.
--
-- Deliberate choices, each measured before it was made:
--   * Lead type is read from deals.lead_source (the form already stores it; it was blank on 2,008 of 2,012
--     deals because the field was optional free text). Old deals are typed from the lead warehouse by phone
--     (390 of 1,698 deals match). No column is added to deals, so no hot-path trigger is touched.
--   * "No policy number" means blank OR a placeholder an agent typed to get past the required field
--     (12345678910, 1234, 00000). 255 deals carry one; 249 are AgentLink imports (real historical sales,
--     some active, some cancelled) and are FLAGGED ONLY. Only the native posts agents typed themselves
--     are returned to the agent's My Leads, and nothing is deleted or re-statused.
--   * Production pace reads v_production_canonical, the same truth layer as the dashboards.
-- Idempotent throughout.

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function public.fn_lead_type_of(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p), '') = '' then 'unknown'
    when p ~* 'mortgage|va ?cash|cash ?out|refinanc|heloc|lower payment|reverse|(^|[^a-z])mtg([^a-z]|$)|home ?loan' then 'mortgage'
    when p ~* 'vet|(^|[^a-z])va([^a-z]|$)|starr?t?e?rpack|5kvets|valeads' then 'veteran'
    when p ~* '(^|[^a-z])pos([^a-z]|$)|point.of.sale' then 'pos'
    when p ~* 'fex|final ?expense|burial|benefici|a[ _+-]?list|(^|[^a-z])b[/_ ]?c([^a-z]|$)|level ?3|gold|remaining' then 'fex'
    when p ~* 'aged|age.?out' then 'aged'
    when p ~* 'referr|friend' then 'referral'
    else 'other'
  end
$$;

-- blank | placeholder | short | ok. 'short' (5-6 digits) is suspicious, not proof: it is reported, never auto-acted on.
create or replace function public.fn_policy_number_grade(p text)
returns text
language sql
immutable
set search_path = public
as $$
  with t as (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as k)
  select case
    when k = '' then 'blank'
    when k ~ '^(PENDING|TBD|NA|NONE|UNKNOWN|TEST|NULL|NOPOLICY|NOPOLICYYET|X+)$' then 'placeholder'
    when k ~ '^(.)\1+$' then 'placeholder'
    when k ~ '^(12345|01234|09876|98765|87654|76543|65432|54321)' then 'placeholder'
    when length(k) <= 4 then 'placeholder'
    when length(k) <= 6 and k ~ '^[0-9]+$' then 'short'
    else 'ok'
  end
  from t
$$;

-- ───────────────────────────── tables ─────────────────────────────
create table if not exists public.perf_bot_runs (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  ok        boolean not null,
  summary   jsonb,
  error     text
);

create table if not exists public.perf_bot_findings (
  id         bigint generated always as identity primary key,
  run_date   date not null,
  kind       text not null,
  severity   text not null default 'info' check (severity in ('info','warn','high')),
  agent_id   uuid,
  headline   text not null,
  detail     jsonb not null default '{}'::jsonb,
  dollars    numeric,
  created_at timestamptz not null default now()
);
create index if not exists perf_bot_findings_run_idx on public.perf_bot_findings (run_date desc, severity);

create table if not exists public.deal_lead_returns (
  deal_id        uuid primary key references public.deals(id) on delete cascade,
  agent_id       uuid not null,
  bundle_id      uuid,
  item_id        uuid,
  policy_grade   text not null,
  annual_premium numeric,
  returned_at    timestamptz not null default now()
);

alter table public.deal_lead_returns add column if not exists outcome text not null default 'created';

alter table public.perf_bot_runs     enable row level security;
alter table public.perf_bot_findings enable row level security;
alter table public.deal_lead_returns enable row level security;
do $$
declare t text;
begin
  foreach t in array array['perf_bot_runs','perf_bot_findings','deal_lead_returns'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_role(auth.uid(), ''admin''::public.app_role)) with check (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t || '_admin_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

insert into public.system_settings (key, value) values
  ('perf_goal_floor', '20000'),
  ('perf_goal_target', '25000'),
  ('perf_policy_grace_days', '14'),
  ('perf_bot_alerts', 'true')
on conflict (key) do nothing;

-- ───────────────────────────── row types (so the facts are computed once and reused) ─────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'perf_deal_fact' and typnamespace = 'public'::regnamespace) then
    create type public.perf_deal_fact as (
      deal_id uuid, agent_id uuid, canonical_agent_id uuid, source text, posted_date date, annual_premium numeric,
      status text, policy_number text, policy_grade text, lead_type text, lead_type_from text, lead_list text, p10 text);
  end if;
  if not exists (select 1 from pg_type where typname = 'perf_agent_row' and typnamespace = 'public'::regnamespace) then
    create type public.perf_agent_row as (
      id uuid, name text, licensed boolean, since_d date, mtd numeric, d30 numeric, n30 int, d90 numeric, last_deal date,
      legs int, applicants_90d int, seg text, proj numeric, ticket numeric);
  end if;
end $$;

-- ───────────────────────────── per-deal facts (internal) ─────────────────────────────
-- One row per live deal: who, when, how much, how good its policy number is, and what kind of lead it came
-- from. The dead-status list matches v_production_canonical.
create or replace function public.perf_deal_facts()
returns setof public.perf_deal_fact
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select dl.id, dl.agent_id, coalesce(m.canonical_agent_id, dl.agent_id) as cid, dl.source::text as src,
           coalesce(dl.posted_at, dl.created_at)::date as posted, dl.annual_premium, dl.status, dl.policy_number, dl.lead_source,
           right(regexp_replace(coalesce(dl.client_phone, ''), '\D', '', 'g'), 10) as p10
      from deals dl
      left join v_agent_canonical_map m on m.agent_id = dl.agent_id
     where lower(coalesce(dl.status, '')) not in ('duplicate','lapsed','cancelled','charged_back','withdrawn','not_taken','declined')
       and dl.duplicate_of_deal_id is null
  ), hit as (
    select distinct on (d.id) d.id, c.source_file,
           public.fn_lead_type_of(coalesce(c.lead_type, '') || ' ' || coalesce(c.source_file, '')) as lt
      from d
      join client_leads c on right(regexp_replace(coalesce(c.phone_digits, ''), '\D', '', 'g'), 10) = d.p10
     where length(d.p10) = 10
     order by d.id, (c.source_file is null), c.source_file
  )
  select d.id, d.agent_id, d.cid, d.src, d.posted, d.annual_premium, d.status, d.policy_number,
         public.fn_policy_number_grade(d.policy_number),
         case when coalesce(btrim(d.lead_source), '') <> '' then public.fn_lead_type_of(d.lead_source)
              when hit.lt is not null then hit.lt else 'unknown' end,
         case when coalesce(btrim(d.lead_source), '') <> '' then 'form' when hit.lt is not null then 'warehouse' else 'none' end,
         hit.source_file, d.p10
    from d left join hit on hit.id = d.id
$$;

-- ───────────────────────────── the numbers (internal; the page and the bot both read this) ─────────────────────────────
create or replace function public.perf_bot_core(p_floor numeric, p_target numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_ms    date := date_trunc('month', (now() at time zone 'America/Phoenix'))::date;
  v_dim   int  := extract(day from (date_trunc('month', v_ms::timestamp) + interval '1 month - 1 day'))::int;
  v_day   int  := extract(day from v_today)::int;
  v_rows jsonb; v_facts jsonb;
  v_agents jsonb; v_goal jsonb; v_types jsonb; v_lists jsonb; v_down jsonb; v_policy jsonb; v_fresh jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    with act as (
      select a.id, coalesce(a.display_name, '-') as name, (a.license_status = 'licensed') as licensed,
             coalesce(a.contracted_at::date, a.start_date, a.created_at::date) as since_d
        from agents a
       where a.canonical_agent_id is null and a.status = 'active'
         and not coalesce(a.is_inactive, false) and not coalesce(a.is_deactivated, false)
         and not public.fn_agent_is_roster_excluded(a.id)
    ), prod as (
      select coalesce(m.canonical_agent_id, p.agent_id) as aid,
             sum(p.annual_premium) filter (where p.posted_date >= v_ms) as mtd,
             sum(p.annual_premium) filter (where p.posted_date >= v_today - 30) as d30,
             (count(*) filter (where p.posted_date >= v_today - 30))::int as n30,
             sum(p.annual_premium) as d90,
             (count(*))::int as n90,
             max(p.posted_date) as last_deal
        from v_production_canonical p
        left join v_agent_canonical_map m on m.agent_id = p.agent_id
       where p.posted_date >= v_today - 90
       group by 1
    )
    select act.id, act.name, coalesce(act.licensed, false) as licensed, act.since_d,
           coalesce(pr.mtd, 0) as mtd, coalesce(pr.d30, 0) as d30, coalesce(pr.n30, 0) as n30, coalesce(pr.d90, 0) as d90, pr.last_deal,
           (select count(*)::int from agents c where c.manager_id = act.id and c.canonical_agent_id is null
               and c.status is distinct from 'terminated' and not coalesce(c.is_deactivated, false)) as legs,
           (select count(*)::int from v_applications_real ap
              where (ap.referral_recruiter_id = act.id or ap.referrer_agent_id = act.id) and ap.created_at > now() - interval '90 days') as applicants_90d,
           case when coalesce(pr.d30, 0) > 0 then 'producing' when coalesce(act.licensed, false) then 'licensed_silent' else 'unlicensed' end as seg,
           case when v_day > 0 then round(coalesce(pr.mtd, 0) / v_day * v_dim) else 0 end as proj,
           case when coalesce(pr.n30, 0) > 0 then round(pr.d30 / pr.n30)
                when coalesce(pr.n90, 0) > 0 then round(pr.d90 / pr.n90) else null end as ticket
      from act left join prod pr on pr.aid = act.id
  ) t;

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_facts from public.perf_deal_facts() f;

  select jsonb_build_object(
    'floor', p_floor, 'target', p_target, 'month_start', v_ms, 'day', v_day, 'days_in_month', v_dim,
    'active_agents', count(*), 'licensed_active', count(*) filter (where licensed),
    'producing_30d', count(*) filter (where seg = 'producing'),
    'licensed_silent', count(*) filter (where seg = 'licensed_silent'),
    'at_floor_mtd', count(*) filter (where mtd >= p_floor), 'at_target_mtd', count(*) filter (where mtd >= p_target),
    'on_pace_floor', count(*) filter (where licensed and proj >= p_floor),
    'mtd_total', coalesce(sum(mtd), 0), 'projected_total', coalesce(sum(proj), 0),
    'floor_potential', count(*) filter (where licensed) * p_floor,
    'avg_per_producer_30d', coalesce(round(avg(d30) filter (where seg = 'producing')), 0)
  ) into v_goal from jsonb_populate_recordset(null::public.perf_agent_row, v_rows);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'segment', seg, 'mtd', mtd, 'projected', proj, 'd30', d30, 'deals_30d', n30, 'ticket', ticket,
    'gap_to_floor', greatest(p_floor - proj, 0),
    'deals_to_floor', case when ticket > 0 then ceil(greatest(p_floor - proj, 0) / ticket) else null end,
    'last_deal', last_deal, 'tenure_days', v_today - since_d
  ) order by mtd desc, d30 desc), '[]'::jsonb)
    into v_agents from (select * from jsonb_populate_recordset(null::public.perf_agent_row, v_rows) order by mtd desc, d30 desc limit 150) x;

  -- Lead type: deals posted in the last 180 days.
  select coalesce(jsonb_agg(jsonb_build_object('lead_type', lt, 'deals', n, 'ap', ap, 'avg_ticket', case when n > 0 then round(ap / n) end,
           'from_form', ff) order by ap desc), '[]'::jsonb)
    into v_types
    from (select lead_type as lt, count(*) as n, round(sum(annual_premium)) as ap, count(*) filter (where lead_type_from = 'form') as ff
            from jsonb_populate_recordset(null::public.perf_deal_fact, v_facts) where posted_date >= v_today - 180 group by 1) t;

  -- Lead list yield: deals that share a phone with a lead in that warehouse file. Not a close rate (no dial counts).
  select coalesce(jsonb_agg(jsonb_build_object('list', sf, 'lead_type', public.fn_lead_type_of(sf), 'leads_in_file', total, 'deals', n, 'ap', ap,
           'deals_per_1000', round(n * 1000.0 / nullif(total, 0), 2), 'ap_per_lead', round(ap / nullif(total, 0), 2)) order by n * 1.0 / nullif(total, 0) desc nulls last), '[]'::jsonb)
    into v_lists
    from (select f.lead_list as sf, count(*) as n, round(sum(f.annual_premium)) as ap,
                 (select count(*) from client_leads c where c.source_file = f.lead_list) as total
            from jsonb_populate_recordset(null::public.perf_deal_fact, v_facts) f where f.lead_list is not null and f.posted_date >= v_today - 400 group by f.lead_list) l
   where total > 0;

  -- Downline: active agents at least 90 days in who have no one under them.
  select jsonb_build_object(
    'agents_90d_plus', count(*),
    'no_downline', count(*) filter (where legs = 0),
    'by_reason', jsonb_build_object(
       'not_producing',        count(*) filter (where legs = 0 and d90 = 0),
       'no_applicants',        count(*) filter (where legs = 0 and d90 > 0 and applicants_90d = 0),
       'applicants_not_hired', count(*) filter (where legs = 0 and d90 > 0 and applicants_90d > 0)),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tenure_days', v_today - since_d, 'd90', d90, 'applicants_90d', applicants_90d,
              'reason', case when d90 = 0 then 'not_producing' when applicants_90d = 0 then 'no_applicants' else 'applicants_not_hired' end) order by d90 desc, since_d)
              from (select * from jsonb_populate_recordset(null::public.perf_agent_row, v_rows) z0 where legs = 0 and since_d <= v_today - 90 order by d90 desc, since_d limit 60) z), '[]'::jsonb))
    into v_down from jsonb_populate_recordset(null::public.perf_agent_row, v_rows) where since_d <= v_today - 90;

  select jsonb_build_object(
    'native_flagged', count(*) filter (where source in ('apex_native','apex') and policy_grade in ('blank','placeholder')),
    'native_flagged_ap', coalesce(round(sum(annual_premium) filter (where source in ('apex_native','apex') and policy_grade in ('blank','placeholder'))), 0),
    'native_short', count(*) filter (where source in ('apex_native','apex') and policy_grade = 'short'),
    'import_placeholder', count(*) filter (where source not in ('apex_native','apex') and policy_grade in ('blank','placeholder')),
    'import_placeholder_ap', coalesce(round(sum(annual_premium) filter (where source not in ('apex_native','apex') and policy_grade in ('blank','placeholder'))), 0),
    'returned', (select count(*) from deal_lead_returns),
    'returned_ap', (select coalesce(round(sum(annual_premium)), 0) from deal_lead_returns),
    'grace_days', coalesce(nullif((select value from system_settings where key = 'perf_policy_grace_days'), '')::int, 14),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('deal_id', deal_id, 'agent', (select display_name from agents a where a.id = fx.canonical_agent_id),
              'policy_number', policy_number, 'grade', policy_grade, 'ap', annual_premium, 'posted', posted_date,
              'returned', exists (select 1 from deal_lead_returns r where r.deal_id = fx.deal_id)) order by posted_date desc)
              from (select * from jsonb_populate_recordset(null::public.perf_deal_fact, v_facts) where source in ('apex_native','apex') and policy_grade in ('blank','placeholder','short') order by posted_date desc limit 25) fx), '[]'::jsonb))
    into v_policy from jsonb_populate_recordset(null::public.perf_deal_fact, v_facts);

  select coalesce(jsonb_agg(jsonb_build_object('origin', origin, 'days_dark', days_dark, 'verdict', verdict, 'deals_30d', deals_30d, 'alp_30d', alp_30d)), '[]'::jsonb)
    into v_fresh from v_production_origin_freshness;

  return jsonb_build_object('generated_at', now(), 'goal', v_goal, 'agents', v_agents, 'lead_types', v_types, 'lead_lists', v_lists,
                            'downline', v_down, 'policy', v_policy, 'freshness', v_fresh);
end $$;

-- ───────────────────────────── the page's read (admin only) ─────────────────────────────
create or replace function public.perf_bot_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_floor numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_floor'), '')::numeric, 20000);
  v_target numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_target'), '')::numeric, 25000);
  v_core jsonb;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    return null;
  end if;
  v_core := public.perf_bot_core(v_floor, v_target);
  return v_core || jsonb_build_object(
    'findings', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'severity', severity, 'headline', headline, 'dollars', dollars, 'detail', detail)
                          order by case severity when 'high' then 0 when 'warn' then 1 else 2 end, dollars desc nulls last)
                          from perf_bot_findings where run_date = (select max(run_date) from perf_bot_findings)), '[]'::jsonb),
    'findings_date', (select max(run_date) from perf_bot_findings),
    'last_run', (select jsonb_build_object('ran_at', ran_at, 'ok', ok, 'error', error) from perf_bot_runs order by id desc limit 1),
    'alerts_on', coalesce((select value = 'true' from system_settings where key = 'perf_bot_alerts'), false));
end $$;

-- ───────────────────────────── return deals with no real policy number to the agent's leads ─────────────────────────────
-- Native posts only (source apex_native / apex), older than the grace window. The deal stays exactly as it is;
-- the agent gets a My Leads item to confirm the number with the carrier and re-submit. Idempotent per deal.
create or replace function public.fn_perf_return_deals_to_leads(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace int := coalesce(nullif((select value from system_settings where key = 'perf_policy_grace_days'), '')::int, 14);
  r record; v_user uuid; v_name text; v_bundle uuid; v_item uuid; v_first text; v_last text; v_live_bundle uuid;
  n_due int := 0; n_done int := 0; n_already int := 0; n_skip int := 0; v_ap numeric := 0;
begin
  for r in
    select f.deal_id, f.canonical_agent_id as aid, f.annual_premium, f.policy_grade, f.posted_date, f.p10
      from perf_deal_facts() f
     where f.source in ('apex_native','apex') and f.policy_grade in ('blank','placeholder')
       and f.posted_date <= (now() at time zone 'America/Phoenix')::date - v_grace
       and length(f.p10) = 10
       and not exists (select 1 from deal_lead_returns x where x.deal_id = f.deal_id)
  loop
    n_due := n_due + 1;
    if p_dry_run then continue; end if;

    -- A phone can sit in only one live bundle. If this customer is already someone's lead, link to that lead
    -- instead of duplicating or moving it; the page lists these separately.
    select i.id, i.bundle_id into v_item, v_live_bundle from lead_bundle_items i where i.phone10 = r.p10 and i.removed_at is null limit 1;
    if v_item is not null then
      insert into deal_lead_returns (deal_id, agent_id, bundle_id, item_id, policy_grade, annual_premium, outcome)
      values (r.deal_id, r.aid, v_live_bundle, v_item, r.policy_grade, r.annual_premium, 'already_a_lead') on conflict (deal_id) do nothing;
      n_already := n_already + 1;
      continue;
    end if;

    select a.user_id, coalesce(a.display_name, 'Agent') into v_user, v_name from agents a where a.id = r.aid;
    if v_user is null then n_skip := n_skip + 1; continue; end if;

    select b.id into v_bundle from lead_bundles b
     where b.archived_at is null and b.criteria->>'kind' = 'deal_no_policy' and b.criteria->>'agent_id' = r.aid::text limit 1;
    if v_bundle is null then
      insert into lead_bundles (name, format, criteria, note)
      values ('Confirm these deals: ' || v_name, 'client_leads', jsonb_build_object('kind', 'deal_no_policy', 'agent_id', r.aid),
              'Deals posted without a real policy number. Confirm the number with the carrier, then re-submit the deal.')
      returning id into v_bundle;
    end if;
    if not exists (select 1 from lead_bundle_grants g where g.bundle_id = v_bundle and g.user_id = v_user and g.revoked_at is null) then
      insert into lead_bundle_grants (bundle_id, user_id, note) values (v_bundle, v_user, 'perf bot: deals without a policy number');
    end if;

    select d.client_first_name, d.client_last_name into v_first, v_last from deals d where d.id = r.deal_id;
    v_item := null;
    begin
      insert into lead_bundle_items (bundle_id, phone10, first_name, last_name, source_kind, status, status_note)
      values (v_bundle, r.p10, v_first, v_last, 'rewrite', 'new',
              'Sold ' || r.posted_date::text || ' for $' || round(r.annual_premium)::text || ' a year with no real policy number. Get the number from the carrier and re-submit the deal.')
      returning id into v_item;
    exception when unique_violation then
      n_already := n_already + 1;
      continue;
    end;

    insert into deal_lead_returns (deal_id, agent_id, bundle_id, item_id, policy_grade, annual_premium)
    values (r.deal_id, r.aid, v_bundle, v_item, r.policy_grade, r.annual_premium) on conflict (deal_id) do nothing;
    n_done := n_done + 1; v_ap := v_ap + coalesce(r.annual_premium, 0);
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'due', n_due, 'returned', n_done, 'already_a_lead', n_already, 'skipped_no_login', n_skip, 'returned_ap', round(v_ap), 'grace_days', v_grace);
end $$;

-- ───────────────────────────── the bot ─────────────────────────────
create or replace function public.fn_perf_bot_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_floor'), '')::numeric, 20000);
  v_target numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_target'), '')::numeric, 25000);
  v_today date := (now() at time zone 'America/Phoenix')::date;
  c jsonb; g jsonb; ret jsonb; a jsonb; v_stale boolean; v_unknown numeric; v_total int; v_lines text := ''; v_n int := 0;
  v_summary jsonb;
begin
  begin
    -- Return first, then measure, so today's returns are in the numbers the digest quotes.
    ret := public.fn_perf_return_deals_to_leads(false);
    c := public.perf_bot_core(v_floor, v_target);
    g := c->'goal';

    select coalesce(bool_or((x->>'verdict') in ('DARK','DYING') and (x->>'origin') = 'apex_native'), false)
      into v_stale from jsonb_array_elements(c->'freshness') x;

    delete from perf_bot_findings where run_date = v_today;

    if v_stale then
      insert into perf_bot_findings (run_date, kind, severity, headline)
      values (v_today, 'production_feed_stale', 'high', 'Native production has stopped posting. Goal numbers below may be understated until it resumes.');
    end if;

    insert into perf_bot_findings (run_date, kind, severity, headline, dollars, detail)
    values (v_today, 'goal_pace', case when (g->>'on_pace_floor')::int * 2 < (g->>'licensed_active')::int then 'high' else 'warn' end,
      'Agents on pace for ' || to_char(v_floor, 'FM$999,999,999') || ' this month: ' || (g->>'on_pace_floor') || ' of ' || (g->>'licensed_active')
        || ' licensed. Projected total ' || to_char((g->>'projected_total')::numeric, 'FM$999,999,999') || ' against ' || to_char((g->>'floor_potential')::numeric, 'FM$999,999,999')
        || ' if every licensed agent hit the floor.',
      (g->>'floor_potential')::numeric - (g->>'projected_total')::numeric, g);

    if (g->>'licensed_silent')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'licensed_silent', 'high',
        (g->>'licensed_silent') || ' licensed agents wrote nothing in 30 days. Activating them is the biggest lever: each is ' || to_char(v_floor, 'FM$999,999,999') || ' of room.',
        jsonb_build_object('agents', (select coalesce(jsonb_agg(x->>'name'), '[]'::jsonb) from (select x from jsonb_array_elements(c->'agents') x
                                       where x->>'segment' = 'licensed_silent' order by (x->>'tenure_days')::int desc limit 10) q)));
    end if;

    for a in
      select x from jsonb_array_elements(c->'agents') x
       where x->>'segment' = 'producing' and (x->>'projected')::numeric < v_floor and (x->>'projected')::numeric >= v_floor * 0.5
       order by (x->>'gap_to_floor')::numeric asc limit 5
    loop
      insert into perf_bot_findings (run_date, kind, severity, agent_id, headline, dollars, detail)
      values (v_today, 'closest_to_floor', 'warn', (a->>'id')::uuid,
        (a->>'name') || ' is projected at ' || to_char((a->>'projected')::numeric, 'FM$999,999,999') || '. About ' || coalesce(a->>'deals_to_floor', '?')
          || ' more deals at their ' || coalesce(to_char((a->>'ticket')::numeric, 'FM$999,999,999'), '?') || ' average gets them to ' || to_char(v_floor, 'FM$999,999,999') || '.',
        (a->>'gap_to_floor')::numeric, a);
    end loop;

    if (c->'downline'->>'no_downline')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'downline_gap', 'warn',
        (c->'downline'->>'no_downline') || ' of ' || (c->'downline'->>'agents_90d_plus') || ' agents past 90 days have no one under them. '
          || (c->'downline'->'by_reason'->>'not_producing') || ' are not producing, ' || (c->'downline'->'by_reason'->>'no_applicants') || ' never referred an applicant, '
          || (c->'downline'->'by_reason'->>'applicants_not_hired') || ' referred applicants who were not hired.', c->'downline'->'by_reason');
    end if;

    select count(*), coalesce(round(100.0 * count(*) filter (where lead_type = 'unknown') / nullif(count(*), 0)), 0)
      into v_total, v_unknown from perf_deal_facts() where posted_date >= v_today - 30;
    if v_total > 0 and v_unknown >= 30 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'lead_type_unknown', 'warn', v_unknown::bigint::text || '% of the last 30 days of deals have no lead type, so close rate by lead type is still partly blind.',
              jsonb_build_object('deals_30d', v_total, 'unknown_pct', v_unknown));
    end if;

    if (c->'policy'->>'native_flagged')::int > 0 or (ret->>'returned')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, dollars, detail)
      values (v_today, 'policy_numbers', 'warn',
        (c->'policy'->>'native_flagged') || ' agent-posted deals (' || to_char((c->'policy'->>'native_flagged_ap')::numeric, 'FM$999,999,999') || ') have no real policy number. '
          || (c->'policy'->>'returned') || ' are in the agent''s leads to confirm (' || (ret->>'returned') || ' new today). '
          || (c->'policy'->>'import_placeholder') || ' AgentLink imports have placeholder numbers and are flagged only.',
        (c->'policy'->>'native_flagged_ap')::numeric, ret);
    end if;

    -- One digest a day, the three biggest findings, to Sam's phone only.
    if coalesce((select value from system_settings where key = 'perf_bot_alerts'), 'true') = 'true'
       and not exists (select 1 from bot_alerts b where b.event_type = 'perf_bot_digest' and b.created_at::date = now()::date) then
      for a in select to_jsonb(f) from (select kind, headline from perf_bot_findings where run_date = v_today
                 order by case severity when 'high' then 0 when 'warn' then 1 else 2 end, dollars desc nulls last limit 3) f
      loop
        v_n := v_n + 1;
        v_lines := v_lines || '<p>' || v_n::text || '. ' || replace(replace(a->>'headline', '<', ' '), '>', ' ') || '</p>';
      end loop;
      if v_n > 0 then
        insert into bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
        values ('perf_bot', 'perf_bot_digest', 'celebrate', 'Performance bot - ' || v_today::text, v_lines, null,
                'https://apex-financial.org/dashboard/admin/performance-bot', array['ntfy']::text[]);
      end if;
    end if;

    v_summary := jsonb_build_object('on_pace', g->'on_pace_floor', 'licensed_silent', g->'licensed_silent', 'returned', ret, 'stale', v_stale,
                                    'findings', (select count(*) from perf_bot_findings where run_date = v_today));
    insert into perf_bot_runs (ok, summary) values (true, v_summary);
    return v_summary;
  exception when others then
    insert into perf_bot_runs (ok, error) values (false, left(sqlerrm, 500));
    raise;
  end;
end $$;

-- ───────────────────────────── grants: the page reads one function; everything else is server-side ─────────────────────────────
revoke all on function public.perf_deal_facts() from public, anon, authenticated;
revoke all on function public.perf_bot_core(numeric, numeric) from public, anon, authenticated;
revoke all on function public.fn_perf_return_deals_to_leads(boolean) from public, anon, authenticated;
revoke all on function public.fn_perf_bot_run() from public, anon, authenticated;
revoke all on function public.perf_bot_summary() from public, anon;
grant execute on function public.perf_bot_summary() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('perf-bot-daily', '30 15 * * *', 'select public.fn_perf_bot_run()');
  end if;
end $$;
