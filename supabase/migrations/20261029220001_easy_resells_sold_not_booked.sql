-- MP-310 (2026-10-29): Easy Resells gains tier 2, "Bought, never booked" (bucket sold_not_booked): a dialer sale
-- that never reached the book or the posted deals, where the call did not capture a usable SSN and bank, or no
-- booking packet was built. Tier 1 (SSN and bank in hand) is unchanged; lapsing, dropped, Vantage, agent left
-- and warm calls move down one tier (3 to 7). The blocked set, the dialable-number rule and one row per phone
-- apply to the new rows as to every other (apex-doctor Check #103). Before: easy_resells.before.sql in 310-tools.
CREATE OR REPLACE FUNCTION public.easy_resells()
 RETURNS TABLE(item_key text, bucket text, tier integer, reason text, client_name text, phone text, state text, age_years integer, carrier text, product text, monthly_premium numeric, policy_status text, agent_name text, agent_group text, event_at timestamp with time zone, call_id uuid, work_status text, flip_carrier text, flip_policy_number text, flip_client_key text, flip_status text, callback_at timestamp with time zone, attempts integer, last_touch_at timestamp with time zone, dob date, packet_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not public.can_view_sold_calls() then
    raise exception 'Not allowed to read the resell queue.' using errcode = '42501';
  end if;

  return query
  with
  wl as materialized (
    select w.*, right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10) as ph10
    from public.v_book_flip_worklist w
  ),
  -- A person drops out of the queue entirely (every policy, every call) once any row for their number
  -- is closed: resold, not interested, do not call, bad number, an appointment set, a callback that is
  -- not due yet, or a sold/objection call marked resold or pushback. Otherwise marking one policy
  -- "not interested" would bring the same person back under their next policy.
  blocked as (
    select wl.ph10 from wl
    where length(wl.ph10) = 10
      and (wl.do_not_call
           or wl.flip_status in ('resold', 'not_interested', 'do_not_call', 'bad_number', 'appointment')
           or (wl.flip_status = 'callback' and wl.callback_at > now()))
    union
    select right(regexp_replace(coalesce(c.lead_phone, ''), '\D', '', 'g'), 10)
    from public.readymode_dialer_calls c
    join public.sold_call_work sw on sw.call_id = c.id
    where sw.status in ('resold', 'pushback')
    union
    -- The dialer's own opt-out: any call on this number dispositioned Do Not Call (1,267 numbers on
    -- 2026-10-16). The person asked not to be called; nothing on this page may offer them a Call button.
    select right(regexp_replace(coalesce(c.lead_phone, ''), '\D', '', 'g'), 10)
    from public.readymode_dialer_calls c
    where lower(btrim(c.disposition)) = 'do not call'
  ),
  -- Tier 1: the client gave SSN and bank on a sold call and no deal was ever posted for them
  -- (no deal with the packet's policy number, the same phone, or the same first and last name).
  sold as (
    select
      'call:' || c.id::text,
      -- Vantage deals have not reached public.deals since 2026-08-07, so for a Vantage agent's sale
      -- "no deal posted" proves nothing: it is a Vantage client, worded as one.
      case when public.is_vantage_agent(c.agent_id) then 'vantage' else 'ready_to_finish' end::text,
      case when public.is_vantage_agent(c.agent_id) then 5 else 1 end,
      case when public.is_vantage_agent(c.agent_id)
        then 'Gave SSN and bank on a sold call, and their agent moved to Vantage, whose deals are not in this system. Check whether the application went in.'
        else 'Gave SSN and bank on the call, and no deal was ever posted. Finish the application.' end::text,
      nullif(btrim(concat_ws(' ', coalesce(nullif(btrim(p.client_first_name), ''), c.lead_first_name),
                                  coalesce(nullif(btrim(p.client_last_name), ''), c.lead_last_name))), ''),
      coalesce(nullif(btrim(c.lead_phone), ''), nullif(btrim(p.client_phone), '')),
      nullif(btrim(p.client_state), ''),
      case when p.client_dob is null or p.client_dob < date '1901-01-01' or p.client_dob > current_date then null::integer
           else extract(year from age(current_date, p.client_dob))::integer end,
      p.carrier::text,
      p.product::text,
      p.monthly_premium::numeric,
      'Sold on the call'::text,
      coalesce(nullif(btrim(a.display_name), ''), c.agent_raw)::text,
      case when public.is_vantage_agent(c.agent_id) then 'Vantage'::text end,
      c.call_started_at::timestamptz,
      c.id,
      w.status::text,
      null::text, null::text, null::text, null::text, null::timestamptz, null::integer,
      w.updated_at::timestamptz,
      case when p.client_dob between date '1901-01-01' and current_date then p.client_dob end,
      p.id
    from public.readymode_dialer_calls c
    join public.readymode_booking_packets p on p.call_id = c.id
    left join public.sold_call_work w on w.call_id = c.id
    left join public.agents a on a.id = c.agent_id
    where c.disposition = 'Completed Sale'
      and p.ssn_encrypted is not null
      and p.bank_account_encrypted is not null
      and p.status <> 'booked'
      and coalesce(w.status, '') not in ('resold', 'pushback')
      and not exists (
        select 1 from public.deals d
        where d.duplicate_of_deal_id is null
          and (
            (nullif(btrim(coalesce(p.booked_policy_number, p.policy_number)), '') is not null
              and btrim(d.policy_number) = btrim(coalesce(p.booked_policy_number, p.policy_number)))
            or (length(right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10)) = 10
              and right(regexp_replace(coalesce(d.client_phone, ''), '\D', '', 'g'), 10)
                = right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10))
            or (nullif(btrim(coalesce(p.client_first_name, c.lead_first_name)), '') is not null
              and nullif(btrim(coalesce(p.client_last_name, c.lead_last_name)), '') is not null
              and lower(btrim(d.client_first_name)) = lower(btrim(coalesce(p.client_first_name, c.lead_first_name)))
              and lower(btrim(d.client_last_name)) = lower(btrim(coalesce(p.client_last_name, c.lead_last_name))))
          )
      )
      -- ...nor an external deal (Ayro, Vantage) by the same agent (or their duplicate row), within three
      -- days of the call, at the packet's premium and carrier.
      and not exists (
        select 1
        from public.production_external_deals e
        left join public.agents ea on ea.id = e.agent_id
        left join public.agents ca on ca.id = c.agent_id
        where coalesce(e.status, '') <> 'duplicate'
          and (e.agent_id = c.agent_id
               or ea.canonical_agent_id = c.agent_id
               or ca.canonical_agent_id = e.agent_id
               or (ea.canonical_agent_id is not null and ea.canonical_agent_id = ca.canonical_agent_id))
          and coalesce(e.occurred_at, e.posted_date::timestamptz)
              between c.call_started_at - interval '1 hour' and coalesce(c.call_ended_at, c.call_started_at) + interval '3 days'
          and p.monthly_premium is not null and e.monthly_premium = p.monthly_premium
          and (nullif(btrim(p.carrier), '') is null
               or left(lower(regexp_replace(e.carrier, '[^a-zA-Z]', '', 'g')), 5)
                = left(lower(regexp_replace(p.carrier, '[^a-zA-Z]', '', 'g')), 5))
      )
  ),
  -- Tier 2 (MP-310, 2026-10-29): bought on a dialer call and never booked, where the call did not capture
  -- both SSN and bank, or no booking packet was built. Tier 1 holds the calls that did capture both. Never
  -- reached the book (v_sold_call_book_match), no posted deal by policy number, phone or name, no outside
  -- deal at the packet's premium and carrier. Without a packet premium an outside deal cannot be matched,
  -- so an outside deal by the same agent within 3 days is said out loud instead of hiding the person.
  unbooked as (
    select
      'call:' || c.id::text,
      case when public.is_vantage_agent(c.agent_id) then 'vantage' else 'sold_not_booked' end::text,
      case when public.is_vantage_agent(c.agent_id) then 5 else 2 end,
      (case
        when public.is_vantage_agent(c.agent_id)
          then 'Bought on a call, and their agent moved to Vantage, whose deals are not in this system. Check whether the application went in.'
        when p.id is null
          then 'Bought on the call, and no application was found in the book or the posted deals. Hear the call, then call back to finish it.'
        when p.ssn_encrypted is null and p.bank_account_encrypted is null
          then 'Bought on the call, but no usable SSN or bank came through on the call and no deal was ever posted. Call back to finish the application.'
        when p.ssn_encrypted is null
          then 'Bought on the call and gave their bank, but no usable SSN came through and no deal was ever posted. Call back to finish the application.'
        else 'Bought on the call and gave their SSN, but no usable bank came through and no deal was ever posted. Call back to finish the application.'
      end
      || case when x.near and not public.is_vantage_agent(c.agent_id)
              then ' Their agent posted an Ayro deal within 3 days of the call, so check Ayro first.' else '' end)::text,
      nullif(btrim(concat_ws(' ', coalesce(nullif(btrim(p.client_first_name), ''), c.lead_first_name),
                                  coalesce(nullif(btrim(p.client_last_name), ''), c.lead_last_name))), ''),
      coalesce(nullif(btrim(c.lead_phone), ''), nullif(btrim(p.client_phone), '')),
      nullif(btrim(p.client_state), ''),
      case when p.client_dob is null or p.client_dob < date '1901-01-01' or p.client_dob > current_date then null::integer
           else extract(year from age(current_date, p.client_dob))::integer end,
      p.carrier::text,
      p.product::text,
      p.monthly_premium::numeric,
      'Sold on the call'::text,
      coalesce(nullif(btrim(a.display_name), ''), c.agent_raw)::text,
      case when public.is_vantage_agent(c.agent_id) then 'Vantage'::text end,
      c.call_started_at::timestamptz,
      c.id,
      w.status::text,
      null::text, null::text, null::text, null::text, null::timestamptz, null::integer,
      w.updated_at::timestamptz,
      case when p.client_dob between date '1901-01-01' and current_date then p.client_dob end,
      p.id
    from public.readymode_dialer_calls c
    left join public.readymode_booking_packets p on p.call_id = c.id
    left join public.sold_call_work w on w.call_id = c.id
    left join public.agents a on a.id = c.agent_id
    cross join lateral (
      select exists (
        select 1
        from public.production_external_deals e
        left join public.agents ea on ea.id = e.agent_id
        left join public.agents ca on ca.id = c.agent_id
        where coalesce(e.status, '') <> 'duplicate'
          and (e.agent_id = c.agent_id
               or ea.canonical_agent_id = c.agent_id
               or ca.canonical_agent_id = e.agent_id
               or (ea.canonical_agent_id is not null and ea.canonical_agent_id = ca.canonical_agent_id))
          and coalesce(e.occurred_at, e.posted_date::timestamptz)
              between c.call_started_at - interval '1 hour' and coalesce(c.call_ended_at, c.call_started_at) + interval '3 days'
          and (p.monthly_premium is null or e.monthly_premium = p.monthly_premium)
          and (nullif(btrim(coalesce(p.carrier, '')), '') is null
               or left(lower(regexp_replace(e.carrier, '[^a-zA-Z]', '', 'g')), 5)
                = left(lower(regexp_replace(p.carrier, '[^a-zA-Z]', '', 'g')), 5))
      ) as near
    ) x
    where c.disposition = 'Completed Sale'
      and c.call_started_at >= now() - interval '548 days'
      and not (p.id is not null and p.ssn_encrypted is not null and p.bank_account_encrypted is not null)
      and coalesce(p.status, '') <> 'booked'
      and coalesce(w.status, '') not in ('resold', 'pushback')
      and not exists (select 1 from public.v_sold_call_book_match m where m.call_id = c.id and m.in_book)
      and not exists (
        select 1 from public.deals d
        where d.duplicate_of_deal_id is null
          and (
            (nullif(btrim(coalesce(p.booked_policy_number, p.policy_number)), '') is not null
              and btrim(d.policy_number) = btrim(coalesce(p.booked_policy_number, p.policy_number)))
            or (length(right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10)) = 10
              and right(regexp_replace(coalesce(d.client_phone, ''), '\D', '', 'g'), 10)
                = right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10))
            or (nullif(btrim(coalesce(p.client_first_name, c.lead_first_name)), '') is not null
              and nullif(btrim(coalesce(p.client_last_name, c.lead_last_name)), '') is not null
              and lower(btrim(d.client_first_name)) = lower(btrim(coalesce(p.client_first_name, c.lead_first_name)))
              and lower(btrim(d.client_last_name)) = lower(btrim(coalesce(p.client_last_name, c.lead_last_name))))
          )
      )
      -- The packet's premium matched an outside deal by the same agent: it went in through Ayro or Vantage.
      and not (p.monthly_premium is not null and x.near)
  ),
  -- Tiers 3-6, from the book (v_book_flip_worklist, the same rows and call outcomes Book Flips shows):
  -- 3 lapsing; 4 dropped in the last 18 months (declined, withdrawn, not taken, cancelled: they wanted
  -- coverage and have none); 5 written by a Vantage agent; 6 the writing agent left Apex.
  -- Only rows still to work: to call, no answer, or a callback that is due (do not call, closed
  -- and resold people are removed below, by number).
  book as (
    select
      'book:' || w.flip_key,
      case when w.status_group = 'lapsing' then 'lapsing'
           when w.status_group = 'dead' then 'dropped'
           when w.agent_group = 'Vantage' then 'vantage'
           else 'agent_left' end::text,
      case when w.status_group = 'lapsing' then 3
           when w.status_group = 'dead' then 4
           when w.agent_group = 'Vantage' then 5
           else 6 end,
      case
        when w.status_group = 'lapsing' then 'Policy is ' || lower(w.book_status) || '. Save it, or rewrite it before it drops.'
        when w.status_group = 'dead' then 'Policy was ' || lower(w.book_status) || ': they wanted coverage and have none. Resell with another carrier.'
        when w.agent_group = 'Vantage' then 'Written by ' || coalesce(w.agent_name, 'an agent') || ', who moved to Vantage, so nobody is servicing this client.'
        else 'Written by ' || coalesce(w.agent_name, 'an agent') || ', who is no longer with Apex.'
      end::text,
      w.client_name::text,
      w.phone::text,
      w.state::text,
      w.age_years::integer,
      w.carrier::text,
      w.product::text,
      w.monthly_premium::numeric,
      w.book_status::text,
      w.agent_name::text,
      w.agent_group::text,
      coalesce(w.effective_date, w.posted_date)::timestamptz,
      null::uuid,
      null::text,
      w.carrier::text, w.policy_number::text, w.client_key::text, w.flip_status::text, w.callback_at::timestamptz, w.attempts::integer,
      w.last_contact_at::timestamptz,
      w.dob::date,
      null::uuid
    from wl w
    where w.phone is not null
      and (w.flip_status in ('to_call', 'no_answer') or (w.flip_status = 'callback' and (w.callback_at is null or w.callback_at <= now())))
      and (
        w.status_group = 'lapsing'
        or (w.status_group = 'dead'
            and lower(btrim(w.book_status)) in ('declined', 'withdrawn', 'not taken', 'cancelled', 'canceled', 'incomplete')
            and coalesce(w.effective_date, w.posted_date) >= current_date - 548)
        or (w.agent_group = 'Vantage' and w.status_group <> 'dead')
        or (w.agent_gone and w.status_group <> 'dead')
      )
      -- The same person (number + client key) already holds a newer active policy: they were rewritten.
      -- A dropped or lapsing policy is then not "no coverage", and a newer policy from an agent still at
      -- Apex means someone services them. (A newer policy whose agent left surfaces on its own row.)
      and not exists (
        select 1 from wl a
        where length(w.ph10) = 10
          and a.ph10 = w.ph10
          and a.client_key = w.client_key
          and a.status_group = 'active'
          and lower(btrim(a.policy_number)) <> lower(btrim(w.policy_number))
          and coalesce(a.effective_date, a.posted_date) > coalesce(w.effective_date, w.posted_date)
          and (w.status_group in ('dead', 'lapsing') or not a.agent_gone)
      )
  ),
  -- Tier 7: objection calls that showed real interest and did not buy later.
  warm as (
    select
      'call:' || o.call_id::text,
      'warm_objection'::text,
      7,
      concat_ws(' ',
        case when coalesce(o.said_ssn, false) and coalesce(o.said_bank, false) then 'Gave SSN and bank.'
             when coalesce(o.said_ssn, false) then 'Gave their SSN.'
             when coalesce(o.said_bank, false) then 'Gave their bank.' end,
        case when coalesce(o.spouse_coverage, false) then 'Asked about covering the spouse.' end,
        case when coalesce(o.mortgage_protection, false) then 'Wants mortgage protection.' end,
        case when coalesce(o.price_objection, false) then 'Balked at the price.' end,
        'Did not buy (' || coalesce(o.disposition, 'objection') || ').')::text,
      nullif(btrim(concat_ws(' ', o.lead_first_name, o.lead_last_name)), '')::text,
      nullif(btrim(o.lead_phone), '')::text,
      null::text, null::integer, null::text, null::text, null::numeric,
      o.disposition::text,
      o.agent_raw::text,
      case when public.is_vantage_agent(rc.agent_id) then 'Vantage'::text end,
      o.call_at::timestamptz,
      o.call_id,
      o.work_status::text,
      null::text, null::text, null::text, null::text, null::timestamptz, null::integer,
      o.work_updated_at::timestamptz,
      null::date,
      null::uuid
    from public.v_objection_calls o
    join public.readymode_dialer_calls rc on rc.id = o.call_id
    where not coalesce(o.sold_later, false)
      and coalesce(o.work_status, '') not in ('resold', 'pushback')
      and (coalesce(o.spouse_coverage, false) or coalesce(o.mortgage_protection, false) or coalesce(o.price_objection, false)
           or coalesce(o.said_ssn, false) or coalesce(o.said_bank, false))
      -- A deal posted on this number after the call means they bought after all.
      and not exists (
        select 1 from public.deals d
        where d.duplicate_of_deal_id is null
          and length(right(regexp_replace(coalesce(o.lead_phone, ''), '\D', '', 'g'), 10)) = 10
          and right(regexp_replace(coalesce(d.client_phone, ''), '\D', '', 'g'), 10)
            = right(regexp_replace(coalesce(o.lead_phone, ''), '\D', '', 'g'), 10)
          and coalesce(d.posted_at, d.created_at) >= o.call_at
      )
  ),
  all_rows (item_key, bucket, tier, reason, client_name, phone, state, age_years, carrier, product, monthly_premium,
            policy_status, agent_name, agent_group, event_at, call_id, work_status, flip_carrier, flip_policy_number,
            flip_client_key, flip_status, callback_at, attempts, last_touch_at, dob, packet_id) as (
    select * from sold union all select * from unbooked union all select * from book union all select * from warm
  ),
  -- One row per phone, at its easiest tier; a row with no dialable number is not a resell to call.
  dedup as (
    select distinct on (right(regexp_replace(x.phone, '\D', '', 'g'), 10)) x.*
    from all_rows x
    -- A callable US number: valid area code and exchange (first digit 2-9), not a one-digit filler such
    -- as 222-222-2222 (one was shared by 13 clients), and not an 11+ digit value cut down to 10.
    where right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
      and right(regexp_replace(x.phone, '\D', '', 'g'), 10) !~ '^([0-9])\1{9}$'
      and regexp_replace(coalesce(x.phone, ''), '\D', '', 'g') ~ '^1?[0-9]{10}$'
      and right(regexp_replace(x.phone, '\D', '', 'g'), 10) not in (select b.ph10 from blocked b where b.ph10 is not null)
    order by right(regexp_replace(x.phone, '\D', '', 'g'), 10), x.tier, x.event_at desc nulls last, x.item_key
  )
  select d.item_key, d.bucket, d.tier, d.reason, d.client_name, d.phone, d.state, d.age_years, d.carrier, d.product,
         d.monthly_premium, d.policy_status, d.agent_name, d.agent_group, d.event_at, d.call_id, d.work_status,
         d.flip_carrier, d.flip_policy_number, d.flip_client_key, d.flip_status, d.callback_at, d.attempts, d.last_touch_at,
         d.dob, d.packet_id
  from dedup d
  -- Easiest tier first; inside a tier, people nobody has called yet come first, then the ones called
  -- longest ago, newest policy or call first.
  order by d.tier, (d.last_touch_at is not null), d.last_touch_at nulls first, d.event_at desc nulls last, d.item_key;
end
$function$;
