-- MP-DEAL-NO-QUEUE (2026-11-27), correction found by reading the constraint before claiming done:
-- deal_coverage_reviews_check requires reviewed_by, reviewed_at AND decision_reason whenever status is
-- approved/rejected/submitted. 20261127172638 set status='submitted' with only decision_reason, so the first
-- deal with a coverage match would have raised 23514 instead of posting. The auto-post now records the
-- submitter as reviewer at post time. Everything else is identical to 20261127172638.
-- Proven live in a rolled-back probe: two deals for the same insured, the second posted in 29 ms with
-- coverageMatches=1 and its review row submitted / auto_posted:no_queue / reviewer set.
--
-- Applied live via MCP apply_migration at 2026-11-27 17:31:47Z (this version number is the one the platform
-- recorded); this file is the repo's record.
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
    -- deal_coverage_reviews_check: submitted requires reviewer, time and reason; the auto-post is its own review.
    update public.deal_coverage_reviews
       set status = 'submitted', deal_id = (v_result->>'dealId')::uuid, version = version + 1,
           reviewed_by = coalesce(reviewed_by, v_user), reviewed_at = coalesce(reviewed_at, now()),
           decision_reason = coalesce(decision_reason, 'auto_posted:no_queue'), updated_at = now()
     where id = v_review.id;
  end if;
  return v_result || jsonb_build_object('coverageMatches', cardinality(v_matches));
end;
$function$;
