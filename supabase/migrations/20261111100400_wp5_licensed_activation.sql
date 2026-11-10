-- WP5 (2026-11-10) part 1 of 3: contracting truth on contract_review_*, the contracting-stalled alert repaired,
-- the contracting guard view, and the dead contracting-sheet-sync cron retired.
--
-- MEASURED LIVE BEFORE WRITING (2026-11-10):
--   * Two competing contracting trackers, 32 days apart. The 10-09 portal tracker (contract_review_marks / _events /
--     _carriers: Combine, AFLAC, GTO, Ethos) holds 13 marks on 4 agents, newest 11-10 17:16. The 11-10 My Team toggle
--     (set_team_carrier_contract -> getting_started_progress.contracted_{chubb,ethos,ahl}_sent) holds 0 effective rows.
--     The stall alert graded only the second one, so its "missing Ethos/Chubb/AHL" list was fiction.
--   * team_carrier_contract_events holds 2 'chubb received=true' rows (2026-11-10 17:19:31 and 17:20:02 UTC, agent
--     7914c92b = Cari, a merged duplicate of 0dfa9c7b) while that agent's getting_started contracted_chubb_sent is NULL.
--     REPORTED, NOT REWRITTEN: the log and the state disagree and nothing here can prove which one is right.
--   * agents.contracted_at: 0 of 241. No function writes it. Its definition needs Sam (N7: which carriers must be
--     appointed). The derivation below is built and keyed to system_settings.contracting_required_carriers, which is
--     shipped EMPTY, so it does nothing until Sam names the list. Nothing is backfilled, ever.
--   * bot_alerts 'contracting_stalled': exactly 1 row ever (cc15c4a7-406f-4ea6-afe9-af520672a941, 2026-11-10 09:13:30
--     UTC, channels {ntfy}, sent_at NULL). The function stamped contracting_stalled_alerted_at at INSERT on 50
--     getting_started_progress rows in the same statement, so an undelivered page suppressed the next one for 7 days.
--   * contracting_requests: 0 rows ever, while cron contracting-sheet-sync-15m (jobid 132) posts every 15 minutes.
--
-- WHAT THIS DOES (idempotent; additive except the redefinitions listed, whose live preimages are saved to
-- public.ops_preimage_snapshots under reason 'wp5 preimage: functions + cron (part 1)' before anything is replaced):
--   1. system_settings keys (insert-if-missing): contracting_required_carriers='' (N7 pending),
--      contracting_owner_agent_id='' (N7 pending), contracting_stalled_crossing_anchor=<first apply time>,
--      new_hire_live_flow_enabled='false' (copy not approved).
--   2. contract_review_carriers gains in_portal_review (default true) and two rows Sam named on 11-10 for the My Team
--      toggle: chubb, ahl (in_portal_review=false, so the 10-09 portal review keeps its four circles). The portal review
--      (contract_review_roster) and contracting_call_list ('finished' = 4 marks) are patched to count portal carriers
--      only, by a guarded textual edit of their LIVE definitions.
--   3. set_team_carrier_contract writes contract_review_marks + contract_review_events (actor + via='team_toggle').
--      team_carrier_contract_status reads the marks. getting_started contracted_{chubb,ethos,ahl}_sent become a
--      trigger-maintained PROJECTION of the marks; a direct write to those columns by an admin/manager/service is
--      mirrored into a mark (the GettingStarted admin page keeps working and lands in the truth); an agent writing their
--      own row cannot claim a carrier (the column is reverted, the claim is not a contract).
--   4. agents.contracted_at derivation trigger on marks: forward-only, only when every REQUIRED carrier (setting) is
--      marked; AHL skipped for exempt hierarchies; inert while the setting is empty. trg_fn_agent_new_hire_flow loses its
--      contracted_at branch first, so a future derivation can never fire 'You're Live'.
--   5. fn_onboarding_contracting_stalled_alert rewritten: population = canonical active licensed recruits (no manager /
--      admin accounts, no merged rows) with NO deal in ANY source (mat_production_unified, public.deals,
--      agents.first_deal_at, all via canonical id); "no contracting record on file" (or "missing required carriers" once
--      N7 is set); fires once per agent per checkpoint crossing (day 3 / 7 / 14 since hire) that happens AFTER the
--      anchor; channels {ntfy,email}; first names only + a /dashboard/team?view=hire-clock link. A settle step stamps
--      contracting_stalled_alerted_at only from a delivered alert (bot_alerts.sent_at) and clears stamps written by an
--      alert that expired undelivered. Crossings before the anchor are the BACKLOG: reported by the guard view and the
--      apex-doctor WARN digest, never paged.
--   6. v_contracting_truth_health: one row, scalar subqueries only (never blank-green).
--   7. bot_alert_agent_contracted: "joined the team", not "signed a contract" (applications.contracted_at is a hire
--      marker, not carrier contracting).
--   8. cron contracting-sheet-sync-15m unscheduled (preimage below). The Ethos sheet legs stay retired (Sam, 10-09).
--
-- PREIMAGE (cron jobid 132, unscheduled here):
--   jobname  contracting-sheet-sync-15m
--   schedule */15 * * * *
--   command  select net.http_post(url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/contracting-sheet-sync',
--              headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--              where name = 'apex_bot_token' limit 1), 'Content-Type', 'application/json'), body := '{"source":"cron"}'::jsonb)
--   Restore: select cron.schedule('contracting-sheet-sync-15m', '*/15 * * * *', $$<command above>$$);
--
-- PREIMAGE (getting_started_progress.contracting_stalled_alerted_at): 50 rows, every one = 2026-11-10 09:13:30.048548+00,
--   written by alert cc15c4a7. The settle step clears these only once that alert is expired_undelivered. agent_ids:
--   00d44514-7361-46aa-a27a-4eb72b5e9efe 00f5cdae-4e9c-4383-b9ec-9064bba73a67 021f1686-2560-4b05-9281-c3a66d23c1f2
--   0dfa9c7b-eaac-4d42-83c4-d7d5e770d0f6 0e26ad12-8094-4c67-859d-8f8f6c2fedc3 0e88ed44-bd90-4862-85ca-38b66e9b4f2f
--   12258f97-a864-4489-b933-b094328d08f3 1c6beea0-f259-4f8d-b688-b6bd248697a1 297a82f8-ad38-479b-aaae-675d02a9f72a
--   29cf07b9-3e3a-4dec-bffc-a654b9e51bd6 309c2bb4-9229-44d9-9a60-5beda3c04f89 38f3671b-ac08-4be7-82a7-bd10103bce1f
--   3eb53b21-1a06-4d22-8d6a-3ebde05b2578 47a5608f-4da5-4245-a980-29cff62abb0f 49255ff1-3557-4374-b28b-fc2401976227
--   4b6292b5-9ed4-4edb-91ea-af43a67f7694 5b8a53e4-cf0c-4b0c-88b6-3b3c78dbc77d 679d17dc-4644-42ab-b699-29c8e3214b79
--   7650f7f6-a0e2-46cc-aae7-456666cdf060 7c70daa6-51cd-4a25-8009-5a4a2b0b98af 7fdbc828-9daf-4824-a640-a895c89c4050
--   8097f596-0b2d-4093-8aa9-f5b099c47152 84822cca-a375-4dc6-918d-5d691409ffa4 89614279-10ac-440d-9af6-63d8b22d0f3f
--   91bbf68a-bf54-4154-8db4-f076724d52db a2074fdf-e51e-42bb-b209-ab577a9c16c3 a56b8027-249d-4ce7-a37a-8558cd6bb784
--   a6d86923-485a-4223-931e-1dc46c86adb8 aabd9c8b-a3b2-46e5-b26e-111ec21cb415 abaf0758-19d7-4c80-8f87-0b86b6b51cdc
--   b2a1f632-cd04-4a72-8d80-5408318588fa b939f09d-0e04-40d4-b68e-cf8fafc03ce5 ba6d2762-0c7f-4a32-91ad-82b26669c42a
--   c19cdecd-a6e2-4269-b85e-281f9cbd9ade c3d3a1da-5258-4828-8a4a-3d182099574a c42dcd42-a03a-4d5f-98b9-7fa8f6f0ede9
--   c7b282e5-3f48-4eb9-89ce-1b724820e6f4 c83dd262-4756-4267-ac66-cf1c118f3ccb dd6265bd-d280-49c2-bd8b-b4c5c2007587
--   de084e1b-1011-426b-bcb4-67b3ad4e0297 e1f8616f-a5f8-4ea5-a468-051d055851e9 e6f01562-abec-4fa7-9550-a2748afa7ea9
--   e8479da3-4a81-42e0-9a0f-241685fa54ed ea6cde9d-bf41-43e7-9ac7-c1d0e726823f eb29dd59-8ffa-4d57-9db4-d1e7b3838087
--   edd08dc8-2787-4049-a854-f8d3c23e80c4 ee2ffb16-d939-4682-a638-d7c089321e55 f3c4bd53-7d6f-477f-9a3e-b0e2e82ff233
--   fa16673a-1c2c-4439-b0fc-ce4be209dc40 fece1996-9c3d-41bb-98d0-027295a21e6b

-- ── 0. preimages (once) ───────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.ops_preimage_snapshots') is not null
     and not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp5 preimage: functions + cron (part 1)') then
    insert into public.ops_preimage_snapshots (reason, payload)
    select 'wp5 preimage: functions + cron (part 1)', jsonb_build_object(
      'functions', (select jsonb_object_agg(p.proname, pg_get_functiondef(p.oid))
                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
                        'set_team_carrier_contract', 'team_carrier_contract_status', 'fn_onboarding_contracting_stalled_alert',
                        'contract_review_roster', 'contracting_call_list', 'trg_fn_agent_new_hire_flow', 'bot_alert_agent_contracted')),
      'cron', (select jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'command', command, 'active', active))
                 from cron.job where jobname in ('contracting-sheet-sync-15m', 'apex-onboarding-contracting-stalled')),
      'gsp_contracting_stalled_alerted_at', (select jsonb_agg(jsonb_build_object('id', id, 'agent_id', agent_id, 'at', contracting_stalled_alerted_at))
                 from public.getting_started_progress where contracting_stalled_alerted_at is not null),
      'orphan_team_events', (select jsonb_agg(to_jsonb(e)) from public.team_carrier_contract_events e));
  end if;
end $$;

-- ── 1. settings (insert-if-missing; never overwrite a value Sam set) ────────────────────────────────────────────
insert into public.system_settings (key, value) values
  ('contracting_required_carriers', ''),
  ('contracting_owner_agent_id', ''),
  ('contracting_stalled_crossing_anchor', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('new_hire_live_flow_enabled', 'false')
on conflict (key) do nothing;

-- The required-carrier list, parsed from the setting and limited to carriers that exist. Empty = not decided (N7).
create or replace function public.fn_contracting_required_carriers()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct k.carrier_key order by k.carrier_key), '{}'::text[])
  from regexp_split_to_table(lower(coalesce((select value from public.system_settings where key = 'contracting_required_carriers'), '')), '[\s,;]+') t(x)
  join public.contract_review_carriers k on k.carrier_key = btrim(t.x)
  where btrim(t.x) <> '';
$$;

-- ── 2. carriers: one catalog, portal review keeps its four circles ──────────────────────────────────────────────
alter table public.contract_review_carriers add column if not exists in_portal_review boolean not null default true;

insert into public.contract_review_carriers (carrier_key, label, position, carrier_id, portal_url, portal_verified, mapping_note, in_portal_review)
values
  ('chubb', 'Chubb', 5, (select id from public.carriers where name = 'Chubb' limit 1), null, false,
   'Sam 2026-11-10 (My Team toggle). Not in the carrier catalog on 2026-11-10. Not part of the portal review circles.', false),
  ('ahl', 'American Home Life', 6, (select id from public.carriers where name = 'American Home Life' limit 1), null, false,
   'Sam 2026-11-10 (My Team toggle). Exact catalog name "American Home Life". Not part of the portal review circles; hidden for OB/Chudi hierarchies (carrier_hierarchy_exemptions).', false)
on conflict (carrier_key) do nothing;

-- Patch the two readers that count marks so a team-toggle carrier never changes the portal review's arithmetic.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.contract_review_roster'::regproc);
  if position('k.in_portal_review' in v_def) = 0 then
    v_new := v_def;
    v_new := replace(v_new, 'into v_carriers from public.contract_review_carriers k;',
                            'into v_carriers from public.contract_review_carriers k where k.in_portal_review;');
    v_new := replace(v_new, '(select count(*) from public.contract_review_marks m where m.agent_id = a.id and m.version = v_version)::int as marked_count',
                            '(select count(*) from public.contract_review_marks m join public.contract_review_carriers pk on pk.carrier_key = m.carrier_key and pk.in_portal_review where m.agent_id = a.id and m.version = v_version)::int as marked_count');
    v_new := replace(v_new, 'left join public.agents mb on mb.user_id = m.confirmed_by) as marks',
                            'left join public.agents mb on mb.user_id = m.confirmed_by where k.in_portal_review) as marks');
    if (length(v_new) - length(v_def)) <> (length(' where k.in_portal_review') + length(' join public.contract_review_carriers pk on pk.carrier_key = m.carrier_key and pk.in_portal_review') + length(' where k.in_portal_review')) then
      raise exception 'wp5: contract_review_roster live text drifted; refusing a partial patch';
    end if;
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.contracting_call_list'::regproc);
  if position('pk.in_portal_review' in v_def) = 0 then
    v_new := replace(v_def, '(select count(*) from public.contract_review_marks m where m.agent_id = p.id and m.version = v_version) as marked_count',
                            '(select count(*) from public.contract_review_marks m join public.contract_review_carriers pk on pk.carrier_key = m.carrier_key and pk.in_portal_review where m.agent_id = p.id and m.version = v_version) as marked_count');
    if v_new = v_def then
      raise exception 'wp5: contracting_call_list live text drifted; refusing to leave it counting team-toggle marks';
    end if;
    execute v_new;
  end if;
end $$;

-- ── 3. the team toggle writes the marks ─────────────────────────────────────────────────────────────────────────
create or replace function public.team_carrier_contract_status(p_agent_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_canon uuid; v_version integer; v_chubb timestamptz; v_ethos timestamptz; v_ahl timestamptz;
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this agent' using errcode = '42501';
  end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  select c.version into v_version from public.contract_review_config c where c.singleton;
  select max(m.confirmed_at) filter (where m.carrier_key = 'chubb'),
         max(m.confirmed_at) filter (where m.carrier_key = 'ethos'),
         max(m.confirmed_at) filter (where m.carrier_key = 'ahl')
    into v_chubb, v_ethos, v_ahl
    from public.contract_review_marks m where m.agent_id = v_canon and m.version = v_version;
  return jsonb_build_object(
    'chubb', v_chubb is not null, 'chubb_at', v_chubb,
    'ethos', v_ethos is not null, 'ethos_at', v_ethos,
    'ahl',   v_ahl   is not null, 'ahl_at',   v_ahl,
    'ahl_exempt', public.fn_agent_ahl_exempt(p_agent_id),
    'source', 'contract_review_marks'
  );
end;
$$;

create or replace function public.set_team_carrier_contract(p_agent_id uuid, p_carrier text, p_received boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_canon uuid;
  v_version integer;
  v_cur public.contract_review_marks%rowtype;
  v_was boolean;
begin
  if v_uid is null or not (
    public.apex_is_admin()
    or (public.has_role(v_uid, 'manager'::app_role) and public.apex_can_read_agent(p_agent_id))
  ) then
    raise exception 'Not permitted to set contracts for this agent' using errcode = '42501';
  end if;
  if p_agent_id is null or p_received is null then
    raise exception 'agent and state are required' using errcode = '22023';
  end if;
  v_key := case lower(btrim(coalesce(p_carrier, '')))
    when 'chubb' then 'chubb' when 'ethos' then 'ethos' when 'ahl' then 'ahl' when 'american_home_life' then 'ahl' end;
  if v_key is null or not exists (select 1 from public.contract_review_carriers k where k.carrier_key = v_key) then
    raise exception 'Unknown carrier % (expected chubb, ethos, ahl)', p_carrier using errcode = '22023';
  end if;
  -- A merged duplicate is its canonical row's person: the mark lands on the canonical row, like set_contract_review_mark.
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if v_canon <> p_agent_id and not public.apex_can_read_agent(v_canon) then
    raise exception 'Not permitted to set contracts for this agent' using errcode = '42501';
  end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  -- Same lock key as set_contract_review_mark, so the two writers serialise on one (agent, carrier).
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':' || v_key, 7));
  select * into v_cur from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
  v_was := found;
  if p_received and not v_was then
    insert into public.contract_review_marks (agent_id, version, carrier_key, confirmed_by) values (v_canon, v_version, v_key, v_uid);
    insert into public.contract_review_events (agent_id, version, event_type, carrier_key, detail, acted_by)
      values (v_canon, v_version, 'marked', v_key, jsonb_build_object('via', 'team_toggle', 'requested_agent_id', p_agent_id), v_uid);
  elsif (not p_received) and v_was then
    delete from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
    insert into public.contract_review_events (agent_id, version, event_type, carrier_key, detail, acted_by)
      values (v_canon, v_version, 'cleared', v_key, jsonb_build_object('via', 'team_toggle', 'requested_agent_id', p_agent_id,
              'was_confirmed_at', v_cur.confirmed_at, 'was_confirmed_by', v_cur.confirmed_by), v_uid);
  end if;
  -- The 11-10 audit table keeps its history, one row per tap (both directions), as before.
  insert into public.team_carrier_contract_events (agent_id, carrier, received, acted_by)
    values (p_agent_id, lower(btrim(p_carrier)), p_received, v_uid);
  return public.team_carrier_contract_status(p_agent_id);
end;
$$;

-- ── 3b. getting_started contracted_* = projection of the marks ──────────────────────────────────────────────────
create or replace function public.fn_project_contract_marks_to_getting_started()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_agent uuid; v_key text; v_version integer; v_mark_version integer; v_col text; v_value timestamptz;
begin
  if tg_op = 'DELETE' then
    v_agent := old.agent_id; v_key := old.carrier_key; v_mark_version := old.version; v_value := null;
  else
    v_agent := new.agent_id; v_key := new.carrier_key; v_mark_version := new.version; v_value := new.confirmed_at;
  end if;
  -- The mirror below is already writing this very getting_started row; updating it again here would collide.
  if coalesce(current_setting('apex.contract_mark_mirror', true), '') = v_agent::text then return null; end if;
  v_col := case v_key when 'chubb' then 'contracted_chubb_sent' when 'ethos' then 'contracted_ethos_sent' when 'ahl' then 'contracted_ahl_sent' end;
  if v_col is null then return null; end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  if v_mark_version <> v_version then return null; end if;
  perform set_config('apex.contract_projection', 'on', true);
  insert into public.getting_started_progress (agent_id) values (v_agent) on conflict (agent_id) do nothing;
  execute format('update public.getting_started_progress set %1$I = $1 where agent_id = $2 and %1$I is distinct from $1', v_col)
    using v_value, v_agent;
  perform set_config('apex.contract_projection', '', true);
  return null;
end;
$$;

drop trigger if exists trg_project_contract_marks_to_getting_started on public.contract_review_marks;
create trigger trg_project_contract_marks_to_getting_started
  after insert or delete on public.contract_review_marks
  for each row execute function public.fn_project_contract_marks_to_getting_started();

create or replace function public.fn_mirror_getting_started_contract_marks()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_trusted boolean;
  v_version integer;
  v_canon uuid;
  v_key text;
  v_old timestamptz;
  v_new timestamptz;
  v_cur public.contract_review_marks%rowtype;
begin
  if coalesce(current_setting('apex.contract_projection', true), '') = 'on' then return new; end if;
  v_trusted := case
    when v_uid is not null then public.apex_is_admin()
                                or (public.has_role(v_uid, 'manager'::app_role) and public.apex_can_read_agent(new.agent_id))
    else v_role in ('', 'service_role')  -- direct DB / cron / service key; an anon JWT is never trusted
  end;
  if not v_trusted then
    -- An agent ticking their own row is not a carrier contract. Keep the projection equal to the marks.
    new.contracted_chubb_sent := old.contracted_chubb_sent;
    new.contracted_ethos_sent := old.contracted_ethos_sent;
    new.contracted_ahl_sent := old.contracted_ahl_sent;
    return new;
  end if;
  v_canon := coalesce(public.fn_canonical_agent_id(new.agent_id), new.agent_id);
  select c.version into v_version from public.contract_review_config c where c.singleton;
  perform set_config('apex.contract_mark_mirror', new.agent_id::text, true);
  foreach v_key in array array['chubb', 'ethos', 'ahl'] loop
    v_old := case v_key when 'chubb' then old.contracted_chubb_sent when 'ethos' then old.contracted_ethos_sent else old.contracted_ahl_sent end;
    v_new := case v_key when 'chubb' then new.contracted_chubb_sent when 'ethos' then new.contracted_ethos_sent else new.contracted_ahl_sent end;
    continue when v_old is not distinct from v_new;
    perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':' || v_key, 7));
    select * into v_cur from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
    if v_new is not null and not found then
      insert into public.contract_review_marks (agent_id, version, carrier_key, confirmed_at, confirmed_by) values (v_canon, v_version, v_key, v_new, v_uid);
      insert into public.contract_review_events (agent_id, version, event_type, carrier_key, detail, acted_by)
        values (v_canon, v_version, 'marked', v_key, jsonb_build_object('via', 'getting_started_direct', 'requested_agent_id', new.agent_id), v_uid);
    elsif v_new is null and found then
      delete from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
      insert into public.contract_review_events (agent_id, version, event_type, carrier_key, detail, acted_by)
        values (v_canon, v_version, 'cleared', v_key, jsonb_build_object('via', 'getting_started_direct', 'requested_agent_id', new.agent_id,
                'was_confirmed_at', v_cur.confirmed_at, 'was_confirmed_by', v_cur.confirmed_by), v_uid);
    end if;
  end loop;
  perform set_config('apex.contract_mark_mirror', '', true);
  return new;
end;
$$;

drop trigger if exists trg_mirror_getting_started_contract_marks on public.getting_started_progress;
create trigger trg_mirror_getting_started_contract_marks
  before update of contracted_chubb_sent, contracted_ethos_sent, contracted_ahl_sent on public.getting_started_progress
  for each row execute function public.fn_mirror_getting_started_contract_marks();

-- One-time projection of the marks that already exist (the projection is what the columns now mean).
do $$
declare v_version integer;
begin
  select c.version into v_version from public.contract_review_config c where c.singleton;
  perform set_config('apex.contract_projection', 'on', true);
  insert into public.getting_started_progress (agent_id)
    select distinct m.agent_id from public.contract_review_marks m
    where m.version = v_version and m.carrier_key in ('chubb', 'ethos', 'ahl')
  on conflict (agent_id) do nothing;
  update public.getting_started_progress gp set
    contracted_chubb_sent = (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'chubb'),
    contracted_ethos_sent = (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'ethos'),
    contracted_ahl_sent   = (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'ahl')
  where (gp.contracted_chubb_sent, gp.contracted_ethos_sent, gp.contracted_ahl_sent) is distinct from (
    (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'chubb'),
    (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'ethos'),
    (select m.confirmed_at from public.contract_review_marks m where m.agent_id = gp.agent_id and m.version = v_version and m.carrier_key = 'ahl'));
  perform set_config('apex.contract_projection', '', true);
end $$;

-- ── 4. the new-hire flow can never be fired by contracting; agents.contracted_at derivation (inert until N7) ──────
create or replace function public.trg_fn_agent_new_hire_flow()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $function$
begin
  -- WP5: only the move INTO in_field_training, only once (production_unlocked_at is the edge function's claim), and only
  -- while Sam has switched the flow on (system_settings.new_hire_live_flow_enabled='true'; shipped 'false' until he
  -- approves the copy). The contracted_at branch is gone: contracting is not "You're Live". Payload key is agentId,
  -- which is what the edge function reads (it sent agent_id since April and every run 404'd).
  if old.onboarding_stage is distinct from new.onboarding_stage
     and new.onboarding_stage = 'in_field_training'
     and new.production_unlocked_at is null
     and coalesce((select s.value from public.system_settings s where s.key = 'new_hire_live_flow_enabled'), 'false') = 'true' then
    perform public.run_automation_job(
      'trigger-new-hire-flow',
      'trigger-new-hire-flow',
      jsonb_build_object('agentId', new.id, 'triggerType', 'stage_in_field_training')
    );
  end if;
  return new;
exception when others then
  return new;
end;
$function$;

create or replace function public.fn_derive_agent_contracted_at()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_required text[]; v_version integer; v_at timestamptz;
begin
  v_required := public.fn_contracting_required_carriers();
  if cardinality(v_required) = 0 then return null; end if;  -- N7 not answered: "contracted" is undefined, do nothing
  select c.version into v_version from public.contract_review_config c where c.singleton;
  if new.version <> v_version then return null; end if;
  if exists (
    select 1 from unnest(v_required) r(k)
    where not (r.k = 'ahl' and public.fn_agent_ahl_exempt(new.agent_id))
      and not exists (select 1 from public.contract_review_marks m where m.agent_id = new.agent_id and m.version = v_version and m.carrier_key = r.k)
  ) then
    return null;
  end if;
  select max(m.confirmed_at) into v_at from public.contract_review_marks m
   where m.agent_id = new.agent_id and m.version = v_version and m.carrier_key = any(v_required);
  -- Forward-only: the first time the required set completes. Never rewritten, never cleared, never backfilled.
  update public.agents set contracted_at = v_at where id = new.agent_id and contracted_at is null;
  return null;
exception when others then
  raise warning 'fn_derive_agent_contracted_at soft-failed for %: %', new.agent_id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_derive_agent_contracted_at on public.contract_review_marks;
create trigger trg_derive_agent_contracted_at
  after insert on public.contract_review_marks
  for each row execute function public.fn_derive_agent_contracted_at();

-- ── 5. the contracting-stalled alert ────────────────────────────────────────────────────────────────────────────
-- First deal from ANY source, keyed by canonical id (production_unified, legacy public.deals, agents.first_deal_at).
create or replace view public.v_agent_first_deal_any_source with (security_invoker = true) as
with ids as (
  select a.id as member_id,
         case when a.canonical_agent_id is not null and a.canonical_agent_id <> a.id then a.canonical_agent_id else a.id end as agent_id
  from public.agents a
), src as (
  select i.agent_id, min(coalesce(m.posted_date, m.effective_date))::timestamptz as at, 'production_unified'::text as source
    from public.mat_production_unified m join ids i on i.member_id = m.agent_id group by i.agent_id
  union all
  select i.agent_id, min(d.created_at), 'deals'::text from public.deals d join ids i on i.member_id = d.agent_id group by i.agent_id
  union all
  select i.agent_id, min(a.first_deal_at), 'agents.first_deal_at'::text
    from public.agents a join ids i on i.member_id = a.id where a.first_deal_at is not null group by i.agent_id
)
select agent_id, min(at) as first_deal_at, array_agg(distinct source order by source) as sources
from src group by agent_id;
revoke all on public.v_agent_first_deal_any_source from public, anon, authenticated;
grant select on public.v_agent_first_deal_any_source to service_role;

-- Who may read agency-wide WP5 facts: Sam (admin), Aisha (the manager role is Aisha-only), or a caller with no end-user
-- JWT (pg_cron, the service key, apex-doctor's bot-sql). Plain agents and anon get nothing. Inside SECURITY DEFINER
-- current_user is the owner, so the JWT role claim is what distinguishes cron/service from an end user.
create or replace function public.fn_wp5_staff_reader()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when auth.uid() is not null then coalesce(public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role), false)
    else coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('', 'service_role')
  end
$$;
revoke all on function public.fn_wp5_staff_reader() from public, anon;
grant execute on function public.fn_wp5_staff_reader() to authenticated, service_role;

-- The licensed-recruit population every WP5 surface grades: canonical, active, licensed, a person (not a manager or
-- admin account, not a placeholder, not roster-excluded). Empty for anyone but staff readers.
create or replace function public.fn_licensed_activation_population()
returns table (agent_id uuid, hired_at timestamptz, first_name text, manager_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select a.id, a.created_at,
         coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'Unnamed'),
         coalesce(a.manager_id, a.invited_by_manager_id)
  from public.agents a
  join public.fn_contract_review_population() p on p.agent_id = a.id
  where a.license_status::text = 'licensed'
    and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
    and public.fn_wp5_staff_reader()
$$;
revoke all on function public.fn_licensed_activation_population() from public, anon;
grant execute on function public.fn_licensed_activation_population() to authenticated, service_role;

-- Per licensed recruit: contracting record + deal state. gap = "no contracting record on file" (no current-version mark
-- at all) while N7 is open; once the required list is set, gap = a required carrier (AHL skipped when exempt) unmarked.
create or replace function public.fn_licensed_contracting_gaps()
returns table (agent_id uuid, hired_at timestamptz, first_name text, manager_id uuid, marked_count integer,
               required_missing text[], has_deal boolean, gap boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_required text[]; v_version integer;
begin
  v_required := public.fn_contracting_required_carriers();
  select c.version into v_version from public.contract_review_config c where c.singleton;
  if not public.fn_wp5_staff_reader() then return; end if;
  return query
  with pop as (select * from public.fn_licensed_activation_population()),
  fd as (select f.agent_id, f.first_deal_at from public.v_agent_first_deal_any_source f),
  m as (
    select pop.agent_id,
           (select count(*)::int from public.contract_review_marks mk where mk.agent_id = pop.agent_id and mk.version = v_version) as marked_count,
           case when cardinality(v_required) = 0 then null else
             coalesce((select array_agg(r.k order by r.k) from unnest(v_required) r(k)
                        where not (r.k = 'ahl' and public.fn_agent_ahl_exempt(pop.agent_id))
                          and not exists (select 1 from public.contract_review_marks mk where mk.agent_id = pop.agent_id and mk.version = v_version and mk.carrier_key = r.k)),
                      '{}'::text[]) end as required_missing
    from pop
  )
  select pop.agent_id, pop.hired_at, pop.first_name, pop.manager_id, m.marked_count, m.required_missing,
         (fd.agent_id is not null) as has_deal,
         case when m.required_missing is null then m.marked_count = 0 else cardinality(m.required_missing) > 0 end as gap
  from pop join m on m.agent_id = pop.agent_id left join fd on fd.agent_id = pop.agent_id;
end;
$$;
revoke all on function public.fn_licensed_contracting_gaps() from public, anon;
grant execute on function public.fn_licensed_contracting_gaps() to authenticated, service_role;

create table if not exists public.contracting_stalled_checkpoints (
  agent_id uuid not null references public.agents(id) on delete cascade,
  checkpoint smallint not null check (checkpoint in (3, 7, 14)),
  crossed_at timestamptz not null,
  bot_alert_id uuid,
  attempts smallint not null default 0,
  queued_at timestamptz,
  delivered_at timestamptz,
  expired_at timestamptz,
  primary key (agent_id, checkpoint)
);
alter table public.contracting_stalled_checkpoints enable row level security;
revoke all on table public.contracting_stalled_checkpoints from public, anon, authenticated;
grant all on table public.contracting_stalled_checkpoints to service_role;

-- Checkpoint crossings that are due a page: crossed AFTER the anchor (the backlog is a digest, not a page), still a gap,
-- no deal, and not already delivered / in flight / out of attempts.
create or replace function public.fn_contracting_stalled_due(p_anchor timestamptz)
returns table (agent_id uuid, checkpoint smallint, crossed_at timestamptz, first_name text, days_since_hire integer)
language sql stable security definer set search_path to 'public' as $$
  select g.agent_id, c.cp::smallint, g.hired_at + make_interval(days => c.cp), g.first_name,
         floor(extract(epoch from (now() - g.hired_at)) / 86400)::int
  from public.fn_licensed_contracting_gaps() g
  cross join lateral (select max(x) as cp from unnest(array[3, 7, 14]) x where g.hired_at + make_interval(days => x) <= now()) c
  where g.gap and not g.has_deal and c.cp is not null
    and g.hired_at + make_interval(days => c.cp) >= p_anchor
    and not exists (
      select 1 from public.contracting_stalled_checkpoints s
      where s.agent_id = g.agent_id and s.checkpoint = c.cp
        and (s.delivered_at is not null or s.attempts >= 3 or (s.bot_alert_id is not null and s.expired_at is null))
    )
$$;
revoke all on function public.fn_contracting_stalled_due(timestamptz) from public, anon;
grant execute on function public.fn_contracting_stalled_due(timestamptz) to authenticated, service_role;

-- Settle: a checkpoint (and the getting_started stamp) is "alerted" only once the dispatcher recorded sent_at.
create or replace function public.fn_contracting_stalled_settle()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_delivered int; v_expired int; v_stamped int; v_cleared int;
begin
  update public.contracting_stalled_checkpoints s set delivered_at = b.sent_at
    from public.bot_alerts b where b.id = s.bot_alert_id and s.delivered_at is null and b.sent_at is not null;
  get diagnostics v_delivered = row_count;
  update public.contracting_stalled_checkpoints s set expired_at = b.expired_at
    from public.bot_alerts b where b.id = s.bot_alert_id and s.delivered_at is null and s.expired_at is null
      and b.sent_at is null and b.expired_at is not null;
  get diagnostics v_expired = row_count;
  update public.getting_started_progress gp set contracting_stalled_alerted_at = d.at
    from (select s.agent_id, max(s.delivered_at) as at from public.contracting_stalled_checkpoints s
           where s.delivered_at is not null group by s.agent_id) d
   where d.agent_id = gp.agent_id
     and (gp.contracting_stalled_alerted_at is null or gp.contracting_stalled_alerted_at < d.at);
  get diagnostics v_stamped = row_count;
  -- Legacy stamps written at INSERT by an alert that then expired undelivered: nobody was told, so nothing is "alerted".
  update public.getting_started_progress gp set contracting_stalled_alerted_at = null
   where gp.contracting_stalled_alerted_at is not null
     and exists (select 1 from public.bot_alerts b
                  where b.event_type = 'contracting_stalled' and b.sent_at is null and b.expired_at is not null
                    and abs(extract(epoch from (gp.contracting_stalled_alerted_at - b.created_at))) < 5)
     and not exists (select 1 from public.contracting_stalled_checkpoints s
                      where s.agent_id = gp.agent_id and s.delivered_at = gp.contracting_stalled_alerted_at);
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('delivered', v_delivered, 'expired', v_expired, 'stamped', v_stamped, 'legacy_cleared', v_cleared);
end;
$$;
revoke all on function public.fn_contracting_stalled_settle() from public, anon, authenticated;
grant execute on function public.fn_contracting_stalled_settle() to service_role;

create or replace function public.fn_onboarding_contracting_stalled_alert()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_anchor timestamptz;
  v_required text[];
  v_n int;
  v_list text;
  v_alert uuid;
begin
  perform public.fn_contracting_stalled_settle();
  v_anchor := coalesce(nullif(btrim((select s.value from public.system_settings s where s.key = 'contracting_stalled_crossing_anchor')), '')::timestamptz, now());
  v_required := public.fn_contracting_required_carriers();

  select count(*), string_agg(d.first_name || ' (day ' || d.days_since_hire || ')', ', ' order by d.days_since_hire desc, d.first_name)
    into v_n, v_list from public.fn_contracting_stalled_due(v_anchor) d;
  if coalesce(v_n, 0) = 0 then return; end if;

  insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels, action_link)
  values ('onboarding', 'contracting_stalled', 'critical',
    v_n || ' licensed hire' || case when v_n = 1 then '' else 's' end
        || case when cardinality(v_required) = 0 then ': no contracting record on file' else ': missing required carrier contracts' end,
    case when cardinality(v_required) = 0
      then 'No contracting record on file for: ' || v_list || '. Each just crossed day 3, 7 or 14 since hire with no carrier marked and no deal. Open the hire clock and mark carriers from their My Team card.'
      else 'Missing a required carrier (' || array_to_string(v_required, ', ') || ') for: ' || v_list || '. Each just crossed day 3, 7 or 14 since hire with no deal. Open the hire clock.' end,
    v_n || ' licensed hire(s) have no contracting record. Open the hire clock.',
    array['ntfy', 'email'],
    'https://apex-financial.org/dashboard/team?view=hire-clock')
  returning id into v_alert;

  insert into public.contracting_stalled_checkpoints (agent_id, checkpoint, crossed_at, bot_alert_id, attempts, queued_at)
  select d.agent_id, d.checkpoint, d.crossed_at, v_alert, 1, now() from public.fn_contracting_stalled_due(v_anchor) d
  on conflict (agent_id, checkpoint) do update
    set bot_alert_id = excluded.bot_alert_id, attempts = public.contracting_stalled_checkpoints.attempts + 1,
        queued_at = now(), expired_at = null;
end;
$function$;
revoke all on function public.fn_onboarding_contracting_stalled_alert() from public, anon, authenticated;
grant execute on function public.fn_onboarding_contracting_stalled_alert() to service_role;

-- ── 6. guard view: one row in every state ───────────────────────────────────────────────────────────────────────
create or replace view public.v_contracting_truth_health with (security_barrier = true) as
select
  (select value from public.system_settings where key = 'contracting_required_carriers') as required_carriers_setting,
  cardinality(public.fn_contracting_required_carriers()) > 0 as required_carriers_configured,
  nullif(btrim(coalesce((select value from public.system_settings where key = 'contracting_stalled_crossing_anchor'), '')), '')::timestamptz as crossing_anchor,
  (select count(*) from public.contract_review_marks m join public.contract_review_config c on c.singleton and m.version = c.version)::int as marks_total,
  greatest((select max(confirmed_at) from public.contract_review_marks),
           (select max(acted_at) from public.contract_review_events where event_type in ('marked', 'cleared'))) as last_mark_write_at,
  (select count(*) from public.fn_licensed_contracting_gaps() g where g.gap and not g.has_deal and g.hired_at < now() - interval '7 days')::int as stalled_past_day7,
  (select count(*) from public.fn_licensed_contracting_gaps() g where g.gap and not g.has_deal
     and g.hired_at + interval '3 days' < nullif(btrim(coalesce((select value from public.system_settings where key = 'contracting_stalled_crossing_anchor'), '')), '')::timestamptz)::int as backlog_crossed_before_anchor,
  (select count(*) from public.fn_contracting_stalled_due(nullif(btrim(coalesce((select value from public.system_settings where key = 'contracting_stalled_crossing_anchor'), '')), '')::timestamptz))::int as crossings_due_now,
  (select count(*) from public.contracting_stalled_checkpoints where queued_at > now() - interval '7 days')::int as crossings_queued_7d,
  (select count(*) from public.contracting_stalled_checkpoints where delivered_at > now() - interval '7 days')::int as crossings_delivered_7d,
  (select count(*) from public.bot_alerts b where b.event_type in ('contracting_stalled', 'licensed_hire_clock')
     and b.sent_at is null and b.expired_at is null and b.created_at < now() - interval '1 hour')::int as alerts_unsent_over_1h,
  (select count(*) from public.bot_alerts b where b.event_type in ('contracting_stalled', 'licensed_hire_clock')
     and b.sent_at is null and b.expired_at > now() - interval '7 days')::int as alerts_expired_undelivered_7d,
  (select count(*) from public.getting_started_progress gp
     where (gp.contracted_chubb_sent is not null) is distinct from exists (select 1 from public.contract_review_marks m join public.contract_review_config c on c.singleton and m.version = c.version where m.agent_id = gp.agent_id and m.carrier_key = 'chubb')
        or (gp.contracted_ethos_sent is not null) is distinct from exists (select 1 from public.contract_review_marks m join public.contract_review_config c on c.singleton and m.version = c.version where m.agent_id = gp.agent_id and m.carrier_key = 'ethos')
        or (gp.contracted_ahl_sent is not null) is distinct from exists (select 1 from public.contract_review_marks m join public.contract_review_config c on c.singleton and m.version = c.version where m.agent_id = gp.agent_id and m.carrier_key = 'ahl'))::int as projection_mismatches,
  (select count(*) from public.team_carrier_contract_events e where e.received
     and not exists (select 1 from public.contract_review_marks m
                      where m.agent_id = coalesce((select case when a.canonical_agent_id <> a.id then a.canonical_agent_id end from public.agents a where a.id = e.agent_id), e.agent_id)
                        and m.carrier_key = case e.carrier when 'american_home_life' then 'ahl' else e.carrier end)
     and not exists (select 1 from public.team_carrier_contract_events e2 where e2.agent_id = e.agent_id and e2.carrier = e.carrier and e2.acted_at > e.acted_at))::int as orphan_team_toggle_events,
  (select count(*) from cron.job where jobname = 'apex-onboarding-contracting-stalled' and active)::int as alert_cron_active,
  now() as measured_at
where public.apex_is_admin()
   or public.has_role(auth.uid(), 'manager'::app_role)
   or current_user in ('postgres', 'service_role', 'supabase_admin');
revoke all on public.v_contracting_truth_health from public, anon;
grant select on public.v_contracting_truth_health to authenticated, service_role;

-- ── 7. "joined the team", not "signed a contract" ───────────────────────────────────────────────────────────────
create or replace function public.bot_alert_agent_contracted()
returns trigger language plpgsql security definer as $function$
begin
  -- applications.contracted_at is stamped when an applicant is HIRED (fn_auto_advance_licensed_to_contracting,
  -- record_apex_licensed_disposition 'hired', the Call Center hire button). It is not carrier contracting, which lives
  -- in contract_review_marks. The wording says what happened.
  if new.contracted_at is not null and (old.contracted_at is null) then
    insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels, action_link)
    values (
      'trigger',
      'applicant_contracted',
      'celebrate',
      format('Joined the team: %s %s', new.first_name, new.last_name),
      format('<p><strong>%s %s</strong> joined the team (application marked hired). Carrier contracting is tracked separately on My Team. License: %s.</p>',
             new.first_name, new.last_name, coalesce(new.license_status::text, 'n/a')),
      format('Joined the team: %s %s', new.first_name, new.last_name),
      array['email', 'sms']::text[],
      'https://apex-financial.org/dashboard/hiring-pipeline'
    );
  end if;
  return new;
end;
$function$;

-- ── 8. retire the cron that has posted every 15 minutes into a queue that never held a row ─────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'contracting-sheet-sync-15m') then
    perform cron.unschedule('contracting-sheet-sync-15m');
  end if;
end $$;

revoke all on function public.fn_contracting_required_carriers() from public, anon;
grant execute on function public.fn_contracting_required_carriers() to authenticated, service_role;
revoke all on function public.set_team_carrier_contract(uuid, text, boolean) from public, anon;
revoke all on function public.team_carrier_contract_status(uuid) from public, anon;
grant execute on function public.set_team_carrier_contract(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.team_carrier_contract_status(uuid) to authenticated, service_role;
