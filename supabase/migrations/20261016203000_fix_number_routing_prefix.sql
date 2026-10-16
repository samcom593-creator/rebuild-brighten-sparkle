-- PL-SOLD-CALL-NUMBERS review fix (2026-10-16): the routing number rule gains the two checks the page now
-- runs (src/lib/soldCallPacket.ts checkNumber). A real routing number starts with 00-12, 21-32, 61-72 or 80,
-- and is never all zeros. Without these, 503000196 (053000196 with its first two digits swapped) passes the
-- ABA check digit. Same function otherwise; CREATE OR REPLACE keeps its revoke/grant.

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
    if v_digits = '000000000' then
      raise exception 'A routing number cannot be all zeros. Check each digit with the client.' using errcode = '22023';
    end if;
    if not (left(v_digits, 2)::int <= 12 or left(v_digits, 2)::int between 21 and 32
            or left(v_digits, 2)::int between 61 and 72 or left(v_digits, 2) = '80') then
      raise exception 'No routing number starts with %. Check each digit with the client.', left(v_digits, 2) using errcode = '22023';
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

notify pgrst, 'reload schema';
