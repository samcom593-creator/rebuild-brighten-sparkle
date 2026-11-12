-- MP-PERF-BOT follow-up (2026-11-13): the daily digest also goes by email.
-- Edge functions cannot reliably reach ntfy (the free quota binds to the shared sending IP; the laptop
-- relay republishes from Sam's IP and never stamps sent_at). An ntfy-only alert therefore stays "unsent",
-- is retried against ntfy every 5 minutes for 24 hours, and then expires as undelivered. Email is the
-- channel that lands (24 of 24 recent criticals), so it carries sent_at; ntfy stays in the list so the relay
-- still pushes it to the phone. apex-alert-dispatch gives this event a neutral PERFORMANCE BOT label.
create or replace function public.fn_perf_bot_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_floor'), '')::numeric, 20000);
  v_target numeric := coalesce(nullif((select value from system_settings where key = 'perf_goal_target'), '')::numeric, 25000);
  v_today date := (now() at time zone 'America/Phoenix')::date;
  c jsonb; g jsonb; ret jsonb; a jsonb; v_stale boolean; v_unknown numeric; v_total int; v_lines text := ''; v_n int := 0;
  v_summary jsonb;
begin
  begin
    -- Return first, then measure, so today's returns are in the numbers the digest quotes.
    ret := public.fn_perf_return_deals_to_leads(false);
    c := public.perf_bot_core(v_floor, v_target);
    g := c->'goal';

    select coalesce(bool_or((x->>'verdict') in ('DARK','DYING') and (x->>'origin') = 'apex_native'), false)
      into v_stale from jsonb_array_elements(c->'freshness') x;

    delete from perf_bot_findings where run_date = v_today;

    if v_stale then
      insert into perf_bot_findings (run_date, kind, severity, headline)
      values (v_today, 'production_feed_stale', 'high', 'Native production has stopped posting. Goal numbers below may be understated until it resumes.');
    end if;

    insert into perf_bot_findings (run_date, kind, severity, headline, dollars, detail)
    values (v_today, 'goal_pace', case when (g->>'on_pace_floor')::int * 2 < (g->>'licensed_active')::int then 'high' else 'warn' end,
      'Agents on pace for ' || to_char(v_floor, 'FM$999,999,999') || ' this month: ' || (g->>'on_pace_floor') || ' of ' || (g->>'licensed_active')
        || ' licensed. Projected total ' || to_char((g->>'projected_total')::numeric, 'FM$999,999,999') || ' against ' || to_char((g->>'floor_potential')::numeric, 'FM$999,999,999')
        || ' if every licensed agent hit the floor.',
      (g->>'floor_potential')::numeric - (g->>'projected_total')::numeric, g);

    if (g->>'licensed_silent')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'licensed_silent', 'high',
        (g->>'licensed_silent') || ' licensed agents wrote nothing in 30 days. Activating them is the biggest lever: each is ' || to_char(v_floor, 'FM$999,999,999') || ' of room.',
        jsonb_build_object('agents', (select coalesce(jsonb_agg(x->>'name'), '[]'::jsonb) from (select x from jsonb_array_elements(c->'agents') x
                                       where x->>'segment' = 'licensed_silent' order by (x->>'tenure_days')::int desc limit 10) q)));
    end if;

    for a in
      select x from jsonb_array_elements(c->'agents') x
       where x->>'segment' = 'producing' and (x->>'projected')::numeric < v_floor and (x->>'projected')::numeric >= v_floor * 0.5
       order by (x->>'gap_to_floor')::numeric asc limit 5
    loop
      insert into perf_bot_findings (run_date, kind, severity, agent_id, headline, dollars, detail)
      values (v_today, 'closest_to_floor', 'warn', (a->>'id')::uuid,
        (a->>'name') || ' is projected at ' || to_char((a->>'projected')::numeric, 'FM$999,999,999') || '. About ' || coalesce(a->>'deals_to_floor', '?')
          || ' more deals at their ' || coalesce(to_char((a->>'ticket')::numeric, 'FM$999,999,999'), '?') || ' average gets them to ' || to_char(v_floor, 'FM$999,999,999') || '.',
        (a->>'gap_to_floor')::numeric, a);
    end loop;

    if (c->'downline'->>'no_downline')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'downline_gap', 'warn',
        (c->'downline'->>'no_downline') || ' of ' || (c->'downline'->>'agents_90d_plus') || ' agents past 90 days have no one under them. '
          || (c->'downline'->'by_reason'->>'not_producing') || ' are not producing, ' || (c->'downline'->'by_reason'->>'no_applicants') || ' never referred an applicant, '
          || (c->'downline'->'by_reason'->>'applicants_not_hired') || ' referred applicants who were not hired.', c->'downline'->'by_reason');
    end if;

    select count(*), coalesce(round(100.0 * count(*) filter (where lead_type = 'unknown') / nullif(count(*), 0)), 0)
      into v_total, v_unknown from perf_deal_facts() where posted_date >= v_today - 30;
    if v_total > 0 and v_unknown >= 30 then
      insert into perf_bot_findings (run_date, kind, severity, headline, detail)
      values (v_today, 'lead_type_unknown', 'warn', v_unknown::bigint::text || '% of the last 30 days of deals have no lead type, so close rate by lead type is still partly blind.',
              jsonb_build_object('deals_30d', v_total, 'unknown_pct', v_unknown));
    end if;

    if (c->'policy'->>'native_flagged')::int > 0 or (ret->>'returned')::int > 0 then
      insert into perf_bot_findings (run_date, kind, severity, headline, dollars, detail)
      values (v_today, 'policy_numbers', 'warn',
        (c->'policy'->>'native_flagged') || ' agent-posted deals (' || to_char((c->'policy'->>'native_flagged_ap')::numeric, 'FM$999,999,999') || ') have no real policy number. '
          || (c->'policy'->>'returned') || ' are in the agent''s leads to confirm (' || (ret->>'returned') || ' new today). '
          || (c->'policy'->>'import_placeholder') || ' AgentLink imports have placeholder numbers and are flagged only.',
        (c->'policy'->>'native_flagged_ap')::numeric, ret);
    end if;

    -- One digest a day, the three biggest findings, to Sam's phone only.
    if coalesce((select value from system_settings where key = 'perf_bot_alerts'), 'true') = 'true'
       and not exists (select 1 from bot_alerts b where b.event_type = 'perf_bot_digest' and b.created_at::date = now()::date) then
      for a in select to_jsonb(f) from (select kind, headline from perf_bot_findings where run_date = v_today
                 order by case severity when 'high' then 0 when 'warn' then 1 else 2 end, dollars desc nulls last limit 3) f
      loop
        v_n := v_n + 1;
        v_lines := v_lines || '<p>' || v_n::text || '. ' || replace(replace(a->>'headline', '<', ' '), '>', ' ') || '</p>';
      end loop;
      if v_n > 0 then
        insert into bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
        values ('perf_bot', 'perf_bot_digest', 'celebrate', 'Performance bot - ' || v_today::text, v_lines, null,
                'https://apex-financial.org/dashboard/admin/performance-bot', array['ntfy','email']::text[]);
      end if;
    end if;

    v_summary := jsonb_build_object('on_pace', g->'on_pace_floor', 'licensed_silent', g->'licensed_silent', 'returned', ret, 'stale', v_stale,
                                    'findings', (select count(*) from perf_bot_findings where run_date = v_today));
    insert into perf_bot_runs (ok, summary) values (true, v_summary);
    return v_summary;
  exception when others then
    insert into perf_bot_runs (ok, error) values (false, left(sqlerrm, 500));
    raise;
  end;
end $$;
