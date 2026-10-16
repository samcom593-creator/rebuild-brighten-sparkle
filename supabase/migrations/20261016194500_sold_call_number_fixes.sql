-- PL-SOLD-CALL-NUMBERS (2026-10-16): SSN and bank numbers heard wrong on the recording can be
-- corrected on the call, and stay corrected.
--
-- Sam, 2026-10-16: "a lot of these SSN have extra numbers". Measured on the 85 packets that hold an
-- SSN: 16 have 10 digits and 4 have 7 or 8. Of 58 routing numbers, 4 are the wrong length and 4 more
-- fail the ABA check digit. The page now flags each one (src/lib/soldCallPacket.ts checkNumber) and
-- offers Fix. This migration is the write side:
--
--   * booking_packet_fix_number(packet, field, value): the caller types the number the client
--     confirmed. Same rules as the page (SSN 9 digits and a possible SSN; routing 9 digits passing
--     the check digit; account 4 to 17 digits), gated on can_view_sold_calls() like every other
--     read of these numbers, saved encrypted with the same vault key, logged without the value.
--   * readymode_booking_packets.numbers_fixed records which numbers a person corrected.
--   * booking_packet_upsert leaves a corrected number alone. The reconcile scripts re-upsert every
--     packet file, so without this the extractor's next run would write the mis-heard number back.

alter table public.readymode_booking_packets
  add column if not exists numbers_fixed jsonb not null default '{}'::jsonb;

comment on column public.readymode_booking_packets.numbers_fixed is
  'Numbers a person corrected by hand after confirming them with the client, as {"ssn"|"bank_routing"|"bank_account": {"at": timestamptz, "by": uuid}}. booking_packet_upsert never overwrites a field named here.';

create or replace function public.booking_packet_fix_number(p_packet_id uuid, p_field text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $function$
declare
  v_field text := lower(btrim(coalesce(p_field, '')));
  v_digits text := regexp_replace(coalesce(p_value, ''), '\D', '', 'g');
  v_n int;
  v_sum int;
  v_key text;
  v_id uuid;
  v_call uuid;
  v_label text;
  v_missing text;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Not allowed to change sold-call numbers.' using errcode = '42501';
  end if;
  v_n := length(v_digits);

  if v_field = 'ssn' then
    v_label := 'SSN';
    v_missing := '^ssn';
    if v_n <> 9 then
      raise exception 'An SSN has 9 digits; that was %.', v_n using errcode = '22023';
    end if;
    if left(v_digits, 3) in ('000', '666') or substr(v_digits, 4, 2) = '00' or right(v_digits, 4) = '0000' then
      raise exception 'That is not a possible SSN. Check each digit with the client.' using errcode = '22023';
    end if;
  elsif v_field = 'bank_routing' then
    v_label := 'routing number';
    v_missing := '^(bank_)?routing';
    if v_n <> 9 then
      raise exception 'A routing number has 9 digits; that was %.', v_n using errcode = '22023';
    end if;
    v_sum := 3 * (substr(v_digits, 1, 1)::int + substr(v_digits, 4, 1)::int + substr(v_digits, 7, 1)::int)
           + 7 * (substr(v_digits, 2, 1)::int + substr(v_digits, 5, 1)::int + substr(v_digits, 8, 1)::int)
           +     (substr(v_digits, 3, 1)::int + substr(v_digits, 6, 1)::int + substr(v_digits, 9, 1)::int);
    if v_sum % 10 <> 0 then
      raise exception 'That routing number fails the bank check digit, so one digit is wrong.' using errcode = '22023';
    end if;
  elsif v_field = 'bank_account' then
    v_label := 'account number';
    v_missing := '^(bank_account|account_number)';
    if v_n < 4 or v_n > 17 then
      raise exception 'A bank account number has 4 to 17 digits; that was %.', v_n using errcode = '22023';
    end if;
  else
    raise exception 'Unknown number "%". Use ssn, bank_routing or bank_account.', p_field using errcode = '22023';
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'agent_credentials_key' limit 1;
  if v_key is null then
    raise exception 'vault key missing';
  end if;

  update public.readymode_booking_packets b set
    ssn_encrypted = case when v_field = 'ssn' then pgp_sym_encrypt(v_digits, v_key) else b.ssn_encrypted end,
    ssn_last4 = case when v_field = 'ssn' then right(v_digits, 4) else b.ssn_last4 end,
    bank_routing_encrypted = case when v_field = 'bank_routing' then pgp_sym_encrypt(v_digits, v_key) else b.bank_routing_encrypted end,
    bank_account_encrypted = case when v_field = 'bank_account' then pgp_sym_encrypt(v_digits, v_key) else b.bank_account_encrypted end,
    -- The number is on file now, so the "ask the client for it" entries for that field go.
    missing_fields = array(
      select u.f from unnest(b.missing_fields) with ordinality as u(f, i)
      where u.f !~ v_missing order by u.i
    ),
    numbers_fixed = b.numbers_fixed || jsonb_build_object(v_field, jsonb_build_object('at', now(), 'by', auth.uid())),
    updated_at = now()
  where b.id = p_packet_id
  returning b.id, b.call_id into v_id, v_call;

  if v_id is null then
    raise exception 'No sold-call packet %.', p_packet_id using errcode = 'P0002';
  end if;

  insert into public.readymode_packet_access_log (packet_id, accessed_by, fields)
    values (v_id, auth.uid(), array['fix:' || v_field]);
  if v_call is not null then
    insert into public.sold_call_work_events (call_id, status, note, created_by)
      values (v_call, null, 'Corrected the ' || v_label || ' after confirming it with the client.', auth.uid());
  end if;

  return jsonb_build_object('field', v_field, 'digits', v_n, 'fixed_at', now());
end;
$function$;

revoke all on function public.booking_packet_fix_number(uuid, text, text) from public, anon;
grant execute on function public.booking_packet_fix_number(uuid, text, text) to authenticated, service_role;

-- The extractor's upsert, unchanged except that it leaves alone any number a person corrected
-- (and that number's "ask the client" entries).
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
    client_zip=EXCLUDED.client_zip,
    -- A number a person corrected (numbers_fixed) is never written over by a re-extraction.
    ssn_last4=CASE WHEN (t.numbers_fixed -> 'ssn') IS NOT NULL THEN t.ssn_last4 ELSE EXCLUDED.ssn_last4 END,
    tobacco=EXCLUDED.tobacco, health_notes=EXCLUDED.health_notes,
    carrier=EXCLUDED.carrier, product=EXCLUDED.product, face_amount=EXCLUDED.face_amount, monthly_premium=EXCLUDED.monthly_premium,
    draft_day=EXCLUDED.draft_day, payment_method_type=EXCLUDED.payment_method_type, bank_name=EXCLUDED.bank_name,
    policy_number=EXCLUDED.policy_number, beneficiaries=EXCLUDED.beneficiaries,
    ssn_encrypted=CASE WHEN (t.numbers_fixed -> 'ssn') IS NOT NULL THEN t.ssn_encrypted
                       ELSE COALESCE(EXCLUDED.ssn_encrypted, t.ssn_encrypted) END,
    bank_account_encrypted=CASE WHEN (t.numbers_fixed -> 'bank_account') IS NOT NULL THEN t.bank_account_encrypted
                                ELSE COALESCE(EXCLUDED.bank_account_encrypted, t.bank_account_encrypted) END,
    bank_routing_encrypted=CASE WHEN (t.numbers_fixed -> 'bank_routing') IS NOT NULL THEN t.bank_routing_encrypted
                                ELSE COALESCE(EXCLUDED.bank_routing_encrypted, t.bank_routing_encrypted) END,
    sensitive_pointers=EXCLUDED.sensitive_pointers,
    missing_fields=ARRAY(
      SELECT u.f FROM unnest(EXCLUDED.missing_fields) WITH ORDINALITY AS u(f, i)
      WHERE NOT ((t.numbers_fixed -> 'ssn') IS NOT NULL AND u.f ~ '^ssn')
        AND NOT ((t.numbers_fixed -> 'bank_routing') IS NOT NULL AND u.f ~ '^(bank_)?routing')
        AND NOT ((t.numbers_fixed -> 'bank_account') IS NOT NULL AND u.f ~ '^(bank_account|account_number)')
      ORDER BY u.i
    ),
    confidence=EXCLUDED.confidence, transcript_excerpt=EXCLUDED.transcript_excerpt, model=EXCLUDED.model,
    -- A packet marked booked (resold) stays booked when the extractor re-runs: the reconcile
    -- scripts re-upsert every packet file, and EXCLUDED.status is only ever ready/needs_review.
    status=CASE WHEN t.status = 'booked' THEN t.status ELSE EXCLUDED.status END, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

notify pgrst, 'reload schema';
