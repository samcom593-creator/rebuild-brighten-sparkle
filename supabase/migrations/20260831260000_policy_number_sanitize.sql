-- MP-355b: a pasted TAB character silently cost the agency a deal.
--
-- submit_apex_deal_ledger_impl read the policy number with btrim(), which
-- strips SPACES only, then rejected anything still matching '[[:cntrl:]]' with
-- 'Application or policy number is required and must be valid'. A number
-- copied out of a carrier portal or a spreadsheet carries a trailing tab, so
-- the agent sees a message telling him the number he is looking at is invalid,
-- with nothing on screen to distinguish it from a correct one.
--
-- Measured 2026-08-28: deal_drafts a7ad69bd (Wendell Funderburg, client
-- Michelle Cole, policy '3002725\t') is still status='draft' with deal_id
-- null -- the post never landed, and '3002725' is on no deal anywhere, so it
-- was not a duplicate being caught. It is the only draft in the table whose
-- policy number carries a control character, and no row in public.deals does,
-- which is what a hard reject looks like from the far side.
--
-- Invisible whitespace is a paste artifact, not a data error. Strip it and
-- accept the number; keep rejecting the two things that are genuinely
-- unusable (nothing at all, or something too long to store), and say which.

begin;

create or replace function public.fn_normalize_policy_number(p_raw text)
returns text
language sql
immutable
as $fn$
  -- Control characters (tab, newline, vertical tab, form feed, CR), the
  -- non-breaking space, and the zero-width characters that ride along with a
  -- browser copy all collapse to a single ordinary space, which is then
  -- trimmed off the ends.
  select btrim(regexp_replace(
    regexp_replace(coalesce(p_raw, ''), '[[:cntrl:] ​‌‍﻿]+', ' ', 'g'),
    ' {2,}', ' ', 'g'
  ));
$fn$;

comment on function public.fn_normalize_policy_number(text) is
  'Paste-artifact normalizer for application/policy numbers. Shared by submit_apex_deal_ledger_impl and the browser so the pre-flight duplicate check asks about the same string the insert stores.';

grant execute on function public.fn_normalize_policy_number(text) to authenticated, anon, service_role;

-- Live definition of the impl with the normalizer wired in. Mirrored here
-- verbatim from pg_get_functiondef after the bot-sql apply, so a fresh
-- `supabase db push` reproduces the deployed function exactly.
CREATE OR REPLACE FUNCTION public.submit_apex_deal_ledger_impl(p_idempotency_key uuid, p_payload jsonb, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_own_agent_id uuid;
  v_agent_id uuid;
  v_manager_id uuid;
  v_deal_id uuid;
  v_existing public.deals;
  v_correlation_id uuid := gen_random_uuid();
  v_first text := btrim(coalesce(p_payload->>'clientFirstName', ''));
  v_last text := btrim(coalesce(p_payload->>'clientLastName', ''));
  v_phone text := regexp_replace(coalesce(p_payload->>'clientPhone', ''), '[^0-9]', '', 'g');
  v_dob_text text := p_payload->>'clientDob';
  v_carrier_id uuid;
  v_product text := btrim(coalesce(p_payload->>'product', ''));
  v_policy_number text := public.fn_normalize_policy_number(p_payload->>'policyNumber');
  v_application_date date;
  v_effective_date date;
  v_premium_mode text := lower(btrim(coalesce(p_payload->>'premiumMode', '')));
  v_modal numeric;
  v_paid numeric;
  v_alp numeric;
  v_face numeric;
  v_factor numeric;
  v_status text;
  v_needs_review boolean := coalesce((p_payload->>'calculationNeedsReview')::boolean, false);
  v_actor_role text;
  v_draft_id uuid;
  v_attachment_count integer;
  v_payment_method text := nullif(btrim(coalesce(p_payload->>'paymentMethod', '')), '');
  v_draft_day_text text := nullif(btrim(coalesce(p_payload->>'draftDay', '')), '');
  v_draft_day smallint;
  v_policy_status text := nullif(btrim(coalesce(p_payload->>'policyStatus', '')), '');
  v_beneficiaries jsonb := coalesce(p_payload->'beneficiaries', '[]'::jsonb);
  v_benef jsonb;
  v_benef_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Deal payload must be an object' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 100000 then
    raise exception 'Deal payload is too large' using errcode = '22023';
  end if;

  select * into v_existing
  from public.deals d
  where d.submitted_by_user_id = v_user_id
    and d.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'dealId', v_existing.id,
      'status', v_existing.status,
      'correlationId', v_existing.correlation_id
    );
  end if;

  select a.id into v_own_agent_id
  from public.agents a
  where a.user_id = v_user_id
  order by a.created_at
  limit 1;

  v_agent_id := coalesce(p_agent_id, v_own_agent_id);
  if v_agent_id is null then
    raise exception 'No agent record is linked to this account' using errcode = '22023';
  end if;

  if v_agent_id is distinct from v_own_agent_id then
    if not public.apex_is_admin()
       and not (
         public.apex_has_any_role(array['manager'])
         and public.apex_can_read_agent(v_agent_id)
       ) then
      raise exception 'Writing-agent override is not permitted' using errcode = '42501';
    end if;
  end if;

  select a.manager_id into v_manager_id
  from public.agents a where a.id = v_agent_id;
  if not found then
    raise exception 'Writing agent does not exist' using errcode = '22023';
  end if;

  if v_first = '' or length(v_first) > 100 or v_first ~ '[[:cntrl:]]' then
    raise exception 'Client first name is required and must be valid' using errcode = '22023';
  end if;
  if v_last = '' or length(v_last) > 100 or v_last ~ '[[:cntrl:]]' then
    raise exception 'Client last name is required and must be valid' using errcode = '22023';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Client phone must contain 10 to 15 digits' using errcode = '22023';
  end if;
  if v_dob_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Client date of birth must be YYYY-MM-DD' using errcode = '22023';
  end if;
  if v_dob_text::date >= current_date then
    raise exception 'Client date of birth must be in the past' using errcode = '22023';
  end if;

  begin
    v_carrier_id := (p_payload->>'carrierId')::uuid;
  exception when others then
    raise exception 'A valid carrier is required' using errcode = '22023';
  end;
  if not exists (select 1 from public.carriers c where c.id = v_carrier_id and coalesce(c.is_active, true)) then
    raise exception 'Selected carrier is not active' using errcode = '22023';
  end if;
  if v_product = '' or length(v_product) > 160 or v_product ~ '[[:cntrl:]]' then
    raise exception 'Product is required and must be valid' using errcode = '22023';
  end if;
  if length(coalesce(p_payload->>'leadSource', '')) > 160
     or length(coalesce(p_payload->>'communityCaption', '')) > 240
     or length(coalesce(p_payload->>'notes', '')) > 5000 then
    raise exception 'Lead source, caption, or notes exceed the allowed length' using errcode = '22023';
  end if;
  -- Paste artifacts (tab, newline, non-breaking and zero-width spaces) are
  -- normalized away above, not rejected: a trailing tab from a carrier portal
  -- copy used to fail here with a message the agent could not act on, and the
  -- deal was simply never posted. Only the two genuinely unusable cases are
  -- refused, and each says which one it is.
  if v_policy_number = '' then
    raise exception 'Enter the application or policy number' using errcode = '22023';
  end if;
  if length(v_policy_number) > 160 then
    raise exception 'That application or policy number is % characters; the limit is 160', length(v_policy_number) using errcode = '22023';
  end if;
  if exists (
    select 1 from public.deals d
    where lower(btrim(d.policy_number)) = lower(v_policy_number)
  ) then
    raise exception 'A deal with this application or policy number already exists' using errcode = '23505';
  end if;

  begin
    v_application_date := (p_payload->>'applicationDate')::date;
    v_effective_date := nullif(p_payload->>'effectiveDate', '')::date;
  exception when others then
    raise exception 'Application and effective dates must be valid dates' using errcode = '22023';
  end;
  if v_application_date is null then
    raise exception 'Application date is required' using errcode = '22023';
  end if;
  if v_application_date > current_date then
    raise exception 'Application date cannot be in the future' using errcode = '22023';
  end if;

  if v_premium_mode not in ('annual', 'semiannual', 'quarterly', 'monthly', 'single_pay', 'other') then
    raise exception 'Premium mode is invalid' using errcode = '22023';
  end if;
  begin
    v_modal := (p_payload->>'modalPremium')::numeric;
    v_paid := nullif(p_payload->>'annualizedPaidPremium', '')::numeric;
    v_alp := nullif(p_payload->>'annualizedCommissionablePremium', '')::numeric;
    v_face := (p_payload->>'faceAmount')::numeric;
  exception when others then
    raise exception 'Premium and face amount must be valid numbers' using errcode = '22023';
  end;
  if v_modal is null or v_modal <= 0 then
    raise exception 'Modal premium must be greater than zero' using errcode = '22023';
  end if;
  if v_face is null or v_face <= 0 then
    raise exception 'Face amount must be greater than zero' using errcode = '22023';
  end if;
  if v_modal > 1000000000 or coalesce(v_paid, 0) > 1000000000
     or coalesce(v_alp, 0) > 1000000000 or v_face > 1000000000 then
    raise exception 'Premium or face amount exceeds the supported limit' using errcode = '22023';
  end if;

  v_factor := case v_premium_mode
    when 'annual' then 1
    when 'semiannual' then 2
    when 'quarterly' then 4
    when 'monthly' then 12
    when 'single_pay' then 1
    else null
  end;
  if v_paid is null and v_factor is not null then
    v_paid := round(v_modal * v_factor, 2);
  end if;
  if v_paid is null or v_paid <= 0 then
    raise exception 'Annualized paid premium is required' using errcode = '22023';
  end if;
  if v_alp is null and v_premium_mode in ('annual', 'semiannual', 'quarterly', 'monthly') then
    v_alp := v_paid;
  end if;
  if v_alp is null or v_alp <= 0 then
    raise exception 'Annualized commissionable premium is required for this product' using errcode = '22023';
  end if;

  -- Post-a-Deal parity fields. Each one below is written to a real column, so a
  -- control on the form can never look answered while the answer is discarded.
  if v_payment_method is not null and v_payment_method not in (
    'bank_draft', 'credit_card', 'debit_card', 'direct_express', 'check', 'social_security'
  ) then
    raise exception 'Payment method is invalid' using errcode = '22023';
  end if;

  if v_draft_day_text is not null then
    if v_draft_day_text !~ '^[0-9]{1,2}$' then
      raise exception 'Draft day must be a day number' using errcode = '22023';
    end if;
    v_draft_day := v_draft_day_text::smallint;
    if v_draft_day < 1 or v_draft_day > 28 then
      raise exception 'Draft day must be between 1 and 28' using errcode = '22023';
    end if;
  end if;

  if v_policy_status is null then
    v_policy_status := 'Issued, Not Paid';
  end if;
  if v_policy_status not in (
    'Issued, Not Paid', 'Active', 'In Review', 'Pending', 'Approved',
    'Lapse Pending', 'Lapsed', 'Cancelled', 'Withdrawn', 'Not Taken',
    'Postponed', 'Declined'
  ) then
    raise exception 'Policy status is invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(v_beneficiaries) <> 'array' then
    raise exception 'Beneficiaries must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_beneficiaries) > 10 then
    raise exception 'A deal supports at most 10 beneficiaries' using errcode = '22023';
  end if;
  for v_benef in select * from jsonb_array_elements(v_beneficiaries) loop
    if btrim(coalesce(v_benef->>'firstName', '')) = ''
       or btrim(coalesce(v_benef->>'lastName', '')) = '' then
      raise exception 'Every beneficiary needs a first and last name' using errcode = '22023';
    end if;
    if length(coalesce(v_benef->>'firstName', '')) > 100
       or length(coalesce(v_benef->>'lastName', '')) > 100
       or length(coalesce(v_benef->>'relationship', '')) > 60 then
      raise exception 'Beneficiary details exceed the allowed length' using errcode = '22023';
    end if;
    if v_benef ? 'allocationPct' and nullif(btrim(coalesce(v_benef->>'allocationPct','')), '') is not null then
      begin
        if (v_benef->>'allocationPct')::numeric < 0 or (v_benef->>'allocationPct')::numeric > 100 then
          raise exception 'Beneficiary allocation must be between 0 and 100' using errcode = '22023';
        end if;
      exception when invalid_text_representation then
        raise exception 'Beneficiary allocation must be a number' using errcode = '22023';
      end;
    end if;
  end loop;

  select dd.id into v_draft_id
  from public.deal_drafts dd
  where dd.owner_user_id = v_user_id
    and dd.idempotency_key = p_idempotency_key
    and dd.status = 'draft';
  if v_draft_id is null then
    raise exception 'Save the deal draft before submitting' using errcode = '22023';
  end if;
  select count(*)::integer into v_attachment_count
  from public.deal_attachments da
  where da.draft_id = v_draft_id
    and da.owner_user_id = v_user_id
    and da.scan_status <> 'quarantined';
  -- 2026-08-19 (Sam, exact Agent Cloud Post-a-Deal): evidence is OPTIONAL.
  -- Agent Cloud posts a deal with no attachment; a deal WITH attachments still
  -- flows through the scan/needs_review logic below. The count above is kept
  -- only to drive that. A deal never blocks on a missing file now.
  v_needs_review := v_needs_review
    or v_premium_mode in ('single_pay', 'other')
    or exists (
      select 1 from public.deal_attachments da
      where da.draft_id = v_draft_id and da.scan_status <> 'clean'
    );
  v_status := case when v_needs_review then 'needs_review' else 'submitted' end;

  select string_agg(ur.role::text, ',' order by ur.role::text)
    into v_actor_role
  from public.user_roles ur where ur.user_id = v_user_id;

  -- Insert as a non-fresh draft so the legacy insert-only broadcast/autopush
  -- triggers cannot send client data or external writes. The same transaction
  -- immediately promotes the row and enqueues redacted durable events.
  insert into public.deals(
    agent_id, manager_id, carrier_id, client_first_name, client_last_name,
    client_phone, client_dob, product_sold, policy_number, monthly_premium,
    annual_premium, face_amount, effective_date, notes, status, source,
    pipeline_stage, posted_at, idempotency_key, submitted_by_user_id,
    premium_mode, modal_premium, annualized_paid_premium,
    annualized_commissionable_premium, calculation_basis, application_date,
    lead_source, community_caption, version, correlation_id,
    payment_method, draft_day, policy_status_standard
  ) values (
    v_agent_id, v_manager_id, v_carrier_id, v_first, v_last,
    v_phone, v_dob_text::date, v_product, v_policy_number, round(v_paid / 12, 2),
    v_paid, v_face, coalesce(v_effective_date, v_application_date),
    nullif(btrim(p_payload->>'notes'), ''), 'draft', 'agent_link',
    'submitted', '2000-01-01 00:00:00+00'::timestamptz, p_idempotency_key, v_user_id,
    v_premium_mode, v_modal, v_paid, v_alp,
    jsonb_build_object(
      'formulaVersion', 1,
      'factor', v_factor,
      'paidPremiumSource', case when p_payload ? 'annualizedPaidPremium' then 'agent_entered' else 'system_calculated' end,
      'commissionablePremiumSource', case when p_payload ? 'annualizedCommissionablePremium' then 'agent_entered' else 'system_calculated' end,
      'requiresReview', v_needs_review
    ),
    v_application_date, nullif(btrim(p_payload->>'leadSource'), ''),
    nullif(btrim(p_payload->>'communityCaption'), ''), 1, v_correlation_id,
    v_payment_method, v_draft_day, v_policy_status
  )
  returning id into v_deal_id;

  update public.deals
  set status = v_status,
      source = 'apex_native',
      submitted_at = now(),
      posted_at = now(),
      pipeline_stage = 'submitted',
      updated_at = now()
  where id = v_deal_id;

  insert into public.deal_beneficiaries(
    deal_id, position, first_name, last_name, relationship, allocation_pct
  )
  select
    v_deal_id,
    (ord - 1)::smallint,
    btrim(elem->>'firstName'),
    btrim(elem->>'lastName'),
    nullif(btrim(coalesce(elem->>'relationship', '')), ''),
    nullif(btrim(coalesce(elem->>'allocationPct', '')), '')::numeric
  from jsonb_array_elements(v_beneficiaries) with ordinality AS t(elem, ord);
  get diagnostics v_benef_rows = row_count;

  insert into public.deal_status_history(
    deal_id, from_status, to_status, reason, actor_id, actor_role,
    correlation_id, deal_version
  ) values (
    v_deal_id, 'draft', v_status, 'Native APEX deal submitted', v_user_id,
    v_actor_role, v_correlation_id, 1
  );

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'deal', v_deal_id, 'deal.submitted', 'review',
    jsonb_build_object(
      'dealId', v_deal_id,
      'agentId', v_agent_id,
      'managerId', v_manager_id,
      'carrierId', v_carrier_id,
      'productCategory', v_product,
      'status', v_status
    ),
    'deal.submitted:' || v_deal_id::text || ':review', v_correlation_id
  );

  insert into public.audit_log(
    action, actor_role, actor_user_id, after_data, entity_id, entity_type,
    request_id
  ) values (
    'deal.submitted', v_actor_role, v_user_id,
    jsonb_build_object(
      'status', v_status,
      'agent_id', v_agent_id,
      'carrier_id', v_carrier_id,
      'annualized_paid_premium', v_paid,
      'annualized_commissionable_premium', v_alp,
      'correlation_id', v_correlation_id
    ),
    v_deal_id::text, 'deal', p_idempotency_key::text
  );

  update public.deal_drafts
  set status = 'submitted', deal_id = v_deal_id, updated_at = now()
  where owner_user_id = v_user_id and idempotency_key = p_idempotency_key;

  update public.deal_attachments
  set deal_id = v_deal_id
  where draft_id = v_draft_id and owner_user_id = v_user_id;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  )
  select 'attachment', da.id, 'attachment.scan_requested', 'file_scan',
    jsonb_build_object('attachmentId', da.id, 'dealId', v_deal_id),
    'attachment.scan_requested:' || da.id::text,
    v_correlation_id
  from public.deal_attachments da
  where da.deal_id = v_deal_id and da.scan_status = 'pending'
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'dealId', v_deal_id,
    'status', v_status,
    'downstreamState', 'queued',
    'correlationId', v_correlation_id,
    'policyStatus', v_policy_status,
    'beneficiaries', v_benef_rows
  );
end;
$function$
;

commit;
