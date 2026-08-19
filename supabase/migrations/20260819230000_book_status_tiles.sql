-- 2026-08-19 (Sam, exact Agent Cloud): the POLICY STATUS 10-tile grid on the
-- Production page, sourced from the real book (agentlink_book) mapped to Agent
-- Cloud's status buckets. Applied live via bot-sql.
create or replace view public.v_book_status_tiles as
select
  case
    when status='Active' then 'active'
    when status in ('Issued','Approved') then 'issued_not_paid'
    when status in ('In Review','Pending') then 'in_review'
    when status='Lapse Pending' then 'lapse_pending'
    when status='Lapsed' then 'lapsed'
    when status='Cancelled' then 'cancelled'
    when status='Withdrawn' then 'withdrawn'
    when status in ('Not Taken','Declined') then 'not_taken'
    when status='Postponed' then 'postponed'
    else 'carrier_na'
  end as bucket,
  count(*)::int as n,
  round(sum(annual_premium)::numeric,0) as alp
from agentlink_book
group by 1;
grant select on public.v_book_status_tiles to authenticated, anon;
