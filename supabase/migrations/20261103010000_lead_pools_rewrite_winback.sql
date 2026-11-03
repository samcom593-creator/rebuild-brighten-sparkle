-- APEX lead engine wave 2 (MP-LEAD-MANAGER, 2026-11-03), review-hardened.
-- Four normalized pools (marketing/dialer/re-write/lapsed win-back), a dispatcher,
-- unified counts+assign, agent record+log flow, closers leaderboard, drill-down.
-- Applied live via bot-sql; mirrored here. Owned leads + own-pipeline re-work +
-- lapsed-only win-back to OWN agents. SSN/bank surface as presence booleans only.
-- Hardened after adversarial review: dialer holds back ALL do-not-call (tier
-- 'blocked'); win-back excludes in-force deals; closers credit the agent who
-- marked the close; the raw sellable_* engines are NOT callable by clients.

alter table public.lead_bundle_items add column if not exists recording_path text;

drop view if exists public.v_pool_marketing;
create view public.v_pool_marketing with (security_invoker = true) as
 SELECT lead_id,
    phone10,
    first_name,
    last_name,
    email,
    state,
    age,
    grade AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[
        CASE
            WHEN wants_mortgage THEN 'mortgage'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_veteran THEN 'veteran'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_homeowner THEN 'homeowner'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_policyholder THEN 'policyholder'::text
            ELSE NULL::text
        END,
        CASE
            WHEN lead_age_days < 274 THEN 'under-9mo'::text
            ELSE NULL::text
        END], NULL::text), ', '::text), ''::text) AS tags,
    jsonb_build_object('mortgage', wants_mortgage, 'veteran', is_veteran, 'homeowner', is_homeowner, 'policyholder', is_policyholder, 'dnc', dnc) AS flags,
    lead_age_days,
    lead_age_days < 274 AS under_9mo
   FROM v_sellable_client_leads s;

drop view if exists public.v_pool_dialer;
create view public.v_pool_dialer with (security_invoker = true) as
 SELECT NULL::uuid AS lead_id,
    phone10,
    first_name,
    last_name,
    email,
    NULL::text AS state,
    NULL::integer AS age,
    quality_tier AS tier,
    quality_reason AS tags,
    jsonb_build_object('dnc', quality_tier = 'blocked'::text OR lower(COALESCE(last_disposition, ''::text)) = 'do not call'::text, 'campaign', campaign) AS flags,
    days_since_dialed AS lead_age_days,
    false AS under_9mo
   FROM v_readymode_lead_quality q;

drop view if exists public.v_pool_rewrite;
create view public.v_pool_rewrite with (security_invoker = true) as
 SELECT NULL::uuid AS lead_id,
    "right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AS phone10,
    p.client_first_name AS first_name,
    p.client_last_name AS last_name,
    NULL::text AS email,
    p.client_state AS state,
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
    jsonb_build_object('cc', p.payment_method_type = 'card'::text, 'direct_express', p.payment_method_type = 'direct_express'::text, 'bank_on_file', p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]), 'no_bank', p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text, 'ssn_collected', p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL, 'bank_collected', p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL, 'hung_up', p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]), 'spouse', COALESCE(ci.spouse_coverage, false), 'dnc', false) AS flags,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - (p.call_at AT TIME ZONE 'America/Phoenix'::text)::date AS lead_age_days,
    false AS under_9mo
   FROM readymode_booking_packets p
     LEFT JOIN readymode_call_insights ci ON ci.call_id = p.call_id
  WHERE COALESCE(p.status, ''::text) <> 'booked'::text;

drop view if exists public.v_pool_winback;
create view public.v_pool_winback with (security_invoker = true) as
 SELECT NULL::uuid AS lead_id,
    "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AS phone10,
    d.client_first_name AS first_name,
    d.client_last_name AS last_name,
    NULL::text AS email,
    NULL::text AS state,
        CASE
            WHEN d.client_dob IS NOT NULL THEN EXTRACT(year FROM age(d.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[c.name, d.product_sold, COALESCE(d.policy_status_standard, d.status)], NULL::text), ' · '::text), ''::text) AS tags,
    jsonb_build_object('lapsed', lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text, 'vantage', is_vantage_agent(d.agent_id), 'dnc', false) AS flags,
    now()::date - COALESCE(d.posted_at::date, d.effective_date) AS lead_age_days,
    false AS under_9mo
   FROM deals d
     LEFT JOIN carriers c ON c.id = d.carrier_id
  WHERE ((lower(COALESCE(d.status, ''::text)) = ANY (ARRAY['lapsed'::text, 'cancelled'::text])) OR d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken'::text) AND (lower(COALESCE(d.status, ''::text)) <> ALL (ARRAY['active'::text, 'in_force'::text, 'submitted'::text, 'pending'::text]));

CREATE OR REPLACE FUNCTION public.sellable_pool(p_source text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean, already_sold boolean, in_bundle boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_view text;
begin
  v_view := case p_source
    when 'marketing' then 'v_pool_marketing'
    when 'dialer' then 'v_pool_dialer'
    when 'rewrite' then 'v_pool_rewrite'
    when 'winback' then 'v_pool_winback' end;
  if v_view is null then raise exception 'Unknown lead pool: %', p_source using errcode = '22023'; end if;
  return query execute format($q$
    with f as (select
      case when jsonb_typeof($1->'tiers')='array' then array(select jsonb_array_elements_text($1->'tiers')) end as tiers,
      case when jsonb_typeof($1->'states')='array' then array(select upper(jsonb_array_elements_text($1->'states'))) end as states,
      case when jsonb_typeof($1->'require_flags')='array' then array(select jsonb_array_elements_text($1->'require_flags')) end as req_flags,
      ($1->>'min_age')::int as min_age, ($1->>'max_age')::int as max_age,
      ($1->>'max_lead_age_days')::int as max_lead_age_days,
      coalesce(($1->>'vantage_only')::boolean, false) as vantage_only)
    select s.lead_id, s.phone10, s.first_name, s.last_name, s.email, s.state, s.age,
      s.tier, s.tags, s.flags, s.lead_age_days, s.under_9mo,
      exists(select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10) as already_sold,
      exists(select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null) as in_bundle
    from public.%I s cross join f
    where s.phone10 ~ '^[0-9]{10}$'
      and (f.tiers is null or cardinality(f.tiers)=0 or s.tier = any(f.tiers))
      and (f.states is null or cardinality(f.states)=0 or s.state = any(f.states))
      and (f.req_flags is null or cardinality(f.req_flags)=0
           or (select bool_and(coalesce((s.flags->>rf)::boolean, false)) from unnest(f.req_flags) rf))
      and (f.min_age is null or s.age >= f.min_age)
      and (f.max_age is null or s.age <= f.max_age)
      and (f.max_lead_age_days is null or s.lead_age_days <= f.max_lead_age_days)
      and (not f.vantage_only or coalesce((s.flags->>'vantage')::boolean, false))
  $q$, v_view) using coalesce(p_filters, '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_pool_counts(p_source text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  with m as (select * from public.sellable_pool(p_source, p_filters)),
  e as (select * from m
        where not (v_excl_dnc and coalesce((flags->>'dnc')::boolean, false))
          and not (v_excl_sold and already_sold)
          and not in_bundle)
  select jsonb_build_object(
    'total', (select count(*)::int from e),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*)::int n from e group by tier) g), '{}'::jsonb),
    'under_9mo', (select count(*)::int from e where under_9mo),
    'dnc_excluded', (select count(*)::int from m where coalesce((flags->>'dnc')::boolean, false)),
    'resold_excluded', (select count(*)::int from m where already_sold),
    'in_bundle_excluded', (select count(*)::int from m where in_bundle),
    'sample', coalesce((select jsonb_agg(row_to_json(t)) from (
        select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
               state, age, tier, tags, flags, lead_age_days, under_9mo
        from e order by array_position(array['S','A','B','C','D'], tier), lead_age_days desc limit 25) t), '[]'::jsonb)
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.lead_pool_assign(p_source text, p_filters jsonb, p_limit integer, p_agent_user_id uuid, p_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_agent text; v_bundle uuid; v_n int; v_name text;
  v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
  v_sort text := coalesce(p_filters->>'sort', 'tier');
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can drop leads into a portal.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A pack holds 1 to 5,000 leads.' using errcode = '22023';
  end if;
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
     quality_tier, quality_reason, status, attrs)
  select v_bundle, e.lead_id, p_source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, 'new',
         e.flags || jsonb_build_object('lead_age_days', e.lead_age_days, 'under_9mo', e.under_9mo, 'pool', p_source)
  from (
    select * from public.sellable_pool(p_source, p_filters) m
    where not (v_excl_dnc and coalesce((m.flags->>'dnc')::boolean, false))
      and not (v_excl_sold and m.already_sold) and not m.in_bundle
  ) e
  order by
    case when v_sort = 'chargeback' then (case when e.under_9mo then 0 else 1 end) end asc nulls last,
    case when v_sort = 'oldest' then e.lead_age_days end desc,
    array_position(array['S','A','B','C','D'], e.tier), e.lead_age_days asc
  limit p_limit;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
  values (v_bundle, p_agent_user_id, auth.uid(), nullif(btrim(p_note), ''));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_agent_user_id, auth.uid(), 'granted',
          jsonb_build_object('agent', v_agent, 'items', v_n, 'pool', p_source));
  return jsonb_build_object('bundle_id', v_bundle, 'items', v_n, 'agent', v_agent);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_item_log(p_item uuid, p_status text, p_note text DEFAULT NULL::text, p_recording_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bundle uuid;
begin
  select bundle_id into v_bundle from public.lead_bundle_items where id = p_item and removed_at is null;
  if v_bundle is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  if not (public.can_view_sold_calls() or exists (
        select 1 from public.lead_bundle_grants g
        where g.bundle_id = v_bundle and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;
  if p_status not in ('new','no_answer','callback','appointment','sold','not_interested','bad_number','do_not_call') then
    raise exception 'Unknown status %.', p_status using errcode = '22023';
  end if;
  update public.lead_bundle_items
    set status = p_status,
        status_note = left(nullif(btrim(p_note), ''), 500),
        status_by = auth.uid(), status_at = now(),
        recording_path = coalesce(nullif(btrim(p_recording_path), ''), recording_path)
    where id = p_item;
  insert into public.lead_bundle_events (bundle_id, item_id, user_id, actor, action, detail)
  values (v_bundle, p_item, auth.uid(), auth.uid(), 'status',
          jsonb_build_object('status', p_status, 'note', left(p_note, 500),
                             'has_recording', (nullif(btrim(p_recording_path), '') is not null)));
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_closers_leaderboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.sold desc, t.appointments desc, t.dropped desc), '[]'::jsonb)
    into v from (
    select g.user_id,
      (select a.display_name from public.agents a where a.user_id = g.user_id
         order by (a.canonical_agent_id is null) desc, a.created_at limit 1) as display_name,
      count(i.id)::int as dropped,
      count(i.id) filter (where i.status <> 'new' and i.status_by = g.user_id)::int as worked,
      count(i.id) filter (where i.status = 'sold' and i.status_by = g.user_id)::int as sold,
      count(i.id) filter (where i.status = 'appointment' and i.status_by = g.user_id)::int as appointments,
      count(i.id) filter (where i.recording_path is not null and i.status_by = g.user_id)::int as recorded,
      round(100.0 * count(i.id) filter (where i.status = 'sold' and i.status_by = g.user_id) / nullif(count(i.id), 0), 1) as sold_rate
    from public.lead_bundle_grants g
    join public.lead_bundle_items i on i.bundle_id = g.bundle_id and i.removed_at is null
    where g.revoked_at is null
    group by g.user_id
    having count(i.id) > 0
  ) t;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_items_manage(p_bundle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.added_at), '[]'::jsonb) into v from (
    select i.id as item_id,
      nullif(concat_ws(' ', i.first_name, i.last_name), '') as name,
      '***-***-' || right(coalesce(i.phone10,''), 4) as phone_masked,
      i.quality_tier as tier, i.status, i.quality_reason as tags, i.added_at,
      (i.recording_path is not null) as has_recording
    from public.lead_bundle_items i
    where i.bundle_id = p_bundle and i.removed_at is null
  ) t;
  return v;
end $function$;

grant execute on function public.lead_pool_counts(text, jsonb) to authenticated;
grant execute on function public.lead_pool_assign(text, jsonb, integer, uuid, text, text) to authenticated;
grant execute on function public.lead_bundle_item_log(uuid, text, text, text) to authenticated;
grant execute on function public.lead_closers_leaderboard() to authenticated;
grant execute on function public.lead_bundle_items_manage(uuid) to authenticated;

-- Raw engines: owner-only. The SECURITY DEFINER wrappers call them as owner, so
-- revoking direct EXECUTE blocks client PII access without breaking the wrappers.
revoke execute on function public.sellable_pool(text, jsonb) from public;
revoke execute on function public.sellable_pool(text, jsonb) from authenticated;
revoke execute on function public.sellable_leads_match(jsonb) from public;
revoke execute on function public.sellable_leads_match(jsonb) from authenticated;
