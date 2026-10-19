-- PL-WIB-LIVENESS-PAUSED: "APEX automation went silent" paged Sam every hour
-- about two automations the scheduler had been told not to run.
--
-- fn_automation_liveness_check (pg_cron job 71, hourly at :23) was
-- hand-applied and never round-tripped into the repo; this file is its first
-- versioned copy. Until today it posted to ntfy on every fire whenever any
-- enabled row in automation_expectations had no run inside its window.
--
-- What it was paging about (measured 2026-10-18):
--   apex-gap-closer   last run 2026-07-29  cron 'mp277-gap-closer-hourly' active=false
--   apex-miss-digest  last run 2026-07-28  cron 'mp278-miss-digest-daily' active=false
-- pg_cron never sets active=false on its own, so both were switched off on
-- purpose. Nothing records who did it or why; the gap closer had sent 386
-- applicant emails in its first two days. "Silent" was the configured state,
-- so the page could only clear by re-arming an outbound sender, which needs
-- Sam's greenlight. Same costume as the permanent Stripe CRITICAL: a true
-- alert nobody can act on costs what a false one costs. 12 of the last 40
-- pushes on Sam's phone topic were this one frozen pair.
--
-- Two changes:
--
-- 1. PAUSED is read off the scheduler, never off a second flag. A pg_cron job
--    belongs to an automation when its command calls a public function whose
--    body writes automation_runs with that automation's literal name. If at
--    least one such job exists and none is active, the automation is paused:
--    returned under 'paused', never paged. If no job can be found (the writer
--    runs off-box, like apex-xcel-ingest, or the job was dropped), it is
--    graded exactly as before. Pause is only claimed when the scheduler says
--    so, so a deleted job still pages.
--
-- 2. One page per episode, then at most one a day. Episode = the automation's
--    last-run instant (or created_at if it never ran). State lives in
--    system_settings 'automation_liveness_paged' as {name: {since, paged_at}}.
--    A page goes out when an episode is new or the last page for it is older
--    than 24h. pg_net cannot tell us inside this transaction whether ntfy
--    accepted the post, so the daily re-send is what bounds a lost page to
--    24h. Unreadable state counts as "page now".
--
-- Also removed the `exception when others then return stale=-1` wrapper: the
-- return value is read by nothing, so a broken guard looked like a quiet one.
-- An error now fails the cron run, where job_run_details records it.

create or replace function public.fn_automation_liveness_check()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_repage constant interval := interval '24 hours';
  v_state  jsonb;
  v_next   jsonb := '{}'::jsonb;
  v_rows   jsonb;
  v_due    jsonb := '[]'::jsonb;
  v_paused jsonb := '[]'::jsonb;
  v_open_n int := 0;
  v_prev   jsonb;
  v_page   boolean;
  r        record;
begin
  begin
    select nullif(s.value, '')::jsonb into v_state
      from public.system_settings s
     where s.key = 'automation_liveness_paged';
  exception when invalid_text_representation then
    v_state := null;  -- unreadable state: treat every open episode as unpaged
  end;
  if v_state is null or jsonb_typeof(v_state) <> 'object' then
    v_state := '{}'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'automation',   x.automation_name,
           'last_run',     x.last_run,
           'since',        x.since,
           'hours_silent', round(extract(epoch from (now() - x.since)) / 3600.0, 1),
           'limit_hours',  x.max_silence_hours,
           'paused',       (x.n_jobs > 0 and x.n_active = 0),
           'cron_jobs',    x.jobnames)
         order by x.automation_name), '[]'::jsonb)
    into v_rows
    from (
      select e.automation_name,
             e.max_silence_hours,
             rr.last_run,
             coalesce(rr.last_run, e.created_at) as since,
             j.n_jobs, j.n_active, j.jobnames
        from public.automation_expectations e
        left join lateral (
          select max(a.ran_at) as last_run
            from public.automation_runs a
           where a.automation_name = e.automation_name
        ) rr on true
        left join lateral (
          select count(*)::int as n_jobs,
                 (count(*) filter (where cj.active))::int as n_active,
                 coalesce(jsonb_agg(cj.jobname order by cj.jobname), '[]'::jsonb) as jobnames
            from cron.job cj
           where exists (
             select 1
               from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and strpos(p.prosrc, 'automation_runs') > 0
                and strpos(p.prosrc, quote_literal(e.automation_name)) > 0
                and cj.command ~* ('\m' || p.proname || '\s*\(')
           )
        ) j on true
       where e.enabled
         and coalesce(rr.last_run, e.created_at)
             < now() - make_interval(mins => (e.max_silence_hours * 60)::int)
    ) x;

  for r in select value from jsonb_array_elements(v_rows) loop
    if (r.value ->> 'paused')::boolean then
      v_paused := v_paused || jsonb_build_array(r.value - 'paused' - 'since');
      continue;
    end if;

    v_open_n := v_open_n + 1;
    v_prev := v_state -> (r.value ->> 'automation');
    v_page := case
      when v_prev is null or jsonb_typeof(v_prev) <> 'object' then true
      when (v_prev ->> 'since') is distinct from (r.value ->> 'since') then true
      when coalesce(v_prev ->> 'paged_at', '') !~ '^\d{4}-\d{2}-\d{2}' then true
      else (v_prev ->> 'paged_at')::timestamptz < now() - v_repage
    end;

    if v_page then
      v_due := v_due || jsonb_build_array(r.value - 'paused' - 'since' - 'cron_jobs');
      v_next := v_next || jsonb_build_object(r.value ->> 'automation',
                  jsonb_build_object('since', r.value -> 'since', 'paged_at', now()));
    else
      v_next := v_next || jsonb_build_object(r.value ->> 'automation', v_prev);
    end if;
  end loop;

  -- Closed episodes drop out of v_next, so a recovery followed by a new
  -- silence pages again straight away.
  if v_next is distinct from v_state then
    insert into public.system_settings (key, value)
    values ('automation_liveness_paged', v_next::text)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;

  if jsonb_array_length(v_due) > 0 then
    perform net.http_post(
      url     := 'https://ntfy.sh',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
                   'topic',    'sams-agent-yrkv9kbqp9e987nb',
                   'title',    'APEX automation went silent',
                   'priority', 4,
                   'tags',     jsonb_build_array('warning'),
                   'message',  jsonb_array_length(v_due)
                               || ' automation(s) have stopped logging runs: ' || v_due::text
                               || case when v_open_n > jsonb_array_length(v_due)
                                       then ' (+' || (v_open_n - jsonb_array_length(v_due))
                                            || ' still silent, paged in the last 24h)'
                                       else '' end
                               || '. Re-sent once a day while still silent.')
    );
  end if;

  return jsonb_build_object(
    'stale',  v_open_n,
    'paged',  jsonb_array_length(v_due),
    'detail', v_due,
    'paused', v_paused);
end;
$function$;

revoke execute on function public.fn_automation_liveness_check() from public, anon, authenticated;
grant execute on function public.fn_automation_liveness_check() to service_role;
