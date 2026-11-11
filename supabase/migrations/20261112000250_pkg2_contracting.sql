-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 6 of 11: contracting.
--
-- WHAT
--   (a) contracted_at, decision N7: an EMPTY contracting_required_carriers means "any one appointment".
--       * fn_derive_agent_contracted_at (trigger on contract_review_marks INSERT): empty list -> the first mark stamps
--         agents.contracted_at; a non-empty list keeps the all-required rule.
--       * NEW fn_stamp_contracted_at_from_deal + triggers on deals (insert, draft->posted) and production_external_deals
--         (insert): the first deal stamps contracted_at (a written deal proves an appointment).
--       * Both are forward-only (they fire on new rows) and never overwrite a value.
--       * NEW fn_backfill_contracted_at(p_dry_run default true): ONE-TIME data backfill for people who already have a
--         mark or a deal = least(first mark, first deal). Data only: while it runs, the next-step recompute trigger
--         and the Discord activation trigger on agents are disabled inside the same transaction, so no stage moves
--         and nothing posts; it refuses to run live unless Discord is paused.
--   (b) The contracting request at licensed hire (none since 10-09).
--       * NEW fn_contracting_request_open(agent, dry_run): records a contracting_intakes row (source
--         'licensed_hire', NO delivery legs: the retired channel/sheet/Slack triggers stay disabled) and queues one
--         email + one in-app notice to the contracting owner (system_settings.contracting_owner_agent_id = Aisha;
--         falls back to Sam when unset or suspended). First names only; link to the contracting review.
--       * NEW fn_contracting_request_sweep(p_dry_run default true) + cron apex-contracting-request-sweep (every 15
--         minutes, live): forward-only from system_settings.pkg2_contracting_request_cutoff (set at apply time).
--       * NEW fn_contracting_request_backfill(p_dry_run default true, p_since default 2026-10-09): the licensed hires
--         since 10-09 who never got one (Jeremiah, Darin, Jonathan, Nevin, Keyel). Live mode records their intakes and
--         sends the owner ONE list, not one page each.
--
-- WHY
--   timeline_forensics D16: commit 53af140a (2026-10-09, PL-CONTRACTING-PORTAL-TRACKER-B) stopped add-agent,
--   consume-invite-token and Quick Edit from queueing a contracting intake when it retired the private channel,
--   sheet and Slack legs. The legs were meant to go; the request to a human went with them, so since 10-09 no
--   licensed hire produced a contracting request. shipped_vs_live 6.4: the derivation returned early on an empty
--   carrier list, so contracted_at was set on 0 active agents although 14 of 39 licensed hires had a deal.

-- ---------------------------------------------------------------------------
-- (a1) Marks: empty required list = any one appointment
-- ---------------------------------------------------------------------------
create or replace function public.fn_derive_agent_contracted_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_required text[]; v_version integer; v_at timestamptz;
begin
  v_required := public.fn_contracting_required_carriers();
  select c.version into v_version from public.contract_review_config c where c.singleton;
  if new.version <> v_version then return null; end if;

  if cardinality(v_required) = 0 then
    -- N7 (2026-11-11): no required list means ANY one carrier appointment counts. Forward-only: the first mark
    -- stamps the time; never rewritten, never cleared.
    update public.agents set contracted_at = new.confirmed_at
     where id = new.agent_id and contracted_at is null;
    return null;
  end if;

  if exists (
    select 1 from unnest(v_required) r(k)
    where not (r.k = 'ahl' and public.fn_agent_ahl_exempt(new.agent_id))
      and not exists (select 1 from public.contract_review_marks m where m.agent_id = new.agent_id and m.version = v_version and m.carrier_key = r.k)
  ) then
    return null;
  end if;
  select max(m.confirmed_at) into v_at from public.contract_review_marks m
   where m.agent_id = new.agent_id and m.version = v_version and m.carrier_key = any(v_required);
  -- Forward-only: the first time the required set completes. Never rewritten, never cleared.
  update public.agents set contracted_at = v_at where id = new.agent_id and contracted_at is null;
  return null;
exception when others then
  raise warning 'fn_derive_agent_contracted_at soft-failed for %: %', new.agent_id, sqlerrm;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- (a2) First deal stamps contracted_at
-- ---------------------------------------------------------------------------
create or replace function public.fn_stamp_contracted_at_from_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_agent uuid; v_at timestamptz;
begin
  if new.agent_id is null then return null; end if;
  select coalesce(nullif(a.canonical_agent_id, a.id), a.id) into v_agent from public.agents a where a.id = new.agent_id;
  if v_agent is null then return null; end if;
  if tg_table_name = 'deals' then
    -- deals.posted_at is the canonical deal date
    v_at := coalesce((to_jsonb(new) ->> 'posted_at')::timestamptz, (to_jsonb(new) ->> 'created_at')::timestamptz, now());
  else
    -- production_external_deals: when the deal happened, else the day it posted, else when we learned of it
    v_at := coalesce((to_jsonb(new) ->> 'occurred_at')::timestamptz, (to_jsonb(new) ->> 'posted_date')::date::timestamptz,
                     (to_jsonb(new) ->> 'created_at')::timestamptz, now());
  end if;
  -- junk deal dates exist (one production row reads 1906-01-03); an implausible date stamps the time we learned of it
  if v_at < '2015-01-01'::timestamptz or v_at > now() + interval '1 day' then
    v_at := now();
  end if;
  -- A written deal proves at least one carrier appointment (N7). Forward-only; never overwrites.
  update public.agents set contracted_at = v_at where id = v_agent and contracted_at is null;
  return null;
exception when others then
  -- never block a deal write over a derived timestamp
  raise warning 'fn_stamp_contracted_at_from_deal soft-failed for %: %', new.agent_id, sqlerrm;
  return null;
end;
$$;

comment on function public.fn_stamp_contracted_at_from_deal() is
  'PKG2 (N7): the first deal on any agent row stamps the person''s agents.contracted_at when it is still null. Forward-only, never overwrites, never blocks the deal write.';

revoke all on function public.fn_stamp_contracted_at_from_deal() from public, anon, authenticated;

drop trigger if exists trg_pkg2_contracted_from_deal on public.deals;
create trigger trg_pkg2_contracted_from_deal
  after insert on public.deals
  for each row when (new.status is distinct from 'draft')
  execute function public.fn_stamp_contracted_at_from_deal();

drop trigger if exists trg_pkg2_contracted_from_deal_native_post on public.deals;
create trigger trg_pkg2_contracted_from_deal_native_post
  after update of status on public.deals
  for each row when (old.status = 'draft' and new.status is distinct from 'draft')
  execute function public.fn_stamp_contracted_at_from_deal();

drop trigger if exists trg_pkg2_contracted_from_external_deal on public.production_external_deals;
create trigger trg_pkg2_contracted_from_external_deal
  after insert on public.production_external_deals
  for each row execute function public.fn_stamp_contracted_at_from_deal();

-- ---------------------------------------------------------------------------
-- (a3) One-time backfill (dry run by default; data only)
-- ---------------------------------------------------------------------------
create or replace view public.v_contracted_at_backfill_due with (security_barrier = true) as
select a.id as agent_id,
       coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'Unnamed') as first_name,
       a.status::text as agent_status,
       mk.first_mark as first_mark_at,
       fd.first_deal_at,
       least(mk.first_mark, fd.first_deal_at) as stamp_at
  from public.agents a
  left join (select m.agent_id, min(m.confirmed_at) as first_mark
               from public.contract_review_marks m
              where m.version = (select c.version from public.contract_review_config c where c.singleton)
              group by m.agent_id) mk on mk.agent_id = a.id
  left join public.v_agent_first_deal_any_source fd on fd.agent_id = a.id
 where a.contracted_at is null
   and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
   and (mk.first_mark is not null or fd.first_deal_at is not null)
   -- a few production rows carry junk effective dates (one reads 1906-01-03); never stamp an implausible date
   and least(mk.first_mark, fd.first_deal_at) >= '2015-01-01'::timestamptz;

revoke all on public.v_contracted_at_backfill_due from public, anon, authenticated;
grant select on public.v_contracted_at_backfill_due to service_role;

comment on view public.v_contracted_at_backfill_due is
  'PKG2 (N7): canonical agents with a carrier mark or a deal and no contracted_at. Empty after fn_backfill_contracted_at(false); the forward triggers keep it empty. Service role only.';

create or replace function public.fn_backfill_contracted_at(p_dry_run boolean default true)
returns table(agent_id uuid, first_name text, agent_status text, first_mark_at timestamptz, first_deal_at timestamptz, stamp_at timestamptz, decision text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_dry_run then
    return query
      select d.agent_id, d.first_name, d.agent_status, d.first_mark_at, d.first_deal_at, d.stamp_at, 'would_stamp'::text
        from public.v_contracted_at_backfill_due d
       order by d.stamp_at;
    return;
  end if;

  if not public.fn_discord_paused() then
    raise exception 'refusing the live backfill while Discord posting is on: a contracted_at change triggers the agent-activated post'
      using errcode = '55000';
  end if;
  -- Data only: no next-step stage recompute (contracted_at feeds stage_entered_at, which times ladder nudges) and
  -- no activation post. Both triggers come back on before this function returns, in the same transaction.
  alter table public.agents disable trigger trg_next_step_agents_update;
  alter table public.agents disable trigger trg_agent_activated_discord;
  return query
    with upd as (
      update public.agents a
         set contracted_at = d.stamp_at
        from public.v_contracted_at_backfill_due d
       where a.id = d.agent_id and a.contracted_at is null
      returning d.agent_id, d.first_name, d.agent_status, d.first_mark_at, d.first_deal_at, d.stamp_at
    )
    select u.agent_id, u.first_name, u.agent_status, u.first_mark_at, u.first_deal_at, u.stamp_at, 'stamped'::text
      from upd u
     order by u.stamp_at;
  alter table public.agents enable trigger trg_next_step_agents_update;
  alter table public.agents enable trigger trg_agent_activated_discord;
end;
$$;

comment on function public.fn_backfill_contracted_at(boolean) is
  'PKG2 (N7): one-time backfill of agents.contracted_at = least(first carrier mark, first deal) for canonical agents that have either. Data only (next-step recompute and the Discord activation trigger are off for the update). p_dry_run defaults to TRUE. Service role only.';

revoke all on function public.fn_backfill_contracted_at(boolean) from public, anon, authenticated;
grant execute on function public.fn_backfill_contracted_at(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- (b1) Contracting request at licensed hire
-- ---------------------------------------------------------------------------
create or replace function public.fn_contracting_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  -- The contracting owner (an AGENT id in system_settings, set to Aisha on 11-11), as a login; Sam when unset,
  -- unresolvable, or suspended.
  select coalesce(
    (select a.user_id
       from public.agents a
      where a.id = (select case when btrim(s.value) ~ '^[0-9a-f-]{36}$' then btrim(s.value)::uuid end
                      from public.system_settings s where s.key = 'contracting_owner_agent_id')
        and a.user_id is not null
        and not public.fn_user_is_suspended(a.user_id)
        and not public.fn_user_login_blocked(a.user_id)),
    public.fn_recruit_sam_user_id())
$$;

revoke all on function public.fn_contracting_owner_user_id() from public, anon, authenticated;
grant execute on function public.fn_contracting_owner_user_id() to service_role;

-- What a contracting intake for this hire would hold, and why it cannot be written when it cannot.
create or replace function public.fn_contracting_intake_draft(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with a as (
    select g.id, g.license_states, g.nipr_number, g.display_name,
           pr.full_name, pr.email as profile_email, pr.phone,
           (select u.email from auth.users u where u.id = g.user_id) as auth_email
      from public.agents g
      left join public.profiles pr on pr.id = g.profile_id
     where g.id = p_agent_id
  ), n as (
    select a.*,
           btrim(coalesce(case when coalesce(a.full_name, '') !~ '@' then nullif(btrim(a.full_name), '') end, a.display_name, '')) as nm
      from a
  ), f as (
    select n.*,
           nullif(split_part(n.nm, ' ', 1), '') as first_name,
           nullif(btrim(regexp_replace(n.nm, '^\S+\s*', '')), '') as last_name,
           public.fn_normalize_contracting_email(coalesce(n.profile_email, n.auth_email)) as email,
           public.fn_normalize_contracting_phone(n.phone) as phone_e164,
           public.fn_normalize_contracting_npn(n.nipr_number) as npn
      from n
  )
  select jsonb_build_object(
    'first_name', left(f.first_name, 100),
    'last_name', left(f.last_name, 100),
    -- contracting_intakes_email_check: lower-case, LIKE '%_@_%.__%', at most 254 characters
    'email', case when f.email like '%_@_%.__%' and length(f.email) <= 254 then f.email end,
    'phone_e164', f.phone_e164,
    'npn', case when f.npn ~ '^[0-9]{5,10}$' then f.npn end,
    'license_states', to_jsonb(f.license_states),
    'missing', to_jsonb(array_remove(array[
        case when f.first_name is null then 'first name' end,
        case when f.last_name is null then 'last name' end,
        case when f.email is null or f.email not like '%_@_%.__%' or length(f.email) > 254 then 'email' end,
        case when f.phone_e164 is null then 'phone' end,
        case when f.npn is null or f.npn !~ '^[0-9]{5,10}$' then 'NPN' end], null)))
    from f
$$;

revoke all on function public.fn_contracting_intake_draft(uuid) from public, anon, authenticated;
grant execute on function public.fn_contracting_intake_draft(uuid) to service_role;

-- Record the intake (no delivery legs) and page the owner once. p_dry_run defaults to TRUE.
create or replace function public.fn_contracting_request_open(p_agent_id uuid, p_dry_run boolean default true, p_page_owner boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_d jsonb := public.fn_contracting_intake_draft(p_agent_id);
  v_first text;
  v_missing text[];
  v_npn text;
  v_intake uuid;
  v_intake_state text;
  v_owner uuid;
  v_states text;
  v_subject text;
  v_text text;
  v_html text;
  v_outbox uuid;
  v_hired date;
  c_link constant text := 'https://apex-financial.org/dashboard/team?view=contracting';
begin
  if v_d is null then
    return jsonb_build_object('agent_id', p_agent_id, 'decision', 'skip', 'reason', 'agent not found');
  end if;
  if public.fn_agent_is_suspended(p_agent_id) then
    return jsonb_build_object('agent_id', p_agent_id, 'decision', 'skip', 'reason', 'suspended');
  end if;
  v_first := coalesce(v_d ->> 'first_name', 'A new hire');
  v_npn := v_d ->> 'npn';
  select coalesce(array_agg(x), '{}'::text[]) into v_missing from jsonb_array_elements_text(v_d -> 'missing') x;
  select (g.created_at at time zone 'America/Phoenix')::date into v_hired from public.agents g where g.id = p_agent_id;

  select i.id into v_intake from public.contracting_intakes i where i.agent_id = p_agent_id order by i.created_at limit 1;
  if v_intake is not null then
    v_intake_state := 'existing_intake';
  elsif v_d ->> 'first_name' is null or v_d ->> 'last_name' is null or v_d ->> 'email' is null or v_d ->> 'phone_e164' is null then
    -- name, email and an E.164 phone are NOT NULL + CHECKed on contracting_intakes: nothing is written, the owner
    -- page below says what is missing
    v_intake_state := 'cannot_record: missing ' || array_to_string(v_missing, ', ');
  elsif v_npn is not null and exists (select 1 from public.contracting_intakes i where i.npn = v_npn) then
    v_intake_state := 'npn_already_on_an_intake';
    if not p_dry_run then
      update public.contracting_intakes set agent_id = p_agent_id where npn = v_npn and agent_id is null returning id into v_intake;
    end if;
  elsif v_npn is null and exists (select 1 from public.contracting_intakes i where i.email = (v_d ->> 'email') and i.npn is null) then
    v_intake_state := 'email_already_on_an_intake';
    if not p_dry_run then
      update public.contracting_intakes set agent_id = p_agent_id
       where email = (v_d ->> 'email') and npn is null and agent_id is null returning id into v_intake;
    end if;
  else
    v_intake_state := case when v_npn is null then 'record_needs_review_npn_missing' else 'record' end;
    if not p_dry_run then
      begin
        insert into public.contracting_intakes
          (first_name, last_name, email, phone_e164, npn, status, review_reason, idempotency_key, source, submitted_by,
           agent_id, license_status, license_states)
        values
          (v_d ->> 'first_name', v_d ->> 'last_name', v_d ->> 'email', v_d ->> 'phone_e164', v_npn,
           case when v_npn is null then 'needs_review' else 'accepted' end,
           case when v_npn is null then 'licensed_hire_npn_missing' end,
           'contracting-intake-hire-' || p_agent_id::text, 'licensed_hire', null,
           p_agent_id,
           -- contracting_intakes_licensed_requires_npn forbids 'licensed' without an NPN; say exactly what is known
           case when v_npn is null then 'licensed_npn_missing' else 'licensed' end,
           (select array(select jsonb_array_elements_text(coalesce(v_d -> 'license_states', '[]'::jsonb)))))
        on conflict (idempotency_key) do nothing
        returning id into v_intake;
        if v_intake is not null then
          -- the enrich trigger can re-point agent_id at another row sharing the email; this hire owns this intake
          update public.contracting_intakes set agent_id = p_agent_id where id = v_intake and agent_id is distinct from p_agent_id;
        end if;
      exception when unique_violation or check_violation then
        v_intake_state := 'cannot_record: ' || left(sqlerrm, 120);
        v_intake := null;
      end;
    end if;
  end if;

  if p_page_owner and not p_dry_run then
    v_owner := public.fn_contracting_owner_user_id();
    v_states := coalesce(nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(v_d -> 'license_states', '[]'::jsonb))), ', '), ''), 'states not on file');
    v_subject := 'Contracting: ' || v_first || ' joined licensed';
    v_text := v_first || ' joined the team as a licensed agent on ' || to_char(v_hired, 'Mon DD') || ' (' || v_states || '). '
           || 'Their carrier contracting has not started'
           || case when cardinality(v_missing) > 0 then ', and their ' || array_to_string(v_missing, ', ') || ' is not on file' else '' end
           || '.' || E'\n\n' || 'Open the contracting review: ' || c_link;
    v_html := '<p>' || public.fn_pkg2_html_escape(v_first) || ' joined the team as a licensed agent on ' || to_char(v_hired, 'Mon DD')
           || ' (' || public.fn_pkg2_html_escape(v_states) || '). '
           || 'Their carrier contracting has not started'
           || case when cardinality(v_missing) > 0 then ', and their ' || array_to_string(v_missing, ', ') || ' is not on file' else '' end
           || '.</p><p><a href="' || c_link || '">Open the contracting review</a></p>';
    v_outbox := public.fn_hire_lane_email_enqueue('contracting_request', 'contracting_request:' || p_agent_id::text,
                  v_owner, null, v_subject, v_text, v_html, null, null,
                  jsonb_build_object('agent_id', p_agent_id, 'intake_id', v_intake, 'intake_state', v_intake_state));
    if v_outbox is not null then
      perform public.fn_emit_inbox_notification(v_owner, 'contracting_request', v_subject,
                v_first || ' joined licensed. Start their carrier contracting.', '/dashboard/team?view=contracting', 'high',
                jsonb_build_object('agent_id', p_agent_id, 'intake_id', v_intake));
    end if;
  end if;

  return jsonb_build_object('agent_id', p_agent_id, 'first_name', v_first,
                            'decision', case when p_dry_run then 'would_open' else 'opened' end,
                            'intake', v_intake_state, 'intake_id', v_intake,
                            'missing', to_jsonb(v_missing), 'owner_emailed', v_outbox is not null);
end;
$$;

comment on function public.fn_contracting_request_open(uuid, boolean, boolean) is
  'PKG2 (N7): contracting request for one licensed hire: a contracting_intakes row (source licensed_hire, no delivery legs) plus one email + inbox notice to the contracting owner (dedupe contracting_request:<agent>). p_dry_run defaults to TRUE. Service role only.';

revoke all on function public.fn_contracting_request_open(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fn_contracting_request_open(uuid, boolean, boolean) to service_role;

-- Licensed hires the request is owed to. p_from/p_to bound the hire (or licensing) time.
create or replace function public.fn_contracting_request_due(p_from timestamptz, p_to timestamptz default 'infinity')
returns table(agent_id uuid, first_name text, hired_at timestamptz, licensed_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id,
         coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'Unnamed'),
         a.created_at,
         a.licensed_at
    from public.agents a
   where a.status::text = 'active'
     and coalesce(a.is_deactivated, false) = false
     and coalesce(a.is_inactive, false) = false
     and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
     and a.user_id is not null
     and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
     and not public.is_placeholder_agent(a.agent_code, a.user_id)
     and not public.fn_agent_is_roster_excluded(a.id)
     and (a.license_status::text = 'licensed' or public.fn_license_stage_rank(a.license_progress) >= 8)
     and greatest(a.created_at, coalesce(a.licensed_at, a.created_at)) >= p_from
     and greatest(a.created_at, coalesce(a.licensed_at, a.created_at)) < p_to
     and not public.fn_agent_is_suspended(a.id)
     and not public.fn_user_login_blocked(a.user_id)
     and not exists (select 1 from public.contracting_intakes i where i.agent_id = a.id)
   order by a.created_at
$$;

revoke all on function public.fn_contracting_request_due(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_contracting_request_due(timestamptz, timestamptz) to service_role;

create or replace function public.fn_contracting_request_cutoff()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Missing or garbled reads as 'infinity': the sweep acts on nobody.
  select coalesce((select case when btrim(value) ~ '^\d{4}-\d{2}-\d{2}' then btrim(value)::timestamptz end
                     from public.system_settings where key = 'pkg2_contracting_request_cutoff'),
                  'infinity'::timestamptz)
$$;

revoke all on function public.fn_contracting_request_cutoff() from public, anon, authenticated;
grant execute on function public.fn_contracting_request_cutoff() to service_role;

-- Forward-only sweep (cron every 15 minutes, live). p_dry_run defaults to TRUE.
create or replace function public.fn_contracting_request_sweep(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
begin
  -- Each due hire is retried every run until an intake exists (data fixed later is picked up); the owner email and
  -- the in-app notice go once per hire ever (dedupe key contracting_request:<agent>).
  for r in
    select d.agent_id from public.fn_contracting_request_due(public.fn_contracting_request_cutoff()) d
     limit 20
  loop
    v_out := v_out || jsonb_build_array(public.fn_contracting_request_open(r.agent_id, p_dry_run, true));
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'cutoff', public.fn_contracting_request_cutoff(), 'opened', v_out, 'at', now());
end;
$$;

comment on function public.fn_contracting_request_sweep(boolean) is
  'PKG2 (N7): opens the contracting request for licensed hires (or newly licensed agents) since pkg2_contracting_request_cutoff. Forward-only, 20 per run, one owner email per hire ever. p_dry_run defaults to TRUE.';

revoke all on function public.fn_contracting_request_sweep(boolean) from public, anon, authenticated;
grant execute on function public.fn_contracting_request_sweep(boolean) to service_role;

-- One-time catch-up for the hires since 10-09 (dry run by default; live = intakes + ONE owner email listing them).
create or replace function public.fn_contracting_request_backfill(p_dry_run boolean default true, p_since timestamptz default '2026-10-09 00:00:00-07')
returns table(agent_id uuid, first_name text, hired_at timestamptz, intake text, missing text, decision text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_res jsonb;
  v_names text[] := '{}';
  v_owner uuid;
  v_text text;
  v_html text;
  c_link constant text := 'https://apex-financial.org/dashboard/team?view=contracting';
begin
  for r in select * from public.fn_contracting_request_due(p_since, public.fn_contracting_request_cutoff()) d loop
    -- the owner gets one list below, not one page per person
    v_res := public.fn_contracting_request_open(r.agent_id, p_dry_run, false);
    agent_id := r.agent_id;
    first_name := r.first_name;
    hired_at := r.hired_at;
    intake := v_res ->> 'intake';
    missing := (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(v_res -> 'missing', '[]'::jsonb)) x);
    decision := case when p_dry_run then 'would_open' else 'opened' end;
    v_names := v_names || r.first_name;
    return next;
  end loop;

  if not p_dry_run and cardinality(v_names) > 0 then
    v_owner := public.fn_contracting_owner_user_id();
    v_text := 'These licensed hires joined since ' || to_char(p_since at time zone 'America/Phoenix', 'Mon DD')
           || ' and never got a contracting request: ' || array_to_string(v_names, ', ') || '.' || E'\n\n'
           || 'Open the contracting review: ' || c_link;
    v_html := '<p>These licensed hires joined since ' || to_char(p_since at time zone 'America/Phoenix', 'Mon DD')
           || ' and never got a contracting request: ' || public.fn_pkg2_html_escape(array_to_string(v_names, ', ')) || '.</p>'
           || '<p><a href="' || c_link || '">Open the contracting review</a></p>';
    perform public.fn_hire_lane_email_enqueue('contracting_request',
              'contracting_request_backfill:' || to_char(p_since, 'YYYY-MM-DD'),
              v_owner, null, 'Contracting: ' || cardinality(v_names) || ' licensed hires waiting since '
                               || to_char(p_since at time zone 'America/Phoenix', 'Mon DD'),
              v_text, v_html, null, null, jsonb_build_object('names', to_jsonb(v_names)));
  end if;
end;
$$;

comment on function public.fn_contracting_request_backfill(boolean, timestamptz) is
  'PKG2 (N7): one-time contracting requests for licensed hires since p_since (default 2026-10-09) and before the forward cutoff. Live mode records intakes and emails the owner ONE list. p_dry_run defaults to TRUE.';

revoke all on function public.fn_contracting_request_backfill(boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_contracting_request_backfill(boolean, timestamptz) to service_role;

select cron.schedule('apex-contracting-request-sweep', '*/15 * * * *', 'select public.fn_contracting_request_sweep(false)');
