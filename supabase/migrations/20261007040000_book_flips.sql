-- Book flips (Sam, 2026-10-06): work the carrier books for rewrites. Priority order
-- tomorrow: Combined, American Home Life, Royal Neighbors, Transamerica. One row per
-- policy with the client's phone, a flip status per policy, and an append-only log.
--
-- WHAT "ONE ROW PER POLICY" MEANS HERE (measured 2026-10-06, before building):
-- agentlink_book holds 836 rows for the four carriers but only 657 distinct
-- (carrier, policy_number). That is NOT 179 duplicate rows. 60 of the 62 repeated
-- numbers are DIFFERENT CLIENTS sharing a placeholder number: American Home Life
-- "1234" alone is 17 different people, "123456" 18, "000" 5. Collapsing on
-- (carrier, policy_number) would have hidden 136 real clients (AHL 462 -> 363).
-- So a policy here is (carrier, trimmed policy_number, client_key), where
-- client_key is the client's name reduced to [a-z0-9]. True duplicates still
-- collapse: Transamerica AES30411 is Faye Sparks four times (one sale plus three
-- re-posts under new pipeline ids). 836 rows -> 793 policies.
--
-- WHICH ROW SPEAKS FOR A POLICY: a carrier status beats "Unknown", then the latest
-- posted, then the latest imported, then a live row before a dead one. The
-- re-posts are all "Unknown"; preferring them would turn a known "Cancelled" or
-- "Declined" into "Unknown" and put it back on the call list.
--
-- PHONES: agentlink_clients by any of the policy's pipeline ids, else a posted deal
-- with the same policy number AND the same client name. Matching deals on the
-- policy number alone was measured and refused: for 35 policies it returns another
-- client's phone ("123456" -> a different person), which would mean calling a
-- stranger about someone else's policy.
--
-- Writes go only through book_flip_set(); the tables have no write policies.

-- No SET clause on purpose: a plain IMMUTABLE SQL function is inlined by the planner,
-- and the view, the RPC and the read policy call it on every book row (with SET it
-- cost ~20us a call, measured). Built-ins are schema-qualified instead.
create or replace function public.book_flip_client_key(p_client_name text, p_pipeline_client_id integer, p_deal_key text)
returns text
language sql
immutable
parallel safe
as $fn$
  select coalesce(
    nullif(pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_client_name, '')), '[^a-z0-9]', '', 'g'), ''),
    'pc' || p_pipeline_client_id::text,
    'dk' || p_deal_key,
    ''
  )
$fn$;
comment on function public.book_flip_client_key(text, integer, text) is
  'Client part of a book policy key: the name reduced to [a-z0-9], else pc<pipeline id>, else dk<deal_key>. Shared by v_book_flip_worklist, book_flip_set and the book_flips read policy so they cannot disagree.';
revoke all on function public.book_flip_client_key(text, integer, text) from public, anon;
grant execute on function public.book_flip_client_key(text, integer, text) to authenticated, service_role;

create table if not exists public.book_flips (
  id uuid primary key default gen_random_uuid(),
  carrier text not null,
  policy_number text not null,
  client_key text not null default '',
  flip_status text not null default 'to_call'
    check (flip_status in ('to_call','no_answer','callback','appointment','resold','not_interested','do_not_call','bad_number')),
  attempts integer not null default 0 check (attempts >= 0),
  last_contact_at timestamptz,
  callback_at timestamptz,
  notes text,
  resold_deal_id uuid references public.deals(id) on delete set null,
  resold_policy_number text,
  resold_carrier text,
  resold_annual_premium numeric,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_flips_policy_key unique (carrier, policy_number, client_key)
);
comment on table public.book_flips is
  'Flip (rewrite) progress per book policy. Key = (carrier, policy_number, client_key); see book_flip_client_key. Written only by book_flip_set().';

create table if not exists public.book_flip_events (
  id bigserial primary key,
  carrier text not null,
  policy_number text not null,
  client_key text not null default '',
  from_status text,
  to_status text not null,
  note text,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
comment on table public.book_flip_events is
  'Append-only log of every book_flip_set() call: status change, note, attempt, callback and resale details.';
create index if not exists book_flip_events_policy_idx
  on public.book_flip_events (carrier, policy_number, created_at desc);

-- The RPC and the manager read policy look a policy up by carrier + trimmed number.
create index if not exists agentlink_book_carrier_policy_idx
  on public.agentlink_book (carrier, btrim(policy_number));
-- agentlink_clients(insuracloud_pipeline_client_id) is already unique-indexed and
-- deals(policy_number) already has idx_deals_policy_number; nothing to add there.

alter table public.book_flips enable row level security;
alter table public.book_flip_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'book_flips' and policyname = 'book_flips_read') then
    create policy book_flips_read on public.book_flips for select to authenticated using (
      public.has_role((select auth.uid()), 'admin'::public.app_role)
      or (
        public.has_role((select auth.uid()), 'manager'::public.app_role)
        and exists (
          select 1 from public.agentlink_book b
          where b.carrier = book_flips.carrier
            and btrim(b.policy_number) = book_flips.policy_number
            and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = book_flips.client_key
            and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
        )
      )
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'book_flip_events' and policyname = 'book_flip_events_read') then
    create policy book_flip_events_read on public.book_flip_events for select to authenticated using (
      public.has_role((select auth.uid()), 'admin'::public.app_role)
      or (
        public.has_role((select auth.uid()), 'manager'::public.app_role)
        and exists (
          select 1 from public.agentlink_book b
          where b.carrier = book_flip_events.carrier
            and btrim(b.policy_number) = book_flip_events.policy_number
            and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = book_flip_events.client_key
            and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
        )
      )
    );
  end if;
end $$;

-- This project adds no default table grants, and its default function/sequence
-- grants include anon, so every grant here is explicit.
revoke all on public.book_flips, public.book_flip_events from anon;
grant select on public.book_flips, public.book_flip_events to authenticated;
grant all on public.book_flips, public.book_flip_events to service_role;
revoke all on sequence public.book_flip_events_id_seq from anon, authenticated;
grant usage, select on sequence public.book_flip_events_id_seq to service_role;

create or replace view public.v_book_flip_worklist with (security_invoker = true) as
select
  concat_ws('|', r.carrier, r.policy_number, r.client_key) as flip_key,
  r.carrier,
  r.policy_number,
  r.client_key,
  r.product,
  coalesce(nullif(btrim(r.status), ''), 'Unknown') as book_status,
  coalesce(r.is_dead, false) as is_dead,
  sg.status_group = 'active' as is_book_active,
  sg.status_group,
  r.client_name,
  r.client_first_name,
  r.client_last_name,
  coalesce(nullif(btrim(cl.phone), ''), nullif(btrim(dl.client_phone), '')) as phone,
  case
    when nullif(btrim(cl.phone), '') is not null then 'client_record'
    when nullif(btrim(dl.client_phone), '') is not null then 'posted_deal'
  end as phone_source,
  coalesce(cl.date_of_birth, dl.client_dob) as dob,
  case
    when coalesce(cl.date_of_birth, dl.client_dob) is null
      or coalesce(cl.date_of_birth, dl.client_dob) > t.today then null
    else extract(year from age(t.today, coalesce(cl.date_of_birth, dl.client_dob)))::int
  end as age_years,
  nullif(btrim(cl.state), '') as state,
  nullif(btrim(cl.city), '') as city,
  coalesce(cl.any_dnc, false) as do_not_call,
  nullif(btrim(cl.best_time_to_call), '') as best_time_to_call,
  nullif(btrim(cl.client_timezone), '') as client_timezone,
  r.face_amount,
  r.monthly_premium,
  r.annual_premium,
  r.effective_date,
  r.posted_date,
  case
    when r.effective_date is null or r.effective_date < date '1990-01-01' then null
    when r.effective_date > t.today then 0
    else (extract(year from age(t.today, r.effective_date)) * 12
          + extract(month from age(t.today, r.effective_date)))::int
  end as months_in_force,
  r.agent_id,
  coalesce(nullif(btrim(ag.display_name), ''), nullif(btrim(r.agent_name), '')) as agent_name,
  ag.status as agent_status,
  coalesce(ag.status in ('inactive', 'terminated') or ag.is_inactive or ag.is_deactivated, false) as agent_gone,
  r.imported_at,
  r.book_rows::int as book_rows,
  r.clients_on_number::int as clients_on_number,
  coalesce(fl.flip_status, 'to_call') as flip_status,
  coalesce(fl.attempts, 0) as attempts,
  fl.last_contact_at,
  fl.callback_at,
  fl.notes,
  fl.resold_deal_id,
  fl.resold_policy_number,
  fl.resold_carrier,
  fl.resold_annual_premium,
  fl.updated_at as flip_updated_at
from (
  select
    k.*,
    row_number() over (
      partition by k.carrier, k.policy_number, k.client_key
      order by (k.status is not null and lower(btrim(k.status)) not in ('', 'unknown')) desc,
               k.posted_date desc nulls last,
               k.imported_at desc nulls last,
               coalesce(k.is_dead, false),
               k.deal_key
    ) as rn,
    count(*) over (partition by k.carrier, k.policy_number, k.client_key) as book_rows,
    array_agg(k.pipeline_client_id) over (partition by k.carrier, k.policy_number, k.client_key) as pipeline_client_ids,
    dense_rank() over (partition by k.carrier, k.policy_number order by k.client_key)
      + dense_rank() over (partition by k.carrier, k.policy_number order by k.client_key desc) - 1 as clients_on_number
  from (
    select
      b.deal_key, b.carrier, btrim(b.policy_number) as policy_number,
      public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) as client_key,
      b.product, b.status, b.is_dead, b.client_name, b.client_first_name, b.client_last_name,
      b.agent_id, b.agent_name, b.face_amount, b.monthly_premium, b.annual_premium,
      b.effective_date, b.posted_date, b.imported_at, b.pipeline_client_id,
      b.policy_number as raw_policy_number
    from public.agentlink_book b
    where nullif(btrim(b.policy_number), '') is not null
  ) k
) r
cross join lateral (select (now() at time zone 'America/Phoenix')::date as today) t
cross join lateral (
  select case
    when lower(coalesce(btrim(r.status), '')) in ('active', 'issued', 'approved', 'in force', 'inforce', 'in-force') then 'active'
    when lower(coalesce(btrim(r.status), '')) in ('lapsed', 'lapse pending', 'lapse-pending', 'grace period') then 'lapsing'
    when lower(coalesce(btrim(r.status), '')) in ('declined', 'withdrawn', 'not taken', 'cancelled', 'canceled', 'terminated',
                                                  'postponed', 'rescinded', 'surrendered', 'deceased', 'closed', 'incomplete')
      or coalesce(r.is_dead, false) then 'dead'
    when lower(coalesce(btrim(r.status), '')) in ('pending', 'in review', 'submitted', 'underwriting', 'issued, not paid', 'approved, not issued') then 'pending'
    else 'unknown'
  end as status_group
) sg
left join lateral (
  select a.display_name, a.status::text as status, a.is_inactive, a.is_deactivated
  from public.agents a
  where a.id = r.agent_id
  order by a.id
  limit 1
) ag on true
left join lateral (
  -- One read of the client records: the best one for contact details, and
  -- do-not-call if ANY record for this person carries it.
  select c.phone, c.date_of_birth, c.state, c.city, c.best_time_to_call, c.client_timezone,
         bool_or(c.do_not_call) over () as any_dnc
  from public.agentlink_clients c
  where c.insuracloud_pipeline_client_id = any (r.pipeline_client_ids)
  order by (nullif(btrim(c.phone), '') is not null) desc,
           (c.insuracloud_pipeline_client_id = r.pipeline_client_id) desc,
           c.updated_at desc nulls last,
           c.id
  limit 1
) cl on true
left join lateral (
  -- Only when the client record is missing a phone or a birth date.
  select d.client_phone, d.client_dob
  from public.deals d
  where (nullif(btrim(cl.phone), '') is null or cl.date_of_birth is null)
    and d.policy_number = any (array[r.policy_number, r.raw_policy_number])
    and public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null, null) = r.client_key
  order by (nullif(btrim(d.client_phone), '') is not null) desc,
           d.updated_at desc nulls last,
           d.id
  limit 1
) dl on true
left join lateral (
  select f.flip_status, f.attempts, f.last_contact_at, f.callback_at, f.notes,
         f.resold_deal_id, f.resold_policy_number, f.resold_carrier, f.resold_annual_premium, f.updated_at
  from public.book_flips f
  where f.carrier = r.carrier and f.policy_number = r.policy_number and f.client_key = r.client_key
  order by f.updated_at desc
  limit 1
) fl on true
where r.rn = 1
  -- The worklist is an admin/manager tool, matching book_flip_set(). Without this an
  -- agent (even a terminated one) would see their own book through it, because
  -- agentlink_book lets agents read their own rows.
  and (select public.has_role(auth.uid(), 'admin'::public.app_role)
           or public.has_role(auth.uid(), 'manager'::public.app_role)
           or current_user in ('postgres', 'service_role'));
alter view public.v_book_flip_worklist set (security_invoker = true);
comment on view public.v_book_flip_worklist is
  'One row per book policy (carrier, policy_number, client_key) with the client''s phone and the flip status. Admins and managers only; RLS on the base tables still scopes a manager to their downline.';

create or replace view public.v_book_flip_carrier_counts with (security_invoker = true) as
select
  w.carrier,
  count(*)::int as policies,
  (count(*) filter (where w.is_book_active))::int as book_active,
  (count(*) filter (where w.status_group = 'unknown'))::int as unknown_status,
  (count(*) filter (where w.status_group = 'lapsing'))::int as lapsing,
  (count(*) filter (where w.status_group <> 'dead'))::int as workable,
  (count(*) filter (where w.phone is not null))::int as with_phone,
  -- Same rule as the page's default view (Workable + To call): open or no-answer,
  -- or a callback that is due, and never a do-not-call client.
  (count(*) filter (where w.status_group <> 'dead' and not w.do_not_call
    and (w.flip_status in ('to_call', 'no_answer') or (w.flip_status = 'callback' and w.callback_at <= now()))))::int as to_call,
  (count(*) filter (where w.flip_status = 'callback' and w.callback_at <= now()))::int as callbacks_due,
  (count(*) filter (where w.flip_status = 'resold'))::int as resold,
  coalesce(sum(w.resold_annual_premium) filter (where w.flip_status = 'resold'), 0) as resold_annual_premium,
  max(w.imported_at) as last_imported_at
from public.v_book_flip_worklist w
group by w.carrier;
alter view public.v_book_flip_carrier_counts set (security_invoker = true);
comment on view public.v_book_flip_carrier_counts is
  'Per-carrier totals over v_book_flip_worklist (same access rules).';

revoke all on public.v_book_flip_worklist, public.v_book_flip_carrier_counts from anon;
grant select on public.v_book_flip_worklist, public.v_book_flip_carrier_counts to authenticated;
grant all on public.v_book_flip_worklist, public.v_book_flip_carrier_counts to service_role;

create or replace function public.book_flip_set(
  p_carrier text,
  p_policy_number text,
  p_status text,
  p_note text default null,
  p_callback_at timestamptz default null,
  p_count_attempt boolean default false,
  p_resold_deal_id uuid default null,
  p_resold_policy_number text default null,
  p_resold_carrier text default null,
  p_resold_annual_premium numeric default null,
  p_client_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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
      and exists (
        select 1 from public.agentlink_book b
        where b.carrier = p_carrier
          and btrim(b.policy_number) = v_policy
          and public.book_flip_client_key(b.client_name, b.pipeline_client_id, b.deal_key) = v_key
          and b.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
      )
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
$fn$;
comment on function public.book_flip_set(text, text, text, text, timestamptz, boolean, uuid, text, text, numeric, text) is
  'Set a book policy''s flip status (admin, or manager over the writing agent). Counts an attempt, sets a callback, prepends a dated note (Phoenix date), records a resale, and logs every call to book_flip_events. p_client_key is only needed when several clients share one policy number.';
revoke all on function public.book_flip_set(text, text, text, text, timestamptz, boolean, uuid, text, text, numeric, text) from public, anon;
grant execute on function public.book_flip_set(text, text, text, text, timestamptz, boolean, uuid, text, text, numeric, text) to authenticated, service_role;
