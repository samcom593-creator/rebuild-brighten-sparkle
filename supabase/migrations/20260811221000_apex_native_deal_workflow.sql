-- Native APEX deal workflow: recoverable drafts, transactional submit,
-- status history, official ledger, audit, and redacted outbox events.

alter table public.deals
  add column if not exists idempotency_key uuid,
  add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists manager_id uuid references public.agents(id) on delete set null,
  add column if not exists premium_mode text,
  add column if not exists modal_premium numeric(14,2),
  add column if not exists annualized_paid_premium numeric(14,2),
  add column if not exists annualized_commissionable_premium numeric(14,2),
  add column if not exists calculation_basis jsonb not null default '{}'::jsonb,
  add column if not exists application_date date,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists lead_source text,
  add column if not exists community_caption text,
  add column if not exists version integer not null default 1,
  add column if not exists correlation_id uuid;

alter table public.deals drop constraint if exists deals_source_check;
alter table public.deals add constraint deals_source_check
  check (source in ('apex', 'agent_link', 'apex_native'));

alter table public.deals drop constraint if exists deals_status_check;
alter table public.deals add constraint deals_status_check
  check (status in (
    'draft', 'submitted', 'needs_review', 'approved', 'declined', 'withdrawn',
    'issued', 'in_force', 'active', 'lapsed', 'chargeback', 'charged_back',
    'cancelled'
  ));

alter table public.deals drop constraint if exists deals_premium_mode_check;
alter table public.deals add constraint deals_premium_mode_check
  check (premium_mode is null or premium_mode in (
    'annual', 'semiannual', 'quarterly', 'monthly', 'single_pay', 'other'
  ));

create unique index if not exists deals_submitter_idempotency_unique
  on public.deals(submitted_by_user_id, idempotency_key)
  where submitted_by_user_id is not null and idempotency_key is not null;
create index if not exists deals_native_status_idx
  on public.deals(status, submitted_at desc) where source = 'apex_native';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'apex-deal-evidence',
  'apex-deal-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists apex_deal_evidence_owner_insert on storage.objects;
create policy apex_deal_evidence_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'apex-deal-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists apex_deal_evidence_owner_read on storage.objects;
create policy apex_deal_evidence_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'apex-deal-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.apex_is_admin()
    or exists (
      select 1
      from public.deal_attachments da
      join public.deals d on d.id = da.deal_id
      where da.object_path = name
        and public.apex_can_read_agent(d.agent_id)
    )
  )
);

drop policy if exists apex_deal_evidence_owner_delete_draft on storage.objects;
create policy apex_deal_evidence_owner_delete_draft on storage.objects
for delete to authenticated
using (
  bucket_id = 'apex-deal-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (
    select 1 from public.deal_attachments da
    where da.object_path = name and da.deal_id is not null
  )
);

create or replace function public.save_apex_deal_draft(
  p_idempotency_key uuid,
  p_section text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.deal_drafts;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_idempotency_key::text, 0));
  if p_section not in ('client', 'policy', 'premium', 'evidence', 'review') then
    raise exception 'Invalid draft section' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Draft payload must be an object' using errcode = '22023';
  end if;

  insert into public.deal_drafts(owner_user_id, idempotency_key, current_section, payload)
  values (auth.uid(), p_idempotency_key, p_section, p_payload)
  on conflict (owner_user_id, idempotency_key) do update
    set current_section = excluded.current_section,
        payload = public.deal_drafts.payload || excluded.payload,
        status = 'draft',
        updated_at = now()
  returning * into v_draft;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'idempotencyKey', v_draft.idempotency_key,
    'section', v_draft.current_section,
    'updatedAt', v_draft.updated_at
  );
end;
$$;

create or replace function public.submit_apex_deal(
  p_idempotency_key uuid,
  p_payload jsonb,
  p_agent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  v_policy_number text := btrim(coalesce(p_payload->>'policyNumber', ''));
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
  if v_policy_number = '' or length(v_policy_number) > 160 or v_policy_number ~ '[[:cntrl:]]' then
    raise exception 'Application or policy number is required and must be valid' using errcode = '22023';
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
  if v_attachment_count = 0 then
    raise exception 'Supporting evidence is required before submitting' using errcode = '22023';
  end if;

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
    lead_source, community_caption, version, correlation_id
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
    nullif(btrim(p_payload->>'communityCaption'), ''), 1, v_correlation_id
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
    'correlationId', v_correlation_id
  );
end;
$$;

create or replace function public.transition_apex_deal_status(
  p_deal_id uuid,
  p_to_status text,
  p_reason text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_deal public.deals;
  v_from text;
  v_to text := lower(btrim(coalesce(p_to_status, '')));
  v_new_version integer;
  v_actor_role text;
  v_correlation_id uuid := gen_random_uuid();
  v_is_manager boolean;
  v_is_admin boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A transition reason is required' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  if v_deal.version <> p_expected_version then
    raise exception 'Deal changed since it was opened; refresh and retry' using errcode = '40001';
  end if;

  v_from := v_deal.status;
  v_is_admin := public.apex_is_admin();
  v_is_manager := public.apex_has_any_role(array['manager']);

  if not v_is_admin and not (v_is_manager and public.apex_can_read_agent(v_deal.agent_id)) then
    if not (
      v_deal.submitted_by_user_id = v_user_id
      and v_to = 'withdrawn'
      and v_from in ('submitted', 'needs_review')
    ) then
      raise exception 'Status transition is not permitted' using errcode = '42501';
    end if;
  end if;

  if not (
    (v_from = 'submitted' and v_to in ('needs_review', 'approved', 'declined', 'withdrawn'))
    or (v_from = 'needs_review' and v_to in ('approved', 'declined', 'withdrawn'))
    or (v_from in ('declined', 'withdrawn') and v_to = 'submitted')
    or (v_from in ('approved', 'active') and v_to in ('issued', 'in_force', 'lapsed', 'chargeback'))
    or (v_from = 'issued' and v_to in ('in_force', 'lapsed', 'chargeback'))
    or (v_from = 'in_force' and v_to in ('lapsed', 'chargeback'))
    or (v_from in ('lapsed', 'chargeback', 'charged_back') and v_to = 'in_force')
  ) then
    raise exception 'Invalid deal status transition: % to %', v_from, v_to using errcode = '22023';
  end if;

  v_new_version := v_deal.version + 1;
  select string_agg(ur.role::text, ',' order by ur.role::text)
    into v_actor_role from public.user_roles ur where ur.user_id = v_user_id;

  update public.deals
  set status = v_to,
      version = v_new_version,
      approved_at = case when v_to = 'approved' then now() else approved_at end,
      policy_status_standard = case
        when v_to = 'in_force' then 'active'
        when v_to = 'chargeback' then 'charged_back'
        else v_to
      end,
      status_updated_at = now(),
      updated_at = now()
  where id = p_deal_id;

  insert into public.deal_status_history(
    deal_id, from_status, to_status, reason, actor_id, actor_role,
    correlation_id, deal_version
  ) values (
    p_deal_id, v_from, v_to, btrim(p_reason), v_user_id, v_actor_role,
    v_correlation_id, v_new_version
  );

  if v_to in ('approved', 'issued', 'in_force') then
    insert into public.production_ledger(
      deal_id, agent_id, entry_type, amount, effective_date, status,
      correlation_id, created_by
    ) values (
      p_deal_id, v_deal.agent_id, 'approved_alp',
      coalesce(v_deal.annualized_commissionable_premium, v_deal.annual_premium),
      coalesce(v_deal.effective_date, v_deal.application_date, current_date),
      'qualifying', v_correlation_id, v_user_id
    )
    on conflict (deal_id, entry_type) do update
      set amount = excluded.amount,
          effective_date = excluded.effective_date,
          status = 'qualifying',
          correlation_id = excluded.correlation_id,
          reversed_at = null,
          reversal_reason = null;

    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    )
    select 'deal', p_deal_id, 'deal.approved', destination,
      jsonb_build_object(
        'dealId', p_deal_id,
        'agentId', v_deal.agent_id,
        'carrierId', v_deal.carrier_id,
        'productCategory', v_deal.product_sold,
        'faceAmount', v_deal.face_amount,
        'annualizedCommissionablePremium', coalesce(v_deal.annualized_commissionable_premium, v_deal.annual_premium),
        'caption', v_deal.community_caption
      ),
      'deal.approved:' || p_deal_id::text || ':' || destination,
      v_correlation_id
    from unnest(array['discord', 'skool', 'insuracloud']) as destination
    on conflict (idempotency_key) do nothing;
  elsif v_to in ('lapsed', 'chargeback') then
    update public.production_ledger
    set status = 'reversed', reversed_at = now(), reversal_reason = btrim(p_reason)
    where deal_id = p_deal_id and entry_type = 'approved_alp';

    if v_to = 'chargeback' then
      insert into public.production_ledger(
        deal_id, agent_id, entry_type, amount, effective_date, status,
        correlation_id, created_by
      ) values (
        p_deal_id, v_deal.agent_id, 'chargeback',
        -abs(coalesce(v_deal.annualized_commissionable_premium, v_deal.annual_premium)),
        current_date, 'qualifying', v_correlation_id, v_user_id
      ) on conflict (deal_id, entry_type) do nothing;
    end if;
  end if;

  insert into public.audit_log(
    action, actor_role, actor_user_id, before_data, after_data,
    entity_id, entity_type, request_id
  ) values (
    'deal.status_changed', v_actor_role, v_user_id,
    jsonb_build_object('status', v_from, 'version', v_deal.version),
    jsonb_build_object('status', v_to, 'version', v_new_version, 'reason', btrim(p_reason), 'correlation_id', v_correlation_id),
    p_deal_id::text, 'deal', v_correlation_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'dealId', p_deal_id,
    'fromStatus', v_from,
    'status', v_to,
    'version', v_new_version,
    'correlationId', v_correlation_id
  );
end;
$$;

grant execute on function public.save_apex_deal_draft(uuid, text, jsonb) to authenticated;
grant execute on function public.submit_apex_deal(uuid, jsonb, uuid) to authenticated;
grant execute on function public.transition_apex_deal_status(uuid, text, text, integer) to authenticated;

-- Native submit intentionally inserts a non-fresh draft and promotes it in the
-- same transaction so legacy outbound triggers cannot fire before validation,
-- audit, and outbox writes are durable. The legacy first-deal trigger was the
-- one exception: it ran for drafts and would set agents.first_deal_at to the
-- sentinel 2000 timestamp. Drafts are not production and must never advance
-- onboarding or production milestones.
drop trigger if exists trg_next_step_deal_first_check on public.deals;
create trigger trg_next_step_deal_first_check
  after insert on public.deals
  for each row
  when (new.status <> 'draft')
  execute function public.fn_next_step_deal_first_check();

-- These two legacy insert-only triggers had no draft guard. Native submit
-- inserts a draft first so outbound effects cannot precede the transaction;
-- without these WHEN clauses the draft would still inflate daily production
-- and create a public culture draft before manager review.
drop trigger if exists trg_deals_rollup on public.deals;
create trigger trg_deals_rollup
  after insert on public.deals
  for each row
  when (new.status <> 'draft')
  execute function public.deals_rollup_to_daily_production();

drop trigger if exists trg_culture_loop_on_deal on public.deals;
create trigger trg_culture_loop_on_deal
  after insert on public.deals
  for each row
  when (new.status <> 'draft')
  execute function public.fn_culture_loop_on_deal();

create or replace function public.claim_apex_outbox_events(p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with claimable as (
    select oe.id
    from public.outbox_events oe
    where (
      oe.status in ('pending', 'failed')
      or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes')
    )
      and oe.available_at <= now()
      and oe.attempts < 5
    order by oe.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.outbox_events oe
  set status = 'processing',
      attempts = oe.attempts + 1,
      locked_at = now(),
      updated_at = now()
  from claimable c
  where oe.id = c.id
  returning oe.*;
end;
$$;

revoke all on function public.claim_apex_outbox_events(integer) from public, anon, authenticated;
grant execute on function public.claim_apex_outbox_events(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('apex-outbox-dispatcher')
      where exists (select 1 from cron.job where jobname = 'apex-outbox-dispatcher');
    perform cron.schedule(
      'apex-outbox-dispatcher',
      '* * * * *',
      $job$select public.run_automation_job(
        'apex-outbox-dispatcher',
        'apex-outbox-dispatcher',
        '{"limit":20}'::jsonb
      );$job$
    );
  end if;
end;
$$;

insert into public.apex_schema_meta(version, description)
values ('20260811221000', 'Native APEX transactional deal workflow')
on conflict (version) do nothing;

comment on function public.submit_apex_deal(uuid, jsonb, uuid) is
  'Authorized idempotent deal submit. Persists status/audit/outbox in one transaction and keeps client PII out of integration payloads.';
