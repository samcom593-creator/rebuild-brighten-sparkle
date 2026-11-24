-- Lead context, reasoned holds and one filter contract for preview/assignment.
-- No provider calls or outbound sends. Existing snapshot cadence is preserved.
-- Source-reported ownership never becomes a policy or production record.
begin;

create or replace function public.lead_outcome_key(p_value text)
returns text language sql immutable set search_path to 'public' as $$
  select case lower(btrim(coalesce(p_value, '')))
    when '' then 'never_called' when 'new' then 'never_called'
    when 'not available' then 'no_answer' when 'no answer' then 'no_answer'
    when 'completed sale' then 'sold' when 'bank objection' then 'bank_objection'
    when 'no bank account' then 'no_bank_account' when 'social objection' then 'ssn_objection'
    when 'i give up' then 'gave_up' when '&rarr; appointments' then 'appointment'
    when '&rarr; spanish speaker' then 'spanish_speaker' when 'do not call' then 'do_not_call'
    when 'not interested' then 'not_interested' when 'bad number' then 'bad_number'
    else lower(replace(btrim(p_value), ' ', '_')) end;
$$;

create or replace function public.lead_context_time(p_value text)
returns timestamptz language plpgsql stable set search_path to 'public' as $$
begin
  if nullif(btrim(p_value), '') is null then return null; end if;
  return p_value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;

-- Genuine DNC survives imports, later outcome edits and transfers. Current-client
-- protection is derived separately and is never recorded in this table.
create table if not exists public.lead_contact_dnc (
  phone10 text primary key check (phone10 ~ '^[0-9]{10}$'),
  recorded_source text not null,
  recorded_at timestamptz not null default now()
);
alter table public.lead_contact_dnc enable row level security;
revoke all on public.lead_contact_dnc from public, anon, authenticated;
grant select, insert on public.lead_contact_dnc to service_role;
insert into public.lead_contact_dnc(phone10, recorded_source)
select phone10, 'existing_call_or_book_restriction' from public.v_readymode_lead_quality
 where quality_tier = 'blocked' and phone10 ~ '^[0-9]{10}$'
on conflict do nothing;
insert into public.lead_contact_dnc(phone10, recorded_source)
select distinct right(regexp_replace(coalesce(phone_digits, phone_e164, ''), '[^0-9]', '', 'g'), 10), 'client_leads'
 from public.client_leads where (dnc or public.lead_outcome_key(last_disposition) = 'do_not_call') and length(regexp_replace(coalesce(phone_digits, phone_e164, ''), '[^0-9]', '', 'g')) >= 10
on conflict do nothing;
insert into public.lead_contact_dnc(phone10, recorded_source)
select distinct phone10, 'lead_bundle_items' from public.lead_bundle_items
 where status = 'do_not_call' and phone10 ~ '^[0-9]{10}$' on conflict do nothing;

insert into public.lead_contact_dnc(phone10, recorded_source)
select distinct right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), 'book_flip'
 from public.v_book_flip_worklist where (do_not_call or flip_status = 'do_not_call')
 and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 10 on conflict do nothing;

create or replace function public.fn_lead_capture_dnc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare p text; blocked boolean := false; j jsonb := to_jsonb(new);
begin
  if tg_table_name = 'client_leads' then
    p := right(regexp_replace(coalesce(j->>'phone_digits', j->>'phone_e164', ''), '[^0-9]', '', 'g'), 10);
    blocked := coalesce((j->>'dnc')::boolean, false) or public.lead_outcome_key(j->>'last_disposition') = 'do_not_call';
  elsif tg_table_name = 'readymode_dialer_calls' then
    p := j->>'lead_phone10'; blocked := public.lead_outcome_key(j->>'disposition') = 'do_not_call';
  elsif tg_table_name = 'agentlink_clients' then
    p := right(regexp_replace(coalesce(j->>'phone', ''), '[^0-9]', '', 'g'), 10);
    blocked := coalesce((j->>'do_not_call')::boolean, false);
  else
    p := j->>'phone10'; blocked := j->>'status' = 'do_not_call';
  end if;
  if blocked and p ~ '^[0-9]{10}$' then
    perform pg_advisory_xact_lock(hashtextextended(p, 951));
    insert into public.lead_contact_dnc(phone10, recorded_source) values(p, tg_table_name) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists lead_capture_dnc on public.client_leads;
create trigger lead_capture_dnc after insert or update of dnc, last_disposition, phone_digits, phone_e164 on public.client_leads for each row execute function public.fn_lead_capture_dnc();
drop trigger if exists lead_capture_dnc on public.readymode_dialer_calls;
create trigger lead_capture_dnc after insert or update of disposition, lead_phone10 on public.readymode_dialer_calls for each row execute function public.fn_lead_capture_dnc();
drop trigger if exists lead_capture_dnc on public.lead_bundle_items;
create trigger lead_capture_dnc after insert or update of status, phone10 on public.lead_bundle_items for each row execute function public.fn_lead_capture_dnc();
drop trigger if exists lead_capture_dnc on public.agentlink_clients;
create trigger lead_capture_dnc after insert or update of do_not_call, phone on public.agentlink_clients for each row execute function public.fn_lead_capture_dnc();
revoke all on function public.fn_lead_capture_dnc() from public, anon, authenticated;

alter table public.lead_bundle_items add column if not exists callback_at timestamptz;
alter table public.lead_bundle_items add column if not exists next_action text;
create index if not exists lead_bundle_items_phone_touch on public.lead_bundle_items(phone10, status_at desc);
create index if not exists lead_bundle_events_tap_item on public.lead_bundle_events(item_id, at desc) where action='dial_tap';

-- Add only explicitly selected provenance and reported-policy fields to the pool.
create or replace view public.v_pool_marketing with (security_invoker = true) as
select s.lead_id, coalesce(f.to_phone10,s.phone10) as phone10, s.first_name, s.last_name, s.email, s.state, s.age, s.grade as tier,
  nullif(concat_ws(', ', case when s.wants_mortgage then 'mortgage' end,
    case when s.is_veteran then 'veteran' end, case when s.is_homeowner then 'homeowner' end,
    case when s.is_policyholder then 'supplier-reported policy owner' end), '') as tags,
  jsonb_strip_nulls(jsonb_build_object(
    'mortgage', s.wants_mortgage, 'veteran', s.is_veteran, 'homeowner', s.is_homeowner,
    'policyholder', s.is_policyholder, 'dnc', s.dnc or d_old.phone10 is not null or coalesce(q.quality_tier = 'blocked', false),
    'true_dnc', s.dnc or d_old.phone10 is not null or coalesce(q.quality_tier = 'blocked', false),
    'current_client', (cs.phone10 is not null or cs_old.phone10 is not null),
    'import_review_required', coalesce(l.raw->>'import_review_required', 'false') = 'true',
    'readymode_number',f.to_phone10 is not null,'replaced_phone10',f.from_phone10,
    'original_producer', l.original_agent,
    'source_file', l.source_file, 'source_batch_id', l.raw->>'source_batch_id',
    'source_type', l.raw->>'source_type', 'policy_ownership_claim', l.raw->>'policy_ownership_claim',
    'policy_standing', case when (cs.phone10 is not null or cs_old.phone10 is not null) then 'current_client' else 'unverified' end,
    'policy_carrier', l.policy_carrier, 'policy_product', l.policy_product,
    'policy_monthly_premium', l.policy_monthly_premium, 'policy_face_amount', l.policy_face_amount,
    'last_caller', case when q.last_dialed_at > coalesce(s.last_dialed_at, '-infinity'::timestamptz) then q.last_agent else null end,
    'last_outcome', public.lead_outcome_key(case when q.last_dialed_at > coalesce(s.last_dialed_at, '-infinity'::timestamptz) then q.last_disposition else s.last_disposition end),
    'last_touched_at', greatest(q.last_dialed_at, s.last_dialed_at),
    'times_called', greatest(coalesce(q.attempts, 0), coalesce(s.dial_count, 0)),
    'callback_at', l.next_touch_by, 'next_action', l.raw->>'next_action')) as flags,
  s.lead_age_days, s.lead_age_days < 274 as under_9mo
from public.v_sellable_client_leads s
join public.client_leads l on l.id = s.lead_id
left join public.mat_lead_phone_fix f on f.source='marketing' and f.from_phone10=s.phone10
  and f.name_key=regexp_replace(lower(coalesce(s.first_name,'') || coalesce(s.last_name,'')),'[^a-z0-9]','','g')
left join public.lead_contact_dnc d_old on d_old.phone10=s.phone10
left join public.v_readymode_lead_quality q on q.phone10 = coalesce(f.to_phone10,s.phone10)
left join (select distinct phone10 from public.v_dialer_client_suppression where verdict = 'suppress') cs on cs.phone10 = coalesce(f.to_phone10,s.phone10)
left join (select distinct phone10 from public.v_dialer_client_suppression where verdict = 'suppress') cs_old on cs_old.phone10 = s.phone10;

create or replace view public.v_pool_dialer with (security_invoker = true) as
with rl as (
  select distinct on (l.phone10) l.phone10, l.first_name, l.last_name, l.email, l.state, l.age, l.campaign, l.batch_name
    from public.readymode_leads l
   where l.phone10 is not null
   order by l.phone10, l.rm_lead_id desc
), agg as (
  select l.phone10, max(l.times_called) as times_called, min(l.first_seen_at) as first_seen_at,
         to_jsonb(array_agg(distinct l.campaign) filter (where l.campaign is not null)) as campaigns
    from public.readymode_leads l
   where l.phone10 is not null
   group by l.phone10
), sup as (
  select s.phone10 from public.v_dialer_client_suppression s where s.verdict = 'suppress'
)
select null::uuid as lead_id,
       coalesce(q.phone10, rl.phone10) as phone10,
       coalesce(rl.first_name, q.first_name) as first_name,
       coalesce(rl.last_name, q.last_name) as last_name,
       coalesce(rl.email, q.email) as email,
       coalesce(rl.state, (select upper(a.state) from public.us_area_codes a where a.area_code = left(coalesce(q.phone10, rl.phone10), 3) limit 1)) as state,
       rl.age as age,
       coalesce(q.quality_tier,
                case when coalesce(agg.times_called, 0) = 0 then 'F' when agg.times_called <= 3 then 'C' else 'D' end) as tier,
       concat_ws(' · ',
         coalesce(q.quality_reason,
                  case when coalesce(agg.times_called, 0) = 0 then 'Fresh: loaded in the dialer, never called'
                       else 'Dialed ' || agg.times_called || ' time' || case when agg.times_called = 1 then '' else 's' end || ' before April, no call detail on file' end),
         rl.campaign) as tags,
       jsonb_strip_nulls(jsonb_build_object(
         'dnc', (coalesce(q.quality_tier = 'blocked', false) or lower(coalesce(q.last_disposition, '')) = 'do not call'),
         'true_dnc', coalesce(q.quality_tier = 'blocked', false) or lower(coalesce(q.last_disposition, '')) = 'do not call',
         'last_caller', q.last_agent, 'last_outcome', public.lead_outcome_key(q.last_disposition),
         'last_touched_at', q.last_dialed_at,
         'policy_standing', case when sup.phone10 is not null then 'current_client' else 'unverified' end,
         'policy_ownership_claim', case when q.quality_tier = 'pos' then 'dialer_sale_reported' end,
         'source_type', 'readymode',
         'campaign', rl.campaign,
         'campaigns', agg.campaigns,
         'source_file', rl.batch_name,
         'times_called', greatest(coalesce(q.attempts, 0), coalesce(agg.times_called, 0)),
         'current_client', case when sup.phone10 is not null then true end,
         'state_from_area_code', case when rl.state is null then true end)) as flags,
       coalesce(q.days_since_dialed, (now()::date - agg.first_seen_at::date)) as lead_age_days,
       false as under_9mo
  from rl
  join agg on agg.phone10 = rl.phone10
  full join public.v_readymode_lead_quality q on q.phone10 = rl.phone10
  left join sup on sup.phone10 = coalesce(q.phone10, rl.phone10);

create or replace view public.v_pool_winback as
 SELECT NULL::uuid AS lead_id,
    COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)) AS phone10,
    d.client_first_name AS first_name,
    d.client_last_name AS last_name,
    NULL::text AS email,
    COALESCE(( SELECT upper(cl.state) FROM client_leads cl WHERE cl.phone_digits = COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)) AND cl.state ~ '^[A-Za-z]{2}$' LIMIT 1), (select upper(a.state) from public.us_area_codes a where a.area_code = left(COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)), 3) limit 1)) AS state,
        CASE
            WHEN d.client_dob IS NOT NULL THEN EXTRACT(year FROM age(d.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[c.name, d.product_sold, COALESCE(d.policy_status_standard, d.status)], NULL::text), ' · '::text), ''::text) AS tags,
    (jsonb_build_object('lapsed', lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text, 'vantage', is_vantage_agent(d.agent_id), 'dnc', false) || jsonb_build_object('readymode_number', f.to_phone10 IS NOT NULL)) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10', NULLIF(f.from_phone10, ''::text))) || jsonb_strip_nulls(jsonb_build_object('true_dnc', coalesce(q.quality_tier = 'blocked', false),
      'current_client', cs.phone10 is not null, 'last_caller', q.last_agent,
      'last_outcome', public.lead_outcome_key(q.last_disposition), 'last_touched_at', q.last_dialed_at,
      'times_called', coalesce(q.attempts, 0), 'policy_standing', case when cs.phone10 is not null then 'current_client' when lower(coalesce(d.status,'')) = 'lapsed' then 'lapsing' else 'gone' end)) AS flags,
    now()::date - COALESCE(d.posted_at::date, d.effective_date) AS lead_age_days,
    false AS under_9mo
   FROM deals d
     LEFT JOIN carriers c ON c.id = d.carrier_id
     LEFT JOIN mat_lead_phone_fix f ON f.source = 'winback'::text AND f.from_phone10 = "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AND f.name_key = regexp_replace(lower(COALESCE(d.client_first_name, ''::text) || COALESCE(d.client_last_name, ''::text)), '[^a-z0-9]'::text, ''::text, 'g'::text)
  LEFT JOIN public.v_readymode_lead_quality q ON q.phone10 = COALESCE(f.to_phone10, right(regexp_replace(COALESCE(d.client_phone, ''), '[^0-9]', '', 'g'), 10))
  LEFT JOIN (select distinct phone10 from public.v_dialer_client_suppression where verdict = 'suppress') cs ON cs.phone10 = COALESCE(f.to_phone10, right(regexp_replace(COALESCE(d.client_phone, ''), '[^0-9]', '', 'g'), 10))
  WHERE ((lower(COALESCE(d.status, ''::text)) = ANY (ARRAY['lapsed'::text, 'cancelled'::text])) OR d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken'::text) AND (lower(COALESCE(d.status, ''::text)) <> ALL (ARRAY['active'::text, 'in_force'::text, 'submitted'::text, 'pending'::text]));

create or replace view public.v_pool_rewrite as
 SELECT NULL::uuid AS lead_id,
    COALESCE(dc.lead_phone10, NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)) AS phone10,
    p.client_first_name AS first_name,
    p.client_last_name AS last_name,
    NULL::text AS email,
    COALESCE(CASE WHEN btrim(p.client_state) ~ '^[A-Za-z]{2}$' THEN upper(btrim(p.client_state)) END, (select upper(a.state) from public.us_area_codes a where a.area_code = left(COALESCE(dc.lead_phone10, NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)), 3) limit 1)) AS state,
        CASE
            WHEN p.client_dob IS NOT NULL THEN EXTRACT(year FROM age(p.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN (p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL) AND (p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL) THEN 'S'::text
            WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL OR p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[
        CASE
            WHEN p.payment_method_type = 'card'::text THEN 'card on file'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type = 'direct_express'::text THEN 'direct express'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]) THEN 'bank on file'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text THEN 'no bank'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL THEN 'SSN collected'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'bank collected'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]) THEN 'data collected, not booked'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(ci.spouse_coverage, false) THEN 'spouse opportunity'::text
            ELSE NULL::text
        END], NULL::text), ', '::text), ''::text) AS tags,
    (jsonb_build_object('cc', p.payment_method_type = 'card'::text, 'direct_express', p.payment_method_type = 'direct_express'::text, 'bank_on_file', p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]), 'no_bank', p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text, 'ssn_collected', p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL, 'bank_collected', p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL, 'hung_up', p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]), 'spouse', COALESCE(ci.spouse_coverage, false), 'dnc', false) || jsonb_build_object('readymode_number', COALESCE(dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10, false))) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10',
        CASE
            WHEN dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10 THEN NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)
            ELSE NULL::text
        END)) || jsonb_strip_nulls(jsonb_build_object('true_dnc', coalesce(q.quality_tier = 'blocked', false),
      'current_client', cs.phone10 is not null, 'last_caller', q.last_agent,
      'last_outcome', public.lead_outcome_key(q.last_disposition), 'last_touched_at', q.last_dialed_at,
      'times_called', coalesce(q.attempts, 0), 'policy_standing', case when cs.phone10 is not null then 'current_client' else 'unverified' end)) AS flags,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - (p.call_at AT TIME ZONE 'America/Phoenix'::text)::date AS lead_age_days,
    false AS under_9mo
   FROM readymode_booking_packets p
     LEFT JOIN readymode_call_insights ci ON ci.call_id = p.call_id
     LEFT JOIN readymode_dialer_calls dc ON dc.id = p.call_id
  LEFT JOIN public.v_readymode_lead_quality q ON q.phone10 = COALESCE(dc.lead_phone10, NULLIF(right(regexp_replace(COALESCE(p.client_phone, ''), '[^0-9]', '', 'g'), 10), ''))
  LEFT JOIN (select distinct phone10 from public.v_dialer_client_suppression where verdict = 'suppress') cs ON cs.phone10 = COALESCE(dc.lead_phone10, NULLIF(right(regexp_replace(COALESCE(p.client_phone, ''), '[^0-9]', '', 'g'), 10), ''))
  WHERE COALESCE(p.status, ''::text) <> 'booked'::text;

-- ---------------------------------------------------------------------------------------------------------------
create index if not exists mat_lead_pool_held_phone on public.mat_lead_pool(phone10)
 where dnc or flags @> '{"true_dnc":true}' or flags @> '{"current_client":true}' or flags @> '{"import_review_required":true}';

-- A single predicate owns every filter. Preview and assignment call the same
-- candidate function over the same snapshot; no second copy to drift.
create or replace function public.lead_pool_filter_matches(
  p_state text, p_age integer, p_tier text, p_lead_age integer, p_flags jsonb, p_filters jsonb
) returns boolean language sql stable set search_path to 'public' as $$
select
  (not (p_filters ? 'tiers') or jsonb_array_length(p_filters->'tiers') = 0 or (p_filters->'tiers') ? p_tier)
  and (not (p_filters ? 'states') or jsonb_array_length(p_filters->'states') = 0 or (p_filters->'states') ? p_state)
  and (not (p_filters ? 'campaigns') or jsonb_array_length(p_filters->'campaigns') = 0
       or coalesce(p_flags->'campaigns', jsonb_build_array(p_flags->>'campaign')) ?| array(select jsonb_array_elements_text(p_filters->'campaigns')))
  and (not (p_filters ? 'require_flags') or not exists (
       select 1 from jsonb_array_elements_text(p_filters->'require_flags') f(k) where coalesce(p_flags->>f.k, 'false') <> 'true'))
  and (not (p_filters ? 'min_age') or p_age >= (p_filters->>'min_age')::integer)
  and (not (p_filters ? 'max_age') or p_age <= (p_filters->>'max_age')::integer)
  and (not (p_filters ? 'max_lead_age_days') or p_lead_age <= (p_filters->>'max_lead_age_days')::integer)
  and (coalesce(p_filters->>'vantage_only', 'false') <> 'true' or p_flags->>'vantage' = 'true')
  and (nullif(p_filters->>'caller', '') is null or position(lower(p_filters->>'caller') in lower(coalesce(p_flags->>'last_caller', ''))) > 0)
  and (not (p_filters ? 'outcomes') or jsonb_array_length(p_filters->'outcomes') = 0
       or (p_filters->'outcomes') ? public.lead_outcome_key(p_flags->>'last_outcome'))
  and (not (p_filters ? 'min_attempts') or coalesce((p_flags->>'times_called')::integer, 0) >= (p_filters->>'min_attempts')::integer)
  and (not (p_filters ? 'max_attempts') or coalesce((p_flags->>'times_called')::integer, 0) <= (p_filters->>'max_attempts')::integer)
  and (not (p_filters ? 'touched_after') or public.lead_context_time(p_flags->>'last_touched_at') >= ((p_filters->>'touched_after')::date::timestamp at time zone 'America/Phoenix'))
  and (not (p_filters ? 'touched_before') or public.lead_context_time(p_flags->>'last_touched_at') < (((p_filters->>'touched_before')::date + 1)::timestamp at time zone 'America/Phoenix'))
  and (not (p_filters ? 'callback_before') or public.lead_context_time(p_flags->>'callback_at') < (((p_filters->>'callback_before')::date + 1)::timestamp at time zone 'America/Phoenix'))
  and (nullif(p_filters->>'source_file', '') is null or position(lower(p_filters->>'source_file') in lower(coalesce(p_flags->>'source_file', ''))) > 0)
  and (nullif(p_filters->>'source_type', '') is null or p_flags->>'source_type' = p_filters->>'source_type')
  and (nullif(p_filters->>'policy_standing', '') is null or coalesce(p_flags->>'policy_standing', 'unverified') = p_filters->>'policy_standing')
  and case coalesce(p_filters->>'hold', '')
    when '' then true
    when 'ready' then not coalesce((p_flags->>'blocked')::boolean, false)
    when 'true_dnc' then coalesce((p_flags->>'true_dnc')::boolean, false)
    when 'current_client' then coalesce((p_flags->>'current_client')::boolean, false)
    when 'assigned' then coalesce((p_flags->>'in_bundle')::boolean, false)
    when 'resold' then coalesce((p_flags->>'already_sold')::boolean, false)
    when 'review' then coalesce((p_flags->>'import_review_required')::boolean, false)
    else false end;
$$;

create or replace function public.lead_pool_candidates(p_source text, p_filters jsonb default '{}')
returns table(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
  age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean,
  already_sold boolean, in_bundle boolean)
language sql stable security definer set search_path to 'public' as $$
with holds as materialized (
  select h.phone10,
    bool_or(coalesce((h.flags->>'true_dnc')::boolean, h.dnc and not coalesce((h.flags->>'current_client')::boolean,false))) as true_dnc,
    bool_or(coalesce((h.flags->>'current_client')::boolean,false)) as current_client,
    bool_or(coalesce((h.flags->>'import_review_required')::boolean,false)) as needs_review
  from public.mat_lead_pool h
  where h.dnc or h.flags @> '{"true_dnc":true}' or h.flags @> '{"current_client":true}' or h.flags @> '{"import_review_required":true}'
  group by h.phone10
), taps as materialized (
  select i.phone10,count(*)::int as n,max(e.at) as touched_at,(array_agg(e.actor order by e.at desc))[1] as actor
  from public.lead_bundle_events e join public.lead_bundle_items i on i.id=e.item_id
  where e.action='dial_tap' group by i.phone10
), work as materialized (
  select distinct on (i.phone10) i.phone10, i.status, i.status_at, i.callback_at, i.next_action,
    coalesce((select a.display_name from public.agents a where a.user_id = i.status_by
       order by (a.canonical_agent_id is null) desc, a.created_at limit 1), i.last_agent) as caller
  from public.lead_bundle_items i where i.status_at is not null
  order by i.phone10, i.status_at desc, i.id
), base as (
  select s.*, d.phone10 is not null or d_old.phone10 is not null as registered_dnc, h.true_dnc as cross_dnc, h.current_client as cross_client, h.needs_review as cross_review,
    exists(select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10) as sold,
    exists(select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null) as assigned,
    coalesce(s.flags, '{}') || case when w.status_at > coalesce(public.lead_context_time(s.flags->>'last_touched_at'), '-infinity'::timestamptz)
      then jsonb_build_object('last_caller', w.caller, 'last_outcome', w.status,
        'last_touched_at', w.status_at, 'callback_at', w.callback_at, 'next_action', w.next_action)
      else '{}'::jsonb end || jsonb_strip_nulls(jsonb_build_object(
      'times_called',coalesce((s.flags->>'times_called')::integer,0)+coalesce(t.n,0),
      'source_attempts',coalesce((s.flags->>'times_called')::integer,0),
      'last_touched_at',greatest(public.lead_context_time(s.flags->>'last_touched_at'),w.status_at,t.touched_at))) ||
      case when t.touched_at > greatest(coalesce(public.lead_context_time(s.flags->>'last_touched_at'),'-infinity'::timestamptz),coalesce(w.status_at,'-infinity'::timestamptz))
        then jsonb_build_object('last_caller',(select a.display_name from public.agents a where a.user_id=t.actor order by a.created_at limit 1))
        else '{}'::jsonb end as context_flags
  from public.mat_lead_pool s
  left join public.lead_contact_dnc d on d.phone10 = s.phone10
  left join public.lead_contact_dnc d_old on d_old.phone10 = s.flags->>'replaced_phone10'
  left join holds h on h.phone10 = s.phone10
  left join work w on w.phone10 = s.phone10
  left join taps t on t.phone10 = s.phone10
  where s.source = p_source
), truth as (
  select b.*, b.registered_dnc or coalesce(b.cross_dnc,false) as true_dnc,
    coalesce(b.cross_client,false) as current_client, coalesce(b.cross_review,false) as needs_review
  from base b
), context as (
  select t.*, t.context_flags || jsonb_build_object('true_dnc', t.true_dnc, 'dnc', t.true_dnc,
    'last_outcome', case when coalesce((t.context_flags->>'times_called')::integer,0)>0 and public.lead_outcome_key(t.context_flags->>'last_outcome')='never_called' then 'unknown' else public.lead_outcome_key(t.context_flags->>'last_outcome') end,
    'current_client', t.current_client, 'import_review_required', t.needs_review,
    'policy_standing', case when t.current_client then 'current_client' else coalesce(t.context_flags->>'policy_standing','unverified') end, 'already_sold', t.sold, 'in_bundle', t.assigned,
    'blocked', t.true_dnc or t.current_client or t.sold or t.assigned or t.needs_review) as merged
  from truth t
)
select c.lead_id, c.phone10, c.first_name, c.last_name, c.email, c.state, c.age, c.tier,
 c.tags, c.merged, c.lead_age_days, c.under_9mo, c.sold, c.assigned
from context c
where public.lead_pool_filter_matches(c.state, c.age, c.tier, c.lead_age_days, c.merged, coalesce(p_filters, '{}'));
$$;
revoke all on function public.lead_pool_candidates(text, jsonb) from public, anon, authenticated;

create or replace function public.sellable_pool(p_source text, p_filters jsonb default '{}')
returns table(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
 age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean,
 already_sold boolean, in_bundle boolean)
language sql stable security definer set search_path to 'public' as $$
 select * from public.lead_pool_candidates(p_source, p_filters) c where not (c.flags->>'blocked')::boolean;
$$;
revoke all on function public.sellable_pool(text, jsonb) from public, anon, authenticated;

create or replace function public.lead_pool_counts(p_source text, p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare result jsonb; refreshed timestamptz;
begin
  if not public.can_view_sold_calls() then raise exception 'Only lead administrators can browse lead pools.' using errcode = '42501'; end if;
  if p_source not in ('marketing', 'dialer', 'rewrite', 'winback') then raise exception 'Unknown lead pool.' using errcode = '22023'; end if;
  select refreshed_at into refreshed from public.lead_pool_snapshot_meta where id;
  with candidates as materialized (select * from public.lead_pool_candidates(p_source, p_filters)),
  ready as (select * from candidates where not (flags->>'blocked')::boolean),
  unique_ready as (select distinct on (phone10) * from ready
     order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days)
  select jsonb_build_object(
    'total', (select count(*) from unique_ready),
    'matching', (select count(*) from (select distinct phone10 from candidates) z),
    'under_9mo', (select count(*) from unique_ready where under_9mo),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from unique_ready group by tier) z), '{}'),
    'dnc_excluded', (select count(*) from (select distinct phone10 from candidates where (flags->>'true_dnc')::boolean) z),
    'client_excluded', (select count(*) from (select distinct phone10 from candidates where (flags->>'current_client')::boolean) z),
    'review_excluded', (select count(*) from (select distinct phone10 from candidates where coalesce((flags->>'import_review_required')::boolean,false)) z),
    'resold_excluded', (select count(*) from (select distinct phone10 from candidates where already_sold) z),
    'in_bundle_excluded', (select count(*) from (select distinct phone10 from candidates where in_bundle) z),
    'sample', coalesce((select jsonb_agg(to_jsonb(z)) from (
      select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
        state, age, tier, tags, flags - 'replaced_phone10' as flags, lead_age_days, under_9mo
      from (select distinct on (phone10) * from candidates
        where not (flags->>'blocked')::boolean or nullif(p_filters->>'hold','') is not null
        order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days) c
      order by array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days limit 25) z), '[]'),
    'as_of', refreshed, 'snapshot', true) into result;
  return result;
end $$;

-- Defense at the distribution boundary also covers older pack APIs. A display
-- filter can never override a restriction, and a transfer rechecks the phone.
create or replace function public.fn_lead_assignment_hold()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.removed_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.removed_at is null and new.bundle_id = old.bundle_id then
      -- Correcting a number in an existing pack is not a new distribution.
      -- Keep the record inspectable and let My Leads display its live hold.
      -- This also prevents one held correction aborting the scheduled snapshot.
      if new.phone10 is distinct from old.phone10 and exists(select 1 from public.lead_contact_dnc d where d.phone10=old.phone10) then
        perform pg_advisory_xact_lock(hashtextextended(new.phone10,951));
        insert into public.lead_contact_dnc(phone10,recorded_source) values(new.phone10,'suppressed_phone_correction') on conflict do nothing;
      end if;
      return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.phone10, 951));
  if exists(select 1 from public.lead_contact_dnc d where d.phone10 = new.phone10 or d.phone10=new.attrs->>'replaced_phone10')
    or exists(select 1 from public.mat_lead_pool s where s.phone10 = new.phone10
      and (coalesce((s.flags->>'true_dnc')::boolean, s.dnc and not coalesce((s.flags->>'current_client')::boolean,false))
        or coalesce((s.flags->>'current_client')::boolean, false)
        or coalesce((s.flags->>'import_review_required')::boolean, false)))
    or exists(select 1 from public.lead_resale_ledger r where r.phone10 = new.phone10) then
    raise exception 'Lead is held from distribution. Refresh the pool and review its hold reason.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists lead_assignment_hold on public.lead_bundle_items;
create trigger lead_assignment_hold before insert or update of phone10, removed_at on public.lead_bundle_items
 for each row execute function public.fn_lead_assignment_hold();
revoke all on function public.fn_lead_assignment_hold() from public, anon, authenticated;

-- Follow-up scheduling writes an event; it does not send messages or start calls.
create or replace function public.lead_bundle_followup_set(p_item uuid, p_callback_at timestamptz, p_next_action text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare b uuid;
begin
 select i.bundle_id into b from public.lead_bundle_items i join public.lead_bundles b on b.id=i.bundle_id and b.archived_at is null where i.id = p_item and i.removed_at is null;
 if b is null then raise exception 'That lead is no longer assigned.' using errcode = '22023'; end if;
 if not (public.can_view_sold_calls() or exists(select 1 from public.lead_bundle_grants g
    where g.bundle_id = b and g.user_id = auth.uid() and g.revoked_at is null)) then
   raise exception 'This lead is not assigned to you.' using errcode = '42501';
 end if;
 if exists(select 1 from public.lead_bundle_items i join public.lead_contact_dnc d using(phone10) where i.id = p_item)
 or exists(select 1 from public.lead_bundle_items i join public.mat_lead_pool m using(phone10) where i.id=p_item and (m.flags @> '{"current_client":true}' or m.flags @> '{"import_review_required":true}')) then
   raise exception 'This lead is held and cannot be scheduled.' using errcode = '23514';
 end if;
 update public.lead_bundle_items set callback_at = p_callback_at, next_action = left(nullif(btrim(p_next_action), ''), 500),
   status = case when p_callback_at is not null then 'callback' else status end,
   status_at = now(), status_by = auth.uid() where id = p_item;
 insert into public.lead_bundle_events(bundle_id, item_id, user_id, actor, action, detail)
 values(b, p_item, auth.uid(), auth.uid(), 'followup', jsonb_build_object('callback_at',p_callback_at,'next_action',left(p_next_action,500)));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.lead_bundle_followup_set(uuid, timestamptz, text) from public, anon;
grant execute on function public.lead_bundle_followup_set(uuid, timestamptz, text) to authenticated;

-- Copy the selected work context into the pack, including when it moves.
CREATE OR REPLACE FUNCTION public.lead_pool_assign(p_source text, p_filters jsonb, p_limit integer, p_agent_user_id uuid, p_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare v_agent text; v_bundle uuid; v_n int; v_name text;
  v_sort text := coalesce(p_filters->>'sort', 'tier');
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can drop leads into a portal.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A pack holds 1 to 5,000 leads.' using errcode = '22023';
  end if;
  if p_source not in ('marketing','dialer','rewrite','winback') then raise exception 'Unknown lead pool.' using errcode = '22023'; end if;
  select a.display_name into v_agent from public.agents a
  where a.user_id = p_agent_user_id and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
  order by (a.canonical_agent_id is null) desc, a.created_at limit 1;
  if v_agent is null then raise exception 'Pick a live agent with a portal login.' using errcode = '22023'; end if;

  v_name := coalesce(nullif(btrim(p_name), ''),
    v_agent || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' (' || p_source || ')');
  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (v_name, 'client_leads',
          coalesce(p_filters, '{}'::jsonb) || jsonb_build_object('pool', p_source, 'limit', p_limit),
          nullif(btrim(p_note), ''), auth.uid())
  returning id into v_bundle;

  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
     quality_tier, quality_reason, status, attrs, attempts, last_dialed_at, last_disposition, last_agent, callback_at, next_action)
  select v_bundle, e.lead_id, p_source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, 'new',
         e.flags || jsonb_build_object('lead_age_days', e.lead_age_days, 'under_9mo', e.under_9mo, 'pool', p_source),
         coalesce((e.flags->>'times_called')::integer,0), public.lead_context_time(e.flags->>'last_touched_at'),
         e.flags->>'last_outcome', e.flags->>'last_caller', public.lead_context_time(e.flags->>'callback_at'), e.flags->>'next_action'
  from (
    -- One row per phone: the unique index is phone-grain, so the selection must
    -- be too. rank 1 = the best row for that phone under the caller's sort.
    select q.*, row_number() over (
      partition by q.phone10
      order by
        case when v_sort = 'chargeback' then (case when q.under_9mo then 0 else 1 end) end asc nulls last,
        case when v_sort = 'oldest' then q.lead_age_days end desc,
        array_position(array['S','pos','A','B','F','C','D'], q.tier), q.lead_age_days asc
    ) as rn
    from (
      select * from public.sellable_pool(p_source, p_filters) m
    ) q
  ) e
  where e.rn = 1
  order by
    case when v_sort = 'chargeback' then (case when e.under_9mo then 0 else 1 end) end asc nulls last,
    case when v_sort = 'oldest' then e.lead_age_days end desc,
    array_position(array['S','pos','A','B','F','C','D'], e.tier), e.lead_age_days asc
  limit p_limit
  on conflict (phone10) where (removed_at is null) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No assignable leads remain for these filters. Refresh the preview.' using errcode = '22023'; end if;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
  values (v_bundle, p_agent_user_id, auth.uid(), nullif(btrim(p_note), ''));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_agent_user_id, auth.uid(), 'granted',
          jsonb_build_object('agent', v_agent, 'items', v_n, 'pool', p_source));
  return jsonb_build_object('bundle_id', v_bundle, 'items', v_n, 'agent', v_agent);
end $function$;

create or replace function public.lead_move_unworked(p_from uuid, p_to uuid, p_limit integer default null, p_pause boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_to text; v_from text; v_ids uuid[]; v_bundles uuid[]; v_bundle uuid; v_n int := 0;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can move leads.' using errcode = '42501';
  end if;
  if p_from = p_to then raise exception 'Pick a different agent to move the leads to.' using errcode = '22023'; end if;
  select a.display_name into v_to from public.agents a
   where a.user_id = p_to and a.status = 'active'
     and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
     and not public.fn_agent_is_roster_excluded(a.id)
   order by (a.canonical_agent_id is null) desc, a.created_at limit 1;
  if v_to is null then raise exception 'Pick a live agent with a portal login.' using errcode = '22023'; end if;
  select coalesce((select a.display_name from public.agents a where a.user_id = p_from
                    order by (a.canonical_agent_id is null) desc, a.created_at limit 1), 'agent') into v_from;

  select array_agg(s.item_id), array_agg(distinct s.bundle_id) into v_ids, v_bundles
    from (select u.item_id, u.bundle_id from public.fn_lead_unworked_items(p_from) u
           limit greatest(1, least(coalesce(p_limit, 5000), 5000))) s;
  if v_ids is null then
    return jsonb_build_object('moved', 0, 'agent', v_to);
  end if;

  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (v_to || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' (moved from ' || v_from || ')',
          'client_leads', jsonb_build_object('pool', 'moved', 'moved_from', p_from), null, auth.uid())
  returning id into v_bundle;

  -- free the phones first: live items are unique per phone
  update public.lead_bundle_items set removed_at = now() where id = any(v_ids) and removed_at is null;
  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
     quality_tier, quality_reason, attempts, last_dialed_at, last_disposition, last_agent, status, attrs, status_note, status_at, status_by, callback_at, next_action)
  select v_bundle, i.lead_id, i.source_kind, i.phone10, i.first_name, i.last_name, i.email, i.state, i.age,
         i.quality_tier, i.quality_reason, i.attempts, i.last_dialed_at, i.last_disposition, i.last_agent, 'new',
         coalesce(i.attrs, '{}'::jsonb) || jsonb_build_object('moved_from', v_from, 'origin_item_id', coalesce(i.attrs->>'origin_item_id', i.id::text)),
         i.status_note, i.status_at, i.status_by, i.callback_at, i.next_action
    from public.lead_bundle_items i where i.id = any(v_ids)
  on conflict (phone10) where (removed_at is null) do nothing;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note) values (v_bundle, p_to, auth.uid(), 'moved from ' || v_from);
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_to, auth.uid(), 'granted', jsonb_build_object('agent', v_to, 'items', v_n, 'pool', 'moved', 'moved_from', p_from));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  select x.bundle_id, p_from, auth.uid(), 'moved_out', jsonb_build_object('items', x.n, 'to', p_to)
    from (select u.bundle_id, count(*)::int as n from public.fn_lead_unworked_items_from(v_ids) u group by 1) x;
  update public.lead_bundles b set archived_at = now()
   where b.id = any(v_bundles) and b.archived_at is null
     and not exists (select 1 from public.lead_bundle_items i where i.bundle_id = b.id and i.removed_at is null);
  if p_pause then perform public.lead_hold_set(p_from, true, 'unworked leads moved to ' || v_to); end if;
  return jsonb_build_object('moved', v_n, 'agent', v_to, 'bundle_id', v_bundle, 'paused', p_pause);
end $$;


-- Cached tiles/facets use the same phone-grain ready set. This runs only during
-- the existing scheduled refresh, never on a page request.
create or replace function public.fn_lead_pool_stats_refresh()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tiles jsonb; v_facets jsonb;
begin
 with src as (select unnest(array['marketing','dialer','rewrite','winback']) as source),
 ready as materialized (
   select distinct on (src.source,c.phone10) src.source,c.* from src
   cross join lateral public.sellable_pool(src.source,'{}') c
   order by src.source,c.phone10,array_position(array['S','pos','A','B','F','C','D'],c.tier),c.lead_age_days
 ), per as (select source,tier,count(*)::int n from ready group by 1,2)
 select jsonb_object_agg(src.source,jsonb_build_object('total',(select count(*) from ready r where r.source=src.source),
   'by_tier',coalesce((select jsonb_object_agg(tier,n) from per where per.source=src.source),'{}'))),
 jsonb_object_agg(src.source,jsonb_build_object(
   'states',coalesce((select jsonb_agg(jsonb_build_object('k',state,'n',n) order by n desc,state)
      from (select state,count(*)::int n from ready r where r.source=src.source and state ~ '^[A-Z]{2}$' group by state) q),'[]'),
   'no_state',(select count(*) from ready r where r.source=src.source and state is null),
   'campaigns',coalesce((select jsonb_agg(jsonb_build_object('k',campaign,'n',n) order by campaign)
      from (select campaign,count(*)::int n from ready r
       cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.flags->'campaigns')='array' then r.flags->'campaigns' else '[]' end) c(campaign)
       where r.source=src.source group by campaign) q),'[]')))
 into v_tiles,v_facets from src;
 update public.lead_pool_stats set tiles=v_tiles,facets=v_facets,computed_at=now(),last_error=null where id;
end $$;
revoke all on function public.fn_lead_pool_stats_refresh() from public, anon, authenticated;

-- Capture Book Flips opt-outs immediately, even if the number has no dialer row.
create or replace function public.fn_lead_capture_book_dnc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare p text;
begin
 if new.flip_status='do_not_call' then
  for p in select distinct right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),10)
   from public.v_book_flip_worklist w where w.carrier=new.carrier and w.policy_number=new.policy_number and w.client_key=new.client_key
  loop
   if p ~ '^[0-9]{10}$' then
    perform pg_advisory_xact_lock(hashtextextended(p,951));
    insert into public.lead_contact_dnc(phone10,recorded_source) values(p,'book_flips') on conflict do nothing;
   end if;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists lead_capture_dnc on public.book_flips;
create trigger lead_capture_dnc after insert or update of flip_status on public.book_flips for each row execute function public.fn_lead_capture_book_dnc();
revoke all on function public.fn_lead_capture_book_dnc() from public, anon, authenticated;

-- A pack export is an explicit safe field list, not a raw source-row dump. It
-- carries hold reasons for the administrator and excludes restricted numbers
-- from the transferable CSV. Existing source histories remain keyed to phone.
create or replace function public.lead_bundle_export_detail(p_bundle uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare result jsonb;
begin
 if not public.can_view_sold_calls() then raise exception 'Only lead administrators can export packs.' using errcode='42501'; end if;
 with items as (
   select i.*, tap.n as app_taps,tap.touched_at as tap_at,tap.actor as tap_actor, coalesce(i.attrs,'{}') || coalesce(s.flags,'{}') || jsonb_build_object(
     'source_attempts',coalesce((s.flags->>'times_called')::integer,(i.attrs->>'source_attempts')::integer,i.attempts,0),
     'source_type',coalesce(s.flags->>'source_type',i.attrs->>'source_type',cl.raw->>'source_type'),
     'source_file',coalesce(s.flags->>'source_file',i.attrs->>'source_file',cl.source_file),
     'source_batch_id',coalesce(s.flags->>'source_batch_id',i.attrs->>'source_batch_id',cl.raw->>'source_batch_id'),
     'policy_ownership_claim',coalesce(s.flags->>'policy_ownership_claim',i.attrs->>'policy_ownership_claim',cl.raw->>'policy_ownership_claim'),
     'policy_carrier',coalesce(s.flags->>'policy_carrier',i.attrs->>'policy_carrier',cl.policy_carrier),
     'policy_product',coalesce(s.flags->>'policy_product',i.attrs->>'policy_product',cl.policy_product),
     'policy_monthly_premium',coalesce(s.flags->>'policy_monthly_premium',i.attrs->>'policy_monthly_premium',cl.policy_monthly_premium::text),
     'policy_face_amount',coalesce(s.flags->>'policy_face_amount',i.attrs->>'policy_face_amount',cl.policy_face_amount::text)) as context
   from public.lead_bundle_items i
   left join public.client_leads cl on cl.id=i.lead_id
   left join lateral (select count(*)::int as n,max(e.at) as touched_at,(array_agg(e.actor order by e.at desc,e.id desc))[1] as actor
     from public.lead_bundle_events e join public.lead_bundle_items prior on prior.id=e.item_id
     where prior.phone10=i.phone10 and e.action='dial_tap') tap on true
   left join lateral (select m.flags from public.mat_lead_pool m where m.phone10=i.phone10
      order by (m.source=i.source_kind) desc,m.rid limit 1) s on true
   where i.bundle_id=p_bundle and i.removed_at is null
 ), detail as (
   select i.id,i.first_name,i.last_name,i.phone10,i.email,i.state,i.age,i.quality_tier as grade,i.quality_reason as tags,i.status,
    i.source_kind,i.context->>'source_type' as source_type,i.context->>'source_file' as source_file,
    i.context->>'source_batch_id' as source_batch_id,i.context->>'policy_ownership_claim' as policy_ownership_claim,
    case when i.tap_at > greatest(coalesce(i.status_at,'-infinity'::timestamptz),coalesce(public.lead_context_time(i.context->>'last_touched_at'),'-infinity'::timestamptz))
      then (select display_name from public.agents where user_id=i.tap_actor order by created_at limit 1)
      when i.status_at > coalesce(public.lead_context_time(i.context->>'last_touched_at'),'-infinity'::timestamptz)
      then coalesce((select display_name from public.agents where user_id=i.status_by order by created_at limit 1),i.last_agent)
      else coalesce(i.context->>'last_caller',i.last_agent) end as last_caller,
    case when i.status_at > coalesce(public.lead_context_time(i.context->>'last_touched_at'),'-infinity'::timestamptz)
      then i.status else coalesce(i.context->>'last_outcome',i.last_disposition,'never_called') end as last_outcome,
    greatest(i.status_at,i.last_dialed_at,i.tap_at,public.lead_context_time(i.context->>'last_touched_at')) as last_touched_at,
    greatest(i.attempts,coalesce((i.context->>'source_attempts')::integer,0)+coalesce(i.app_taps,0)) as attempts,
    i.callback_at,coalesce(i.next_action,i.context->>'next_action',case
      when i.status='callback' then 'Call back at the agreed time'
      when i.status='appointment' then 'Confirm the appointment'
      when i.context->>'policy_ownership_claim' is not null then 'Confirm reported policy details before advising'
      else 'Review history, contact lead and record outcome' end) as next_action,
    coalesce(i.context->>'policy_standing','unverified') as policy_standing,
    i.context->>'policy_carrier' as policy_carrier,i.context->>'policy_product' as policy_product,
    i.context->>'policy_monthly_premium' as policy_monthly_premium,i.context->>'policy_face_amount' as policy_face_amount,
    (select q.summary from (
      select coalesce(r.summary->>'briefSummary',r.summary->>'summary') as summary,r.created_at as at from public.lead_item_recordings r where r.phone10=i.phone10
      union all select ci.summary,c.call_started_at from public.readymode_dialer_calls c join public.readymode_call_insights ci on ci.call_id=c.id where c.lead_phone10=i.phone10
    ) q where nullif(q.summary,'') is not null order by q.at desc limit 1) as last_summary,
    ((select count(*) from public.lead_item_recordings r where r.phone10=i.phone10)
      + (select count(*) from public.readymode_dialer_calls c where c.lead_phone10=i.phone10 and (c.recording_path is not null or c.recording_url is not null))) as recording_count,
    (select string_agg(h.entry,E'\n' order by h.at desc) from (
      select e.at,concat_ws(' | ',e.at::text,e.action,a.display_name,e.detail->>'status',e.detail->>'note') as entry
      from public.lead_bundle_events e join public.lead_bundle_items old on old.id=e.item_id
      left join lateral (select display_name from public.agents where user_id=e.actor order by created_at limit 1) a on true
      where old.phone10=i.phone10 order by e.at desc limit 20) h) as work_history,
    (select string_agg(h.entry,E'\n' order by h.at desc) from (
      select c.call_started_at as at,concat_ws(' | ',c.call_started_at::text,c.agent_raw,c.disposition) as entry
      from public.readymode_dialer_calls c where c.lead_phone10=i.phone10 order by c.call_started_at desc limit 20) h) as call_history,
    concat_ws('; ',case when i.status='do_not_call' or exists(select 1 from public.lead_contact_dnc d where d.phone10=i.phone10 or d.phone10=i.attrs->>'replaced_phone10') or exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"true_dnc":true}') then 'Do not call' end,
      case when exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"current_client":true}') then 'Existing client' end,
      case when exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"import_review_required":true}') then 'Import review' end) as hold_reasons
   from items i
 )
 select coalesce(jsonb_agg(to_jsonb(d) - 'id' order by grade,last_name),'[]') into result from detail d;
 return result;
end $$;
revoke all on function public.lead_bundle_export_detail(uuid) from public, anon;
grant execute on function public.lead_bundle_export_detail(uuid) to authenticated;

-- Held leads remain visible with explicit reasons; calls and pipeline actions are blocked.
-- Grant scope and calling hours remain intact; every genuine DNC source is honored.
create or replace function public.my_lead_bundles()
returns table(item_id uuid, bundle_id uuid, bundle_name text, bundle_note text, format text, phone10 text,
              first_name text, last_name text, email text, state text, age integer, quality_tier text,
              quality_reason text, attrs jsonb, attempts integer, last_dialed_at timestamptz,
              last_disposition text, status text, status_note text, status_at timestamptz,
              granted_at timestamptz, callable_now boolean, callable_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id, b.id, b.name, b.note, b.format, i.phone10, i.first_name, i.last_name, i.email,
         i.state, i.age, i.quality_tier, i.quality_reason, coalesce(i.attrs, '{}'::jsonb) || jsonb_build_object('callback_at', i.callback_at, 'next_action', i.next_action, 'last_caller', i.last_agent,
           'true_dnc',h.true_dnc,'dnc',h.true_dnc,'current_client',h.current_client,'import_review_required',h.review,
           'blocked',h.true_dnc or h.current_client or h.review), i.attempts,
         i.last_dialed_at, i.last_disposition, i.status, i.status_note, i.status_at, g.granted_at,
         w.callable and not (h.true_dnc or h.current_client or h.review), w.opens_at
  from public.lead_bundle_grants g
  join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
  join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
  cross join lateral (
    select i.status='do_not_call' or exists(select 1 from public.lead_contact_dnc d where d.phone10=i.phone10 or d.phone10=i.attrs->>'replaced_phone10')
      or exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"true_dnc":true}') as true_dnc,
      exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"current_client":true}') as current_client,
      exists(select 1 from public.mat_lead_pool m where m.phone10=i.phone10 and m.flags @> '{"import_review_required":true}') as review
  ) h
  cross join lateral public.lead_calling_window(i.state, i.phone10) w
  where g.user_id = auth.uid() and g.revoked_at is null

  order by b.created_at desc, array_position(array['pos', 'A', 'B', 'C', 'D'], i.quality_tier), i.last_dialed_at desc nulls last
$function$;

revoke all on function public.my_lead_bundles() from public, anon;
grant execute on function public.my_lead_bundles() to authenticated, service_role;

-- Existing refresh_lead_pool_snapshot already calls fn_lead_pool_stats_refresh.
-- New context is visible after its next scheduled refresh; distribution guards
-- and the DNC registry become effective immediately.
notify pgrst, 'reload schema';
commit;
