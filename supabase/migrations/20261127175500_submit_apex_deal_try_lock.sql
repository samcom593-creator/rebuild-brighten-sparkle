-- MP-DEAL-SUBMIT-CONVOY (2026-11-27, incident "agents cannot post deals"). Measured live:
--   * 10 PostgREST sessions queued on ONE advisory lock, hashtextextended(user_id || ':' || idempotency_key),
--     i.e. one submission (an owner-account deal pending coverage review) re-sent concurrently;
--   * those sessions run with statement_timeout 120 s (the 8 s role setting is not in effect for them), so each
--     queued retry hung ~125 s until the gateway returned 504 (9 of 29 submits this morning), while the
--     retrying browsers refilled the queue and the whole 1 GB instance timed out other reads (57014 on the
--     deals lists from 16:47Z, which is what "my deals are missing" looked like);
--   * only 16 submit calls completed since the 12:18Z restart; 2 deals landed today.
-- Fix: the per-submission lock is now TRY: a second concurrent attempt for the same key returns
-- {ok:false, status:'in_progress'} at once instead of queueing (the client polls the receipt by key),
-- and lock_timeout is bounded to 5 s inside this function so no residual wait can hold a request for
-- two minutes. Nothing else in the function changes; the coverage logic is byte-for-byte the same.
--
-- Applied through CI on merge (a live MCP apply of this exact text was declined at 17:5x UTC, so this file
-- is the only path and the pre-push "left for CI" note is expected).
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
  -- MP-DEAL-SUBMIT-CONVOY: never queue behind another attempt of the SAME submission.
  if not pg_try_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text, 0)) then
    return jsonb_build_object('ok', false, 'status', 'in_progress', 'idempotencyKey', p_idempotency_key,
                              'message', 'This deal is already being saved. Wait for its receipt; do not resend.');
  end if;
  -- Any other lock this request has to wait for (the carrier+DOB coverage lock below, the policy lock in the
  -- ledger) fails fast instead of hanging the request for the platform's 120 s.
  perform set_config('lock_timeout', '5000', true);

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
  if cardinality(v_matches) > 0 then
    if v_review.id is null then
      insert into public.deal_coverage_reviews (draft_id, owner_user_id, idempotency_key, agent_id, manager_agent_id,
                                                payload_hash, evidence_hash, matched_deal_ids, match_signals)
      values (v_draft.id, v_user, p_idempotency_key, v_agent, v_manager, v_hash, v_evidence->>'hash', v_matches, v_signals)
      returning * into v_review;
    elsif v_review.payload_hash <> v_hash or v_review.evidence_hash <> v_evidence->>'hash'
          or v_review.agent_id <> v_agent or v_review.manager_agent_id is distinct from v_manager then
      insert into public.audit_log (action, actor_user_id, before_data, after_data, entity_id, entity_type)
      values ('deal.coverage_review_invalidated', v_user,
              jsonb_build_object('status', v_review.status, 'version', v_review.version),
              jsonb_build_object('reason', 'draft_or_coverage_changed'), v_review.id::text, 'deal_coverage_review');
      update public.deal_coverage_reviews
         set draft_id = v_draft.id, agent_id = v_agent, manager_agent_id = v_manager,
             payload_hash = v_hash, evidence_hash = v_evidence->>'hash', matched_deal_ids = v_matches, match_signals = v_signals,
             status = 'pending', version = version + 1, reviewed_by = null, reviewed_at = null, decision_reason = null,
             deal_id = null, updated_at = now()
       where id = v_review.id
      returning * into v_review;
    end if;
    if v_review.status <> 'approved' then
      return jsonb_build_object('ok', false,
                                'status', case when v_review.status = 'rejected' then 'review_rejected' else 'review_required' end,
                                'reviewId', v_review.id, 'reviewVersion', v_review.version, 'matchCount', cardinality(v_matches));
    end if;
  elsif v_review.id is not null then
    -- A changed identity cannot reuse an earlier approval. The normal no-match
    -- path is re-evaluated from the actual payload; no policy is auto-deleted.
    if v_review.payload_hash <> v_hash or v_review.evidence_hash <> v_evidence->>'hash' then
      raise exception 'This reviewed draft changed. Start a new deal after correcting the insured details.' using errcode = '40001';
    end if;
    if v_review.status <> 'approved' then
      return jsonb_build_object('ok', false,
                                'status', case when v_review.status = 'rejected' then 'review_rejected' else 'review_required' end,
                                'reviewId', v_review.id, 'reviewVersion', v_review.version, 'matchCount', 0);
    end if;
  end if;
  insert into public.deal_coverage_post_permits (transaction_id, owner_user_id, idempotency_key, agent_id)
  values (txid_current(), v_user, p_idempotency_key, v_agent);
  v_result := public.submit_apex_deal_before_coverage_review(p_idempotency_key, p_payload, p_agent_id);
  delete from public.deal_coverage_post_permits
   where transaction_id = txid_current() and owner_user_id = v_user and idempotency_key = p_idempotency_key;
  if v_result->>'dealId' is null then
    raise exception 'Posting returned no durable deal receipt' using errcode = 'P0001';
  end if;
  if v_review.id is not null then
    update public.deal_coverage_reviews
       set status = 'submitted', deal_id = (v_result->>'dealId')::uuid, version = version + 1, updated_at = now()
     where id = v_review.id;
  end if;
  return v_result;
end;
$function$;
