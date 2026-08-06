-- BUG-1 fix (2026-08-06): interview_recordings had no place to store the actual
-- audio blob. Recorders used SpeechRecognition (transcript-only) and never
-- called MediaRecorder or wrote to the storage.call-recordings bucket, so
-- clicking the voice button never captured audio.
--
-- After this migration + client fix, MediaRecorder blobs land in
-- storage/call-recordings/interviews/<application_id>/<timestamp>-<uuid>.webm
-- and their signed-URL-ready storage path is recorded on the row.

alter table public.interview_recordings
  add column if not exists audio_url text,
  add column if not exists audio_bytes bigint,
  add column if not exists audio_mime text;

comment on column public.interview_recordings.audio_url is
  'Storage path under call-recordings bucket. Combine with supabase.storage.from(...).createSignedUrl(path, seconds) for playback.';
comment on column public.interview_recordings.audio_bytes is
  'Raw blob byte length as reported by MediaRecorder at upload time.';
comment on column public.interview_recordings.audio_mime is
  'Container/codec the browser picked (audio/webm;codecs=opus on Chrome, audio/mp4 on iOS Safari).';

-- BUG-1: extend the existing storage.objects INSERT policy so authenticated
-- clients can write to the two new prefixes the recorders use.
-- Old policy only allowed orphan/ and inbound_leads/, which is why uploads
-- from the fixed recorders would otherwise silently 403.
drop policy if exists call_recordings_authenticated_insert on storage.objects;
create policy call_recordings_authenticated_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'call-recordings'
    and (
      (storage.foldername(name))[1] = 'orphan'
      or (storage.foldername(name))[1] = 'inbound_leads'
      or (storage.foldername(name))[1] = 'interviews'
      or (storage.foldername(name))[1] = 'callcenter'
    )
  );
