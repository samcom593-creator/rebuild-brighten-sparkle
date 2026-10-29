-- OVERHAUL-resells (2026-10-29): Easy Resells and Book Flips rank by evidence, and Easy Resells loads in
-- half a second instead of seven.
--
-- Sam (2026-10-28): "Easy Resells and Book Flips: cleaner cards, and rank opportunities by evidence
-- (recently lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each
-- one ranks where it does."
--
-- 1. public.resell_evidence(p_phones, p_names): what the dialer and the sold-call packets hold for each
--    number and each name the page asks about. One row per (kind, match_key):
--      kind 'phone', match_key the last ten digits (readymode_dialer_calls.lead_phone10):
--        dials             dialer calls to the number
--        answered          of those, the calls somebody answered (any disposition but 'Not Available';
--                          on 2026-10-29 the dialer's dispositions were Not Available, Do Not Call, the
--                          objections, Completed Sale, Appointments, I Give Up, Spanish Speaker and transfers)
--        last_answered_at  the latest of those
--      kind 'name', match_key first + last name, lower case, letters and digits (lead_name_key; six
--        characters at least, so two short names cannot collide); dials and answered are null for a name.
--      both kinds:
--        sold_calls        distinct ReadyMode calls that ended 'Completed Sale', on the number or name, or
--                          whose booking packet carries this client phone or client name
--        last_sold_at      the latest of those calls
--        gave_ssn_and_bank a booking packet holding both an SSN and a bank account, or a transcript where the
--                          client said both (readymode_call_insights.gave_ssn and gave_bank)
--    SECURITY INVOKER: it reads readymode_dialer_calls, readymode_booking_packets and readymode_call_insights
--    as the viewer, so their row security decides what counts. Admins and Aisha (can_view_sold_calls) see
--    everything; a manager sees the calls of their own downline and no packet or transcript; anyone else
--    sees their own calls. Nothing new is exposed: every row it counts is a row the viewer can already
--    select. Ordered by kind and key so the page can read it 1,000 rows at a time without overlap.
--    Measured as Sam on 2026-10-29 for the whole book (1,394 numbers, 1,519 names): about 650 ms.
--    The page turns it into points (src/lib/resellEvidence.ts): SSN and bank 40, sold on a call 30, lapse
--    pending 25 (lapsed 20 / 15 / 10 by how recently the policy started), answered 15, three or more calls
--    nobody answered -10; a match on the name only counts half.
--
-- 2. public.easy_resells(): the same rows, the same columns, the same order, about 15 times faster.
--    Proven in a rolled-back transaction as Sam: the old and new functions returned the same 762 rows,
--    row for row (EXCEPT ALL both ways empty), in 7,495 ms before and 478 ms after. The page used to wait
--    on it for about 7 seconds. EXPLAIN ANALYZE showed where the time went:
--      - the dedup's NOT IN (blocked) was pushed into each branch of the UNION and run as a plain subplan,
--        scanning 2,126 blocked numbers for every candidate row, and the blocked set itself (a scan of all
--        ~140,000 dialer calls through lower(btrim(disposition))) was computed three times (~1.7 s);
--      - each sold call was checked against every deal with a regular expression on deals.client_phone,
--        all three "already posted" tests OR-ed in one subquery (~1.2 s);
--      - v_objection_calls.sold_later compares every objection call with every sale through a regular
--        expression (~3.5 s).
--    Now: blocked and the Do Not Call dispositions are materialized once, the disposition read through
--    idx_rmd_disposition; the dedup uses NOT EXISTS (a hash anti join; the blocked numbers are never null,
--    so it is the same test as NOT IN); every live deal's phone, policy number and name are computed once
--    (deal_keys) and the three "already posted" tests are three NOT EXISTS, the same as NOT EXISTS of their
--    OR; "bought later" reads the dialer's indexed lead_phone10, which equals the view's
--    right(digits(lead_phone), 10) on all 139,813 calls (checked 2026-10-29: 0 mismatches); the
--    "rewritten since" test reads the active policies once (active_keys). Grants are unchanged.

create or replace function public.easy_resells()
 returns table(item_key text, bucket text, tier integer, reason text, client_name text, phone text, state text, age_years integer, carrier text, product text, monthly_premium numeric, policy_status text, agent_name text, agent_group text, event_at timestamp with time zone, call_id uuid, work_status text, flip_carrier text, flip_policy_number text, flip_client_key text, flip_status text, callback_at timestamp with time zone, attempts integer, last_touch_at timestamp with time zone, dob date, packet_id uuid)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  -- The dialer's Do Not Call numbers. The disposition is read through its index: the distinct
  -- dispositions are few (12 on 2026-10-29), so the normalised match picks the spellings and the
  -- index finds the calls, instead of normalising all ~140,000 calls on every read.
  dnc_dispositions as materialized (
    select d.disposition
    from (select distinct c.disposition from public.readymode_dialer_calls c where c.disposition is not null) d
    where lower(btrim(d.disposition)) = 'do not call'
  ),
  -- A person drops out of the queue entirely (every policy, every call) once any row for their number
  -- is closed: resold, not interested, do not call, bad number, an appointment set, a callback that is
  -- not due yet, or a sold/objection call marked resold or pushback. Otherwise marking one policy
  -- "not interested" would bring the same person back under their next policy.
  -- Materialized: it is read once per branch below, and was computed three times (about 1.7 s).
  blocked as materialized (
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
    where c.disposition in (select x.disposition from dnc_dispositions x)
  ),
  -- Every live deal's match keys, computed once (the checks below used to run a regular expression
  -- over every deal for every candidate row, about 2 s in all).
  deal_keys as materialized (
    select right(regexp_replace(coalesce(d.client_phone, ''), '\D', '', 'g'), 10) as ph10,
           btrim(d.policy_number) as pn,
           lower(btrim(d.client_first_name)) as fn,
           lower(btrim(d.client_last_name)) as ln,
           coalesce(d.posted_at, d.created_at) as at
    from public.deals d
    where d.duplicate_of_deal_id is null
  ),
  -- Tier 1: the client gave SSN and bank on a sold call and no deal was ever posted for them
  -- (no deal with the packet's policy number, the same phone, or the same first and last name).
  sold as (
    select
      'call:' || c.id::text,
      -- Vantage deals have not reached public.deals since 2026-08-07, so for a Vantage agent's sale
      -- "no deal posted" proves nothing: it is a Vantage client, worded as one.
      case when public.is_vantage_agent(c.agent_id) then 'vantage' else 'ready_to_finish' end::text,
      case when public.is_vantage_agent(c.agent_id) then 4 else 1 end,
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
        select 1 from deal_keys d
        where nullif(btrim(coalesce(p.booked_policy_number, p.policy_number)), '') is not null
          and d.pn = btrim(coalesce(p.booked_policy_number, p.policy_number))
      )
      and not exists (
        select 1 from deal_keys d
        where length(right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10)) = 10
          and d.ph10 = right(regexp_replace(coalesce(nullif(btrim(c.lead_phone), ''), p.client_phone, ''), '\D', '', 'g'), 10)
      )
      and not exists (
        select 1 from deal_keys d
        where nullif(btrim(coalesce(p.client_first_name, c.lead_first_name)), '') is not null
          and nullif(btrim(coalesce(p.client_last_name, c.lead_last_name)), '') is not null
          and d.fn = lower(btrim(coalesce(p.client_first_name, c.lead_first_name)))
          and d.ln = lower(btrim(coalesce(p.client_last_name, c.lead_last_name)))
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
  -- The active policies, keyed by number and client, for the "already rewritten" check below.
  active_keys as materialized (
    select wl.ph10, wl.client_key, lower(btrim(wl.policy_number)) as pn,
           coalesce(wl.effective_date, wl.posted_date) as eff, wl.agent_gone
    from wl
    where wl.status_group = 'active' and length(wl.ph10) = 10
  ),
  -- Tiers 2-5, from the book (v_book_flip_worklist, the same rows and call outcomes Book Flips shows):
  -- 2 lapsing; 3 dropped in the last 18 months (declined, withdrawn, not taken, cancelled: they wanted
  -- coverage and have none); 4 written by a Vantage agent; 5 the writing agent left Apex.
  -- Only rows still to work: to call, no answer, or a callback that is due (do not call, closed
  -- and resold people are removed below, by number).
  book as (
    select
      'book:' || w.flip_key,
      case when w.status_group = 'lapsing' then 'lapsing'
           when w.status_group = 'dead' then 'dropped'
           when w.agent_group = 'Vantage' then 'vantage'
           else 'agent_left' end::text,
      case when w.status_group = 'lapsing' then 2
           when w.status_group = 'dead' then 3
           when w.agent_group = 'Vantage' then 4
           else 5 end,
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
        select 1 from active_keys a
        where length(w.ph10) = 10
          and a.ph10 = w.ph10
          and a.client_key = w.client_key
          and a.pn <> lower(btrim(w.policy_number))
          and a.eff > coalesce(w.effective_date, w.posted_date)
          and (w.status_group in ('dead', 'lapsing') or not a.agent_gone)
      )
  ),
  -- Tier 6: objection calls that showed real interest and did not buy later.
  warm as (
    select
      'call:' || o.call_id::text,
      'warm_objection'::text,
      6,
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
    -- "Bought later" is v_objection_calls.sold_later, read through the dialer's indexed phone key:
    -- any Completed Sale on the same 10-digit number. The view's own column compares every
    -- objection call against every sale with a regular expression (about 3.5 s here).
    where not exists (
        select 1 from public.readymode_dialer_calls s
        where s.disposition = 'Completed Sale'
          and rc.lead_phone10 is not null
          and s.lead_phone10 = rc.lead_phone10
      )
      and coalesce(o.work_status, '') not in ('resold', 'pushback')
      and (coalesce(o.spouse_coverage, false) or coalesce(o.mortgage_protection, false) or coalesce(o.price_objection, false)
           or coalesce(o.said_ssn, false) or coalesce(o.said_bank, false))
      -- A deal posted on this number after the call means they bought after all.
      and not exists (
        select 1 from deal_keys d
        where length(right(regexp_replace(coalesce(o.lead_phone, ''), '\D', '', 'g'), 10)) = 10
          and d.ph10 = right(regexp_replace(coalesce(o.lead_phone, ''), '\D', '', 'g'), 10)
          and d.at >= o.call_at
      )
  ),
  all_rows (item_key, bucket, tier, reason, client_name, phone, state, age_years, carrier, product, monthly_premium,
            policy_status, agent_name, agent_group, event_at, call_id, work_status, flip_carrier, flip_policy_number,
            flip_client_key, flip_status, callback_at, attempts, last_touch_at, dob, packet_id) as (
    select * from sold union all select * from book union all select * from warm
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
      and not exists (select 1 from blocked b where b.ph10 = right(regexp_replace(x.phone, '\D', '', 'g'), 10))
    order by right(regexp_replace(x.phone, '\D', '', 'g'), 10), x.tier, x.event_at desc nulls last, x.item_key
  )
  select d.item_key, d.bucket, d.tier, d.reason, d.client_name, d.phone, d.state, d.age_years, d.carrier, d.product,
         d.monthly_premium, d.policy_status, d.agent_name, d.agent_group, d.event_at, d.call_id, d.work_status,
         d.flip_carrier, d.flip_policy_number, d.flip_client_key, d.flip_status, d.callback_at, d.attempts, d.last_touch_at,
         d.dob, d.packet_id
  from dedup d
  -- Easiest tier first; inside a tier, people nobody has called yet come first, then the ones called
  -- longest ago, newest policy or call first. (The page ranks by evidence: src/lib/resellEvidence.ts.)
  order by d.tier, (d.last_touch_at is not null), d.last_touch_at nulls first, d.event_at desc nulls last, d.item_key;
end
$function$;

revoke all on function public.easy_resells() from public, anon;
grant execute on function public.easy_resells() to authenticated, service_role;

create or replace function public.resell_evidence(p_phones text[], p_names text[] default '{}'::text[])
returns table(
  kind text,
  match_key text,
  dials integer,
  answered integer,
  last_answered_at timestamptz,
  sold_calls integer,
  last_sold_at timestamptz,
  gave_ssn_and_bank boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with
  -- The asked numbers as ten-digit keys and the asked names as letters-and-digits keys, the way the
  -- dialer files its leads (fn_rmd_match_keys).
  ph as (
    select distinct right(d, 10) as k
    from (select regexp_replace(coalesce(x, ''), '[^0-9]', '', 'g') as d from unnest(coalesce(p_phones, '{}'::text[])) as x) s
    where length(d) >= 10
  ),
  nm as (
    select distinct k
    from (select nullif(regexp_replace(lower(coalesce(x, '')), '[^a-z0-9]', '', 'g'), '') as k from unnest(coalesce(p_names, '{}'::text[])) as x) s
    where length(k) >= 6
  ),
  -- Calls on those numbers and names, through idx_rmd_lead_phone10 and idx_rmd_lead_name_key. The
  -- viewer's row security decides which calls exist here.
  calls as materialized (
    select 'phone'::text as kind, c.lead_phone10 as k, c.id, c.disposition, c.call_started_at
    from public.readymode_dialer_calls c
    where c.lead_phone10 = any (array(select ph.k from ph))
    union all
    select 'name'::text, c.lead_name_key, c.id, c.disposition, c.call_started_at
    from public.readymode_dialer_calls c
    where c.lead_name_key = any (array(select nm.k from nm))
  ),
  -- Booking packets matched on their own client phone or client name: the client sometimes gives a
  -- different number than the one the dialer called.
  packets as materialized (
    select 'phone'::text as kind, right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10) as k, p.call_id,
           (p.ssn_encrypted is not null and p.bank_account_encrypted is not null) as ssn_bank
    from public.readymode_booking_packets p
    where length(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g')) >= 10
      and right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10) = any (array(select ph.k from ph))
    union all
    select 'name'::text, nullif(regexp_replace(lower(coalesce(p.client_first_name, '') || coalesce(p.client_last_name, '')), '[^a-z0-9]', '', 'g'), ''), p.call_id,
           (p.ssn_encrypted is not null and p.bank_account_encrypted is not null)
    from public.readymode_booking_packets p
    where nullif(regexp_replace(lower(coalesce(p.client_first_name, '') || coalesce(p.client_last_name, '')), '[^a-z0-9]', '', 'g'), '') = any (array(select nm.k from nm))
  ),
  sold as (
    select x.kind, x.k, x.call_id, s.call_started_at
    from (
      select c.kind, c.k, c.id as call_id from calls c where c.disposition = 'Completed Sale'
      union
      select p.kind, p.k, p.call_id from packets p where p.call_id is not null
    ) x
    left join public.readymode_dialer_calls s on s.id = x.call_id
  ),
  ssn_bank as (
    select p.kind, p.k from packets p where p.ssn_bank
    union
    select c.kind, c.k from calls c join public.readymode_booking_packets p on p.call_id = c.id
    where p.ssn_encrypted is not null and p.bank_account_encrypted is not null
    union
    select c.kind, c.k from calls c join public.readymode_call_insights i on i.call_id = c.id
    where coalesce(i.gave_ssn, false) and coalesce(i.gave_bank, false)
  ),
  per_call as (
    select c.kind, c.k,
           count(*)::integer as dials,
           count(*) filter (where c.disposition is distinct from 'Not Available')::integer as answered,
           max(c.call_started_at) filter (where c.disposition is distinct from 'Not Available') as last_answered_at
    from calls c
    group by c.kind, c.k
  ),
  per_sold as (
    select s.kind, s.k, count(distinct s.call_id)::integer as sold_calls, max(s.call_started_at) as last_sold_at
    from sold s
    group by s.kind, s.k
  ),
  keys as (
    select kind, k from calls
    union
    select kind, k from packets
  )
  select
    keys.kind,
    keys.k,
    case when keys.kind = 'phone' then coalesce(pc.dials, 0) end,
    case when keys.kind = 'phone' then coalesce(pc.answered, 0) end,
    case when keys.kind = 'phone' then pc.last_answered_at end,
    coalesce(ps.sold_calls, 0),
    ps.last_sold_at,
    exists (select 1 from ssn_bank b where b.kind = keys.kind and b.k = keys.k)
  from keys
  left join per_call pc on pc.kind = keys.kind and pc.k = keys.k
  left join per_sold ps on ps.kind = keys.kind and ps.k = keys.k
  where keys.k is not null
  order by keys.kind, keys.k;
$$;

revoke all on function public.resell_evidence(text[], text[]) from public, anon;
grant execute on function public.resell_evidence(text[], text[]) to authenticated, service_role;

comment on function public.resell_evidence(text[], text[]) is
  'OVERHAUL-resells (2026-10-29): dialer and sold-call evidence per number (kind phone, last ten digits) and per name (kind name, lower-case letters and digits): dials, answered, last_answered_at (numbers only), sold_calls, last_sold_at, gave_ssn_and_bank. SECURITY INVOKER: row security on readymode_dialer_calls, readymode_booking_packets and readymode_call_insights decides what counts. Easy Resells and Book Flips rank on it (src/lib/resellEvidence.ts).';
