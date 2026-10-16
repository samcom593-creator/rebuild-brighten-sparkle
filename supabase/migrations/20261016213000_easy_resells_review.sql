-- PL-EASY-RESELLS review fix 2 (2026-10-16): the other confirmed findings from the adversarial review of b7ddf795.
--
-- Read access (book_flips_read, book_flip_events_read). book_flip_set started writing marks on AgentLink deals, but the
-- read policies were never widened. A manager's mark on one of those rows saved, then disappeared on reload, so someone
-- marked do-not-call came back to be dialed. 94 of the 308 new rows sit in managers' downlines. Both policies now carry
-- the same deal sources as book_flip_set. book_flip_events_read also gains the deal branch it never had, and full-book
-- readers.
--
-- v_book_flip_worklist:
--   * An AgentLink deal with no standardized status reads 'Unknown', not the importer's catch-all 'submitted', which
--     had been badging them "Not paid yet" and ranking them above in-force policies.
--   * Policy numbers that differ only by tabs or spaces no longer list twice (7 twins).
--
-- easy_resells() (dropped and recreated: two new output columns):
--   * A Vantage agent's sale is not called "never posted". Vantage deals are not in this system, so it is a Vantage
--     client. An external deal (Ayro, Vantage) by the same agent near the call also counts as posted.
--   * A person already rewritten onto a newer active policy leaves the dropped and lapsing lists.
--   * A warm call is skipped once a deal is posted on that number after it, and its Vantage tag comes from the call's
--     agent (33 Vantage warm calls had none).
--   * New columns dob (the deal form needs it) and packet_id (Resold books the sale's packet, as Sold Calls does).

drop policy if exists book_flips_read on public.book_flips;
create policy book_flips_read on public.book_flips for select to authenticated using (
  (select public.api_is_full_reader())
  or (
    public.has_role((select auth.uid()), 'manager'::public.app_role)
    and (
      exists (
        select 1 from public.agentlink_book b
        where b.carrier = book_flips.carrier
          and btrim(b.policy_number) = book_flips.policy_number
          and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = book_flips.client_key
          and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d(agent_id))
      )
      or exists (
        select 1 from public.deals nd
        join public.carriers nc on nc.id = nd.carrier_id
        where nd.source::text = any (array['apex_native', 'apex', 'agent_link'])
          and nc.name = book_flips.carrier
          and btrim(nd.policy_number) = book_flips.policy_number
          and public.book_flip_client_key(btrim(concat_ws(' ', nd.client_first_name, nd.client_last_name)), null::integer, 'deal:' || nd.id::text) = book_flips.client_key
          and nd.agent_id in (select d.agent_id from public.my_downline_agent_ids() d(agent_id))
      )
    )
  )
);

drop policy if exists book_flip_events_read on public.book_flip_events;
create policy book_flip_events_read on public.book_flip_events for select to authenticated using (
  (select public.api_is_full_reader())
  or (
    public.has_role((select auth.uid()), 'manager'::public.app_role)
    and (
      exists (
        select 1 from public.agentlink_book b
        where b.carrier = book_flip_events.carrier
          and btrim(b.policy_number) = book_flip_events.policy_number
          and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = book_flip_events.client_key
          and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d(agent_id))
      )
      or exists (
        select 1 from public.deals nd
        join public.carriers nc on nc.id = nd.carrier_id
        where nd.source::text = any (array['apex_native', 'apex', 'agent_link'])
          and nc.name = book_flip_events.carrier
          and btrim(nd.policy_number) = book_flip_events.policy_number
          and public.book_flip_client_key(btrim(concat_ws(' ', nd.client_first_name, nd.client_last_name)), null::integer, 'deal:' || nd.id::text) = book_flip_events.client_key
          and nd.agent_id in (select d.agent_id from public.my_downline_agent_ids() d(agent_id))
      )
    )
  )
);

create or replace view public.v_book_flip_worklist with (security_invoker = true) as
SELECT concat_ws('|'::text, r.carrier, r.policy_number, r.client_key) AS flip_key,
    r.carrier,
    r.policy_number,
    r.client_key,
    r.product,
    COALESCE(NULLIF(btrim(r.status), ''::text), 'Unknown'::text) AS book_status,
    COALESCE(r.is_dead, false) AS is_dead,
    sg.status_group = 'active'::text AS is_book_active,
    sg.status_group,
    r.client_name,
    r.client_first_name,
    r.client_last_name,
    COALESCE(NULLIF(btrim(cl.phone), ''::text), NULLIF(btrim(dl.client_phone), ''::text)) AS phone,
        CASE
            WHEN NULLIF(btrim(cl.phone), ''::text) IS NOT NULL THEN 'client_record'::text
            WHEN NULLIF(btrim(dl.client_phone), ''::text) IS NOT NULL THEN 'posted_deal'::text
            ELSE NULL::text
        END AS phone_source,
    COALESCE(cl.date_of_birth, dl.client_dob) AS dob,
        CASE
            WHEN COALESCE(cl.date_of_birth, dl.client_dob) IS NULL OR COALESCE(cl.date_of_birth, dl.client_dob) > t.today THEN NULL::integer
            ELSE EXTRACT(year FROM age(t.today::timestamp with time zone, COALESCE(cl.date_of_birth, dl.client_dob)::timestamp with time zone))::integer
        END AS age_years,
    NULLIF(btrim(cl.state), ''::text) AS state,
    NULLIF(btrim(cl.city), ''::text) AS city,
    COALESCE(cl.any_dnc, false) AS do_not_call,
    NULLIF(btrim(cl.best_time_to_call), ''::text) AS best_time_to_call,
    NULLIF(btrim(cl.client_timezone), ''::text) AS client_timezone,
    r.face_amount,
    r.monthly_premium,
    r.annual_premium,
    r.effective_date,
    r.posted_date,
        CASE
            WHEN r.effective_date IS NULL OR r.effective_date < '1990-01-01'::date THEN NULL::integer
            WHEN r.effective_date > t.today THEN 0
            ELSE (EXTRACT(year FROM age(t.today::timestamp with time zone, r.effective_date::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(t.today::timestamp with time zone, r.effective_date::timestamp with time zone)))::integer
        END AS months_in_force,
    r.agent_id,
    COALESCE(NULLIF(btrim(ag.display_name), ''::text), NULLIF(btrim(r.agent_name), ''::text)) AS agent_name,
    ag.status AS agent_status,
    COALESCE((ag.status = ANY (ARRAY['inactive'::text, 'terminated'::text])) OR ag.is_inactive OR ag.is_deactivated, false) AS agent_gone,
    r.imported_at,
    r.book_rows::integer AS book_rows,
    r.clients_on_number::integer AS clients_on_number,
    COALESCE(fl.flip_status, 'to_call'::text) AS flip_status,
    COALESCE(fl.attempts, 0) AS attempts,
    fl.last_contact_at,
    fl.callback_at,
    fl.notes,
    fl.resold_deal_id,
    fl.resold_policy_number,
    fl.resold_carrier,
    fl.resold_annual_premium,
    fl.updated_at AS flip_updated_at,
        CASE
            WHEN is_vantage_agent(r.agent_id) THEN 'Vantage'::text
            ELSE NULL::text
        END AS agent_group
   FROM ( SELECT k.deal_key,
            k.carrier,
            k.policy_number,
            k.client_key,
            k.product,
            k.status,
            k.is_dead,
            k.client_name,
            k.client_first_name,
            k.client_last_name,
            k.agent_id,
            k.agent_name,
            k.face_amount,
            k.monthly_premium,
            k.annual_premium,
            k.effective_date,
            k.posted_date,
            k.imported_at,
            k.pipeline_client_id,
            k.raw_policy_number,
            row_number() OVER (PARTITION BY k.carrier, k.policy_number, k.client_key ORDER BY (k.status IS NOT NULL AND (lower(btrim(k.status)) <> ALL (ARRAY[''::text, 'unknown'::text]))) DESC, k.posted_date DESC NULLS LAST, k.imported_at DESC NULLS LAST, (COALESCE(k.is_dead, false)), k.deal_key) AS rn,
            count(*) OVER (PARTITION BY k.carrier, k.policy_number, k.client_key) AS book_rows,
            array_agg(k.pipeline_client_id) OVER (PARTITION BY k.carrier, k.policy_number, k.client_key) AS pipeline_client_ids,
            dense_rank() OVER (PARTITION BY k.carrier, k.policy_number ORDER BY k.client_key) + dense_rank() OVER (PARTITION BY k.carrier, k.policy_number ORDER BY k.client_key DESC) - 1 AS clients_on_number
           FROM ( SELECT b.deal_key,
                    b.carrier,
                    btrim(b.policy_number) AS policy_number,
                    book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) AS client_key,
                    b.product,
                    b.status,
                    b.is_dead,
                    b.client_name,
                    b.client_first_name,
                    b.client_last_name,
                    b.agent_id,
                    b.agent_name,
                    b.face_amount,
                    b.monthly_premium,
                    b.annual_premium,
                    b.effective_date,
                    b.posted_date,
                    b.imported_at,
                    b.pipeline_client_id,
                    b.policy_number AS raw_policy_number
                   FROM agentlink_book b
                  WHERE NULLIF(btrim(b.policy_number), ''::text) IS NOT NULL
                UNION ALL
                 SELECT 'deal:'::text || d.id::text AS deal_key,
                    c.name AS carrier,
                    btrim(d.policy_number) AS policy_number,
                    book_flip_client_key(btrim(concat_ws(' '::text, d.client_first_name, d.client_last_name)), NULL::integer, 'deal:'::text || d.id::text) AS client_key,
                    d.product_sold AS product,
                    COALESCE(NULLIF(btrim(d.policy_status_standard::text), ''::text), CASE WHEN d.source::text <> 'agent_link'::text THEN d.status ELSE NULL::text END) AS status,
                    false AS is_dead,
                    btrim(concat_ws(' '::text, d.client_first_name, d.client_last_name)) AS client_name,
                    d.client_first_name,
                    d.client_last_name,
                    d.agent_id,
                    NULL::text AS agent_name,
                    d.face_amount,
                    d.monthly_premium,
                    d.annual_premium,
                    d.effective_date,
                    (COALESCE(d.posted_at, d.created_at) AT TIME ZONE 'America/Phoenix'::text)::date AS posted_date,
                    d.created_at AS imported_at,
                    d.pipeline_client_id,
                    d.policy_number AS raw_policy_number
                   FROM deals d
                     JOIN carriers c ON c.id = d.carrier_id
                  WHERE (d.source::text = ANY (ARRAY['apex_native'::text, 'apex'::text, 'agent_link'::text])) AND NULLIF(btrim(d.policy_number), ''::text) IS NOT NULL AND d.duplicate_of_deal_id IS NULL AND NOT (EXISTS ( SELECT 1
                           FROM agentlink_book b2
                          WHERE lower(regexp_replace(b2.policy_number, '^\s+|\s+$', '', 'g')) = lower(regexp_replace(d.policy_number, '^\s+|\s+$', '', 'g'))))) k) r
     CROSS JOIN LATERAL ( SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS today) t
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['active'::text, 'issued'::text, 'approved'::text, 'in force'::text, 'inforce'::text, 'in-force'::text]) THEN 'active'::text
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['lapsed'::text, 'lapse pending'::text, 'lapse-pending'::text, 'grace period'::text]) THEN 'lapsing'::text
                    WHEN (lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['declined'::text, 'withdrawn'::text, 'not taken'::text, 'cancelled'::text, 'canceled'::text, 'terminated'::text, 'postponed'::text, 'rescinded'::text, 'surrendered'::text, 'deceased'::text, 'closed'::text, 'incomplete'::text])) OR COALESCE(r.is_dead, false) THEN 'dead'::text
                    WHEN lower(COALESCE(btrim(r.status), ''::text)) = ANY (ARRAY['pending'::text, 'in review'::text, 'submitted'::text, 'underwriting'::text, 'issued, not paid'::text, 'approved, not issued'::text]) THEN 'pending'::text
                    ELSE 'unknown'::text
                END AS status_group) sg
     LEFT JOIN LATERAL ( SELECT a.display_name,
            a.status::text AS status,
            a.is_inactive,
            a.is_deactivated
           FROM agents a
          WHERE a.id = r.agent_id
          ORDER BY a.id
         LIMIT 1) ag ON true
     LEFT JOIN LATERAL ( SELECT c.phone,
            c.date_of_birth,
            c.state,
            c.city,
            c.best_time_to_call,
            c.client_timezone,
            bool_or(c.do_not_call) OVER () AS any_dnc
           FROM agentlink_clients c
          WHERE c.insuracloud_pipeline_client_id = ANY (r.pipeline_client_ids)
          ORDER BY (NULLIF(btrim(c.phone), ''::text) IS NOT NULL) DESC, (c.insuracloud_pipeline_client_id = r.pipeline_client_id) DESC, c.updated_at DESC NULLS LAST, c.id
         LIMIT 1) cl ON true
     LEFT JOIN LATERAL ( SELECT d.client_phone,
            d.client_dob
           FROM deals d
          WHERE (NULLIF(btrim(cl.phone), ''::text) IS NULL OR cl.date_of_birth IS NULL) AND (d.policy_number = ANY (ARRAY[r.policy_number, r.raw_policy_number, regexp_replace(r.raw_policy_number, '^\s+|\s+$', '', 'g')])) AND book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text) = r.client_key
          ORDER BY (NULLIF(btrim(d.client_phone), ''::text) IS NOT NULL) DESC, d.updated_at DESC NULLS LAST, d.id
         LIMIT 1) dl ON true
     LEFT JOIN LATERAL ( SELECT f.flip_status,
            f.attempts,
            f.last_contact_at,
            f.callback_at,
            f.notes,
            f.resold_deal_id,
            f.resold_policy_number,
            f.resold_carrier,
            f.resold_annual_premium,
            f.updated_at
           FROM book_flips f
          WHERE f.carrier = r.carrier AND f.policy_number = r.policy_number AND f.client_key = r.client_key
          ORDER BY f.updated_at DESC
         LIMIT 1) fl ON true
  WHERE r.rn = 1 AND ( SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name])));

drop function if exists public.easy_resells();

create function public.easy_resells()
returns table (
  item_key text,
  bucket text,
  tier integer,
  reason text,
  client_name text,
  phone text,
  state text,
  age_years integer,
  carrier text,
  product text,
  monthly_premium numeric,
  policy_status text,
  agent_name text,
  agent_group text,
  event_at timestamptz,
  call_id uuid,
  work_status text,
  flip_carrier text,
  flip_policy_number text,
  flip_client_key text,
  flip_status text,
  callback_at timestamptz,
  attempts integer,
  last_touch_at timestamptz,
  dob date,
  packet_id uuid
)
language plpgsql
stable
security definer
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

revoke all on function public.easy_resells() from public, anon;
grant execute on function public.easy_resells() to authenticated, service_role;

notify pgrst, 'reload schema';
