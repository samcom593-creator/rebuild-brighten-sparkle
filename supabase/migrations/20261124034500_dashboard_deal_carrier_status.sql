-- MP-CARRIER-BOOK-TRUTH part 3 (2026-11-24). Sam: "on the dashboard ... for each deal,
-- which carrier it went to, and the status of the deal, whether it's approved."
-- Every deal in the window (the production truth rows plus native deals the carrier says
-- were never placed, flagged not counted) with its carrier and the live carrier status.
create or replace function public.dashboard_deal_status(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_admin boolean := public.apex_is_admin(); v_ids uuid[]; v jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not v_admin then v_ids := public.fn_carrier_visible_agent_ids(); end if;

  with base as (
    select c.row_key, c.origin, c.agent_id, c.agent_name, c.client_name, c.carrier, c.product,
           c.policy_number, c.annual_premium, c.posted_date, true as counted
      from public.v_production_canonical c
     where c.posted_date >= p_start and c.posted_date < p_end
    union all
    select d.id::text, 'apex_native', d.agent_id, coalesce(a.display_name, 'Agent'),
           btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')),
           cr.name, d.product_sold, d.policy_number, d.annual_premium,
           (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date, false
      from public.deals d
      join public.v_carrier_dead_site_deals x on x.deal_id = d.id
      left join public.agents a on a.id = d.agent_id
      left join public.carriers cr on cr.id = d.carrier_id
     where (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date >= p_start
       and (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date < p_end
  ), scoped as (
    select b.*, coalesce(m.canonical_agent_id, b.agent_id) as canon
      from base b left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
     where v_admin or coalesce(m.canonical_agent_id, b.agent_id) = any(v_ids) or b.agent_id = any(v_ids)
  ), joined as (
    select s.*, cb.carrier as book_carrier, cb.underwriter, cb.status_bucket, cb.status_raw, cb.status_changed_on, cb.close_reason
      from scoped s
      left join lateral (
        select p.* from public.carrier_book_policies p
         where p.site_deal_id::text = s.row_key
            or (public.fn_carrier_pn_key(s.policy_number) is not null and p.policy_key = public.fn_carrier_pn_key(s.policy_number))
            or s.row_key like '%:' || p.carrier || ':' || p.policy_key
         order by (p.site_deal_id::text = s.row_key) desc limit 1
      ) cb on true
  )
  select jsonb_build_object(
    'as_of', (select max(run_at) from public.carrier_book_runs where ok),
    'deals', coalesce(jsonb_agg(jsonb_build_object(
       'key', j.row_key, 'agent_id', j.canon, 'agent', j.agent_name, 'client', nullif(j.client_name, ''),
       'carrier', coalesce(case when j.book_carrier = 'Chubb' then 'Combined' else j.book_carrier end, j.carrier),
       'underwriter', j.underwriter, 'product', j.product, 'policy_number', j.policy_number,
       'annual_premium', j.annual_premium, 'posted_date', j.posted_date, 'counted', j.counted,
       'from_portal', j.row_key like 'external-deal:carrier\_%',
       'bucket', coalesce(j.status_bucket,
                  case when lower(coalesce(j.carrier,'')) not in ('ethos','combined','chubb') then 'no_feed'
                       when j.posted_date <= (now() at time zone 'America/Phoenix')::date - 14 then 'missing'
                       else 'not_found' end),
       'label', coalesce(case when j.status_bucket is not null then public.fn_carrier_status_label(j.status_bucket) end,
                  case when lower(coalesce(j.carrier,'')) in ('ethos','combined','chubb') and j.posted_date <= (now() at time zone 'America/Phoenix')::date - 14
                         then 'Not found in carrier portal · check'
                       when lower(coalesce(j.carrier,'')) in ('ethos','combined','chubb') then 'Not in carrier portal yet'
                       else 'No carrier feed for ' || coalesce(j.carrier, 'this carrier') end),
       'status_raw', j.status_raw, 'changed_on', j.status_changed_on, 'close_reason', j.close_reason
     ) order by j.posted_date desc, j.annual_premium desc nulls last), '[]'::jsonb)
  ) into v from joined j;
  return v;
end $$;
revoke all on function public.dashboard_deal_status(date, date) from public, anon;
grant execute on function public.dashboard_deal_status(date, date) to authenticated;
