-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 5/9: after the call (post-call message, no-show re-arm).
--
-- WHAT
--   1. v_next_step_current: when the person's LATEST booking (not cancelled, not a backfill
--      duplicate, not an 'other'/'onboarding' call) has outcome no_answer or no_show and they
--      derive to 'licensed_book_call' (licensed) or 'applied' (unlicensed, never contacted, no
--      video), stage_entered_at is that outcome's time (outcome_at, else the call time). Before
--      this, a no_answer sent the person back to book-call with their ORIGINAL entered_at, so
--      no rebook nudge could ever fire (peer e5 open item 2). Same columns, same order: the
--      view stays backward compatible (asserted in-place edit, like 20261111220000).
--   2. fn_next_step_nudge_sweep (asserted in-place edits of the live function):
--      * 'call_booked' (cadence hour:24 from the call time) sends ONE message the day after the
--        call, only for calls after fn_anchor_pkg1_cutoff() and only while that call has no
--        outcome; a hire stops it at the dispatcher gate (has_agent_row);
--      * a re-armed 'licensed_book_call' / 'applied' entry (latest call no_answer/no_show) sends
--        only its hour24 step, with metadata.variant = 'rearm' (copy: next_step_step_copy) and a
--        dedupe key per missed call (':rearm<epoch>'), at most 2 per person, only after the
--        PKG1 cutoff;
--      * the parent's channel label honours telegram_opt_out.
--   3. fn_next_step_recompute_all() settles entered_at on the new derivation. No sends: every
--      step it could expose is gated by fn_anchor_pkg1_cutoff() or the existing cutoffs.
-- WHY
--   message_map G1 (75 people in call_booked, 13 of 13 calls in 30 days without an outcome,
--   nothing told the recruit what happens next), DECISIONS.md "After the call".
-- ROLLBACK
--   The pre-edit definitions are saved in system_settings 'anchor_pkg1_sweep_backup' and
--   'anchor_pkg1_view_backup'; restore with
--     do $$ begin execute (select value from public.system_settings where key = 'anchor_pkg1_sweep_backup'); end $$;
--     do $$ begin execute 'create or replace view public.v_next_step_current as '
--       || (select value from public.system_settings where key = 'anchor_pkg1_view_backup'); end $$;
--     select * from public.fn_next_step_recompute_all();

-- 0. keep the pre-edit definitions (first apply only)
insert into public.system_settings (key, value, updated_at)
values ('anchor_pkg1_sweep_backup', pg_get_functiondef('public.fn_next_step_nudge_sweep()'::regprocedure), now())
on conflict (key) do nothing;
insert into public.system_settings (key, value, updated_at)
values ('anchor_pkg1_view_backup', pg_get_viewdef('public.v_next_step_current'::regclass, true), now())
on conflict (key) do nothing;

-- 1. the derivation: a missed call re-arms the booking ask with a fresh entered_at
do $mig$
declare
  v_def    text := pg_get_viewdef('public.v_next_step_current'::regclass, true);
  v_anchor text := 'WHEN a.seminar_attended_at IS NOT NULL THEN a.seminar_attended_at';
  v_latest text := $q$( SELECT %s FROM interview_events pkg1_rearm_ie WHERE pkg1_rearm_ie.application_id = a.id AND pkg1_rearm_ie.canceled_at IS NULL AND NOT COALESCE(pkg1_rearm_ie.is_backfill_duplicate, false) AND (COALESCE(pkg1_rearm_ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) ORDER BY pkg1_rearm_ie.scheduled_at DESC NULLS LAST, pkg1_rearm_ie.created_at DESC LIMIT 1)$q$;
  v_branch text;
  v_new    text;
begin
  if strpos(v_def, 'pkg1_rearm_ie') > 0 then
    raise notice 'PKG1: v_next_step_current already re-arms; skipping';
    return;
  end if;
  if strpos(v_def, v_anchor) = 0
     or strpos(substr(v_def, strpos(v_def, v_anchor) + length(v_anchor)), v_anchor) > 0 then
    raise exception 'PKG1: v_next_step_current anchor missing or not unique; refusing to rewrite';
  end if;
  -- WHEN <derives to licensed_book_call or applied> AND <latest call outcome is a miss>
  -- THEN <that call's outcome time>, inserted right after the live-booking branch
  v_branch := 'WHEN (a.license_status::text = ''licensed''::text OR (a.last_contacted_at IS NULL AND a.vsl_watched_at IS NULL)) AND '
    || format(v_latest, 'pkg1_rearm_ie.outcome') || ' = ANY (ARRAY[''no_answer''::text, ''no_show''::text]) THEN '
    || format(v_latest, 'COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at)') || E'\n                    ';
  v_new := replace(v_def, v_anchor, v_branch || v_anchor);
  if v_new = v_def or strpos(v_new, 'pkg1_rearm_ie') = 0 then
    raise exception 'PKG1: v_next_step_current rewrite did not land';
  end if;
  execute 'create or replace view public.v_next_step_current as ' || v_new;
end
$mig$;

-- 2. the sweep: post-call message, re-arm, opt-out-aware channel label
do $mig$
declare
  v_def text := pg_get_functiondef('public.fn_next_step_nudge_sweep()'::regprocedure);
  v_new text;
  a_decl     text := '  v_channel text;';
  a_throttle text := '    -- day steps keep the 20h throttle.';
  a_dedupe   text := $q$v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key;$q$;
  a_meta     text := $q$'send_zones', coalesce(to_jsonb(r.zones), '"unknown: ET+PT"'::jsonb)))$q$;
  a_tg_app   text := 'where a.id = r.application_id and a.telegram_chat_id is not null)';
  a_tg_agent text := 'where g.id = r.agent_id and g.telegram_chat_id is not null)';
  a          text;
begin
  if strpos(v_def, 'fn_anchor_pkg1_cutoff') > 0 then
    raise notice 'PKG1: nudge sweep already edited; skipping';
    return;
  end if;
  foreach a in array array[a_decl, a_throttle, a_dedupe, a_meta, a_tg_app, a_tg_agent] loop
    if strpos(v_def, a) = 0 or strpos(substr(v_def, strpos(v_def, a) + length(a)), a) > 0 then
      raise exception 'PKG1: nudge sweep anchor missing or not unique: %', a;
    end if;
  end loop;
  if strpos(v_def, 'fn_lane_ladder_cutoff') = 0 or strpos(v_def, 'fn_wp3_cutoff') = 0 then
    raise exception 'PKG1: nudge sweep lost its forward-only gates; refusing to edit';
  end if;

  v_new := replace(v_def, a_decl, a_decl || $q$
  v_pkg1 timestamptz := public.fn_anchor_pkg1_cutoff();
  v_arm text := '';
  v_variant text;$q$);

  v_new := replace(v_new, a_throttle, $q$    -- MP-ONBOARD-ANCHOR-PKG1 (20261112000140): after the call.
    -- call_booked: ONE message the day after the call (cadence hour:24 from the call time),
    -- only for calls after the package cutoff and only while that call has no outcome.
    continue when r.current_stage_key = 'call_booked' and (
         r.entered_at < v_pkg1
      or r.application_id is null
      or exists (select 1 from public.interview_events ie
                  where ie.application_id = r.application_id and ie.canceled_at is null
                    and not coalesce(ie.is_backfill_duplicate, false)
                    and ie.scheduled_at = r.entered_at and ie.outcome is not null));
    -- A no_answer / no_show outcome re-arms the booking ask (v_next_step_current sets
    -- entered_at to the outcome time): one rebook nudge (hour24) per missed call, at most 2.
    v_arm := '';
    v_variant := null;
    if r.application_id is not null and r.current_stage_key in ('licensed_book_call', 'applied')
       and exists (select 1 from public.interview_events ie
                    where ie.application_id = r.application_id and ie.canceled_at is null
                      and not coalesce(ie.is_backfill_duplicate, false)
                      and coalesce(ie.call_track, '') not in ('other', 'onboarding')
                      and ie.outcome in ('no_answer', 'no_show')
                      and coalesce(ie.outcome_at, ie.scheduled_at) = r.entered_at) then
      continue when r.entered_at < v_pkg1 or v_key <> 'hour24';
      continue when (select count(*) from public.next_step_messages m2
                      where m2.application_id = r.application_id and m2.fallback_of_id is null
                        and m2.metadata->>'variant' = 'rearm') >= 2;
      v_arm := ':rearm' || floor(extract(epoch from r.entered_at))::bigint::text;
      v_variant := 'rearm';
    end if;
$q$ || a_throttle);

  v_new := replace(v_new, a_dedupe,
    $q$v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key || v_arm;$q$);

  v_new := replace(v_new, a_meta,
    $q$'send_zones', coalesce(to_jsonb(r.zones), '"unknown: ET+PT"'::jsonb)) || case when v_variant is null then '{}'::jsonb else jsonb_build_object('variant', v_variant) end)$q$);

  v_new := replace(v_new, a_tg_app,
    'where a.id = r.application_id and a.telegram_chat_id is not null and not coalesce(a.telegram_opt_out, false))');
  v_new := replace(v_new, a_tg_agent,
    'where g.id = r.agent_id and g.telegram_chat_id is not null and not coalesce(g.telegram_opt_out, false))');

  if v_new = v_def or strpos(v_new, 'fn_anchor_pkg1_cutoff') = 0 or strpos(v_new, 'v_arm;') = 0
     or strpos(v_new, '''variant''') = 0 or strpos(v_new, 'telegram_opt_out') = 0 then
    raise exception 'PKG1: nudge sweep edit did not land';
  end if;
  execute v_new;
end
$mig$;

-- 3. settle entered_at on the new derivation (no sends: every newly exposed step is gated).
--    In DO so the migration returns no result set.
do $mig$
begin
  perform public.fn_next_step_recompute_all();
end
$mig$;
