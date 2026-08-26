-- Unlicensed agents with no NPN must onboard (Sam, 2026-08-25: "absolute
-- necessity", "currently not doing that").
--
-- MEASURED before writing a line (2026-08-25 20:11 Phoenix, prod):
--
--   (i)   add-agent, licenseStatus=unlicensed, no NPN        -> 200 success:true
--   (ii)  hire link consume-invite-token, unlicensed, no NPN -> 500 lookup_failed
--         function_logs: agent_recheck_failed 42703
--         "column agents.license_progress does not exist"
--         The auth user + profile were ALREADY created when it died, the
--         invite stayed unused, and no agents row exists: an orphan account.
--         Not an unlicensed-only defect — the deployed function selects and
--         inserts agents.license_progress on EVERY hire, licensed or not.
--   (iii) submit_contracting_intake(p_npn => null)           -> npn_invalid
--         insert contracting_intakes(npn null)               -> 23502 not-null
--         submit-contracting-intake edge fn, npn ""          -> 400 npn_invalid
--   (iv)  submit-application, unlicensed, no NPN             -> 200 (already fine)
--   (v)   routing for the add-agent recruit: next_step course_started,
--         getting_started 'licensing', onboarding queue course/discord/whatsapp,
--         v_apex_roster active_no_production. Already routes to the licensing
--         track once the row exists.
--
-- ROOT CAUSE of (ii): 20260826041000_one_link_hire_paths_and_license_progress
-- shipped set_agent_license_progress(), which UPDATEs agents.license_progress,
-- and the matching edge-function code — but never added the column. The
-- migration is recorded in schema_migrations, the RPC exists, and both fail at
-- runtime on a column that is not there. This file adds it.
--
-- ROOT CAUSE of (iii): the contracting intake was designed around one truth,
-- "NPN is the producer's identity". A pre-license recruit has no NPN yet, so
-- the same one link Sam hands every hire could not accept them. Below, an NPN
-- stays REQUIRED for a licensed intake and becomes optional for a pre-license
-- one, whose identity is the email until the NPN arrives; when it does, the
-- SAME intake row is upgraded in place and its deliveries are released.

-- ─── statement boundary (bot-sql applies one statement per call) ───

-- 1. The column the 2026-08-26 041000 migration assumed. Enum already exists
--    (applications.license_progress uses it; 040500 added 'failed_test').
alter table public.agents
  add column if not exists license_progress public.license_progress not null default 'unlicensed';

-- ─── statement boundary ───

comment on column public.agents.license_progress is
  'Licensing milestone for the agent (mirrors applications.license_progress vocabulary). Written by set_agent_license_progress(), add-agent and consume-invite-token. Added 2026-08-26 after 041000 shipped the writer without the column.';

-- ─── statement boundary ───

-- Backfill: a licensed producer is at "licensed". Only rows whose value would
-- change are touched, so updated_at moves only where the fact moved.
update public.agents
   set license_progress = 'licensed'
 where license_status = 'licensed'
   and license_progress is distinct from 'licensed';

-- ─── statement boundary ───

-- Backfill: an unlicensed agent inherits the furthest non-terminal milestone
-- their live application already recorded, so the licensing tracker does not
-- reset people who are mid-course. Never copies 'licensed' onto an unlicensed
-- agent — agents.license_status is the corroborated vocabulary (2026-08-07).
update public.agents a
   set license_progress = src.license_progress
  from (
    select distinct on (lower(btrim(p.email))) lower(btrim(p.email)) as email, app.license_progress
      from public.applications app
      join public.profiles p on lower(btrim(p.email)) = lower(btrim(app.email))
     where app.terminated_at is null
       and app.license_progress is not null
       and app.license_progress not in ('licensed', 'unlicensed')
     order by lower(btrim(p.email)), app.updated_at desc
  ) src
  join public.profiles p2 on lower(btrim(p2.email)) = src.email
 where a.profile_id = p2.id
   and a.license_status <> 'licensed'
   and a.license_progress is distinct from src.license_progress;

-- ─── statement boundary ───

-- 2. contracting_intakes.npn becomes optional. Shape is still enforced when
--    present, and a licensed intake still cannot exist without one.
alter table public.contracting_intakes alter column npn drop not null;

-- ─── statement boundary ───

alter table public.contracting_intakes drop constraint if exists contracting_intakes_npn_check;

-- ─── statement boundary ───

alter table public.contracting_intakes
  add constraint contracting_intakes_npn_check check (npn is null or npn ~ '^[0-9]{5,10}$');

-- ─── statement boundary ───

alter table public.contracting_intakes drop constraint if exists contracting_intakes_licensed_requires_npn;

-- ─── statement boundary ───

alter table public.contracting_intakes
  add constraint contracting_intakes_licensed_requires_npn
  check (npn is not null or coalesce(license_status, '') <> 'licensed');

-- ─── statement boundary ───

comment on constraint contracting_intakes_licensed_requires_npn on public.contracting_intakes is
  'NPN optional only while unlicensed. A row claiming licensed with no NPN is the unprovable self-claim add-agent refuses; the table refuses it too.';

-- ─── statement boundary ───

-- Pre-license identity is the email. One parked intake per address until the
-- NPN arrives; contracting_intakes_npn_key still owns identity after that.
create unique index if not exists contracting_intakes_prelicense_email_key
  on public.contracting_intakes (email) where npn is null;

-- ─── statement boundary ───

-- 3. A parked delivery state. A pre-license intake must stay visible on
--    /dashboard/contracting (v_contracting_intake_status inner-joins deliveries)
--    without claiming anything was queued: no outbox event exists for it, so
--    the dispatcher can never touch it, and it is not 'manual_review' because
--    no human is being asked to do anything.
alter table public.contracting_intake_deliveries drop constraint if exists contracting_intake_deliveries_state_check;

-- ─── statement boundary ───

alter table public.contracting_intake_deliveries
  add constraint contracting_intake_deliveries_state_check check (state = any (array[
    'queued', 'attempting', 'unknown_outcome', 'accepted', 'delivered', 'failed',
    'dead_letter', 'manual_review', 'not_configured',
    'awaiting_license'   -- parked: pre-license intake, no NPN yet; released by the NPN upgrade
  ]));

-- ─── statement boundary ───

-- 4. The enrich trigger (20260825194500 line ~41) keyed its match on the NPN
--    and then OVERWROTE license_status with the matched agent's. Tolerate a
--    null NPN explicitly, and let the RPC's own claim win when it set one:
--    a pre-license intake for an address that already belongs to a licensed
--    agent would otherwise be flipped to 'licensed' with no NPN and die on the
--    new check constraint.
create or replace function public.fn_enrich_contracting_intake()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agent public.agents%rowtype;
  v_npn text := nullif(regexp_replace(coalesce(new.npn, ''), '\D', '', 'g'), '');
begin
  select a.* into v_agent
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where (v_npn is not null
         and regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g') = v_npn)
     or lower(trim(coalesce(p.email, ''))) = lower(trim(new.email))
  order by
    case when v_npn is not null
          and regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g') = v_npn then 0 else 1 end,
    case when a.status = 'active' then 0 else 1 end,
    a.updated_at desc
  limit 1;

  if v_agent.id is not null then
    new.agent_id := v_agent.id;
    new.comp_percentage := v_agent.comp_percentage;
    -- The submitter's own claim wins when present; the agent row fills a gap.
    new.license_status := coalesce(new.license_status, v_agent.license_status::text);
    new.license_states := v_agent.license_states;
    new.eo_certificate_url := v_agent.eo_certificate_url;
    new.eo_policy_number := v_agent.eo_policy_number;
    new.eo_expires_at := v_agent.eo_expires_at;
    new.eo_per_claim_limit := v_agent.eo_per_claim_limit;
    new.eo_aggregate_limit := v_agent.eo_aggregate_limit;
    new.eo_deductible := v_agent.eo_deductible;
    new.eft_ready := v_agent.eft_ready;
    new.contracting_contact_name := v_agent.contracting_contact_name;
  end if;
  return new;
end;
$$;

-- ─── statement boundary ───

-- 5. Slack notice: label a pre-license intake so ops never reads it as a
--    contracting-ready producer, and announce the moment the NPN lands.
--    Payload stays producer-name only (no client PII exists here).
create or replace function public.fn_queue_contracting_slack()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_name text := btrim(concat_ws(' ', new.first_name, new.last_name));
begin
  if tg_op = 'UPDATE' then
    -- Only the pre-license -> licensed upgrade is news. Any other update of
    -- the NPN column (a correction on an already-licensed row) stays quiet.
    if not (old.npn is null and new.npn is not null) then
      return new;
    end if;
    v_key := 'contracting.intake_submitted:' || new.id::text || ':slack:npn-added';
  else
    v_key := 'contracting.intake_submitted:' || new.id::text || ':slack';
  end if;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id
  ) values (
    'contracting_intake',
    new.id,
    'contracting.intake_submitted',
    'slack',
    jsonb_build_object(
      'intakeId', new.id,
      'agentName', case
        when new.npn is null then v_name || ' (pre-license, NPN pending)'
        when tg_op = 'UPDATE' then v_name || ' (NPN added, contracting released)'
        else v_name end,
      'npnLast4', case when new.npn is null then null else right(new.npn, 4) end,
      'licensePath', case when new.npn is null then 'pre_license' else 'licensed' end,
      'openUrl', 'https://apex-financial.org/dashboard/contracting/ops'
    ),
    v_key,
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- Contracting intake is canonical even if its notification cannot queue.
  return new;
end;
$$;

-- ─── statement boundary ───

drop trigger if exists trg_queue_contracting_slack_npn_added on public.contracting_intakes;

-- ─── statement boundary ───

create trigger trg_queue_contracting_slack_npn_added
  after update of npn on public.contracting_intakes
  for each row execute function public.fn_queue_contracting_slack();

-- ─── statement boundary ───

-- 6. The RPC. Same seven parameters plus p_license_status (default 'licensed',
--    so add-agent, consume-invite-token and the deployed edge function keep
--    working unchanged). The old 7-arg signature is dropped rather than
--    overloaded: a named-argument call with seven args would otherwise match
--    both and fail with "function is not unique".
drop function if exists public.submit_contracting_intake(text, text, text, text, text, text, uuid);

-- ─── statement boundary ───

-- Idempotent replay after the first live application / a migration-version
-- repair. PostgreSQL identifies this overload by all eight argument types,
-- defaults included.
drop function if exists public.submit_contracting_intake(text, text, text, text, text, text, uuid, text);

-- ─── statement boundary ───

create function public.submit_contracting_intake(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_npn text,
  p_source text default 'apex_contracting_page',
  p_submitted_by uuid default null,
  p_license_status text default 'licensed'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_phone text;
  v_npn   text;
  v_first text;
  v_last  text;
  v_license text;
  v_intake public.contracting_intakes%rowtype;
  v_prelicense public.contracting_intakes%rowtype;
  v_existing_by_email uuid;
  v_replay boolean := false;
  v_upgraded boolean := false;
  v_review_reason text := null;
  v_dest text;
  v_destinations constant text[] := array[
    'contracting_email', 'contracting_discord', 'contracting_workbook', 'ethos_sheet'
  ];
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'apex_contracting_page');
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email := public.fn_normalize_contracting_email(p_email);
  v_phone := public.fn_normalize_contracting_phone(p_phone);
  v_npn   := public.fn_normalize_contracting_npn(p_npn);
  -- Anything that is not an explicit pre-license claim is treated as licensed,
  -- which keeps every existing caller on the strict path.
  v_license := case
    when lower(btrim(coalesce(p_license_status, ''))) in ('unlicensed', 'pending')
      then lower(btrim(p_license_status))
    else 'licensed'
  end;

  -- Field-specific rejections. A single "invalid input" would make the form
  -- unusable on a phone, which is where most of these are filled in.
  if v_first is null then
    return jsonb_build_object('ok', false, 'error', 'first_name_required', 'field', 'first_name');
  end if;
  if v_last is null then
    return jsonb_build_object('ok', false, 'error', 'last_name_required', 'field', 'last_name');
  end if;
  if v_email is null or v_email not like '%_@_%.__%' then
    return jsonb_build_object('ok', false, 'error', 'email_invalid', 'field', 'email');
  end if;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'phone_invalid', 'field', 'phone');
  end if;
  -- Licensed => NPN required. Pre-license => optional, but if one was typed it
  -- still has to be a real NPN shape; a malformed value is never silently
  -- dropped into "no NPN".
  if v_license = 'licensed' and (v_npn is null or v_npn !~ '^[0-9]{5,10}$') then
    return jsonb_build_object('ok', false, 'error', 'npn_invalid', 'field', 'npn');
  end if;
  if v_npn is not null and v_npn !~ '^[0-9]{5,10}$' then
    return jsonb_build_object('ok', false, 'error', 'npn_invalid', 'field', 'npn');
  end if;

  -- ── Pre-license path: no NPN. Identity is the email until the NPN arrives. ──
  if v_npn is null then
    perform pg_advisory_xact_lock(hashtext('contracting_intake:email:' || v_email));

    -- Prefer a row that already carries an NPN: a pre-license replay must never
    -- downgrade a producer who has since been contracted.
    select * into v_intake
      from public.contracting_intakes
     where email = v_email
     order by (npn is not null) desc, created_at
     limit 1;

    if found then
      v_replay := true;
      if v_intake.npn is null then
        update public.contracting_intakes
           set first_name = v_first,
               last_name  = v_last,
               phone_e164 = v_phone,
               license_status = v_license
         where id = v_intake.id
         returning * into v_intake;
      end if;
      return jsonb_build_object(
        'ok', true,
        'intake_id', v_intake.id,
        'status', v_intake.status,
        'review_reason', v_intake.review_reason,
        'replay', true,
        'upgraded', false,
        'license_status', v_intake.license_status,
        'npn_on_file', v_intake.npn is not null,
        'contracting', case when v_intake.npn is null then 'awaiting_license'
                            when v_intake.status = 'needs_review' then 'needs_review'
                            else 'queued' end
      );
    end if;

    insert into public.contracting_intakes (
      first_name, last_name, email, phone_e164, npn,
      status, review_reason, idempotency_key, source, submitted_by, license_status
    ) values (
      v_first, v_last, v_email, v_phone, null,
      'accepted', null,
      'contracting-intake-prelicense-' || v_email,
      v_source, p_submitted_by, v_license
    )
    returning * into v_intake;

    -- Parked, not queued. No outbox event exists, so nothing can be delivered
    -- and nothing can be reported as delivered. The NPN upgrade below releases
    -- these rows to 'queued' and creates the events.
    foreach v_dest in array v_destinations loop
      insert into public.contracting_intake_deliveries (intake_id, destination, state, last_error_redacted)
      values (
        v_intake.id, v_dest, 'awaiting_license',
        'Parked: no NPN yet. Queues automatically when the producer is licensed and submits their NPN.'
      )
      on conflict (intake_id, destination) do nothing;
    end loop;

    return jsonb_build_object(
      'ok', true,
      'intake_id', v_intake.id,
      'status', v_intake.status,
      'review_reason', null,
      'replay', false,
      'upgraded', false,
      'license_status', v_license,
      'npn_on_file', false,
      'contracting', 'awaiting_license'
    );
  end if;

  -- ── Licensed path: NPN present. Identity is the NPN. ──
  -- Serialize every submission for this NPN before reading. Without this, two
  -- first-time submissions of the same NPN both see no row, both INSERT, and one
  -- dies on contracting_intakes_npn_key — so a producer who double-taps Submit
  -- on a slow phone connection gets an error on the request that was about to
  -- succeed. The lock is transaction-scoped and released at commit or rollback,
  -- and because READ COMMITTED takes a fresh snapshot per statement, the waiter
  -- sees the winner's committed row when it proceeds.
  perform pg_advisory_xact_lock(hashtext('contracting_intake:' || v_npn));

  -- A replay returns the SAME intake id, so the caller can retry a dropped
  -- connection without producing a second producer downstream.
  select * into v_intake from public.contracting_intakes where npn = v_npn;

  if found then
    v_replay := true;

    -- A replay may carry a corrected email. That is legitimate, but it is NOT
    -- automatically safe: the new address may already belong to a DIFFERENT
    -- producer's intake, and silently taking it would let one submission
    -- redirect another producer's contracting correspondence. Re-run the
    -- collision check on every replay, not only on first insert. Only rows
    -- that carry an NPN count: a parked pre-license row is not a producer.
    if v_email is distinct from v_intake.email then
      select id into v_existing_by_email
        from public.contracting_intakes
       where email = v_email
         and npn is not null
         and npn <> v_npn
       limit 1;
      if v_existing_by_email is not null then
        v_review_reason := 'email_matches_a_different_npn';
      end if;
    end if;

    -- When a replay is ambiguous, DISCARD ITS CONTACT FIELDS ENTIRELY.
    --
    -- NPN is the only credential this public endpoint has. Anyone holding a
    -- producer's NPN can submit under it, so a submission we have just judged
    -- suspect must not be allowed to rewrite how that producer is reached.
    -- The whole contact block is held at its last trusted values until a
    -- person adjudicates; the review row records that a change was attempted.
    update public.contracting_intakes
       set first_name = case when v_review_reason is not null then v_intake.first_name else v_first end,
           last_name  = case when v_review_reason is not null then v_intake.last_name  else v_last  end,
           email      = case when v_review_reason is not null then v_intake.email      else v_email end,
           phone_e164 = case when v_review_reason is not null then v_intake.phone_e164 else v_phone end,
           license_status = 'licensed',
           -- A review, once raised, belongs to a human. Never downgrade an
           -- existing needs_review back to accepted on a later submission.
           status = case
             when v_review_reason is not null then 'needs_review'
             else v_intake.status
           end,
           review_reason = coalesce(v_review_reason, v_intake.review_reason)
     where id = v_intake.id
     returning * into v_intake;

    -- If this replay is what made the record ambiguous, pull the Ethos write
    -- back before it can run. Anything already delivered stays delivered —
    -- that is a fact about the past, not a claim about the present — but a
    -- queued or retrying write is stopped and handed to a person.
    if v_review_reason is not null then
      update public.contracting_intake_deliveries
         set state = 'manual_review',
             last_error_redacted = 'Held: the submitted email is already on a different NPN.'
       where intake_id = v_intake.id
         and destination = 'ethos_sheet'
         and state in ('queued', 'failed');

      update public.outbox_events
         set status = 'manual_action_required',
             processed_at = now(),
             locked_at = null,
             last_error_redacted = 'Held: the submitted email is already on a different NPN.'
       where aggregate_type = 'contracting_intake'
         and aggregate_id = v_intake.id
         and destination = 'ethos_sheet'
         and status in ('pending', 'failed');
    end if;
  else
    -- The NPN is new. Is this the licensing moment for a parked pre-license
    -- intake under the same address? Then it is the SAME person: upgrade that
    -- row in place, keep its id and history, and release its deliveries.
    perform pg_advisory_xact_lock(hashtext('contracting_intake:email:' || v_email));

    select * into v_prelicense
      from public.contracting_intakes
     where email = v_email
       and npn is null
     limit 1;

    if found then
      update public.contracting_intakes
         set npn = v_npn,
             first_name = v_first,
             last_name  = v_last,
             phone_e164 = v_phone,
             license_status = 'licensed',
             source = v_source,
             submitted_by = coalesce(p_submitted_by, submitted_by)
       where id = v_prelicense.id
       returning * into v_intake;
      v_upgraded := true;

      update public.contracting_intake_deliveries
         set state = 'queued',
             last_error_redacted = null
       where intake_id = v_intake.id
         and state = 'awaiting_license';
    else
      -- Same email under a DIFFERENT NPN. Could be a household address, could be
      -- one producer mistyping their NPN. A machine must not decide which, so the
      -- intake is accepted and flagged; Ethos is held at manual_review so we
      -- cannot overwrite somebody else's row on a guess.
      select id into v_existing_by_email
        from public.contracting_intakes
       where email = v_email
         and npn is not null
       limit 1;
      if v_existing_by_email is not null then
        v_review_reason := 'email_matches_a_different_npn';
      end if;

      begin
        insert into public.contracting_intakes (
          first_name, last_name, email, phone_e164, npn,
          status, review_reason, idempotency_key, source, submitted_by, license_status
        ) values (
          v_first, v_last, v_email, v_phone, v_npn,
          case when v_review_reason is null then 'accepted' else 'needs_review' end,
          v_review_reason,
          'contracting-intake-' || v_npn,
          v_source, p_submitted_by, 'licensed'
        )
        returning * into v_intake;
      exception when unique_violation then
        -- Belt and braces behind the advisory lock. A caller that reaches this
        -- table by some other path can still race us; losing that race is a
        -- replay, not an error, so resolve to the winner's row rather than
        -- failing a producer's submission.
        select * into v_intake from public.contracting_intakes where npn = v_npn;
        if not found then raise; end if;
        v_replay := true;
      end;
    end if;
  end if;

  -- Enqueue exactly one job per destination, in this same transaction. Both
  -- inserts are ON CONFLICT DO NOTHING against unique keys, so a replay adds
  -- nothing: the delivery row already exists and the outbox idempotency key is
  -- already taken. That is what makes a retry safe rather than duplicative.
  -- On an upgrade the delivery rows already exist (just released to 'queued')
  -- and only the outbox events are new.
  foreach v_dest in array v_destinations loop
    insert into public.contracting_intake_deliveries (intake_id, destination, state)
    values (
      v_intake.id,
      v_dest,
      -- An email collision must not be auto-upserted into the shared Ethos
      -- sheet. It parks at manual_review and no outbox job is created for it.
      case when v_dest = 'ethos_sheet' and v_intake.status = 'needs_review'
           then 'manual_review' else 'queued' end
    )
    on conflict (intake_id, destination) do nothing;

    if not (v_dest = 'ethos_sheet' and v_intake.status = 'needs_review') then
      insert into public.outbox_events (
        aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key
      ) values (
        'contracting_intake',
        v_intake.id,
        'contracting_intake_submitted',
        v_dest,
        jsonb_build_object('intake_id', v_intake.id, 'destination', v_dest),
        'contracting-' || v_intake.id::text || '-' || v_dest
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'intake_id', v_intake.id,
    'status', v_intake.status,
    'review_reason', v_intake.review_reason,
    'replay', v_replay,
    'upgraded', v_upgraded,
    'license_status', 'licensed',
    'npn_on_file', true,
    'contracting', case when v_intake.status = 'needs_review' then 'needs_review' else 'queued' end
  );
end;
$$;

-- ─── statement boundary ───

revoke all on function public.submit_contracting_intake(text, text, text, text, text, text, uuid, text) from public, anon, authenticated;

-- ─── statement boundary ───

grant execute on function public.submit_contracting_intake(text, text, text, text, text, text, uuid, text) to service_role;

-- ─── statement boundary ───

comment on function public.submit_contracting_intake(text, text, text, text, text, text, uuid, text) is
  'One-link contracting intake. Licensed (default): NPN required, identity = NPN, deliveries queued. Pre-license (p_license_status unlicensed/pending): NPN optional, identity = email, deliveries parked at awaiting_license and released in place when the NPN arrives. Service role only.';
