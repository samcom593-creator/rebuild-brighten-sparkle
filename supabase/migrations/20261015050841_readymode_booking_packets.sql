-- MP-304 — ReadyMode sold-call booking packets.
CREATE TABLE IF NOT EXISTS public.readymode_booking_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid REFERENCES public.readymode_dialer_calls(id) ON DELETE CASCADE,
  external_call_id text UNIQUE,
  agent_id uuid,
  agent_raw text,
  call_at timestamptz,
  client_first_name text, client_last_name text, client_dob date,
  client_phone text, client_email text,
  client_street text, client_city text, client_state text, client_zip text,
  ssn_last4 text,
  tobacco boolean, health_notes text,
  carrier text, product text, face_amount numeric, monthly_premium numeric,
  draft_day text, payment_method_type text, bank_name text, policy_number text,
  beneficiaries jsonb DEFAULT '[]'::jsonb,
  ssn_encrypted bytea, bank_account_encrypted bytea, bank_routing_encrypted bytea,
  sensitive_pointers jsonb DEFAULT '{}'::jsonb,
  missing_fields text[] DEFAULT '{}', confidence jsonb DEFAULT '{}'::jsonb,
  transcript_excerpt text, model text,
  status text NOT NULL DEFAULT 'needs_review',
  booked_at timestamptz, booked_by uuid, booked_policy_number text,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rmbp_call ON public.readymode_booking_packets(call_id);
CREATE INDEX IF NOT EXISTS idx_rmbp_status ON public.readymode_booking_packets(status);

ALTER TABLE public.readymode_booking_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rmbp_read ON public.readymode_booking_packets;
CREATE POLICY rmbp_read ON public.readymode_booking_packets FOR SELECT
  USING (public.has_role(auth.uid(),'admin'::public.app_role)
      OR public.has_role(auth.uid(),'manager'::public.app_role));

CREATE TABLE IF NOT EXISTS public.readymode_packet_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid, accessed_by uuid, accessed_at timestamptz NOT NULL DEFAULT now(),
  fields text[]
);
ALTER TABLE public.readymode_packet_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rmpal_read ON public.readymode_packet_access_log;
CREATE POLICY rmpal_read ON public.readymode_packet_access_log FOR SELECT
  USING (public.has_role(auth.uid(),'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.booking_packet_upsert(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
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
    status=EXCLUDED.status, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.booking_packet_upsert(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_packet_reveal_sensitive(p_id uuid)
RETURNS TABLE (ssn text, bank_account text, bank_routing text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_key text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'booking_packet_reveal_sensitive: admin or manager only';
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='agent_credentials_key' LIMIT 1;
  INSERT INTO public.readymode_packet_access_log(packet_id, accessed_by, fields)
    VALUES (p_id, auth.uid(), ARRAY['ssn','bank_account','bank_routing']);
  RETURN QUERY SELECT
    CASE WHEN b.ssn_encrypted IS NULL THEN NULL ELSE pgp_sym_decrypt(b.ssn_encrypted, v_key) END,
    CASE WHEN b.bank_account_encrypted IS NULL THEN NULL ELSE pgp_sym_decrypt(b.bank_account_encrypted, v_key) END,
    CASE WHEN b.bank_routing_encrypted IS NULL THEN NULL ELSE pgp_sym_decrypt(b.bank_routing_encrypted, v_key) END
  FROM public.readymode_booking_packets b WHERE b.id = p_id;
END; $$;
REVOKE ALL ON FUNCTION public.booking_packet_reveal_sensitive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_packet_reveal_sensitive(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.booking_packet_mark_booked(p_id uuid, p_policy text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'booking_packet_mark_booked: admin or manager only';
  END IF;
  UPDATE public.readymode_booking_packets
    SET status='booked', booked_at=now(), booked_by=auth.uid(),
        booked_policy_number=NULLIF(p_policy,''), updated_at=now()
  WHERE id=p_id;
END; $$;
REVOKE ALL ON FUNCTION public.booking_packet_mark_booked(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_packet_mark_booked(uuid, text) TO authenticated;

CREATE OR REPLACE VIEW public.v_sold_calls_queue
WITH (security_invoker = true) AS
SELECT c.id AS call_id, c.external_call_id, c.call_started_at AS call_at,
       c.agent_id, c.agent_raw, c.lead_first_name, c.lead_last_name, c.lead_phone,
       c.duration_seconds, c.recording_url,
       r.download_status, r.local_path, r.duration_seconds AS rec_seconds,
       (t.id IS NOT NULL) AS has_transcript,
       p.id AS packet_id, p.client_first_name, p.client_last_name, p.client_state,
       p.carrier, p.product, p.face_amount, p.monthly_premium, p.policy_number,
       p.ssn_last4, (p.ssn_encrypted IS NOT NULL) AS has_ssn,
       (p.bank_account_encrypted IS NOT NULL) AS has_bank,
       p.beneficiaries, p.sensitive_pointers, p.missing_fields, p.confidence,
       p.status, p.booked_at,
       CASE
         WHEN p.id IS NOT NULL AND p.status='booked' THEN 'booked'
         WHEN p.id IS NOT NULL AND p.status='ready' THEN 'ready'
         WHEN p.id IS NOT NULL THEN 'needs_review'
         WHEN t.id IS NOT NULL THEN 'transcribing'
         WHEN r.download_status='ok' THEN 'transcribing'
         WHEN r.id IS NOT NULL THEN 'downloading'
         ELSE 'no_recording'
       END AS packet_status
FROM public.readymode_dialer_calls c
LEFT JOIN LATERAL (SELECT * FROM public.readymode_recordings rr WHERE rr.call_id=c.id ORDER BY rr.created_at DESC LIMIT 1) r ON true
LEFT JOIN LATERAL (SELECT id FROM public.readymode_call_transcripts tt WHERE tt.call_id=c.id ORDER BY transcribed_at DESC LIMIT 1) t ON true
LEFT JOIN public.readymode_booking_packets p ON p.call_id=c.id
WHERE c.disposition='Completed Sale';
GRANT SELECT ON public.v_sold_calls_queue TO authenticated;