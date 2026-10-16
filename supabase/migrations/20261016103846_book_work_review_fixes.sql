-- PL-BOOK-ROW-WORK-REVIEW (2026-10-16): fixes from the overnight review of Book of Business,
-- Book Flips and Sold Calls.
--
-- 1. book_flip_set lets full-book readers log outcomes. Aisha reads the whole book (book_readers)
--    but holds the manager role, so No answer / Callback / Resold failed on every policy outside
--    her own downline ("Only an admin, or the manager over this policy's writing agent").
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

  -- Admins and full-book readers (Aisha) work the whole book; a manager works the policies
  -- their downline wrote. Same people who can read the whole book can log a call on it.
  v_allowed := public.has_role(v_uid, 'admin'::public.app_role)
    or public.api_is_full_reader()
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
    raise exception 'Only an admin, a full-book reader, or the manager over this policy''s writing agent, can update it.' using errcode = '42501';
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

-- 2. book_flips read rule matches who can write: admins and full-book readers see every
--    record; a manager sees the records for policies their downline wrote, in the AgentLink
--    book or posted here (the native-deal half was missing, so a manager could log a call on a
--    native client through book_flip_set and then not see it).
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
        where nd.source::text = any (array['apex_native', 'apex'])
          and nc.name = book_flips.carrier
          and btrim(nd.policy_number) = book_flips.policy_number
          and public.book_flip_client_key(btrim(concat_ws(' ', nd.client_first_name, nd.client_last_name)), null::integer, 'deal:' || nd.id::text) = book_flips.client_key
          and nd.agent_id in (select d.agent_id from public.my_downline_agent_ids() d(agent_id))
      )
    )
  )
);

-- 3. book_client_details matches the CLIENT, not just the policy number. 72 policy numbers
--    (248 book rows) are shared by more than one client; matching on the number alone gave a
--    row whichever client sorted first, so it showed another person's phone and date of birth
--    and Resold/No answer wrote that other person's record. The page now sends each row's
--    client name; a row takes book work state only from its own client (by book_flip_client_key,
--    the same key book_flips uses), and phone/DOB fallbacks from deals and the AgentLink snapshot
--    only from a deal with that client's name. A row with no client name gets no policy-number
--    fallback at all, because there is no way to tell which client it is.
create or replace function public.book_client_details(p_rows jsonb)
returns table(
  row_key text, phone text, dob date, state text, city text, do_not_call boolean, best_time_to_call text,
  flip_carrier text, flip_policy_number text, flip_client_key text, flip_status text,
  resold_policy_number text, resold_carrier text, resold_annual_premium numeric,
  attempts integer, last_contact_at timestamptz, callback_at timestamptz, notes text
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with r as (
    select x->>'row_key' as row_key, x->>'origin' as origin,
           nullif(btrim(x->>'policy_number'), '') as policy_number, nullif(btrim(x->>'carrier'), '') as carrier,
           public.book_flip_client_key(nullif(btrim(x->>'client_name'), ''), null::integer, null::text) as ckey
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    limit 200
  ),
  keys as (
    select coalesce(array_agg(distinct r.policy_number) filter (where r.policy_number is not null), '{}'::text[]) as pns,
           coalesce(array_agg(r.row_key::uuid) filter (where r.origin = 'apex_native'
             and r.row_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}'::uuid[]) as native_ids
    from r
  ),
  d_all as (
    select dd.id, dd.policy_number, dd.client_phone, dd.client_dob,
           public.book_flip_client_key(btrim(concat_ws(' ', dd.client_first_name, dd.client_last_name)), null::integer, null::text) as ckey
    from public.deals dd, keys k
    where dd.policy_number = any(k.pns) or dd.id = any(k.native_ids)
  ),
  s_all as (
    select ss.id, ss.policy_number, ss.client_phone, ss.client_dob,
           public.book_flip_client_key(btrim(concat_ws(' ', ss.client_first_name, ss.client_last_name)), null::integer, null::text) as ckey
    from public.agentlink_deals_snapshot ss, keys k
    where ss.policy_number = any(k.pns)
  ),
  f_all as (
    select ff.phone, ff.dob, ff.state, ff.city, ff.do_not_call, ff.best_time_to_call, ff.carrier, ff.policy_number,
           ff.client_key, ff.flip_status, ff.resold_policy_number, ff.resold_carrier, ff.resold_annual_premium,
           ff.attempts, ff.last_contact_at, ff.callback_at, ff.notes
    from public.v_book_flip_worklist ff, keys k
    where ff.policy_number = any(k.pns)
  )
  select r.row_key,
         coalesce(f.phone, d.client_phone, s.client_phone),
         coalesce(f.dob, d.client_dob, s.client_dob),
         f.state, f.city, f.do_not_call, f.best_time_to_call,
         f.carrier, f.policy_number, f.client_key, f.flip_status,
         f.resold_policy_number, f.resold_carrier, f.resold_annual_premium,
         f.attempts, f.last_contact_at, f.callback_at, f.notes
  from r
  left join lateral (
    select d_all.client_phone, d_all.client_dob from d_all
     where (r.origin = 'apex_native' and d_all.id::text = r.row_key)
        or (r.policy_number is not null and r.ckey <> '' and d_all.policy_number = r.policy_number and d_all.ckey = r.ckey)
     order by (d_all.id::text = r.row_key) desc, (d_all.client_phone is not null) desc
     limit 1) d on true
  left join lateral (
    select s_all.client_phone, s_all.client_dob from s_all
     where r.policy_number is not null and r.ckey <> '' and s_all.policy_number = r.policy_number and s_all.ckey = r.ckey
     order by (s_all.client_phone is not null) desc, s_all.id desc
     limit 1) s on true
  left join lateral (
    select f_all.* from f_all
     where r.policy_number is not null and r.ckey <> '' and f_all.policy_number = r.policy_number
       and f_all.client_key = r.ckey
       and (r.carrier is null or lower(f_all.carrier) = lower(r.carrier)
            or position(lower(f_all.carrier) in lower(r.carrier)) > 0 or position(lower(r.carrier) in lower(f_all.carrier)) > 0)
     order by (f_all.phone is not null) desc
     limit 1) f on true
$fn$;

comment on function public.book_client_details(jsonb) is
  'Client phone, DOB, state/city and Book Flips work state (status, attempts, callback, notes, resale) for the Book of Business rows on screen, matched to each row''s own client (policy number AND client name), never to another client on a shared policy number. SECURITY INVOKER: every lookup runs under the caller''s own row rules.';
revoke all on function public.book_client_details(jsonb) from public, anon;
grant execute on function public.book_client_details(jsonb) to authenticated, service_role;

-- 4. Sold Calls for Aisha: v_sold_calls_queue is security_invoker and reads the recording and
--    transcript rows to say whether a packet is coming. Those two tables were admin-only, so on
--    her login every sale without a packet read "No recording". She already reads the calls
--    (rmd_sold_call_viewers_read), the packets with SSN and bank, and the recording link, so
--    reading the recording and transcript rows adds nothing she cannot already see.
drop policy if exists rmr_sold_call_viewers_read on public.readymode_recordings;
create policy rmr_sold_call_viewers_read on public.readymode_recordings for select to authenticated
  using ((select public.can_view_sold_calls()));
drop policy if exists rmct_sold_call_viewers_read on public.readymode_call_transcripts;
create policy rmct_sold_call_viewers_read on public.readymode_call_transcripts for select to authenticated
  using ((select public.can_view_sold_calls()));
