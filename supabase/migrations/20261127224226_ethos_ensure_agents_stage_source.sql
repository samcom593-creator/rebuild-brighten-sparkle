-- MP-ETHOS-ROSTER (2026-11-27), second cut. The rolled-back dry run of ethos_callsheet_ensure_agents(true) failed on
-- agent_stage_source_check: the stage source must be staff | default | mapped, and the first cut wrote 'ethos_hierarchy'.
-- Same function as 20261127222910 with source 'mapped'. Applied live via MCP; recorded as this version.
create or replace function public.ethos_callsheet_ensure_agents(p_unhide boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  SAM_AGENT_ID constant uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  -- Every kind a hire trigger or sweep can enqueue (agent_onboarding_queue_email_kind_check).
  MAIL_KINDS constant text[] := array['course', 'discord', 'hired_whatsapp', 'onboarding_call', 'get_licensed', 'scripts_packet',
                                      'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10'];
  r record;
  v_ids uuid[];
  v_agent uuid;
  v_manager uuid;
  v_match text;
  v_name text;
  v_code text;
  v_n int;
  v_linked int := 0;
  v_linked_by jsonb := '{}'::jsonb;
  v_created int := 0;
  v_created_names text[] := '{}';
  v_skipped_names text[] := '{}';
  v_mail_parked int := 0;
  v_nipr_backfilled int := 0;
  v_phone_backfilled int := 0;
  v_al_backfilled int := 0;
  v_unhidden_names text[] := '{}';
begin
  for r in
    select p.*,
           regexp_replace(coalesce(p.npn, ''), '[^0-9]', '', 'g') as npn_digits,
           right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) as phone10
      from public.ethos_callsheet_people p
     where p.on_ethos and p.in_latest_snapshot and p.agent_id is null
     order by p.full_name
  loop
    v_agent := null;
    v_match := null;

    -- (a) NPN digits: one record, not a merged duplicate, not already the record of another Ethos row.
    if r.npn_digits <> '' then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
       where a.canonical_agent_id is null
         and regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g') = r.npn_digits
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'npn'; end if;
    end if;
    -- (b) email on the profile
    if v_agent is null and r.email is not null then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        join public.profiles pr on pr.id = a.profile_id or pr.user_id = a.user_id
       where a.canonical_agent_id is null
         and lower(pr.email) = lower(r.email)
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'email'; end if;
    end if;
    -- (c) normalised name, letters only, at least 6 of them
    if v_agent is null and length(coalesce(r.name_key, '')) >= 6 then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        left join public.profiles pr on pr.id = a.profile_id
       where a.canonical_agent_id is null
         and (lower(regexp_replace(coalesce(a.display_name, ''), '[^a-zA-Z]', '', 'g')) = r.name_key
              or lower(regexp_replace(coalesce(pr.full_name, ''), '[^a-zA-Z]', '', 'g')) = r.name_key)
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'name'; end if;
    end if;
    -- (d) last 10 digits of the phone on the profile
    if v_agent is null and length(r.phone10) = 10 then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        join public.profiles pr on pr.id = a.profile_id or pr.user_id = a.user_id
       where a.canonical_agent_id is null
         and right(regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g'), 10) = r.phone10
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'phone'; end if;
    end if;

    if v_agent is not null then
      update public.ethos_callsheet_people set agent_id = v_agent, agent_match = v_match, updated_at = now() where id = r.id;
      -- The export is the better source for the NPN; every downstream match keys on it first.
      update public.agents a set nipr_number = r.npn_digits, updated_at = now()
       where a.id = v_agent and r.npn_digits <> ''
         and nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '') is null;
      get diagnostics v_n = row_count; v_nipr_backfilled := v_nipr_backfilled + v_n;
      update public.profiles pr set phone = r.phone, updated_at = now()
        from public.agents a
       where a.id = v_agent and pr.id = a.profile_id and pr.phone is null and r.phone is not null;
      get diagnostics v_n = row_count; v_phone_backfilled := v_phone_backfilled + v_n;
      if r.al_user_id is not null then
        update public.agents a set al_user_id = r.al_user_id, updated_at = now()
         where a.id = v_agent and a.al_user_id is null
           and not exists (select 1 from public.agents o where o.al_user_id = r.al_user_id and o.canonical_agent_id is null and coalesce(o.is_deactivated, false) = false);
        get diagnostics v_n = row_count; v_al_backfilled := v_al_backfilled + v_n;
      end if;
      v_linked := v_linked + 1;
      v_linked_by := jsonb_set(v_linked_by, array[v_match], to_jsonb(coalesce((v_linked_by ->> v_match)::int, 0) + 1));
      continue;
    end if;

    -- No record anywhere: a contracted producer with no seat here. Without an NPN there is nothing to key the
    -- record on, so the person stays on the call sheet only and is named in the result.
    v_name := nullif(regexp_replace(initcap(lower(btrim(coalesce(r.full_name, '')))), '\s+', ' ', 'g'), '');
    if r.npn_digits = '' or v_name is null then
      v_skipped_names := v_skipped_names || coalesce(r.full_name, r.id::text);
      continue;
    end if;
    v_code := 'ETHOS_' || r.npn_digits;
    if exists (select 1 from public.agents where agent_code = v_code) then
      v_code := v_code || '_' || left(replace(r.id::text, '-', ''), 6);
    end if;
    -- Manager: the nearest AgentLink upline with a live record here, else the owner. A terminated upline (KJ) is
    -- never written as anyone's manager.
    v_manager := null;
    select a.id into v_manager
      from public.agents a
     where a.id = coalesce(public.fn_canonical_agent_id(r.sub_agency_agent_id), r.sub_agency_agent_id)
       and a.status = 'active' and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
       and a.canonical_agent_id is null;
    v_manager := coalesce(v_manager, SAM_AGENT_ID);

    insert into public.agents (
      display_name, agent_code, nipr_number, license_status, status, is_inactive, is_deactivated, onboarding_stage,
      manager_id, al_user_id, origin, account_mode, start_date, notes, metadata)
    values (
      v_name, v_code, r.npn_digits, 'licensed', 'active',
      true,   -- hidden at insert on purpose: every hire trigger (Discord/Slack/email hire events, course + call mail) gates on is_inactive; this is not a hire
      false, 'live',
      v_manager,
      case when r.al_user_id is not null
            and not exists (select 1 from public.agents o where o.al_user_id = r.al_user_id and o.canonical_agent_id is null and coalesce(o.is_deactivated, false) = false)
           then r.al_user_id end,
      'import', 'agent', r.first_seen_on,
      'Created from the Ethos hierarchy export (snapshot ' || coalesce(r.snapshot_on::text, 'unknown') || ') by ethos_callsheet_ensure_agents. No login; contact details are on the call sheet.',
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'ethos_hierarchy', 'origin', 'import', 'ethos_person_id', r.id,
        'comp_level', r.comp_level, 'sub_agency', r.sub_agency, 'snapshot_on', r.snapshot_on,
        'created_by', 'ethos_callsheet_ensure_agents')))
    returning id into v_agent;

    -- Park every onboarding-mail kind as never due. The ungated insert trigger has already queued course+discord;
    -- the rows stay, with target_send_at = infinity and the reason in meta, so the sender (target_send_at <= now()),
    -- the backfill sweep and any later trigger's ON CONFLICT DO NOTHING can never arm them. Nothing is deleted and
    -- nothing is marked sent.
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, meta)
    select v_agent, k, 'infinity'::timestamptz,
           jsonb_build_object('parked', 'ethos_hierarchy_import', 'why', 'contracted producer imported from the Ethos hierarchy, not a hire', 'parked_at', now())
      from unnest(MAIL_KINDS) k
    on conflict (agent_id, email_kind) do update
      set target_send_at = 'infinity'::timestamptz,
          meta = coalesce(public.agent_onboarding_queue.meta, '{}'::jsonb)
                 || jsonb_build_object('parked', 'ethos_hierarchy_import', 'why', 'contracted producer imported from the Ethos hierarchy, not a hire', 'parked_at', now())
      where public.agent_onboarding_queue.sent_at is null;
    get diagnostics v_n = row_count; v_mail_parked := v_mail_parked + v_n;

    -- A hire broadcast or hire event for this row means a gate above has changed: stop and roll back the whole run.
    if exists (select 1 from public.telegram_scheduled_messages t where t.dedupe_key = 'wins_new_hire_' || v_agent::text and t.sent_at is null)
       or exists (select 1 from public.outbox_events o where o.aggregate_type = 'agent' and o.aggregate_id = v_agent and o.event_type = 'agent.hired' and o.processed_at is null) then
      raise exception 'ethos_callsheet_ensure_agents: a hire broadcast was queued for % (%); the is_inactive gate on the hire triggers has changed, refusing to continue', v_name, v_agent;
    end if;

    -- Training stage: in the field, not online training (the default for a new hire).
    -- (agent_stage_source_check allows staff | default | mapped; the dry run caught 'ethos_hierarchy' failing it.)
    update public.agent_stage s set stage = 'released_in_field', source = 'mapped', set_at = now()
     where s.agent_id = v_agent and s.stage is distinct from 'released_in_field';
    if found then
      insert into public.agent_stage_events (agent_id, from_stage, to_stage, source)
      values (v_agent, 'online_training', 'released_in_field', 'mapped');
    end if;

    -- Now visible on the roster.
    update public.agents set is_inactive = false, updated_at = now() where id = v_agent;
    update public.ethos_callsheet_people set agent_id = v_agent, agent_match = 'ethos_hierarchy_created', updated_at = now() where id = r.id;
    v_created := v_created + 1;
    v_created_names := v_created_names || v_name;
  end loop;

  -- One-time: un-hide Ethos holders who were hidden but never let go (status active, not deactivated, not banned,
  -- no open suspension, not excluded). Not run by the hourly sync, so a later Hide from roster holds.
  if p_unhide then
    with cand as (
      select distinct a.id, a.display_name
        from public.ethos_callsheet_people p
        join public.agents a on a.id = p.agent_id
       where p.on_ethos and p.in_latest_snapshot
         and coalesce(a.is_inactive, false)
         and a.status = 'active'
         and coalesce(a.is_deactivated, false) = false
         and a.canonical_agent_id is null
         and not public.fn_agent_is_roster_excluded(a.id)
         and not exists (select 1 from auth.users u where u.id = a.user_id and u.banned_until is not null and u.banned_until > now())
         and not exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null)
    ), done as (
      update public.agents a set is_inactive = false, updated_at = now()
        from cand where a.id = cand.id
      returning cand.display_name
    )
    select coalesce(array_agg(display_name), '{}') into v_unhidden_names from done;
  end if;

  return jsonb_build_object(
    'ok', true,
    'linked', v_linked, 'linked_by', v_linked_by,
    'created', v_created, 'created_names', to_jsonb(v_created_names),
    'skipped_no_npn', to_jsonb(v_skipped_names),
    'onboarding_mail_rows_parked', v_mail_parked,
    'nipr_backfilled', v_nipr_backfilled, 'profile_phone_backfilled', v_phone_backfilled, 'al_user_id_backfilled', v_al_backfilled,
    'unhidden', to_jsonb(v_unhidden_names),
    'ethos_people', (select count(*) from public.ethos_callsheet_people where on_ethos and in_latest_snapshot),
    'ethos_people_without_record', (select count(*) from public.ethos_callsheet_people where on_ethos and in_latest_snapshot and agent_id is null));
end;
$function$;
revoke all on function public.ethos_callsheet_ensure_agents(boolean) from public, anon, authenticated;
