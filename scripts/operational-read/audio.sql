-- Fixed aggregate-only diagnostic. No identifiers, paths, transcripts, or media leave the database.
with objects as materialized (
  select bucket_id, name,
    case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric > 0 else null end as nonempty,
    lower(split_part(coalesce(metadata->>'mimetype', ''), ';', 1)) like 'audio/%' as audio_mime
  from storage.objects where bucket_id in ('readymode-audio', 'training-recordings', 'call-recordings')
), published_audio as materialized (
  select a.call_id, a.team_visible,
    a.raw_path is not null as has_raw_path,
    exists(select 1 from objects o where o.bucket_id='readymode-audio' and o.name=a.raw_path) as raw_object,
    exists(select 1 from objects o where o.bucket_id='readymode-audio' and o.name=a.redacted_path) as redacted_object,
    exists(select 1 from objects o where o.bucket_id='readymode-audio' and o.name=a.redacted_path and o.nonempty) as redacted_nonempty
  from public.readymode_call_audio a
), team as materialized (
  select tc.call_id, tc.audio_path is not null as has_audio_path,
    exists(select 1 from objects o where o.bucket_id='readymode-audio' and o.name=tc.audio_path) as audio_object
  from public.call_training_team_copy tc join public.readymode_dialer_calls c on c.id=tc.call_id
), training as materialized (
  select r.published, r.audio_path is not null as has_audio_path,
    jsonb_typeof(r.transcript)='array' as transcript_array,
    exists(select 1 from objects o where o.bucket_id='training-recordings' and o.name=r.audio_path) as audio_object,
    exists(select 1 from objects o where o.bucket_id='training-recordings' and o.name=r.audio_path and o.nonempty) as audio_nonempty,
    exists(select 1 from objects o where o.bucket_id='training-recordings' and o.name=r.audio_path and o.audio_mime) as audio_mime
  from public.training_recordings r
), graded as materialized (
  select distinct call_id from public.readymode_call_analysis where model='grade-v1'
)
select jsonb_build_object(
  'privacy_filter_evaluated', false,
  'dialer_calls', (select count(*) from public.readymode_dialer_calls),
  'calls_with_provider_recording_reference', (select count(*) from public.readymode_dialer_calls where nullif(btrim(recording_url),'') is not null),
  'calls_linked_to_agent', (select count(*) from public.readymode_dialer_calls where agent_id is not null),
  'calls_linked_to_application', (select count(*) from public.readymode_dialer_calls where matched_application_id is not null),
  'calls_linked_to_lead', (select count(*) from public.readymode_dialer_calls where matched_lead_id is not null),
  'graded_calls', (select count(*) from graded),
  'graded_calls_without_audio_catalog', (select count(*) from graded g left join published_audio a on a.call_id=g.call_id where a.call_id is null),
  'graded_calls_with_redacted_object', (select count(*) from graded g join published_audio a on a.call_id=g.call_id where a.redacted_object),
  'audio_catalog_rows', (select count(*) from published_audio),
  'raw_paths', (select count(*) from published_audio where has_raw_path),
  'raw_objects', (select count(*) from published_audio where raw_object),
  'redacted_objects', (select count(*) from published_audio where redacted_object),
  'redacted_nonempty_objects', (select count(*) from published_audio where redacted_nonempty),
  'redacted_objects_missing', (select count(*) from published_audio where not redacted_object),
  'team_visible_audio_rows', (select count(*) from published_audio where team_visible),
  'team_copy_rows', (select count(*) from team),
  'team_copies_with_audio_object', (select count(*) from team where audio_object),
  'team_visible_without_team_audio', (select count(*) from published_audio a left join team t on t.call_id=a.call_id where a.team_visible and (t.call_id is null or not t.has_audio_path or not t.audio_object)),
  'library_candidates_before_privacy', (select count(*) from published_audio a join team t on t.call_id=a.call_id join graded g on g.call_id=a.call_id where a.team_visible and t.has_audio_path),
  'library_candidates_with_audio_object', (select count(*) from published_audio a join team t on t.call_id=a.call_id join graded g on g.call_id=a.call_id where a.team_visible and t.has_audio_path and t.audio_object),
  'training_rows', (select count(*) from training),
  'training_published', (select count(*) from training where published),
  'training_published_without_path', (select count(*) from training where published and not has_audio_path),
  'training_published_with_path', (select count(*) from training where published and has_audio_path),
  'training_published_with_object', (select count(*) from training where published and has_audio_path and audio_object),
  'training_published_missing_object', (select count(*) from training where published and has_audio_path and not audio_object),
  'training_published_nonempty_object', (select count(*) from training where published and has_audio_path and audio_nonempty),
  'training_published_audio_mime', (select count(*) from training where published and has_audio_path and audio_mime),
  'training_published_transcript_not_array', (select count(*) from training where published and has_audio_path and not transcript_array),
  'readymode_bucket_private', exists(select 1 from storage.buckets where id='readymode-audio' and not public),
  'training_bucket_private', exists(select 1 from storage.buckets where id='training-recordings' and not public),
  'call_recordings_bucket_private', exists(select 1 from storage.buckets where id='call-recordings' and not public),
  'readymode_bucket_objects', (select count(*) from objects where bucket_id='readymode-audio'),
  'training_bucket_objects', (select count(*) from objects where bucket_id='training-recordings'),
  'call_recordings_bucket_objects', (select count(*) from objects where bucket_id='call-recordings'),
  'authenticated_call_audio_rpc', coalesce(has_function_privilege('authenticated',to_regprocedure('public.call_audio_for(uuid[])'),'EXECUTE'),false),
  'anonymous_call_audio_rpc', coalesce(has_function_privilege('anon',to_regprocedure('public.call_audio_for(uuid[])'),'EXECUTE'),false),
  'authenticated_training_catalog_rpc', coalesce(has_function_privilege('authenticated',to_regprocedure('public.training_recordings_list()'),'EXECUTE'),false),
  'anonymous_training_catalog_rpc', coalesce(has_function_privilege('anon',to_regprocedure('public.training_recordings_list()'),'EXECUTE'),false)
) as audio
