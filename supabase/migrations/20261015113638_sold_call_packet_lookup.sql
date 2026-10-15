-- Lookup view so existing client surfaces (Client Pipeline, Book of Business,
-- Book Flips) can find a client's sold-call booking packet by phone or name+dob.
-- No encrypted columns exposed; SSN/bank come only from booking_packet_reveal_sensitive.
CREATE OR REPLACE VIEW public.v_sold_call_packets
WITH (security_invoker = true) AS
SELECT
  p.id AS packet_id,
  p.call_id,
  p.external_call_id,
  c.call_started_at AS call_at,
  p.agent_raw,
  right(regexp_replace(coalesce(c.lead_phone,''),'[^0-9]','','g'),10) AS match_phone10,
  lower(trim(coalesce(p.client_first_name, c.lead_first_name))) AS match_first,
  lower(trim(coalesce(p.client_last_name, c.lead_last_name))) AS match_last,
  p.client_dob AS match_dob,
  p.client_first_name, p.client_last_name, p.client_dob,
  p.client_phone, p.client_email, p.client_street, p.client_city, p.client_state, p.client_zip,
  p.ssn_last4, p.tobacco, p.health_notes,
  p.carrier, p.product, p.face_amount, p.monthly_premium, p.draft_day, p.payment_method_type, p.bank_name, p.policy_number,
  p.beneficiaries, p.sensitive_pointers, p.missing_fields, p.confidence,
  (p.ssn_encrypted IS NOT NULL) AS has_ssn,
  (p.bank_account_encrypted IS NOT NULL) AS has_bank,
  c.recording_url, c.duration_seconds,
  p.status, p.booked_at, p.booked_policy_number
FROM public.readymode_booking_packets p
JOIN public.readymode_dialer_calls c ON c.id = p.call_id;
GRANT SELECT ON public.v_sold_call_packets TO authenticated;