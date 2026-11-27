-- MP-DEAL-NO-QUEUE (2026-11-27). Sam: "all deals posted should be posted, there's no queue."
-- The coverage-review HOLD introduced by 20261127050000 (PR 82) is switched off. A deal whose insured matches
-- existing coverage (same carrier + DOB + name or phone) now POSTS immediately; the match is still written to
-- deal_coverage_reviews with status 'submitted' and decision_reason 'auto_posted:no_queue', so duplicate coverage
-- stays visible for review after the fact and nothing waits on a manager. Field completeness (carrier, DOB in
-- the past, first and last name, 10-digit phone) still applies to authenticated writers; service-role imports
-- (auth.uid() is null) stay exempt as before. Locks in submit_apex_deal are unchanged in this migration
-- (the try-lock follows in 20261127175500_submit_apex_deal_try_lock).
--
-- Applied live via MCP apply_migration at 2026-11-27 17:26:38Z (this version number is the one the platform
-- recorded); this file is the repo's record.

create or replace function public.enforce_deal_coverage_review()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Trusted carrier ingestion has no end-user identity. Authenticated table
  -- writes, including admin bulk entry, still have to pass the completeness check.
  if auth.uid() is null then
    return new;
  end if;
  if public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'This account cannot post deals' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and old.agent_id is not distinct from new.agent_id
     and old.carrier_id is not distinct from new.carrier_id
     and old.client_dob is not distinct from new.client_dob
     and public.deal_coverage_name(old.client_first_name, old.client_last_name) = public.deal_coverage_name(new.client_first_name, new.client_last_name)
     and public.deal_coverage_phone(old.client_phone) = public.deal_coverage_phone(new.client_phone) then
    return new;
  end if;
  if new.carrier_id is null or new.client_dob is null or new.client_dob >= current_date
     or nullif(btrim(new.client_first_name), '') is null or nullif(btrim(new.client_last_name), '') is null
     or length(public.deal_coverage_phone(new.client_phone)) < 10 then
    raise exception 'A complete insured name, valid date of birth, phone and carrier are required. Use Post a Deal.' using errcode = '23514';
  end if;
  -- MP-DEAL-NO-QUEUE: no coverage hold here. Matches are recorded by submit_apex_deal; the deal posts.
  return new;
end;
$function$;

create or replace function public.submit_apex_deal(p_idempotency_key uuid, p_payload jsonb, p_agent_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user uuid := auth.uid();
  v_own uuid;
  v_agent uuid;
  v_manager uuid;
  v_carrier uuid;
  v_dob date;
  v_name text;
  v_phone text;
  v_hash text;
  v_evidence jsonb;
  v_matches uuid[];
  v_signals text[];
  v_draft public.deal_drafts;
  v_review public.deal_coverage_reviews;
  v_result jsonb;
  v_policy text;
  v_npn text;
begin
  if v_user is null or public.fn_user_login_blocked(v_user) or public.fn_user_is_suspended(v_user) then
    raise exception 'An eligible authenticated account is required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 100000 then
    raise exception 'A valid bounded deal payload and retry key are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text, 0));
  select a.id into v_own from public.agents a where a.user_id = v_user order by a.created_at limit 1;
  v_agent := coalesce(p_agent_id, v_own);
  if v_agent is null then
    raise exception 'No agent record is linked to this account' using errcode = '22023';
  end if;
  if v_agent is distinct from v_own and not public.apex_is_admin()
     and not (public.apex_has_any_role(array['manager']) and public.apex_can_read_agent(v_agent)) then
    raise exception 'Writing-agent override is not permitted' using errcode = '42501';
  end if;
  select a.manager_id, nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '')
    into v_manager, v_npn
    from public.agents a where a.id = v_agent;
  if not found then
    raise exception 'Writing agent does not exist' using errcode = '22023';
  end if;
  -- Existing receipts are still receipts, even if the book gained new coverage.
  if exists (select 1 from public.deals d where d.submitted_by_user_id = v_user and d.idempotency_key = p_idempotency_key) then
    return public.submit_apex_deal_before_coverage_review(p_idempotency_key, p_payload, p_agent_id);
  end if;
  begin
    v_carrier := (p_payload->>'carrierId')::uuid;
    v_dob := (p_payload->>'clientDob')::date;
  exception when others then
    raise exception 'A valid carrier and client date of birth are required' using errcode = '22023';
  end;
  v_name := public.deal_coverage_name(p_payload->>'clientFirstName', p_payload->>'clientLastName');
  v_phone := public.deal_coverage_phone(p_payload->>'clientPhone');
  if v_carrier is null or v_dob is null or v_dob >= current_date or v_name = ''
     or nullif(btrim(p_payload->>'clientFirstName'), '') is null or nullif(btrim(p_payload->>'clientLastName'), '') is null
     or length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Complete the insured name, valid date of birth, phone and carrier before submitting' using errcode = '22023';
  end if;
  if not exists (select 1 from public.carriers where id = v_carrier and coalesce(is_active, true)) then
    raise exception 'Selected carrier is not active' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deal-coverage:' || v_carrier::text || ':' || v_dob::text, 0));
  v_policy := public.fn_normalize_policy_number(p_payload->>'policyNumber');
  if v_policy <> '' and v_npn is not null and exists (
       select 1 from public.deals d
        where d.carrier_id = v_carrier and lower(btrim(d.policy_number)) = lower(v_policy)
          and d.writing_npn = v_npn and d.duplicate_of_deal_id is null) then
    return public.submit_apex_deal_before_coverage_review(p_idempotency_key, p_payload, p_agent_id);
  end if;
  -- Offline requests may reach the server before their earlier draft save.
  -- Store exactly the reviewed payload, never a stale merged form fragment.
  insert into public.deal_drafts (owner_user_id, idempotency_key, current_section, payload)
  values (v_user, p_idempotency_key, 'review', p_payload)
  on conflict (owner_user_id, idempotency_key) do update
     set payload = excluded.payload, current_section = 'review', updated_at = now()
  returning * into v_draft;
  if v_draft.status <> 'draft' then
    raise exception 'This draft is no longer open; refresh before retrying' using errcode = '40001';
  end if;
  v_hash := public.deal_coverage_payload_hash(p_payload, v_agent);
  v_evidence := public.deal_coverage_candidates(v_carrier, v_dob, v_name, v_phone);
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_matches from jsonb_array_elements_text(v_evidence->'ids') x;
  select coalesce(array_agg(x), '{}'::text[]) into v_signals from jsonb_array_elements_text(v_evidence->'signals') x;
  select * into v_review from public.deal_coverage_reviews
   where owner_user_id = v_user and idempotency_key = p_idempotency_key for update;
  -- MP-DEAL-NO-QUEUE: a match is RECORDED, never a hold. The deal posts below either way.
  if cardinality(v_matches) > 0 and v_review.id is null then
    insert into public.deal_coverage_reviews (draft_id, owner_user_id, idempotency_key, agent_id, manager_agent_id,
                                              payload_hash, evidence_hash, matched_deal_ids, match_signals)
    values (v_draft.id, v_user, p_idempotency_key, v_agent, v_manager, v_hash, v_evidence->>'hash', v_matches, v_signals)
    returning * into v_review;
  end if;
  v_result := public.submit_apex_deal_before_coverage_review(p_idempotency_key, p_payload, p_agent_id);
  if v_result->>'dealId' is null then
    raise exception 'Posting returned no durable deal receipt' using errcode = 'P0001';
  end if;
  if v_review.id is not null then
    update public.deal_coverage_reviews
       set status = 'submitted', deal_id = (v_result->>'dealId')::uuid, version = version + 1,
           decision_reason = coalesce(decision_reason, 'auto_posted:no_queue'), updated_at = now()
     where id = v_review.id;
  end if;
  return v_result || jsonb_build_object('coverageMatches', cardinality(v_matches));
end;
$function$;
