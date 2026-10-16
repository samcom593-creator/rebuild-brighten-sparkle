-- PL-WIB-NUDGE-QUIET-HOURS: the next-step nudge sweep sends only between 08:00 and 21:00
-- in the recipient's own time zone.
--
-- 20261016193000 made the sweep read cadences as written, so hour steps 1/6/12 fire for
-- the first time. Nothing gated the clock: trg_next_step_messages_auto_dispatch sends on
-- insert and next-step-dispatch has no time check, so the send instant is entered_at + H
-- rounded to the :07 tick. A 12h step lands on the other half of the clock from the moment
-- the person acted. Measured 2026-10-16 over 30 days of real stage entries, in each
-- applicant's own state's zone: applied:hour12 lands 21:00-08:00 for 28 of 42 applicants
-- (hour1 14/42, hour24 12/42, i.e. the people who applied at night). The primary channel is
-- Telegram and 134 of 250 primaries in 30d fell back to SMS, so most of those are texts.
--
-- Zone: applications.time_zone when it names a real zone (0 of 68 filled today), else the
-- state on the application, or on the agent's profile(s). A state that spans zones maps to
-- all of them and a send must be inside 08-21 in every one; two profiles with different
-- states do the same, so ambiguity is stricter, never read as absence. Unknown maps to
-- America/New_York + America/Los_Angeles (11:00-21:00 ET).
--
-- Holding a send must not lose the step. Day steps already have a 24h window, so a held
-- tick fires at the first allowed tick of the same day. Hour steps had [H, H+3): one whose
-- window sat entirely in the night would simply vanish. An hour step is now due while
-- fewer than 3 hours of ALLOWED time have passed since it started, and only while it is
-- the latest started step (a later step supersedes it, it never sends late as well). With
-- no quiet time in between that is exactly [H, H+3), the 20261016193000 parser is still
-- the one parser and stays untouched; this only adds the clock it was missing. 3h of
-- allowed time always accrues within 3h + the longest quiet stretch (14h, unknown zone),
-- so nothing older than 20h is ever evaluated or back-filled.
--
-- Trade, stated: a deferred step can land within 6h of the next one, and the sweep's 6h
-- hour-step throttle then holds the next one, which can expire. One nudge instead of two
-- back to back, never one at 02:00.

CREATE OR REPLACE FUNCTION public.fn_us_state_send_zones(p_state text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE upper(btrim(regexp_replace(coalesce(p_state, ''), '[^A-Za-z]+', ' ', 'g')))
    WHEN 'AL' THEN ARRAY['America/Chicago'] WHEN 'ALABAMA' THEN ARRAY['America/Chicago']
    WHEN 'AK' THEN ARRAY['America/Anchorage'] WHEN 'ALASKA' THEN ARRAY['America/Anchorage']
    WHEN 'AZ' THEN ARRAY['America/Phoenix'] WHEN 'ARIZONA' THEN ARRAY['America/Phoenix']
    WHEN 'AR' THEN ARRAY['America/Chicago'] WHEN 'ARKANSAS' THEN ARRAY['America/Chicago']
    WHEN 'CA' THEN ARRAY['America/Los_Angeles'] WHEN 'CALIFORNIA' THEN ARRAY['America/Los_Angeles']
    WHEN 'CO' THEN ARRAY['America/Denver'] WHEN 'COLORADO' THEN ARRAY['America/Denver']
    WHEN 'CT' THEN ARRAY['America/New_York'] WHEN 'CONNECTICUT' THEN ARRAY['America/New_York']
    WHEN 'DE' THEN ARRAY['America/New_York'] WHEN 'DELAWARE' THEN ARRAY['America/New_York']
    WHEN 'DC' THEN ARRAY['America/New_York'] WHEN 'DISTRICT OF COLUMBIA' THEN ARRAY['America/New_York']
    WHEN 'FL' THEN ARRAY['America/New_York','America/Chicago'] WHEN 'FLORIDA' THEN ARRAY['America/New_York','America/Chicago']
    WHEN 'GA' THEN ARRAY['America/New_York'] WHEN 'GEORGIA' THEN ARRAY['America/New_York']
    WHEN 'HI' THEN ARRAY['Pacific/Honolulu'] WHEN 'HAWAII' THEN ARRAY['Pacific/Honolulu']
    WHEN 'ID' THEN ARRAY['America/Boise','America/Los_Angeles'] WHEN 'IDAHO' THEN ARRAY['America/Boise','America/Los_Angeles']
    WHEN 'IL' THEN ARRAY['America/Chicago'] WHEN 'ILLINOIS' THEN ARRAY['America/Chicago']
    WHEN 'IN' THEN ARRAY['America/Indiana/Indianapolis','America/Chicago'] WHEN 'INDIANA' THEN ARRAY['America/Indiana/Indianapolis','America/Chicago']
    WHEN 'IA' THEN ARRAY['America/Chicago'] WHEN 'IOWA' THEN ARRAY['America/Chicago']
    WHEN 'KS' THEN ARRAY['America/Chicago','America/Denver'] WHEN 'KANSAS' THEN ARRAY['America/Chicago','America/Denver']
    WHEN 'KY' THEN ARRAY['America/New_York','America/Chicago'] WHEN 'KENTUCKY' THEN ARRAY['America/New_York','America/Chicago']
    WHEN 'LA' THEN ARRAY['America/Chicago'] WHEN 'LOUISIANA' THEN ARRAY['America/Chicago']
    WHEN 'ME' THEN ARRAY['America/New_York'] WHEN 'MAINE' THEN ARRAY['America/New_York']
    WHEN 'MD' THEN ARRAY['America/New_York'] WHEN 'MARYLAND' THEN ARRAY['America/New_York']
    WHEN 'MA' THEN ARRAY['America/New_York'] WHEN 'MASSACHUSETTS' THEN ARRAY['America/New_York']
    WHEN 'MI' THEN ARRAY['America/Detroit','America/Menominee'] WHEN 'MICHIGAN' THEN ARRAY['America/Detroit','America/Menominee']
    WHEN 'MN' THEN ARRAY['America/Chicago'] WHEN 'MINNESOTA' THEN ARRAY['America/Chicago']
    WHEN 'MS' THEN ARRAY['America/Chicago'] WHEN 'MISSISSIPPI' THEN ARRAY['America/Chicago']
    WHEN 'MO' THEN ARRAY['America/Chicago'] WHEN 'MISSOURI' THEN ARRAY['America/Chicago']
    WHEN 'MT' THEN ARRAY['America/Denver'] WHEN 'MONTANA' THEN ARRAY['America/Denver']
    WHEN 'NE' THEN ARRAY['America/Chicago','America/Denver'] WHEN 'NEBRASKA' THEN ARRAY['America/Chicago','America/Denver']
    WHEN 'NV' THEN ARRAY['America/Los_Angeles'] WHEN 'NEVADA' THEN ARRAY['America/Los_Angeles']
    WHEN 'NH' THEN ARRAY['America/New_York'] WHEN 'NEW HAMPSHIRE' THEN ARRAY['America/New_York']
    WHEN 'NJ' THEN ARRAY['America/New_York'] WHEN 'NEW JERSEY' THEN ARRAY['America/New_York']
    WHEN 'NM' THEN ARRAY['America/Denver'] WHEN 'NEW MEXICO' THEN ARRAY['America/Denver']
    WHEN 'NY' THEN ARRAY['America/New_York'] WHEN 'NEW YORK' THEN ARRAY['America/New_York']
    WHEN 'NC' THEN ARRAY['America/New_York'] WHEN 'NORTH CAROLINA' THEN ARRAY['America/New_York']
    WHEN 'ND' THEN ARRAY['America/Chicago','America/Denver'] WHEN 'NORTH DAKOTA' THEN ARRAY['America/Chicago','America/Denver']
    WHEN 'OH' THEN ARRAY['America/New_York'] WHEN 'OHIO' THEN ARRAY['America/New_York']
    WHEN 'OK' THEN ARRAY['America/Chicago'] WHEN 'OKLAHOMA' THEN ARRAY['America/Chicago']
    WHEN 'OR' THEN ARRAY['America/Los_Angeles','America/Boise'] WHEN 'OREGON' THEN ARRAY['America/Los_Angeles','America/Boise']
    WHEN 'PA' THEN ARRAY['America/New_York'] WHEN 'PENNSYLVANIA' THEN ARRAY['America/New_York']
    WHEN 'PR' THEN ARRAY['America/Puerto_Rico'] WHEN 'PUERTO RICO' THEN ARRAY['America/Puerto_Rico']
    WHEN 'RI' THEN ARRAY['America/New_York'] WHEN 'RHODE ISLAND' THEN ARRAY['America/New_York']
    WHEN 'SC' THEN ARRAY['America/New_York'] WHEN 'SOUTH CAROLINA' THEN ARRAY['America/New_York']
    WHEN 'SD' THEN ARRAY['America/Chicago','America/Denver'] WHEN 'SOUTH DAKOTA' THEN ARRAY['America/Chicago','America/Denver']
    WHEN 'TN' THEN ARRAY['America/Chicago','America/New_York'] WHEN 'TENNESSEE' THEN ARRAY['America/Chicago','America/New_York']
    WHEN 'TX' THEN ARRAY['America/Chicago','America/Denver'] WHEN 'TEXAS' THEN ARRAY['America/Chicago','America/Denver']
    WHEN 'UT' THEN ARRAY['America/Denver'] WHEN 'UTAH' THEN ARRAY['America/Denver']
    WHEN 'VT' THEN ARRAY['America/New_York'] WHEN 'VERMONT' THEN ARRAY['America/New_York']
    WHEN 'VA' THEN ARRAY['America/New_York'] WHEN 'VIRGINIA' THEN ARRAY['America/New_York']
    WHEN 'WA' THEN ARRAY['America/Los_Angeles'] WHEN 'WASHINGTON' THEN ARRAY['America/Los_Angeles']
    WHEN 'WV' THEN ARRAY['America/New_York'] WHEN 'WEST VIRGINIA' THEN ARRAY['America/New_York']
    WHEN 'WI' THEN ARRAY['America/Chicago'] WHEN 'WISCONSIN' THEN ARRAY['America/Chicago']
    WHEN 'WY' THEN ARRAY['America/Denver'] WHEN 'WYOMING' THEN ARRAY['America/Denver']
    ELSE NULL END
$function$;

-- NULL means unknown; fn_next_step_send_ok() treats it as ET + PT.
CREATE OR REPLACE FUNCTION public.fn_next_step_send_zones(p_application_id uuid, p_agent_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_zones text[];
BEGIN
  IF p_application_id IS NOT NULL THEN
    SELECT nullif(btrim(a.time_zone), ''), public.fn_us_state_send_zones(a.state)
      INTO v_tz, v_zones FROM public.applications a WHERE a.id = p_application_id;
    IF v_tz IS NOT NULL THEN
      BEGIN
        PERFORM now() AT TIME ZONE v_tz;
        RETURN ARRAY[v_tz];
      EXCEPTION WHEN invalid_parameter_value THEN
        NULL;  -- not a zone name: fall through to the state
      END;
    END IF;
    RETURN v_zones;
  END IF;
  IF p_agent_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT z ORDER BY z) INTO v_zones
      FROM public.agents g
      JOIN public.profiles p ON p.user_id = g.user_id,
      LATERAL unnest(public.fn_us_state_send_zones(p.state)) z
     WHERE g.id = p_agent_id;
    RETURN v_zones;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_next_step_send_ok(p_zones text[], p_at timestamptz)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  z text;
  h int;
BEGIN
  IF p_at IS NULL THEN RETURN false; END IF;
  FOREACH z IN ARRAY coalesce(p_zones, ARRAY['America/New_York', 'America/Los_Angeles']) LOOP
    BEGIN
      h := extract(hour from (p_at AT TIME ZONE z))::int;
    EXCEPTION WHEN invalid_parameter_value THEN
      RETURN false;  -- a moment that cannot be placed is never a send moment
    END;
    IF h < 8 OR h >= 21 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_next_step_cadence_due_local(p_cadence text, p_entered timestamptz, p_now timestamptz, p_zones text[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_key text;
  v_steps int[];
  v_step int;
  v_start timestamptz;
  v_t timestamptz;
  v_next timestamptz;
  v_allowed interval := interval '0';
BEGIN
  IF p_entered IS NULL OR p_now IS NULL OR p_now < p_entered
     OR NOT public.fn_next_step_send_ok(p_zones, p_now) THEN
    RETURN NULL;
  END IF;
  v_key := public.fn_next_step_cadence_due(p_cadence, p_now - p_entered);
  -- day steps, and hour steps inside [H, H+3) at an allowed moment: the parser's answer
  IF v_key IS NOT NULL OR lower(btrim(split_part(p_cadence, ':', 1))) <> 'hour' THEN
    RETURN v_key;
  END IF;
  BEGIN
    SELECT array_agg(btrim(s)::int) INTO v_steps
      FROM unnest(string_to_array(split_part(p_cadence, ':', 2), ',')) s
     WHERE btrim(s) <> '';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
  END;
  SELECT max(s) INTO v_step FROM unnest(v_steps) s
   WHERE s >= 0 AND p_entered + make_interval(hours => s) <= p_now;
  IF v_step IS NULL THEN RETURN NULL; END IF;
  v_start := p_entered + make_interval(hours => v_step);
  IF p_now - v_start >= interval '20 hours' THEN RETURN NULL; END IF;
  v_t := v_start;
  WHILE v_t < p_now LOOP
    v_next := least(date_trunc('hour', v_t) + interval '1 hour', p_now);
    IF public.fn_next_step_send_ok(p_zones, v_t) THEN
      v_allowed := v_allowed + (v_next - v_t);
    END IF;
    v_t := v_next;
  END LOOP;
  IF v_allowed < interval '3 hours' THEN RETURN 'hour' || v_step; END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_us_state_send_zones(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_next_step_send_zones(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_next_step_send_ok(text[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_next_step_cadence_due_local(text, timestamptz, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_us_state_send_zones(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_next_step_send_zones(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_next_step_send_ok(text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_next_step_cadence_due_local(text, timestamptz, timestamptz, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_next_step_nudge_sweep()
 RETURNS TABLE(queued integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_queued int := 0;
  r record;
  v_days int;
  v_key text;
  v_dedupe text;
  v_ins int;
begin
  for r in
    select np.application_id, np.agent_id, np.current_stage_key, np.entered_at, np.nudge_count, np.last_nudged_at,
           s.reminder_cadence, public.fn_next_step_send_zones(np.application_id, np.agent_id) as zones
    from public.next_step_progress np
    join public.next_step_stages s on s.stage_key = np.current_stage_key
    where np.status = 'active' and s.reminder_cadence is not null
  loop
    -- NULL outside 08:00-21:00 in the recipient's zone(s); a held hour step stays due
    -- until it has had 3h of allowed time (20261016210500)
    v_key := public.fn_next_step_cadence_due_local(r.reminder_cadence, r.entered_at, now(), r.zones);
    continue when v_key is null;
    -- day steps keep the 20h throttle. Hour steps take 6h: the tightest live gap is
    -- hour:1,12 (11h, nudge at most 2h late in its window), so 6h never holds a real
    -- step, and it stops a row the old sweep nudged as day1 this hour from getting
    -- hour24 again on the first tick after this migration
    continue when r.last_nudged_at is not null and r.last_nudged_at >= now() -
      case when v_key like 'day%' then interval '20 hours' else interval '6 hours' end;
    v_days := floor(extract(epoch from (now() - r.entered_at))/86400.0)::int;
    v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key;
    insert into public.next_step_messages
      (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values
      (r.application_id, r.agent_id, r.current_stage_key, 'telegram',
       r.current_stage_key || ':' || v_key, v_dedupe,
       jsonb_build_object('day', v_days, 'step', v_key, 'cadence', r.reminder_cadence,
                          'send_zones', coalesce(to_jsonb(r.zones), '"unknown: ET+PT"'::jsonb)))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_ins = row_count;
    continue when v_ins = 0;
    update public.next_step_progress
      set last_nudged_at = now(), nudge_count = nudge_count + 1
      where (application_id = r.application_id and r.application_id is not null)
         or (agent_id = r.agent_id and r.agent_id is not null);
    v_queued := v_queued + 1;
  end loop;
  return query select v_queued;
end;
$function$;
