-- PL-RESELL-WORKBENCH (2026-10-16). Sam: make reselling as easy as possible. Mark every sold call
-- contacted / resold / push / pushback; note who gave SSN and bank; show what the agent said about
-- approval; flag mortgage-protection and spouse interest, price and bank objections, and anyone who
-- gave SSN + bank and was still declined; put the moments that matter from the transcript on the
-- card; and work the calls ReadyMode dispositioned Bank Objection / No Bank Account / Social
-- Objection the same way.

-- 1. Resale work state, one row per dialer call, history in sold_call_work_events. Written only by
--    sold_call_set_status (definer, gated on can_view_sold_calls: admins and Aisha).
create table if not exists public.sold_call_work (
  call_id uuid primary key references public.readymode_dialer_calls(id) on delete cascade,
  status text check (status in ('contacted', 'resold', 'pushed', 'pushback')),
  note text,
  contacted_at timestamptz,
  resold_at timestamptz,
  pushed_at timestamptz,
  pushback_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.sold_call_work_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.readymode_dialer_calls(id) on delete cascade,
  status text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists sold_call_work_events_call_idx on public.sold_call_work_events (call_id, created_at desc);
alter table public.sold_call_work enable row level security;
alter table public.sold_call_work_events enable row level security;
drop policy if exists sold_call_work_read on public.sold_call_work;
create policy sold_call_work_read on public.sold_call_work for select to authenticated using ((select public.can_view_sold_calls()));
drop policy if exists sold_call_work_events_read on public.sold_call_work_events;
create policy sold_call_work_events_read on public.sold_call_work_events for select to authenticated using ((select public.can_view_sold_calls()));
revoke all on public.sold_call_work, public.sold_call_work_events from anon;
grant select on public.sold_call_work, public.sold_call_work_events to authenticated;

create or replace function public.sold_call_set_status(p_call_id uuid, p_status text default null, p_note text default null)
returns public.sold_call_work
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_today text := to_char((now() at time zone 'America/Phoenix')::date, 'YYYY-MM-DD');
  v_row public.sold_call_work;
begin
  if v_uid is null or not public.can_view_sold_calls() then
    raise exception 'Only admins and sold-call viewers can work these calls.' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('contacted', 'resold', 'pushed', 'pushback') then
    raise exception 'Unknown status "%".', p_status using errcode = '22023';
  end if;
  if v_status is null and v_note is null then
    raise exception 'Pick a status or write a note.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'Notes are limited to 2000 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.readymode_dialer_calls c where c.id = p_call_id) then
    raise exception 'Call % does not exist.', p_call_id using errcode = 'P0002';
  end if;
  insert into public.sold_call_work as w (call_id, status, note, contacted_at, resold_at, pushed_at, pushback_at, updated_by, updated_at)
  values (
    p_call_id, v_status,
    case when v_note is not null then v_today || ': ' || v_note end,
    case when v_status = 'contacted' then now() end,
    case when v_status = 'resold' then now() end,
    case when v_status = 'pushed' then now() end,
    case when v_status = 'pushback' then now() end,
    v_uid, now()
  )
  on conflict (call_id) do update set
    status = coalesce(v_status, w.status),
    note = case when v_note is not null then v_today || ': ' || v_note || coalesce(E'\n' || w.note, '') else w.note end,
    contacted_at = case when v_status = 'contacted' then now() else w.contacted_at end,
    resold_at = case when v_status = 'resold' then now() else w.resold_at end,
    pushed_at = case when v_status = 'pushed' then now() else w.pushed_at end,
    pushback_at = case when v_status = 'pushback' then now() else w.pushback_at end,
    updated_by = v_uid,
    updated_at = now()
  returning * into v_row;
  insert into public.sold_call_work_events (call_id, status, note, created_by) values (p_call_id, v_status, v_note, v_uid);
  return v_row;
end
$fn$;
revoke all on function public.sold_call_set_status(uuid, text, text) from public, anon;
grant execute on function public.sold_call_set_status(uuid, text, text) to authenticated, service_role;

-- 2. What each call's transcript says, written by the resell-intelligence pass (an extraction read
--    of the whole transcript, then an independent check of every flag). Booleans only for SSN/bank:
--    no digits are ever stored here.
create table if not exists public.readymode_call_insights (
  call_id uuid primary key references public.readymode_dialer_calls(id) on delete cascade,
  mortgage_protection boolean not null default false,
  spouse_coverage boolean not null default false,
  price_objection boolean not null default false,
  bank_objection boolean not null default false,
  ssn_objection boolean not null default false,
  gave_ssn boolean not null default false,
  gave_bank boolean not null default false,
  approval_status text not null default 'not_said' check (approval_status in ('approved', 'declined', 'pending', 'not_said')),
  approval_quote text,
  declined_after_ssn_bank boolean not null default false,
  other_opportunities text[] not null default '{}',
  key_moments jsonb not null default '[]'::jsonb,
  summary text,
  verified boolean not null default false,
  model text,
  extracted_at timestamptz not null default now()
);
alter table public.readymode_call_insights enable row level security;
drop policy if exists readymode_call_insights_read on public.readymode_call_insights;
create policy readymode_call_insights_read on public.readymode_call_insights for select to authenticated using ((select public.can_view_sold_calls()));
revoke all on public.readymode_call_insights from anon;
grant select on public.readymode_call_insights to authenticated;

-- 3. Sold-call viewers also read the objection dispositions on the dialer table (the calls a
--    client nearly bought on), not only Completed Sale.
drop policy if exists rmd_sold_call_viewers_read on public.readymode_dialer_calls;
create policy rmd_sold_call_viewers_read on public.readymode_dialer_calls for select to authenticated using (
  disposition = any (array['Completed Sale', 'Bank Objection', 'No Bank Account', 'Social Objection'])
  and (select public.can_view_sold_calls())
);

-- 4. The Sold Calls queue carries the work state and the transcript intelligence (trailing columns).
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
    t.id IS NOT NULL AS has_transcript,
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
    p.ssn_encrypted IS NOT NULL AS has_ssn,
    p.bank_account_encrypted IS NOT NULL AS has_bank,
    p.beneficiaries,
    p.sensitive_pointers,
    p.missing_fields,
    p.confidence,
    p.status,
    p.booked_at,
    p.call_summary,
    p.key_points,
        CASE
            WHEN p.id IS NOT NULL AND p.status = 'booked'::text THEN 'booked'::text
            WHEN p.id IS NOT NULL AND p.status = 'ready'::text THEN 'ready'::text
            WHEN p.id IS NOT NULL THEN 'needs_review'::text
            WHEN r.download_status = 'too_small'::text OR r.skip_reason = 'too_short'::text THEN 'short_call'::text
            WHEN t.id IS NOT NULL THEN 'transcribing'::text
            WHEN r.download_status = 'ok'::text THEN 'transcribing'::text
            WHEN r.id IS NOT NULL THEN 'downloading'::text
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
   FROM readymode_dialer_calls c
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
          WHERE rr.call_id = c.id
          ORDER BY rr.created_at DESC
         LIMIT 1) r ON true
     LEFT JOIN LATERAL ( SELECT tt.id,
            tt.word_count
           FROM readymode_call_transcripts tt
          WHERE tt.call_id = c.id
          ORDER BY tt.transcribed_at DESC
         LIMIT 1) t ON true
     LEFT JOIN readymode_booking_packets p ON p.call_id = c.id
     LEFT JOIN sold_call_work w ON w.call_id = c.id
     LEFT JOIN readymode_call_insights i ON i.call_id = c.id
  WHERE c.disposition = 'Completed Sale'::text;

-- 5. Objection calls to resell: same work state and intelligence, plus whether the same phone
--    later bought (so a closed client is not called as a lost one).
create or replace view public.v_objection_calls with (security_invoker = true) as
select c.id as call_id,
       c.external_call_id,
       c.call_started_at as call_at,
       c.agent_raw,
       c.lead_first_name,
       c.lead_last_name,
       c.lead_phone,
       c.lead_email,
       c.disposition,
       c.duration_seconds,
       r.duration_seconds as rec_seconds,
       (t.id is not null) as has_transcript,
       r.download_status,
       exists (
         select 1 from public.readymode_dialer_calls s
          where s.disposition = 'Completed Sale'
            and right(regexp_replace(coalesce(s.lead_phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(c.lead_phone, ''), '\D', '', 'g'), 10)
            and length(regexp_replace(coalesce(c.lead_phone, ''), '\D', '', 'g')) >= 10
       ) as sold_later,
       w.status as work_status, w.note as work_note, w.updated_at as work_updated_at,
       w.contacted_at, w.resold_at, w.pushed_at, w.pushback_at,
       i.mortgage_protection, i.spouse_coverage, i.price_objection, i.bank_objection, i.ssn_objection,
       i.gave_ssn as said_ssn, i.gave_bank as said_bank, i.approval_status, i.approval_quote,
       i.declined_after_ssn_bank, i.other_opportunities, i.key_moments, i.summary as insight_summary, i.verified as insight_verified
  from public.readymode_dialer_calls c
  left join lateral (select rr.id, rr.duration_seconds, rr.download_status from public.readymode_recordings rr where rr.call_id = c.id order by rr.created_at desc limit 1) r on true
  left join lateral (select tt.id from public.readymode_call_transcripts tt where tt.call_id = c.id order by tt.transcribed_at desc limit 1) t on true
  left join public.sold_call_work w on w.call_id = c.id
  left join public.readymode_call_insights i on i.call_id = c.id
 where c.disposition = any (array['Bank Objection', 'No Bank Account', 'Social Objection']);
revoke all on public.v_objection_calls from anon;
grant select on public.v_objection_calls to authenticated;
