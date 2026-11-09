-- MP-LEAD-MANAGER-14 (2026-11-09): Sam — agents "need to be able to see all
-- client data. It's the whole purpose of said lead." The pack snapshot carries
-- only name/phone/state/age/tier/flags; the SOURCE records are far richer
-- (client_leads: dob, address, policy + loan + equity details, beneficiary,
-- notes; booking packets: health, bank/draft, beneficiaries, call summary;
-- deals: the lapsed policy itself). my_lead_detail(p_item) joins back to the
-- source per source_kind and returns the full client record as jsonb.
-- Gate is identical to lead_bundle_item_log: live-grant holder on the item's
-- bundle, or can_view_sold_calls(). Encrypted payloads (ssn_encrypted,
-- bank_account_encrypted, bank_routing_encrypted, sensitive_pointers, raw)
-- are NEVER returned — ssn_last4/bank_name only, which the rewrite flow needs.
-- Join keys: marketing by lead_id (phone10 fallback); the other pools emit
-- lead_id NULL by construction, so they join by phone10 (measured: packets,
-- deals and dialer_calls are all small enough for a per-item lookup).
create or replace function public.my_lead_detail(p_item uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v record; v_detail jsonb := '{}'::jsonb;
begin
  select i.* into v
  from public.lead_bundle_items i
  join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
  where i.id = p_item and i.removed_at is null;
  if v.id is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  if not (public.can_view_sold_calls() or exists (
        select 1 from public.lead_bundle_grants g
        where g.bundle_id = v.bundle_id and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;

  if v.source_kind = 'marketing' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', l.dob,
      'street_address', l.street_address, 'city', l.city, 'zip', l.zip, 'timezone', l.timezone,
      'alt_phone', nullif(right(regexp_replace(coalesce(l.phone_alt, ''), '[^0-9]', '', 'g'), 10), ''),
      'alt_email', l.email_alt,
      'beneficiary', l.beneficiary, 'burial_type', l.burial_type,
      'existing_policy_number', l.policy_number, 'existing_policy_carrier', l.policy_carrier,
      'existing_policy_date', l.policy_date, 'existing_policy_product', l.policy_product,
      'existing_policy_face_amount', l.policy_face_amount,
      'existing_policy_annual_premium', l.policy_annual_premium,
      'existing_policy_monthly_premium', l.policy_monthly_premium,
      'original_agent', l.original_agent,
      'loan_amount', l.loan_amount, 'loan_type', l.loan_type, 'interest_rate', l.interest_rate,
      'lien_balance', l.lien_balance, 'estimated_property_value', l.estimated_property_value,
      'estimated_equity', l.estimated_equity, 'lender_name', l.lender_name,
      'last_sale_date', l.last_sale_date, 'last_sale_amount', l.last_sale_amount,
      'military_status', l.military_status, 'veteran_status', l.veteran_status,
      'lead_type', l.lead_type, 'lead_pack', l.lead_pack, 'notes', l.notes,
      'times_dialed', nullif(l.dial_count, 0), 'last_disposition', l.last_disposition))
    into v_detail
    from public.client_leads l
    where (v.lead_id is not null and l.id = v.lead_id)
       or (v.lead_id is null and right(regexp_replace(coalesce(l.phone_digits, l.phone_e164, ''), '[^0-9]', '', 'g'), 10) = v.phone10)
    limit 1;

  elsif v.source_kind = 'rewrite' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', p.client_dob,
      'street_address', p.client_street, 'city', p.client_city, 'state', p.client_state, 'zip', p.client_zip,
      'email', p.client_email, 'ssn_last4', p.ssn_last4, 'tobacco', p.tobacco,
      'health_notes', p.health_notes, 'carrier_discussed', p.carrier, 'product_discussed', p.product,
      'face_amount', p.face_amount, 'monthly_premium', p.monthly_premium,
      'draft_day', p.draft_day, 'payment_method', p.payment_method_type, 'bank_name', p.bank_name,
      'beneficiaries', p.beneficiaries, 'call_summary', p.call_summary, 'key_points', p.key_points,
      'call_date', p.call_at, 'original_call_agent', p.agent_raw,
      'call_recording', dc.recording_url, 'call_duration_seconds', dc.duration_seconds,
      'transcript_excerpt', p.transcript_excerpt,
      'missing_fields', p.missing_fields))
    into v_detail
    from public.readymode_booking_packets p
    left join public.readymode_dialer_calls dc on dc.id = p.call_id
    where coalesce(nullif(right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10), ''), dc.lead_phone10) = v.phone10
    order by p.call_at desc nulls last limit 1;

  elsif v.source_kind = 'winback' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', d.client_dob,
      'carrier', c.name, 'product', d.product_sold, 'policy_number', d.policy_number,
      'monthly_premium', d.monthly_premium, 'annual_premium', d.annual_premium,
      'face_amount', d.face_amount, 'effective_date', d.effective_date,
      'policy_status', coalesce(d.policy_status_standard, d.status),
      'payment_method', d.payment_method, 'draft_day', d.draft_day,
      'original_agent', a.display_name, 'lead_source', d.lead_source, 'notes', d.notes))
    into v_detail
    from public.deals d
    left join public.carriers c on c.id = d.carrier_id
    left join public.agents a on a.id = d.agent_id
    where right(regexp_replace(coalesce(d.client_phone, ''), '[^0-9]', '', 'g'), 10) = v.phone10
    -- the client may ALSO have a newer active/submitted deal on the same phone;
    -- the win-back pitch is about the policy that LAPSED, so prefer it
    -- (v_pool_winback's own predicate), newest-first only as the tiebreak.
    -- coalesce(..., false) is LOAD-BEARING: policy_status_standard is NULL on
    -- most rows, false OR (NULL ~* ...) = NULL, and DESC sorts NULLs first —
    -- without it the submitted rows outsort the lapsed one (proven live).
    order by coalesce(lower(coalesce(d.status, '')) in ('lapsed', 'cancelled')
              or d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken', false) desc,
             d.posted_at desc nulls last
    limit 1;

  elsif v.source_kind = 'dialer' then
    select jsonb_strip_nulls(jsonb_build_object(
      'campaign', dc.campaign_name, 'last_call_at', dc.call_started_at,
      'last_call_seconds', dc.duration_seconds, 'last_disposition', dc.disposition,
      'last_call_agent', dc.agent_raw, 'email', dc.lead_email, 'call_notes', dc.notes,
      'call_recording', dc.recording_url,
      'times_called', (select count(*) from public.readymode_dialer_calls x where x.lead_phone10 = v.phone10)))
    into v_detail
    from public.readymode_dialer_calls dc
    where dc.lead_phone10 = v.phone10
    order by dc.call_started_at desc nulls last limit 1;
  end if;

  return jsonb_build_object('source', v.source_kind, 'detail', coalesce(v_detail, '{}'::jsonb));
end $function$;
grant execute on function public.my_lead_detail(uuid) to authenticated;
