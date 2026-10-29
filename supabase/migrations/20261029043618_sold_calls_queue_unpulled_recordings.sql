-- MP-310 (2026-10-28, Sam: fix the Sold Calls filters). A sale whose recording ReadyMode holds but the bot has not
-- pulled yet read 'no_recording' (209 sales after the Apr-Aug backfill), so No packet was mostly wrong. It now reads
-- 'downloading' (Pulling recording); 'no_recording' means ReadyMode has no recording at all.
create or replace view public.v_sold_calls_queue with (security_invoker = true) as
 SELECT c.id AS call_id,
    c.external_call_id,
    c.call_started_at AS call_at,
    c.agent_id,
    c.agent_raw,
    c.lead_first_name,
    c.lead_last_name,
    c.lead_phone,
    c.duration_seconds,
    c.recording_url,
    r.download_status,
    r.local_path,
    r.duration_seconds AS rec_seconds,
    (t.id IS NOT NULL) AS has_transcript,
    p.id AS packet_id,
    p.client_first_name,
    p.client_last_name,
    p.client_state,
    p.carrier,
    p.product,
    p.face_amount,
    p.monthly_premium,
    p.policy_number,
    p.draft_day,
    p.payment_method_type,
    p.ssn_last4,
    (p.ssn_encrypted IS NOT NULL) AS has_ssn,
    (p.bank_account_encrypted IS NOT NULL) AS has_bank,
    p.beneficiaries,
    p.sensitive_pointers,
    p.missing_fields,
    p.confidence,
    p.status,
    p.booked_at,
    p.call_summary,
    p.key_points,
        CASE
            WHEN ((p.id IS NOT NULL) AND (p.status = 'booked'::text)) THEN 'booked'::text
            WHEN ((p.id IS NOT NULL) AND (p.status = 'ready'::text)) THEN 'ready'::text
            WHEN (p.id IS NOT NULL) THEN 'needs_review'::text
            WHEN ((r.download_status = 'too_small'::text) OR (r.skip_reason = 'too_short'::text)) THEN 'short_call'::text
            WHEN (t.id IS NOT NULL) THEN 'transcribing'::text
            WHEN (r.download_status = 'ok'::text) THEN 'transcribing'::text
            WHEN (r.id IS NOT NULL) THEN 'downloading'::text
            WHEN (NULLIF(c.recording_url, ''::text) IS NOT NULL) THEN 'downloading'::text
            ELSE 'no_recording'::text
        END AS packet_status,
    w.status AS work_status,
    w.note AS work_note,
    w.updated_at AS work_updated_at,
    w.contacted_at,
    w.resold_at,
    w.pushed_at,
    w.pushback_at,
    i.mortgage_protection,
    i.spouse_coverage,
    i.price_objection,
    i.bank_objection,
    i.ssn_objection,
    i.gave_ssn AS said_ssn,
    i.gave_bank AS said_bank,
    i.approval_status,
    i.approval_quote,
    i.declined_after_ssn_bank,
    i.other_opportunities,
    i.key_moments,
    i.summary AS insight_summary,
    i.verified AS insight_verified
   FROM (((((readymode_dialer_calls c
     LEFT JOIN LATERAL ( SELECT rr.id,
            rr.call_id,
            rr.external_call_id,
            rr.source_url,
            rr.local_path,
            rr.storage_path,
            rr.duration_seconds,
            rr.file_bytes,
            rr.sha256,
            rr.download_status,
            rr.skip_reason,
            rr.error_message,
            rr.downloaded_at,
            rr.created_at
           FROM readymode_recordings rr
          WHERE (rr.call_id = c.id)
          ORDER BY rr.created_at DESC
         LIMIT 1) r ON (true))
     LEFT JOIN LATERAL ( SELECT tt.id,
            tt.word_count
           FROM readymode_call_transcripts tt
          WHERE (tt.call_id = c.id)
          ORDER BY tt.transcribed_at DESC
         LIMIT 1) t ON (true))
     LEFT JOIN readymode_booking_packets p ON ((p.call_id = c.id)))
     LEFT JOIN sold_call_work w ON ((w.call_id = c.id)))
     LEFT JOIN readymode_call_insights i ON ((i.call_id = c.id)))
  WHERE (c.disposition = 'Completed Sale'::text);
