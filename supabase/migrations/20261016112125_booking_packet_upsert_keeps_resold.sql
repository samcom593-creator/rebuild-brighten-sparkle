-- PL-SOLD-CALLS-REVIEW (2026-10-16): re-running the packet extractor must not un-resell a sale.
-- booking_packet_upsert's ON CONFLICT set status = EXCLUDED.status, so re-upserting a packet already
-- marked booked (finalize.sh / extract-until-done.sh re-upsert every packet file) put it back in
-- To resell with booked_at still set, inviting a second carrier submission. Latent: 0 packets are
-- booked today. booked_at, booked_by and booked_policy_number were already left alone.
CREATE OR REPLACE FUNCTION public.booking_packet_upsert(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'extensions'
AS $function$
DECLARE v_id uuid; v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='agent_credentials_key' LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION 'vault key missing'; END IF;
  INSERT INTO public.readymode_booking_packets AS t (
    call_id, external_call_id, agent_id, agent_raw, call_at,
    client_first_name, client_last_name, client_dob, client_phone, client_email,
    client_street, client_city, client_state, client_zip, ssn_last4, tobacco, health_notes,
    carrier, product, face_amount, monthly_premium, draft_day, payment_method_type, bank_name, policy_number,
    beneficiaries, ssn_encrypted, bank_account_encrypted, bank_routing_encrypted,
    sensitive_pointers, missing_fields, confidence, transcript_excerpt, model, status
  ) VALUES (
    (p->>'call_id')::uuid, p->>'external_call_id', (p->>'agent_id')::uuid, p->>'agent_raw', (p->>'call_at')::timestamptz,
    p->>'client_first_name', p->>'client_last_name', (NULLIF(p->>'client_dob',''))::date, p->>'client_phone', p->>'client_email',
    p->>'client_street', p->>'client_city', p->>'client_state', p->>'client_zip', p->>'ssn_last4',
    (NULLIF(p->>'tobacco',''))::boolean, p->>'health_notes',
    p->>'carrier', p->>'product', (NULLIF(p->>'face_amount',''))::numeric, (NULLIF(p->>'monthly_premium',''))::numeric,
    p->>'draft_day', p->>'payment_method_type', p->>'bank_name', p->>'policy_number',
    COALESCE(p->'beneficiaries','[]'::jsonb),
    CASE WHEN COALESCE(p->>'ssn','')<>'' THEN pgp_sym_encrypt(p->>'ssn', v_key) END,
    CASE WHEN COALESCE(p->>'bank_account','')<>'' THEN pgp_sym_encrypt(p->>'bank_account', v_key) END,
    CASE WHEN COALESCE(p->>'bank_routing','')<>'' THEN pgp_sym_encrypt(p->>'bank_routing', v_key) END,
    COALESCE(p->'sensitive_pointers','{}'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p->'missing_fields')), '{}'),
    COALESCE(p->'confidence','{}'::jsonb), p->>'transcript_excerpt', p->>'model',
    COALESCE(p->>'status','needs_review')
  )
  ON CONFLICT (external_call_id) DO UPDATE SET
    client_first_name=EXCLUDED.client_first_name, client_last_name=EXCLUDED.client_last_name,
    client_dob=EXCLUDED.client_dob, client_phone=EXCLUDED.client_phone, client_email=EXCLUDED.client_email,
    client_street=EXCLUDED.client_street, client_city=EXCLUDED.client_city, client_state=EXCLUDED.client_state,
    client_zip=EXCLUDED.client_zip, ssn_last4=EXCLUDED.ssn_last4, tobacco=EXCLUDED.tobacco, health_notes=EXCLUDED.health_notes,
    carrier=EXCLUDED.carrier, product=EXCLUDED.product, face_amount=EXCLUDED.face_amount, monthly_premium=EXCLUDED.monthly_premium,
    draft_day=EXCLUDED.draft_day, payment_method_type=EXCLUDED.payment_method_type, bank_name=EXCLUDED.bank_name,
    policy_number=EXCLUDED.policy_number, beneficiaries=EXCLUDED.beneficiaries,
    ssn_encrypted=COALESCE(EXCLUDED.ssn_encrypted, t.ssn_encrypted),
    bank_account_encrypted=COALESCE(EXCLUDED.bank_account_encrypted, t.bank_account_encrypted),
    bank_routing_encrypted=COALESCE(EXCLUDED.bank_routing_encrypted, t.bank_routing_encrypted),
    sensitive_pointers=EXCLUDED.sensitive_pointers, missing_fields=EXCLUDED.missing_fields,
    confidence=EXCLUDED.confidence, transcript_excerpt=EXCLUDED.transcript_excerpt, model=EXCLUDED.model,
    -- A packet marked booked (resold) stays booked when the extractor re-runs: the reconcile
    -- scripts re-upsert every packet file, and EXCLUDED.status is only ever ready/needs_review.
    status=CASE WHEN t.status = 'booked' THEN t.status ELSE EXCLUDED.status END, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;
