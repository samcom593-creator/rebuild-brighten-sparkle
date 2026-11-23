-- ============================================================
-- MP-CARRIER-DAILY — live daily pull of Sam's two active carriers
-- (Ethos + Chubb) into the agency DB. Additive: historical carriers
-- untouched. Back-office tables (RLS on, no policies); all client
-- reads go through the is_owner()-gated carrier_command() RPC.
-- ============================================================

-- 1) per-policy comp book snapshot (Ethos compensationType=net => gross + chargebacks)
create table if not exists public.ethos_live_policies (
  snapshot_on   date        not null,
  id            text        not null,
  policy_id     text,
  policy_number text,
  payment_type  text,
  comp_bucket   text,          -- 'gross' | 'chargeback'
  amount        numeric       default 0,
  invoice_date  date,
  chargeback_date date,
  paid_to       text,
  paid_to_code  text,
  state_of_issue text,
  pulled_at     timestamptz   not null default now(),
  primary key (snapshot_on, id)
);

-- 2) per-downline-agent production (Ethos hierarchical_metrics, ALL_TIME)
create table if not exists public.ethos_live_production (
  snapshot_on            date    not null,
  partner_id             bigint  not null,
  npn                    text,
  agent_name             text,
  parent_agent_name      text,
  has_subagents          boolean,
  issued_annual_premium  numeric default 0,
  inforce_issued_premium numeric default 0,
  persistency_m4         numeric,
  persistency_m7         numeric,
  persistency_m13        numeric,
  on_advanced_pay        boolean,
  outstanding_chargeback numeric default 0,
  pulled_at              timestamptz not null default now(),
  primary key (snapshot_on, partner_id)
);

-- 3) per-carrier daily scalar metrics (two-carrier rollup top line)
create table if not exists public.carrier_live_metrics (
  snapshot_on           date    not null,
  carrier               text    not null,
  issued_premium        numeric,
  inforce_premium       numeric,
  last_30d_premium      numeric,
  prev_30d_premium      numeric,
  ytd_premium           numeric,
  policies_total        integer,
  policies_30d          integer,
  policies_7d           integer,
  placement_rate        numeric,
  personal_debt         numeric,
  rolled_up_debt        numeric,
  total_outstanding_debt numeric,
  chargeback_total      numeric,
  chargeback_count      integer,
  at_risk_count         integer,
  downline_count        integer,
  raw                   jsonb,
  pulled_at             timestamptz not null default now(),
  primary key (snapshot_on, carrier)
);

alter table public.ethos_live_policies    enable row level security;
alter table public.ethos_live_production   enable row level security;
alter table public.carrier_live_metrics    enable row level security;

-- 4) Chubb / Combined Insurance policy book (pulled via browser session)
create table if not exists public.chubb_live_policies (
  snapshot_on   date not null,
  policy_number text not null,
  insured       text,
  writing_agent text,
  product       text,
  status        text,
  eff_date      date,
  pulled_at     timestamptz not null default now(),
  primary key (snapshot_on, policy_number)
);
alter table public.chubb_live_policies enable row level security;
-- Reconciliation: carrier portal policies the agency site has no record of.
drop view if exists public.v_carrier_unaccounted;
create view public.v_carrier_unaccounted as
with le as (select max(snapshot_on) d from public.ethos_live_policies),
     lc as (select max(snapshot_on) d from public.chubb_live_policies)
select e.policy_number, 'Ethos'::text carrier, e.state_of_issue region, e.paid_to agent,
       e.invoice_date ref_date, sum(e.amount) comp_amount, null::text status
  from public.ethos_live_policies e, le
 where e.snapshot_on=le.d and e.comp_bucket='gross' and e.policy_number is not null
   and not exists (select 1 from public.v_production_canonical v where v.policy_number=e.policy_number)
 group by e.policy_number, e.state_of_issue, e.paid_to, e.invoice_date
union all
select c.policy_number, 'Chubb'::text, null, c.writing_agent, c.eff_date, null::numeric, c.status
  from public.chubb_live_policies c, lc
 where c.snapshot_on=lc.d and c.policy_number is not null
   and lower(coalesce(c.status,'')) not in ('lapsed','cancelled','canceled','declined','withdrawn','not taken','void')
   and not exists (select 1 from public.v_production_canonical v where v.policy_number=c.policy_number);

-- Owner-only RPC the frontend calls for the two-carrier command view.
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
    'chargebacks', (select coalesce(jsonb_agg(jsonb_build_object('policy_number',policy_number,'agent',paid_to,'amount',amount,'reason',payment_type,'date',chargeback_date) order by amount desc),'[]') from public.ethos_live_policies where snapshot_on=(select max(snapshot_on) from public.ethos_live_policies) and comp_bucket='chargeback'),
    'production', (select coalesce(jsonb_agg(jsonb_build_object('agent',agent_name,'npn',npn,'issued',issued_annual_premium,'inforce',inforce_issued_premium,'p13',persistency_m13,'chargeback',outstanding_chargeback) order by issued_annual_premium desc nulls last),'[]') from public.ethos_live_production where snapshot_on=(select max(snapshot_on) from public.ethos_live_production))
  ) into v; return v;
end $fn$;

-- Security posture (matches the live-catalog anon guard): owner-only via body check,
-- client access limited to authenticated; default PUBLIC/anon execute revoked.
revoke all on function public.carrier_command() from public, anon;
grant execute on function public.carrier_command() to authenticated;
