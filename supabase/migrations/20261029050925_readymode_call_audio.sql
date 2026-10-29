-- MP-310 (2026-10-28). Sam: "use a downloaded call over just a link to ReadyMode ... they can't hear it". A ReadyMode
-- recording link opens only for whoever holds the ReadyMode login (one session per login), so the team could not play a
-- single call. Recordings the bot already downloaded are published to a private bucket by
-- readymode-bot/scripts/publish-call-audio.py: redacted/<id>.mp3 (spoken digits muted) for the team, raw/<id>.mp3 for
-- sold calls only, for Sam and Aisha to confirm numbers by ear. Agents hear only training calls (team_visible).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('readymode-audio', 'readymode-audio', false, 52428800, array['audio/mpeg'])
on conflict (id) do nothing;

create table if not exists public.readymode_call_audio (
  call_id uuid primary key references public.readymode_dialer_calls(id) on delete cascade,
  external_call_id text not null,
  raw_path text,
  redacted_path text not null,
  duration_seconds int,
  muted_ranges jsonb not null default '[]'::jsonb,
  muted_seconds numeric not null default 0,
  team_visible boolean not null default false,
  published_at timestamptz not null default now()
);
alter table public.readymode_call_audio enable row level security;
revoke all on public.readymode_call_audio from anon;
revoke insert, update, delete, truncate on public.readymode_call_audio from authenticated;
grant select on public.readymode_call_audio to authenticated;
drop policy if exists readymode_call_audio_read on public.readymode_call_audio;
create policy readymode_call_audio_read on public.readymode_call_audio for select to authenticated using ((select public.can_view_sold_calls()));

create or replace function public.is_active_agent_login() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.agents a where a.user_id = auth.uid() and a.is_deactivated is not true and a.is_inactive is not true)
$$;

-- Sam and Aisha: any published file. An active agent: only the muted copy of a training call.
create or replace function public.can_play_call_audio(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.can_view_sold_calls() then exists (select 1 from public.readymode_call_audio a where a.raw_path = p_path or a.redacted_path = p_path)
    else public.is_active_agent_login() and exists (select 1 from public.readymode_call_audio a where a.redacted_path = p_path and a.team_visible)
  end
$$;

drop policy if exists readymode_audio_play on storage.objects;
create policy readymode_audio_play on storage.objects for select to authenticated
  using (bucket_id = 'readymode-audio' and public.can_play_call_audio(name));

-- The file a viewer should play for each call: unmuted sold-call audio for Sam and Aisha, the muted copy otherwise.
create or replace function public.call_audio_for(p_call_ids uuid[])
returns table (call_id uuid, path text, variant text, duration_seconds int, muted_ranges jsonb)
language sql stable security definer set search_path = public as $$
  select a.call_id,
    case when public.can_view_sold_calls() and a.raw_path is not null then a.raw_path else a.redacted_path end,
    case when public.can_view_sold_calls() and a.raw_path is not null then 'full' else 'numbers_muted' end,
    a.duration_seconds,
    case when public.can_view_sold_calls() and a.raw_path is not null then '[]'::jsonb else a.muted_ranges end
  from public.readymode_call_audio a
  where a.call_id = any (p_call_ids)
    and (public.can_view_sold_calls() or (public.is_active_agent_login() and a.team_visible))
$$;

-- A training call: graded great, or 70+, or an objection the agent turned, with no compliance flag.
create or replace function public.refresh_call_audio_team_visible() returns int
language sql security definer set search_path = public as $$
  with upd as (
    update public.readymode_call_audio a set team_visible = coalesce((
      select (g.great_call or coalesce(g.overall_score, 0) >= 70
              or (jsonb_typeof(g.objection_moments) = 'array' and exists (select 1 from jsonb_array_elements(g.objection_moments) m where (m ->> 'worked') = 'true')))
         and (case when jsonb_typeof(g.compliance_flags) = 'array' then jsonb_array_length(g.compliance_flags) else 0 end) = 0
      from public.readymode_call_analysis g
      where g.call_id = a.call_id and g.model = 'grade-v1' and g.stage_reached not in ('voicemail', 'no_contact')), false)
    returning 1)
  select count(*)::int from upd
$$;

-- The team's training library: graded training calls with audio, no client contact data, no coaching notes.
create or replace function public.call_training_library()
returns table (call_id uuid, call_started_at timestamptz, agent_name text, disposition text, duration_seconds int, overall_score int,
               stage_reached text, great_call boolean, training_tags text[], tactics text[], strengths text[],
               objection_moments jsonb, key_quotes jsonb, summary text)
language sql stable security definer set search_path = public as $$
  select g.call_id, c.call_started_at, coalesce(ag.display_name, c.agent_raw), c.disposition, a.duration_seconds, g.overall_score,
         g.stage_reached, g.great_call, g.training_tags, g.tactics, g.strengths, g.objection_moments, g.key_quotes, g.summary
  from public.readymode_call_audio a
  join public.readymode_call_analysis g on g.call_id = a.call_id and g.model = 'grade-v1'
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  where a.team_visible and (public.can_view_sold_calls() or public.is_active_agent_login())
  order by g.great_call desc, g.overall_score desc nulls last
  limit 300
$$;

revoke execute on function public.is_active_agent_login() from public, anon;
revoke execute on function public.can_play_call_audio(text) from public, anon;
revoke execute on function public.call_audio_for(uuid[]) from public, anon;
revoke execute on function public.refresh_call_audio_team_visible() from public, anon, authenticated;
revoke execute on function public.call_training_library() from public, anon;
grant execute on function public.is_active_agent_login(), public.can_play_call_audio(text), public.call_audio_for(uuid[]), public.call_training_library() to authenticated;
