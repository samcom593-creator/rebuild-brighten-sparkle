-- MP-LEAD-MANAGER-9b (2026-11-09): "should be way more leads" — measured, he's right.
-- 218 unbooked booking packets exist; only 38 carried a parseable client_phone, so
-- v_pool_rewrite starved at 38. The other 180 are phone CALLS whose dialed number
-- sits on readymode_dialer_calls.lead_phone10 (join proven: 180 of 180 recoverable).
-- The view now falls back to the dialer call's number when the packet's own
-- client_phone is blank/unparseable. Everything else in the view is unchanged.
create or replace view public.v_pool_rewrite as
 SELECT NULL::uuid AS lead_id,
    COALESCE(
      NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text),
      dc.lead_phone10
    ) AS phone10,
    p.client_first_name AS first_name,
    p.client_last_name AS last_name,
    NULL::text AS email,
    p.client_state AS state,
        CASE
            WHEN p.client_dob IS NOT NULL THEN EXTRACT(year FROM age(p.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN (p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL) AND (p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL) THEN 'S'::text
            WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL OR p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[
        CASE WHEN p.payment_method_type = 'card'::text THEN 'card on file'::text ELSE NULL::text END,
        CASE WHEN p.payment_method_type = 'direct_express'::text THEN 'direct express'::text ELSE NULL::text END,
        CASE WHEN p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]) THEN 'bank on file'::text ELSE NULL::text END,
        CASE WHEN p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text THEN 'no bank'::text ELSE NULL::text END,
        CASE WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL THEN 'SSN collected'::text ELSE NULL::text END,
        CASE WHEN p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'bank collected'::text ELSE NULL::text END,
        CASE WHEN p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]) THEN 'data collected, not booked'::text ELSE NULL::text END,
        CASE WHEN COALESCE(ci.spouse_coverage, false) THEN 'spouse opportunity'::text ELSE NULL::text END
      ], NULL::text), ', '::text), ''::text) AS tags,
    jsonb_build_object(
      'cc', p.payment_method_type = 'card'::text,
      'direct_express', p.payment_method_type = 'direct_express'::text,
      'bank_on_file', p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]),
      'no_bank', p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text,
      'ssn_collected', p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL,
      'bank_collected', p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL,
      'hung_up', p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]),
      'spouse', COALESCE(ci.spouse_coverage, false),
      'dnc', false) AS flags,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - (p.call_at AT TIME ZONE 'America/Phoenix'::text)::date AS lead_age_days,
    false AS under_9mo
   FROM readymode_booking_packets p
     LEFT JOIN readymode_call_insights ci ON ci.call_id = p.call_id
     LEFT JOIN readymode_dialer_calls dc ON dc.id = p.call_id
  WHERE COALESCE(p.status, ''::text) <> 'booked'::text;
