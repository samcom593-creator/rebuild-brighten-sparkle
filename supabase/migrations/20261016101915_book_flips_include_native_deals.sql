-- Book Flips listed only AgentLink policies, so clients posted in the app (155 live, all
-- recent sales) were missing from Book Flips and could not be worked there or from
-- Book of Business. Native deals not in the AgentLink book now join the worklist with
-- the same columns; output columns and security_invoker are unchanged.
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
    fl.updated_at AS flip_updated_at
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
                    d.status,
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
                    COALESCE(d.posted_at::date, d.created_at::date) AS posted_date,
                    d.created_at AS imported_at,
                    d.pipeline_client_id,
                    d.policy_number AS raw_policy_number
                   FROM deals d
                     JOIN carriers c ON c.id = d.carrier_id
                  WHERE (d.source::text = ANY (ARRAY['apex_native'::text, 'apex'::text]))
                    AND NULLIF(btrim(d.policy_number), ''::text) IS NOT NULL
                    AND d.duplicate_of_deal_id IS NULL
                    AND NOT (EXISTS ( SELECT 1 FROM agentlink_book b2
                          WHERE lower(btrim(b2.policy_number)) = lower(btrim(d.policy_number))))) k) r
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
          WHERE (NULLIF(btrim(cl.phone), ''::text) IS NULL OR cl.date_of_birth IS NULL) AND (d.policy_number = ANY (ARRAY[r.policy_number, r.raw_policy_number])) AND book_flip_client_key(concat_ws(' '::text, d.client_first_name, d.client_last_name), NULL::integer, NULL::text) = r.client_key
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

CREATE OR REPLACE FUNCTION public.book_flip_set(p_carrier text, p_policy_number text, p_status text, p_note text DEFAULT NULL::text, p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_count_attempt boolean DEFAULT false, p_resold_deal_id uuid DEFAULT NULL::uuid, p_resold_policy_number text DEFAULT NULL::text, p_resold_carrier text DEFAULT NULL::text, p_resold_annual_premium numeric DEFAULT NULL::numeric, p_client_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_policy text := btrim(coalesce(p_policy_number, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_keys text[];
  v_key text;
  v_allowed boolean;
  v_prev public.book_flips%rowtype;
  v_row public.book_flips%rowtype;
  v_had_prev boolean := false;
  v_today text := to_char((now() at time zone 'America/Phoenix')::date, 'YYYY-MM-DD');
  v_callback timestamptz;
  v_deal_policy text;
  v_deal_carrier text;
  v_deal_annual numeric;
  v_resold_policy text;
  v_resold_carrier text;
  v_resold_annual numeric;
begin
  if v_uid is null then
    raise exception 'Sign in to update the book.' using errcode = '42501';
  end if;
  if v_status not in ('to_call','no_answer','callback','appointment','resold','not_interested','do_not_call','bad_number') then
    raise exception 'Unknown flip status "%".', p_status using errcode = '22023';
  end if;
  if coalesce(p_carrier, '') = '' or v_policy = '' then
    raise exception 'A carrier and a policy number are required.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'Notes are limited to 2000 characters.' using errcode = '22023';
  end if;

  select array_agg(distinct public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key))
    into v_keys
  from public.agentlink_book b
  where b.carrier = p_carrier and btrim(b.policy_number) = v_policy;

  -- 2026-10-16: a client posted in the app (deals, not yet in the AgentLink book) is
  -- in the book too. Same client key the worklist computes for those rows.
  if v_keys is null then
    select array_agg(distinct public.book_flip_client_key(btrim(concat_ws(' ', d.client_first_name, d.client_last_name)), null::integer, 'deal:' || d.id::text))
      into v_keys
    from public.deals d
    join public.carriers c on c.id = d.carrier_id
    where d.source::text = any (array['apex_native', 'apex'])
      and c.name = p_carrier
      and btrim(d.policy_number) = v_policy
      and d.duplicate_of_deal_id is null;
  end if;
  if v_keys is null then
    raise exception 'Policy % (%) is not in the book.', v_policy, p_carrier using errcode = 'P0002';
  end if;
  if p_client_key is not null then
    if not (p_client_key = any (v_keys)) then
      raise exception 'That client is not on policy % (%).', v_policy, p_carrier using errcode = 'P0002';
    end if;
    v_key := p_client_key;
  elsif cardinality(v_keys) = 1 then
    v_key := v_keys[1];
  else
    raise exception 'Policy number % (%) is shared by % clients; say which one with p_client_key.', v_policy, p_carrier, cardinality(v_keys)
      using errcode = '22023';
  end if;

  v_allowed := public.has_role(v_uid, 'admin'::public.app_role)
    or (
      public.has_role(v_uid, 'manager'::public.app_role)
      and (exists (
        select 1 from public.agentlink_book b
        where b.carrier = p_carrier
          and btrim(b.policy_number) = v_policy
          and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = v_key
          and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
      )
      or exists (
        select 1 from public.deals nd
        join public.carriers nc on nc.id = nd.carrier_id
        where nd.source::text = any (array['apex_native', 'apex'])
          and nc.name = p_carrier
          and btrim(nd.policy_number) = v_policy
          and public.book_flip_client_key(btrim(concat_ws(' ', nd.client_first_name, nd.client_last_name)), null::integer, 'deal:' || nd.id::text) = v_key
          and nd.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
      ))
    );
  if not coalesce(v_allowed, false) then
    raise exception 'Only an admin, or the manager over this policy''s writing agent, can update it.' using errcode = '42501';
  end if;

  select * into v_prev from public.book_flips f
  where f.carrier = p_carrier and f.policy_number = v_policy and f.client_key = v_key
  for update;
  v_had_prev := found;

  if v_status = 'callback' then
    v_callback := coalesce(p_callback_at, case when v_had_prev then v_prev.callback_at end);
    if v_callback is null then
      raise exception 'Pick a callback time.' using errcode = '22023';
    end if;
  end if;

  if v_status = 'resold' then
    if p_resold_deal_id is not null then
      select d.policy_number, c.name, coalesce(d.annualized_paid_premium, d.annual_premium)
        into v_deal_policy, v_deal_carrier, v_deal_annual
      from public.deals d
      left join public.carriers c on c.id = d.carrier_id
      where d.id = p_resold_deal_id;
      if not found then
        raise exception 'Deal % does not exist.', p_resold_deal_id using errcode = 'P0002';
      end if;
    end if;
    v_resold_policy := coalesce(nullif(btrim(p_resold_policy_number), ''), nullif(btrim(v_deal_policy), ''),
                                case when v_had_prev then v_prev.resold_policy_number end);
    v_resold_carrier := coalesce(nullif(btrim(p_resold_carrier), ''), nullif(btrim(v_deal_carrier), ''),
                                 case when v_had_prev then v_prev.resold_carrier end);
    v_resold_annual := coalesce(p_resold_annual_premium, v_deal_annual,
                                case when v_had_prev then v_prev.resold_annual_premium end);
  end if;

  insert into public.book_flips as f (
    carrier, policy_number, client_key, flip_status, attempts, last_contact_at, callback_at, notes,
    resold_deal_id, resold_policy_number, resold_carrier, resold_annual_premium, updated_by, updated_at
  ) values (
    p_carrier, v_policy, v_key, v_status,
    case when p_count_attempt then 1 else 0 end,
    case when p_count_attempt then now() end,
    v_callback,
    case when v_note is not null then v_today || ': ' || v_note end,
    case when v_status = 'resold' then p_resold_deal_id end,
    v_resold_policy, v_resold_carrier, v_resold_annual,
    v_uid, now()
  )
  on conflict (carrier, policy_number, client_key) do update set
    flip_status = excluded.flip_status,
    attempts = f.attempts + case when p_count_attempt then 1 else 0 end,
    last_contact_at = case when p_count_attempt then now() else f.last_contact_at end,
    callback_at = excluded.callback_at,
    notes = case
      when v_note is not null then v_today || ': ' || v_note || coalesce(E'\n' || f.notes, '')
      else f.notes
    end,
    resold_deal_id = case when v_status = 'resold' then coalesce(p_resold_deal_id, f.resold_deal_id) end,
    resold_policy_number = excluded.resold_policy_number,
    resold_carrier = excluded.resold_carrier,
    resold_annual_premium = excluded.resold_annual_premium,
    updated_by = v_uid,
    updated_at = now()
  returning * into v_row;

  insert into public.book_flip_events (carrier, policy_number, client_key, from_status, to_status, note, detail, created_by)
  values (
    p_carrier, v_policy, v_key,
    case when v_had_prev then v_prev.flip_status else 'to_call' end,
    v_status, v_note,
    jsonb_strip_nulls(jsonb_build_object(
      'attempt_counted', p_count_attempt,
      'callback_at', v_row.callback_at,
      'resold_deal_id', v_row.resold_deal_id,
      'resold_policy_number', v_row.resold_policy_number,
      'resold_carrier', v_row.resold_carrier,
      'resold_annual_premium', v_row.resold_annual_premium,
      -- Leaving "resold" clears the resale fields on the row; keep them here.
      'previous_resale', case when v_had_prev and v_prev.flip_status = 'resold' and v_status <> 'resold'
        then jsonb_strip_nulls(jsonb_build_object(
          'deal_id', v_prev.resold_deal_id, 'policy_number', v_prev.resold_policy_number,
          'carrier', v_prev.resold_carrier, 'annual_premium', v_prev.resold_annual_premium))
      end
    )),
    v_uid
  );

  return to_jsonb(v_row);
end
$function$;
