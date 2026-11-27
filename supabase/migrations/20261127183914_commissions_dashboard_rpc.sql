-- MP-COMMISSIONS-REDO (2026-11-27). Sam: "redo the commissions dashboard."
--
-- Measured before building: the Commissions tab was reconciling commission_ledger (170 rows for 16 agents,
-- none created since 2026-10-10, 166 pending summing to ~$440, all 0 to 0.5 percent override rows) against
-- contract-rate estimates, so an agent read a page of footnotes about a dead ledger. agentlink_commissions has 0
-- rows and comp_rates 0 rows, so there is still no carrier-paid feed; v_commission_grid is empty, so no advance
-- timing can be promised. What IS true and fresh: v_production_comp_truth (1,523 rows / 54 agents in 12 months,
-- direct_estimate at the agent's contract rate), carrier_book_policies (Ethos + Chubb, 640 policies with a
-- status bucket, 208 of the 1,523 production rows match one), carrier_book_chargebacks (57) and the Ethos live
-- production snapshot (48 NPNs, 12 matching agents, outstanding chargeback $6,867).
--
-- commissions_dashboard(p_agent_id): one call, one agent (the caller's own record by default; an admin or a
-- manager may pass any agent apex_can_read_agent allows), 12 months. Every deal carries its estimate and a LANE
-- from the carrier book: in_force / pending / lost / not_in_feed (carrier has a feed, policy not found) /
-- no_feed (carrier has no feed). Estimate amounts are NULL throughout when the contract rate is not on file
-- (fn_agent_contract_pct provenance unknown), never a default 60 percent dressed as a figure.
create or replace function public.commissions_dashboard(p_agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', (now() at time zone 'America/Phoenix')::date)::date;
  v_year_start date := date_trunc('year', (now() at time zone 'America/Phoenix')::date)::date;
  v_agent uuid;
  v_ids uuid[];
  v_name text;
  v_npn text;
  v_rate numeric;
  v_prov text;
  v_rate_on_file boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_agent_id is not null then
    if not public.apex_can_read_agent(p_agent_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_agent := p_agent_id;
  else
    select a.id into v_agent
      from public.agents a
     where a.user_id = v_uid
     order by (a.canonical_agent_id is null) desc, a.created_at
     limit 1;
    if v_agent is null then
      return jsonb_build_object('ok', false, 'reason', 'no_agent_record', 'as_of', now());
    end if;
  end if;

  -- The agent, its canonical record, and every record folded into that canonical.
  with canon as (
    select coalesce((select m.canonical_agent_id from public.v_agent_canonical_map m where m.agent_id = v_agent), v_agent) as cid
  )
  select array_agg(distinct x) into v_ids
    from (
      select cid from canon
      union select m.agent_id from public.v_agent_canonical_map m where m.canonical_agent_id = (select cid from canon)
      union select v_agent
    ) s(x);

  select coalesce(nullif(btrim(a.display_name), ''), nullif(btrim(p.full_name), ''), 'Agent'),
         nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '')
    into v_name, v_npn
    from public.agents a
    left join public.profiles p on p.id = a.profile_id
   where a.id = v_agent;

  -- Highest contract rate with a known provenance across the cluster; none means the rate is not on file.
  select max(f.pct), (array_agg(f.provenance order by f.pct desc nulls last))[1]
    into v_rate, v_prov
    from unnest(v_ids) u(id)
    cross join lateral public.fn_agent_contract_pct(u.id) f
   where f.pct is not null and coalesce(f.provenance, 'unknown') <> 'unknown';
  v_rate_on_file := v_rate is not null;
  if not v_rate_on_file then
    select (array_agg(f.provenance))[1] into v_prov from public.fn_agent_contract_pct(v_agent) f;
  end if;

  with rows as materialized (
    select t.row_key, t.posted_date, t.client_name, t.carrier, t.product, t.policy_number,
           t.annual_premium, t.status as deal_status, t.origin,
           case when v_rate_on_file then t.direct_estimate end as est,
           cb.carrier as book_carrier, cb.status_bucket, cb.status_raw, cb.status_changed_on,
           cb.issued_on, cb.lost_on, cb.close_reason
      from public.v_production_comp_truth t
      left join lateral (
        select p.* from public.carrier_book_policies p
         where p.site_deal_id::text = t.row_key
            or (public.fn_carrier_pn_key(t.policy_number) is not null and p.policy_key = public.fn_carrier_pn_key(t.policy_number))
            or t.row_key like '%:' || p.carrier || ':' || p.policy_key
         order by (p.site_deal_id::text = t.row_key) desc
         limit 1
      ) cb on true
     where (t.agent_id = any (v_ids) or t.raw_agent_id = any (v_ids))
       and t.origin is distinct from 'external_daily_gap'
       and t.posted_date >= v_today - 400
  ), laned as (
    select r.*,
           case
             when r.status_bucket in ('active', 'claim') then 'in_force'
             when r.status_bucket in ('pending', 'started', 'at_risk') then 'pending'
             when r.status_bucket in ('lapsed', 'not_taken', 'abandoned', 'declined', 'withdrawn', 'cancelled') then 'lost'
             when lower(coalesce(r.deal_status, '')) in ('lapsed', 'cancelled', 'chargeback', 'charged_back', 'withdrawn', 'declined', 'not_taken') then 'lost'
             when lower(coalesce(r.carrier, '')) in ('ethos', 'chubb', 'combined') then 'not_in_feed'
             else 'no_feed'
           end as lane
      from rows r
  ), year as (
    select * from laned where posted_date >= v_today - 365
  )
  select jsonb_build_object(
    'ok', true,
    'as_of', now(),
    'today', v_today,
    'agent', jsonb_build_object(
      'agent_id', v_agent, 'name', v_name, 'npn', v_npn,
      'rate_pct', v_rate, 'rate_provenance', v_prov, 'rate_on_file', v_rate_on_file,
      'record_ids', to_jsonb(v_ids)),
    'kpis', (
      select jsonb_build_object(
        'mtd_est', sum(est) filter (where posted_date >= v_month_start),
        'mtd_deals', count(*) filter (where posted_date >= v_month_start),
        'mtd_ap', coalesce(sum(annual_premium) filter (where posted_date >= v_month_start), 0),
        'last_month_est', sum(est) filter (where posted_date >= (v_month_start - interval '1 month')::date and posted_date < v_month_start),
        'last_month_deals', count(*) filter (where posted_date >= (v_month_start - interval '1 month')::date and posted_date < v_month_start),
        'ytd_est', sum(est) filter (where posted_date >= v_year_start),
        'ytd_deals', count(*) filter (where posted_date >= v_year_start),
        'ytd_ap', coalesce(sum(annual_premium) filter (where posted_date >= v_year_start), 0),
        'deals_12m', count(*),
        'ap_12m', coalesce(sum(annual_premium), 0),
        'est_12m', sum(est),
        'lanes', jsonb_build_object(
          'in_force', jsonb_build_object('n', count(*) filter (where lane = 'in_force'), 'ap', coalesce(sum(annual_premium) filter (where lane = 'in_force'), 0), 'est', sum(est) filter (where lane = 'in_force')),
          'pending', jsonb_build_object('n', count(*) filter (where lane = 'pending'), 'ap', coalesce(sum(annual_premium) filter (where lane = 'pending'), 0), 'est', sum(est) filter (where lane = 'pending')),
          'lost', jsonb_build_object('n', count(*) filter (where lane = 'lost'), 'ap', coalesce(sum(annual_premium) filter (where lane = 'lost'), 0), 'est', sum(est) filter (where lane = 'lost')),
          'not_in_feed', jsonb_build_object('n', count(*) filter (where lane = 'not_in_feed'), 'ap', coalesce(sum(annual_premium) filter (where lane = 'not_in_feed'), 0), 'est', sum(est) filter (where lane = 'not_in_feed')),
          'no_feed', jsonb_build_object('n', count(*) filter (where lane = 'no_feed'), 'ap', coalesce(sum(annual_premium) filter (where lane = 'no_feed'), 0), 'est', sum(est) filter (where lane = 'no_feed'))))
      from year),
    'months', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', to_char(m.m, 'YYYY-MM'),
               'deals', coalesce(x.deals, 0), 'ap', coalesce(x.ap, 0), 'est', x.est,
               'est_in_force', x.est_in_force, 'est_pending', x.est_pending, 'est_lost', x.est_lost, 'est_unknown', x.est_unknown)
             order by m.m), '[]'::jsonb)
        from generate_series(date_trunc('month', v_today)::date - interval '11 months', date_trunc('month', v_today)::date, interval '1 month') m(m)
        left join (
          select date_trunc('month', posted_date)::date as mm, count(*) as deals, sum(annual_premium) as ap, sum(est) as est,
                 sum(est) filter (where lane = 'in_force') as est_in_force,
                 sum(est) filter (where lane = 'pending') as est_pending,
                 sum(est) filter (where lane = 'lost') as est_lost,
                 sum(est) filter (where lane in ('not_in_feed', 'no_feed')) as est_unknown
            from laned group by 1
        ) x on x.mm = m.m::date),
    'deals', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.posted_date desc nulls last, d.row_key), '[]'::jsonb)
        from (
          select row_key, posted_date, client_name, carrier, product, policy_number, annual_premium, est, deal_status, origin, lane,
                 book_carrier, status_bucket, status_raw, status_changed_on, issued_on, lost_on, close_reason
            from laned
           order by posted_date desc nulls last, row_key
           limit 500
        ) d),
    'chargebacks', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.chargeback_on desc nulls last), '[]'::jsonb)
        from (
          select carrier, policy_number, amount, original_amount, chargeback_on, reason, status
            from public.carrier_book_chargebacks c
           where c.agent_id = any (v_ids)
              or (v_npn is not null and regexp_replace(coalesce(c.agent_npn, ''), '[^0-9]', '', 'g') = v_npn)
           order by c.chargeback_on desc nulls last
           limit 50
        ) c),
    'chargeback_open_total', (
      select coalesce(sum(c.amount), 0)
        from public.carrier_book_chargebacks c
       where (c.agent_id = any (v_ids) or (v_npn is not null and regexp_replace(coalesce(c.agent_npn, ''), '[^0-9]', '', 'g') = v_npn))
         and lower(coalesce(c.status, '')) not in ('recovered', 'cleared', 'paid', 'resolved', 'closed')),
    'ethos', (
      select to_jsonb(e)
        from (
          select snapshot_on, issued_annual_premium, inforce_issued_premium, persistency_m4, persistency_m7, persistency_m13,
                 outstanding_chargeback, on_advanced_pay
            from public.ethos_live_production e
           where v_npn is not null and regexp_replace(coalesce(e.npn, ''), '[^0-9]', '', 'g') = v_npn
           order by snapshot_on desc
           limit 1
        ) e),
    'book', jsonb_build_object(
      'last_run_at', (select max(run_at) from public.carrier_book_runs where ok),
      'carriers', (select coalesce(jsonb_agg(distinct carrier), '[]'::jsonb) from public.carrier_book_policies)),
    'sources', jsonb_build_object(
      'commission_ledger_rows', (select count(*) from public.commission_ledger l where l.agent_id = any (v_ids)),
      'paid_feed', false)
  ) into v_result;

  return v_result;
end;
$function$;
revoke all on function public.commissions_dashboard(uuid) from public, anon;
grant execute on function public.commissions_dashboard(uuid) to authenticated;