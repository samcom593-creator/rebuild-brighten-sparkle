-- Group labels are fixed enums; no agent/client/policy identifiers or free text leave the database.
with ledger_groups as (
  select case when status in ('pending','paid','clawed_back','voided') then status else 'other' end as status,
    case when rate_source in ('override','contract','carrier_default','schedule','carrier_schedule') then rate_source else 'other' end as rate_source,
    count(*) as rows,
    count(*) filter(where actual_paid_date is not null) as dated_paid_rows,
    coalesce(sum(amount),0) as amount,
    coalesce(sum(amount) filter(where actual_paid_date is not null),0) as dated_paid_amount
  from public.commission_ledger group by 1,2
), chargeback_groups as (
  select case when carrier in ('Ethos','Chubb','Combined') then carrier else 'other' end as carrier,
    case when source in ('comp_ledger','debt_outstanding') then source else 'other' end as source,
    count(*) as rows, coalesce(sum(amount),0) as amount,
    count(*) filter(where agent_id is null) as unassigned_rows,
    coalesce(sum(amount) filter(where agent_id is null),0) as unassigned_amount
  from public.carrier_book_chargebacks group by 1,2
)
select jsonb_build_object(
  'commission_ledger', coalesce((select jsonb_agg(to_jsonb(l) order by status,rate_source) from ledger_groups l),'[]'::jsonb),
  'agentlink', (select jsonb_build_object(
    'rows',count(*),'rows_with_paid_date',count(*) filter(where paid_at is not null),
    'rows_with_positive_paid_amount',count(*) filter(where paid_amount > 0),
    'dated_paid_rows',count(*) filter(where paid_at is not null and paid_amount > 0),
    'dated_paid_amount',coalesce(sum(paid_amount) filter(where paid_at is not null and paid_amount > 0),0),
    'latest_statement',max(statement_date)) from public.agentlink_commissions),
  'carrier_chargebacks',coalesce((select jsonb_agg(to_jsonb(c) order by carrier,source) from chargeback_groups c),'[]'::jsonb)
) as finances
