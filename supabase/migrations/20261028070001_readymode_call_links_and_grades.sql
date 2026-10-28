-- Mirrored 2026-10-28 from supabase_migrations.schema_migrations (applied via MCP by a parallel session; the file must exist
-- under the recorded version or `supabase db push` refuses every later migration: see apex_mcp_migrations_must_mirror).
-- MP-309 (2026-10-28, Sam: "match as much book of business to the transcriptions as possible, add filters like is this
-- policy active / inactive / do we not know, and find the great calls for training").
-- 1. Match keys on dialer calls, trigger-maintained (upsert_readymode_dialer_calls lists its columns and
--    fn_readymode_ingest populates the whole record, so a generated column would break the webhook path).
alter table public.readymode_dialer_calls
  add column if not exists lead_phone10 text,
  add column if not exists lead_name_key text;
create or replace function public.fn_rmd_match_keys() returns trigger
language plpgsql set search_path = public as $$
declare d text;
begin
  d := regexp_replace(coalesce(new.lead_phone, ''), '[^0-9]', '', 'g');
  new.lead_phone10 := case when length(d) >= 10 then right(d, 10) end;
  new.lead_name_key := nullif(regexp_replace(lower(coalesce(new.lead_first_name, '') || coalesce(new.lead_last_name, '')), '[^a-z0-9]', '', 'g'), '');
  return new;
end $$;
drop trigger if exists trg_rmd_match_keys on public.readymode_dialer_calls;
create trigger trg_rmd_match_keys before insert or update of lead_phone, lead_first_name, lead_last_name
  on public.readymode_dialer_calls for each row execute function public.fn_rmd_match_keys();
update public.readymode_dialer_calls set
  lead_phone10 = case when length(regexp_replace(coalesce(lead_phone, ''), '[^0-9]', '', 'g')) >= 10 then right(regexp_replace(coalesce(lead_phone, ''), '[^0-9]', '', 'g'), 10) end,
  lead_name_key = nullif(regexp_replace(lower(coalesce(lead_first_name, '') || coalesce(lead_last_name, '')), '[^a-z0-9]', '', 'g'), '')
where lead_phone10 is null and lead_name_key is null;
create index if not exists idx_rmd_lead_phone10 on public.readymode_dialer_calls (lead_phone10) where lead_phone10 is not null;
create index if not exists idx_rmd_lead_name_key on public.readymode_dialer_calls (lead_name_key) where lead_name_key is not null;
-- 2. Call grades for training on readymode_call_analysis (built by MP-303, 0 rows until now; grader model = 'grade-v1').
alter table public.readymode_call_analysis
  add column if not exists overall_score integer,
  add column if not exists scores jsonb,
  add column if not exists stage_reached text,
  add column if not exists objection_moments jsonb not null default '[]'::jsonb,
  add column if not exists tactics text[] not null default '{}',
  add column if not exists strengths text[] not null default '{}',
  add column if not exists improvements text[] not null default '{}',
  add column if not exists training_tags text[] not null default '{}',
  add column if not exists great_call boolean not null default false,
  add column if not exists grader_model text;
create index if not exists idx_rmca_call_model on public.readymode_call_analysis (call_id, model);
drop policy if exists rmca_sold_call_viewers_read on public.readymode_call_analysis;
create policy rmca_sold_call_viewers_read on public.readymode_call_analysis
  for select to authenticated using ((select public.can_view_sold_calls()));
-- 3. Sold-call viewers (Sam + Aisha, can_view_sold_calls) read every dialer call: the book links need attempts,
--    Do Not Call, appointments and give-ups, not only the four resell dispositions.
drop policy if exists rmd_sold_call_viewers_read on public.readymode_dialer_calls;
create policy rmd_sold_call_viewers_read on public.readymode_dialer_calls
  for select to authenticated using ((select public.can_view_sold_calls()));
-- 4. Book row <-> call links. Phone first (client record or posted deal phone, or the packet's client phone),
--    then the same name key book_flip_client_key uses. One row per (book row, call); matched_by says how.
create or replace view public.v_book_row_calls with (security_invoker = true) as
with book as (
  select b.flip_key, b.policy_number, b.client_key,
         case when length(regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g')) >= 10
              then right(regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g'), 10) end as phone10,
         nullif(regexp_replace(lower(coalesce(b.client_name, '')), '[^a-z0-9]', '', 'g'), '') as name_key
  from public.v_book_flip_worklist b
), packet_keys as (
  select p.call_id,
         case when length(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g')) >= 10
              then right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10) end as phone10,
         nullif(regexp_replace(lower(coalesce(p.client_first_name, '') || coalesce(p.client_last_name, '')), '[^a-z0-9]', '', 'g'), '') as name_key
  from public.readymode_booking_packets p
), hits as (
  select book.flip_key, c.id as call_id, 'phone'::text as matched_by
    from book join public.readymode_dialer_calls c on c.lead_phone10 = book.phone10
  union all
  select book.flip_key, pk.call_id, 'phone'::text
    from book join packet_keys pk on pk.phone10 = book.phone10
  union all
  select book.flip_key, c.id, 'name'::text
    from book join public.readymode_dialer_calls c on c.lead_name_key = book.name_key
   where length(book.name_key) >= 6
  union all
  select book.flip_key, pk.call_id, 'name'::text
    from book join packet_keys pk on pk.name_key = book.name_key
   where length(book.name_key) >= 6
), links as (
  select flip_key, call_id, case when bool_or(matched_by = 'phone') then 'phone' else 'name' end as matched_by
  from hits group by flip_key, call_id
)
select l.flip_key, l.call_id, l.matched_by, c.external_call_id, c.call_started_at, c.disposition, c.agent_raw, c.agent_id,
       c.duration_seconds, c.recording_url, c.lead_first_name, c.lead_last_name
from links l join public.readymode_dialer_calls c on c.id = l.call_id;

-- 5. One row per book row: what the dialer knows about this client (Book of Business row + filters).
create or replace view public.v_book_row_call_summary with (security_invoker = true) as
select b.flip_key, b.policy_number, b.client_key, b.carrier,
  count(l.call_id)::int as calls_total,
  count(*) filter (where l.disposition = 'Completed Sale')::int as sold_calls,
  count(*) filter (where l.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', 'I Give Up'))::int as objection_calls,
  count(*) filter (where l.disposition = '&rArr; Appointments')::int as appointment_calls,
  count(*) filter (where l.disposition = 'Do Not Call')::int as dnc_calls,
  count(t.id)::int as transcripts,
  max(l.call_started_at) as last_call_at,
  (array_agg(l.disposition order by l.call_started_at desc nulls last))[1] as last_disposition,
  (array_agg(l.agent_raw order by l.call_started_at desc nulls last))[1] as last_agent,
  coalesce(bool_or(l.matched_by = 'phone'), false) as matched_by_phone,
  (array_agg(p.id order by l.call_started_at desc nulls last) filter (where p.id is not null))[1] as packet_id,
  (array_agg(l.call_id order by l.call_started_at desc nulls last) filter (where t.id is not null))[1] as latest_transcript_call_id,
  (array_agg(coalesce(p.call_summary, i.summary, a.summary) order by l.call_started_at desc nulls last)
     filter (where coalesce(p.call_summary, i.summary, a.summary) is not null))[1] as latest_summary,
  max(a.overall_score) as best_grade,
  coalesce(bool_or(a.great_call), false) as has_great_call,
  coalesce(bool_or(i.gave_ssn and i.gave_bank), false) as gave_ssn_and_bank,
  (array_agg(i.approval_status order by l.call_started_at desc nulls last)
     filter (where i.approval_status is not null and i.approval_status <> 'not_said'))[1] as last_approval_said
from public.v_book_flip_worklist b
left join public.v_book_row_calls l on l.flip_key = b.flip_key
left join public.readymode_call_transcripts t on t.call_id = l.call_id
left join public.readymode_booking_packets p on p.call_id = l.call_id
left join public.readymode_call_insights i on i.call_id = l.call_id
left join public.readymode_call_analysis a on a.call_id = l.call_id and a.model = 'grade-v1'
group by b.flip_key, b.policy_number, b.client_key, b.carrier;

-- 5b. One row per (book row, call) with everything the row panel shows.
create or replace view public.v_book_row_call_detail with (security_invoker = true) as
select l.flip_key, l.call_id, l.matched_by, l.external_call_id, l.call_started_at, l.disposition, l.agent_raw, l.agent_id,
  coalesce(ag.display_name, l.agent_raw) as agent_name, l.duration_seconds, l.recording_url,
  (t.id is not null) as has_transcript, t.word_count,
  p.id as packet_id, p.carrier as packet_carrier, p.product as packet_product, p.monthly_premium as packet_monthly_premium,
  p.policy_number as packet_policy_number, p.status as packet_status, p.call_summary,
  i.summary as resell_summary, i.approval_status, i.gave_ssn, i.gave_bank, i.price_objection, i.bank_objection, i.ssn_objection,
  i.spouse_coverage, i.mortgage_protection, i.other_opportunities,
  a.overall_score, a.great_call, a.stage_reached, a.training_tags, a.coaching_notes, a.summary as grade_summary,
  w.status as work_status
from public.v_book_row_calls l
left join public.agents ag on ag.id = l.agent_id
left join public.readymode_call_transcripts t on t.call_id = l.call_id
left join public.readymode_booking_packets p on p.call_id = l.call_id
left join public.readymode_call_insights i on i.call_id = l.call_id
left join public.readymode_call_analysis a on a.call_id = l.call_id and a.model = 'grade-v1'
left join public.sold_call_work w on w.call_id = l.call_id;

-- 6. The other direction: every sold call and whether it ever became a book row (the unbooked sales).
create or replace view public.v_sold_call_book_match with (security_invoker = true) as
with best as (
  select distinct on (l.call_id) l.call_id, l.flip_key, l.matched_by
  from public.v_book_row_calls l
  order by l.call_id, (l.matched_by = 'phone') desc
)
select c.id as call_id, c.external_call_id, c.call_started_at, c.agent_raw, c.agent_id, c.lead_first_name, c.lead_last_name,
  (best.flip_key is not null) as in_book, best.flip_key, best.matched_by,
  b.book_status, b.status_group, b.carrier as book_carrier, b.policy_number as book_policy_number, b.client_name as book_client_name,
  p.id as packet_id, p.carrier as packet_carrier, p.policy_number as packet_policy_number, p.monthly_premium as packet_monthly_premium, p.status as packet_status,
  w.status as work_status
from public.readymode_dialer_calls c
left join best on best.call_id = c.id
left join public.v_book_flip_worklist b on b.flip_key = best.flip_key
left join public.readymode_booking_packets p on p.call_id = c.id
left join public.sold_call_work w on w.call_id = c.id
where c.disposition = 'Completed Sale';

-- 7. Training surfaces: graded calls + per-agent scorecard (90 days, dialer rows that reached a human).
drop view if exists public.v_call_training;
create view public.v_call_training with (security_invoker = true) as
select a.id as analysis_id, a.call_id, c.external_call_id, c.call_started_at, c.disposition, c.agent_raw, c.agent_id,
  coalesce(ag.display_name, c.agent_raw) as agent_name, c.duration_seconds, c.recording_url, c.lead_first_name,
  a.overall_score, a.scores, a.stage_reached,
  case a.outcome_quality when 4 then 'great' when 3 then 'good' when 2 then 'average' when 1 then 'poor' end as outcome_quality,
  a.great_call, a.training_tags, a.tactics, a.strengths, a.improvements,
  a.objection_moments, a.key_quotes, a.coaching_priority, a.coaching_notes, a.compliance_flags, a.sentiment, a.summary, a.analyzed_at,
  (p.id is not null) as has_packet, i.summary as resell_summary
from public.readymode_call_analysis a
join public.readymode_dialer_calls c on c.id = a.call_id
left join public.agents ag on ag.id = c.agent_id
left join public.readymode_booking_packets p on p.call_id = c.id
left join public.readymode_call_insights i on i.call_id = c.id
where a.model = 'grade-v1';

create or replace view public.v_call_training_agents with (security_invoker = true) as
select coalesce(ag.display_name, c.agent_raw) as agent_name, c.agent_id, c.agent_raw,
  count(*)::int as calls_total,
  count(*) filter (where c.disposition = 'Completed Sale')::int as sold,
  count(a.id)::int as graded,
  round(avg(a.overall_score) filter (where a.stage_reached not in ('voicemail', 'no_contact')))::int as avg_score,
  count(*) filter (where a.great_call)::int as great_calls,
  round(avg((a.scores->>'objection_handling')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_objection_handling,
  round(avg((a.scores->>'close')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_close,
  count(*) filter (where a.coaching_priority = 'urgent')::int as urgent_flags,
  max(c.call_started_at) as last_call_at
from public.readymode_dialer_calls c
left join public.agents ag on ag.id = c.agent_id
left join public.readymode_call_analysis a on a.call_id = c.id and a.model = 'grade-v1'
where c.call_started_at > now() - interval '90 days' and c.disposition <> 'Not Available'
group by 1, 2, 3;

