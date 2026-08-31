-- MP-354 part 2: recover_partial_applications() had independently encoded the
-- correct abandonment rule inline. That second derivation is the only reason
-- the 11 recovery SMS this system has ever sent all went to genuinely
-- abandoned people while the panel beside it was 75.8% wrong. Two derivations
-- of one question drift; this one now reads the same view the panel does.
-- Proven equivalent over the whole 62-row table before repointing: 11 vs 11,
-- zero rows on either side of the difference.
create or replace function public.recover_partial_applications()
 returns table(queued integer, partial_id uuid, email text, step text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with todo as (
    select pa.id, pa.email AS pa_email, pa.step AS pa_step
    from v_partial_applications_abandoned pa
    where pa.created_at < now() - interval '30 minutes'
      and pa.recovery_sms_sent_at is null
      and pa.recovered_at is null
      and pa.email is not null
  ),
  marked as (
    update partial_applications
    set recovery_sms_sent_at = now()
    where id in (select id from todo)
    returning id, partial_applications.email AS pa_email, partial_applications.step AS pa_step
  )
  select (select count(*)::int from todo), m.id, m.pa_email, m.pa_step from marked m;
end;
$function$;
