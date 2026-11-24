-- MP-TRAINING-CENTER (2026-11-23): one training center, and no client data in it.
--
-- Sam: the training calls must keep everything an agent learns from (the opening, the objections, the close)
-- and carry nothing that could be used to resell or flip the book. Before this wave the team copy muted
-- spoken digits only: the text an agent read named the client in 40 of 60 calls (6 with the last name),
-- and the audio still spoke last names, street names, towns and emails.
--
-- The rule now: an agent reads and hears another agent's call ONLY through call_training_team_copy, a
-- separately stored copy written by ~/business-ops/training-center/redact.py (names, places, emails, banks,
-- birth dates and every number removed from the text and muted in the audio). The library fails closed:
-- no team copy, or a team copy that still trips fn_training_text_leaks(), means the call is not shown.

-- 1. The team copy -------------------------------------------------------------------------------------
create table if not exists public.call_training_team_copy (
  call_id uuid primary key references public.readymode_dialer_calls (id) on delete cascade,
  summary text,
  objection_moments jsonb not null default '[]'::jsonb,
  key_quotes jsonb not null default '[]'::jsonb,
  strengths text[] not null default '{}',
  tactics text[] not null default '{}',
  score_reasons jsonb,
  script_steps jsonb,
  audio_path text,
  muted_ranges jsonb not null default '[]'::jsonb,
  muted_seconds numeric,
  pii_hits integer not null default 0,
  redaction_version integer not null,
  redacted_at timestamptz not null default now()
);
alter table public.call_training_team_copy enable row level security;
-- No policies on purpose: only the SECURITY DEFINER functions below read it.
revoke all on public.call_training_team_copy from anon, authenticated;

-- 2. The leak test the library runs on every read -----------------------------------------------------------
-- True when text still carries the client's name, a phone / SSN / account shaped number, or an email.
-- The first name is matched as written (capitalised) so "bill" the noun does not trip on a client named Bill.
create or replace function public.fn_training_text_leaks(p_text text, p_first text, p_last text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_text, '') <> '' and (
    (length(btrim(coalesce(p_last, ''))) >= 3
      and p_text ~* ('\m' || regexp_replace(btrim(p_last), '([^[:alnum:] ])', '\\\1', 'g') || '\M'))
    or (length(btrim(coalesce(p_first, ''))) >= 3
      and p_text ~ ('\m' || regexp_replace(initcap(btrim(p_first)), '([^[:alnum:] ])', '\\\1', 'g') || '\M'))
    or p_text ~ '\d{7,}'
    or p_text ~ '\d{3}[-. ]\d{2}[-. ]\d{4}'
    or p_text ~ '\d{3}[-. )]+\d{3}[-. ]\d{4}'
    or p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
  )
$$;

create or replace function public.fn_team_copy_text(tc public.call_training_team_copy)
returns text language sql immutable set search_path = public as $$
  select coalesce(tc.summary, '') || ' ' || tc.objection_moments::text || ' ' || tc.key_quotes::text || ' '
      || array_to_string(tc.strengths, ' ') || ' ' || array_to_string(tc.tactics, ' ') || ' '
      || coalesce(tc.score_reasons::text, '') || ' ' || coalesce(tc.script_steps::text, '')
$$;
revoke all on function public.fn_team_copy_text(public.call_training_team_copy) from public, anon, authenticated;

-- 3. What kind of objection is this? One vocabulary for the objection library. ----------------------------------
create or replace function public.fn_objection_category(p_text text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_text ~* '(social|ssn)' then 'ssn'
    when p_text ~* '(bank|routing|account|debit|card number|payment info)' then 'bank'
    when p_text ~* '(scam|legit|who are you|trust|how did you get|is this real|fraud)' then 'trust'
    when p_text ~* '(wife|husband|spouse|daughter|my son|my kids|family first|talk (it over|to my))' then 'spouse'
    when p_text ~* '(already (have|got)|have (coverage|insurance|a policy)|covered through|got a policy)' then 'covered'
    when p_text ~* '(afford|expensive|price|cost|too much|budget|cheaper|fixed income|money)' then 'price'
    when p_text ~* '(think about|call (me )?back|later|busy|not a good time|send (me )?(something|info|it in)|in the mail|another time)' then 'think'
    when p_text ~* '(not interested|don''?t need|no thank|take me off|stop calling)' then 'not_interested'
    else 'other'
  end
$$;

-- 4. The library an agent reads: team copies only, fail closed, best teaching calls first ----------------------
create or replace function public.call_training_library()
returns table (call_id uuid, call_started_at timestamptz, agent_name text, disposition text, duration_seconds integer,
  overall_score integer, stage_reached text, great_call boolean, training_tags text[], tactics text[], strengths text[],
  objection_moments jsonb, key_quotes jsonb, summary text, scores jsonb, script_score integer, script_followed text,
  script_steps jsonb, score_reasons jsonb)
language sql stable security definer set search_path = public as $$
  select g.call_id, date_trunc('day', c.call_started_at), coalesce(ag.display_name, c.agent_raw), c.disposition, a.duration_seconds,
         g.overall_score, g.stage_reached, g.great_call, g.training_tags, tc.tactics, tc.strengths, tc.objection_moments,
         tc.key_quotes, tc.summary, g.scores, g.script_score, g.script_followed, tc.script_steps, tc.score_reasons
  from public.readymode_call_audio a
  join public.call_training_team_copy tc on tc.call_id = a.call_id
  join public.readymode_call_analysis g on g.call_id = a.call_id and g.model = 'grade-v1'
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  where a.team_visible
    and tc.audio_path is not null
    and (public.can_view_sold_calls() or public.is_active_agent_login())
    and not public.fn_training_text_leaks(public.fn_team_copy_text(tc), c.lead_first_name, c.lead_last_name)
  -- Teaching rank, not raw grade: a turned objection and a call short enough to finish outrank a long 90.
  order by (coalesce(g.overall_score, 0)
            + case when g.great_call then 10 else 0 end
            + 6 * least(3, (select count(*) from jsonb_array_elements(tc.objection_moments) m where (m ->> 'worked') = 'true'))
            + coalesce(g.script_score, 0)
            - greatest(0, coalesce(a.duration_seconds, 0) / 60.0 - 30) * 0.5) desc
  limit 300
$$;

-- 5. The objection library: every objection an agent turned, grouped, each one playable ---------------------
create or replace function public.call_training_objections()
returns table (call_id uuid, agent_name text, call_day date, overall_score integer, great_call boolean,
  category text, t text, objection text, response text, technique text)
language sql stable security definer set search_path = public as $$
  select g.call_id, coalesce(ag.display_name, c.agent_raw), c.call_started_at::date, g.overall_score, g.great_call,
         public.fn_objection_category(coalesce(m ->> 'objection', '') || ' ' || coalesce(m ->> 'technique', '')),
         m ->> 't', m ->> 'objection', m ->> 'response', m ->> 'technique'
  from public.readymode_call_audio a
  join public.call_training_team_copy tc on tc.call_id = a.call_id
  join public.readymode_call_analysis g on g.call_id = a.call_id and g.model = 'grade-v1'
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  cross join lateral jsonb_array_elements(tc.objection_moments) m
  where a.team_visible
    and tc.audio_path is not null
    and (m ->> 'worked') = 'true'
    and coalesce(m ->> 'objection', '') <> '' and coalesce(m ->> 'response', '') <> ''
    and (public.can_view_sold_calls() or public.is_active_agent_login())
    and not public.fn_training_text_leaks(public.fn_team_copy_text(tc), c.lead_first_name, c.lead_last_name)
  order by g.overall_score desc nulls last, g.call_id, m ->> 't'
  limit 600
$$;

-- 6. Audio: another agent's call plays from the team copy only ------------------------------------------------
-- Sam and the grant holders keep the full recording; an agent keeps the numbers-muted copy of their OWN calls
-- and an upline of their downline's (those are their own clients). Everyone else gets the team copy or nothing.
create or replace function public.call_audio_for(p_call_ids uuid[])
returns table (call_id uuid, path text, variant text, duration_seconds integer, muted_ranges jsonb)
language sql stable security definer set search_path = public as $$
  with me as (select public.can_view_sold_calls() as lead, public.is_active_agent_login() as active)
  select a.call_id,
    case when me.lead then coalesce(a.raw_path, a.redacted_path) when own.yes then a.redacted_path else tc.audio_path end,
    case when me.lead and a.raw_path is not null then 'full' when me.lead or own.yes then 'numbers_muted' else 'client_data_removed' end,
    a.duration_seconds,
    case when me.lead and a.raw_path is not null then '[]'::jsonb when me.lead or own.yes then a.muted_ranges else tc.muted_ranges end
  from public.readymode_call_audio a
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.call_training_team_copy tc on tc.call_id = a.call_id
  cross join me
  cross join lateral (
    select (c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
         or c.agent_id in (select g.id from public.agents g where g.user_id = auth.uid())) as yes) own
  where a.call_id = any (p_call_ids)
    and (me.lead or own.yes or (me.active and a.team_visible and tc.audio_path is not null))
$$;

create or replace function public.can_play_call_audio(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.can_view_sold_calls() then
      exists (select 1 from public.readymode_call_audio a where a.raw_path = p_path or a.redacted_path = p_path)
      or exists (select 1 from public.call_training_team_copy tc where tc.audio_path = p_path)
    else
      exists (
        select 1 from public.readymode_call_audio a join public.readymode_dialer_calls c on c.id = a.call_id
        where a.redacted_path = p_path
          and (c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
               or c.agent_id in (select g.id from public.agents g where g.user_id = auth.uid())))
      or exists (
        select 1 from public.call_training_team_copy tc join public.readymode_call_audio a on a.call_id = tc.call_id
        where tc.audio_path = p_path and a.team_visible and public.is_active_agent_login())
  end
$$;

-- 7. Recorded training calls (the old apex-resources recordings), re-cut and held here ---------------------------
-- The source site serves those recordings and their word-for-word transcripts to anyone on the internet, with
-- Social Security numbers, bank details and birth dates spoken in them. The center stops reading that source:
-- it plays a re-cut copy from a private bucket and shows a scrubbed transcript from this table.
create table if not exists public.training_recordings (
  id text primary key,
  title text not null,
  presenter_id text,
  presenter_name text,
  topic text,
  description text,
  recorded_on text,
  duration_seconds integer,
  audio_path text,
  transcript jsonb not null default '[]'::jsonb,
  muted_seconds numeric,
  pii_hits integer not null default 0,
  redaction_version integer not null,
  published boolean not null default false,
  sort_key bigint not null default 0,
  redacted_at timestamptz not null default now()
);
alter table public.training_recordings enable row level security;
revoke all on public.training_recordings from anon, authenticated;

create or replace function public.training_recordings_list()
returns table (id text, title text, presenter_id text, presenter_name text, topic text, description text,
  recorded_on text, duration_seconds integer, audio_path text, transcript jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.presenter_id, r.presenter_name, r.topic, r.description, r.recorded_on, r.duration_seconds,
         r.audio_path, r.transcript
  from public.training_recordings r
  where r.published and r.audio_path is not null
    and (public.can_view_sold_calls() or public.is_active_agent_login())
    and not public.fn_training_text_leaks(r.transcript::text, null, null)
  order by r.sort_key desc, r.id
$$;

insert into storage.buckets (id, name, public) values ('training-recordings', 'training-recordings', false)
on conflict (id) do update set public = false;

drop policy if exists training_recordings_play on storage.objects;
create policy training_recordings_play on storage.objects for select to authenticated
  using (bucket_id = 'training-recordings'
    and (public.can_view_sold_calls() or public.is_active_agent_login())
    and exists (select 1 from public.training_recordings r where r.audio_path = name and r.published));

-- 8. The standing proof: anything an agent can read that still carries client data -----------------------------
-- Zero rows is the invariant. apex-doctor runs it; the library also applies the same test on every read.
create or replace function public.fn_training_privacy_audit()
returns table (source text, id text, problem text)
language sql stable security definer set search_path = public as $$
  select 'team_copy', tc.call_id::text, 'text still carries the client name, a long number or an email'
  from public.call_training_team_copy tc join public.readymode_dialer_calls c on c.id = tc.call_id
  where public.fn_training_text_leaks(public.fn_team_copy_text(tc), c.lead_first_name, c.lead_last_name)
  union all
  select 'team_copy', a.call_id::text, 'training call has no team copy audio (hidden from agents)'
  from public.readymode_call_audio a left join public.call_training_team_copy tc on tc.call_id = a.call_id
  where a.team_visible and (tc.call_id is null or tc.audio_path is null)
  union all
  select 'recording', r.id, 'transcript still carries a long number or an email'
  from public.training_recordings r
  where r.published and public.fn_training_text_leaks(r.transcript::text, null, null)
$$;

revoke all on function public.call_training_objections(), public.training_recordings_list(), public.fn_training_privacy_audit() from public, anon;
revoke all on function public.fn_training_privacy_audit() from authenticated;
grant execute on function public.call_training_library(), public.call_training_objections(), public.training_recordings_list(),
  public.call_audio_for(uuid[]), public.can_play_call_audio(text) to authenticated;
grant execute on function public.fn_training_privacy_audit() to service_role;
