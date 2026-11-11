-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 1 of 10: foundation.
--
-- WHAT
--   1. Settings this package reads (insert-only; a value someone already set is never overwritten):
--        dialer_status                    'canceled_nonpayment'  (ReadyMode was canceled for non-payment 2026-11-10)
--        onboarding_starter_pack_enabled  'false'                (the daily starter-pack job is OFF until the integrator flips it)
--        hire_lane_email_enabled          'true'                 (emergency brake for this package's email outbox)
--        pkg2_contracting_request_cutoff  <apply time>           (forward-only anchor for the contracting request at licensed hire)
--   2. fn_agent_is_suspended(agent) / fn_user_is_suspended(user): one reading of the standing rule
--      "nobody with an open agent_access_suspensions row receives anything". Service role only.
--   3. hire_lane_email_outbox + enqueue / dispatch / settle / tick: the one path this package uses to email a person.
--      Rows go out through the existing send-email edge function (=> _shared/email.ts sendEmail: Resend suppression,
--      non-routable guard, unsubscribe footer), Reply-To info@kingofsales.net (the only mailbox that exists; the
--      apex-financial.org From mailboxes return 550). A row is 'sent' ONLY when send-email answered ok with a
--      provider id (read back from net._http_response by the settle step); a queued request is never a receipt.
--      * No unsubscribe_token is passed: sendEmail then builds the Unsubscribe link from the recipient's own address,
--        which is the only value supabase/functions/unsubscribe can record (it ignores anything without an '@').
--      * A failed row is retried ONLY when send-email's reply proves nothing reached Resend (401/403/429, Resend's
--        rate-limit error, no Resend key). A timeout, a 5xx or no reply is ambiguous (Resend may have accepted it and
--        there is no idempotency key), so it stays failed and doctor #55 reports it: never the same email twice.
--      * Every settled send also lands in email_delivery_log under template 'hire-lane-<kind>', keys registered in
--        recruit_touch_kinds first, so v_recruit_touches / doctor #53 see this package's mail.
--
-- WHY
--   The decisions (business-ops/2026-11-11-onboarding-anchor/decisions/DECISIONS.md) need three automatic emails:
--   the starter-pack notice to a ready licensed hire (N8), the contracting request to the contracting owner at
--   licensed hire (N7), and email pages + a daily digest to a non-Sam recruit owner whose in-app inbox was last read
--   11-02 (N5). The database has no service key in vault, so SQL cannot call send-email except through the
--   system_settings.service_role_key that run_automation_job already uses. One outbox with one dedupe key per
--   (person, purpose) keeps "one touch per person per purpose" a constraint instead of a convention.
--
-- SAFETY
--   * Every producer is forward-only or capped; this table starts empty and nothing here enqueues anything.
--   * dispatch re-checks suspension and email_unsubscribes immediately before sending, and refuses everything while
--     hire_lane_email_enabled <> 'true'.
--   * dispatch / tick default to p_dry_run = true; only the cron passes false.
--   * At most 5 requests per 5-minute tick (Resend's 10/second limit lost 4 ladder emails on 11-11).

-- ---------------------------------------------------------------------------
-- 1. Settings (insert-only)
-- ---------------------------------------------------------------------------
insert into public.system_settings (key, value) values
  ('dialer_status', 'canceled_nonpayment'),
  ('onboarding_starter_pack_enabled', 'false'),
  ('hire_lane_email_enabled', 'true'),
  ('pkg2_contracting_request_cutoff', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Suspension readers
-- ---------------------------------------------------------------------------
create or replace function public.fn_user_is_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user_id is not null
     and exists (select 1 from public.agent_access_suspensions s
                  where s.user_id = p_user_id and s.lifted_at is null)
$$;

comment on function public.fn_user_is_suspended(uuid) is
  'PKG2: true when this login has an open agent_access_suspensions row (lifted_at is null). Service role only.';

create or replace function public.fn_agent_is_suspended(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Suspensions are keyed by LOGIN. A person can hold two agent rows (two logins) that share one canonical
  -- row; a suspension on either login suspends the person.
  select exists (
    select 1
      from public.agents t
      join public.agents g
        on coalesce(nullif(g.canonical_agent_id, g.id), g.id) = coalesce(nullif(t.canonical_agent_id, t.id), t.id)
      join public.agent_access_suspensions s on s.user_id = g.user_id and s.lifted_at is null
     where t.id = p_agent_id)
$$;

comment on function public.fn_agent_is_suspended(uuid) is
  'PKG2: true when any login of this person (same canonical agent) has an open agent_access_suspensions row. Service role only.';

-- A login that auth has banned or deleted receives nothing either (revocation keys on the LOGIN). Kept separate from
-- the suspension readers above so lists and the doctor grade exactly the agent_access_suspensions rule.
create or replace function public.fn_user_login_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user_id is not null
     and exists (select 1 from auth.users u
                  where u.id = p_user_id
                    and ((u.banned_until is not null and u.banned_until > now()) or u.deleted_at is not null))
$$;

comment on function public.fn_user_login_blocked(uuid) is
  'PKG2: true when auth has banned (banned_until in the future) or deleted this login. Senders skip it. Service role only.';

revoke all on function public.fn_user_is_suspended(uuid) from public, anon, authenticated;
revoke all on function public.fn_agent_is_suspended(uuid) from public, anon, authenticated;
revoke all on function public.fn_user_login_blocked(uuid) from public, anon, authenticated;
grant execute on function public.fn_user_is_suspended(uuid) to service_role;
grant execute on function public.fn_agent_is_suspended(uuid) to service_role;
grant execute on function public.fn_user_login_blocked(uuid) to service_role;

-- Names in these emails come from application forms: escape them before they go into HTML.
create or replace function public.fn_pkg2_html_escape(p_text text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select replace(replace(replace(replace(replace(coalesce(p_text, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

revoke all on function public.fn_pkg2_html_escape(text) from public, anon, authenticated;
grant execute on function public.fn_pkg2_html_escape(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Email outbox
-- ---------------------------------------------------------------------------
create table if not exists public.hire_lane_email_outbox (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  dedupe_key        text not null,
  recipient_user_id uuid,
  agent_id          uuid references public.agents(id) on delete set null,
  to_email          text not null,
  subject           text not null,
  body_text         text not null,
  body_html         text not null,
  magic_destination text,
  magic_token_id    uuid,
  status            text not null default 'queued',
  retryable         boolean not null default false,
  attempts          integer not null default 0,
  req_id            bigint,
  requested_at      timestamptz,
  settled_at        timestamptz,
  http_status       integer,
  provider_id       text,
  error             text,
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint hire_lane_email_outbox_kind_check
    check (kind in ('starter_pack', 'contracting_request', 'recruit_page', 'recruit_digest')),
  constraint hire_lane_email_outbox_status_check
    check (status in ('queued', 'requested', 'sent', 'failed', 'refused', 'skipped')),
  constraint hire_lane_email_outbox_dedupe_key unique (dedupe_key)
);

-- idempotent re-apply over an earlier shape of this table
alter table public.hire_lane_email_outbox add column if not exists retryable boolean not null default false;

create index if not exists hire_lane_email_outbox_status_idx on public.hire_lane_email_outbox (status, created_at);
create index if not exists hire_lane_email_outbox_recipient_idx on public.hire_lane_email_outbox (kind, recipient_user_id, created_at desc);
create index if not exists hire_lane_email_outbox_agent_idx on public.hire_lane_email_outbox (agent_id, kind);

comment on table public.hire_lane_email_outbox is
  'PKG2 (MP-ONBOARD-ANCHOR): every email this package sends, one row per (person, purpose) via dedupe_key. status=sent only on a provider id read back from send-email''s response. Service role only.';

alter table public.hire_lane_email_outbox enable row level security;
revoke all on table public.hire_lane_email_outbox from public, anon, authenticated;
grant all on table public.hire_lane_email_outbox to service_role;

-- Register this package's email_delivery_log keys BEFORE anything can send (lanes/_touch_read_model_usage.md): a send
-- from an unregistered key turns doctor #53 yellow. Data only; an existing registration is never changed.
insert into public.recruit_touch_kinds (source, key_pattern, kind, note) values
  ('email_delivery_log', 'hire-lane-starter_pack', 'operational',
   'MP-ONBOARD-ANCHOR-PKG2: "your first leads are in My Leads", one per ready licensed hire ever (hire_lane_email_outbox).'),
  ('email_delivery_log', 'hire-lane-contracting_request', 'staff',
   'MP-ONBOARD-ANCHOR-PKG2: contracting request at licensed hire, to the contracting owner (hire_lane_email_outbox).'),
  ('email_delivery_log', 'hire-lane-recruit_page', 'staff',
   'MP-ONBOARD-ANCHOR-PKG2: recruit SLA page by email to an active non-Sam recruit owner (hire_lane_email_outbox).'),
  ('email_delivery_log', 'hire-lane-recruit_digest', 'staff',
   'MP-ONBOARD-ANCHOR-PKG2: daily recruit-queue digest email to an active non-Sam recruit owner (hire_lane_email_outbox).')
on conflict (source, key_pattern) do nothing;

-- Enqueue. Returns the row id (also for a row recorded as 'skipped'), or null when the dedupe key was already
-- used (one touch per person per purpose). Gates checked HERE and again at dispatch: suspension, opt-out.
-- Sends nothing and mints nothing: a one-tap login token is minted at dispatch, for a row that is really going.
create or replace function public.fn_hire_lane_email_enqueue(
  p_kind text,
  p_dedupe_key text,
  p_recipient_user_id uuid,
  p_agent_id uuid,
  p_subject text,
  p_body_text text,
  p_body_html text,
  p_to_email text default null,
  p_magic_destination text default null,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_status text := 'queued';
  v_error text;
  v_id uuid;
begin
  if p_dedupe_key is null or btrim(p_dedupe_key) = '' then
    raise exception 'dedupe key required' using errcode = '22023';
  end if;
  if p_magic_destination is not null and p_magic_destination not in ('leads', 'portal', 'numbers') then
    raise exception 'unknown login destination %', p_magic_destination using errcode = '22023';
  end if;
  if exists (select 1 from public.hire_lane_email_outbox o where o.dedupe_key = p_dedupe_key) then
    return null;
  end if;

  v_email := lower(btrim(coalesce(nullif(btrim(p_to_email), ''),
                                  (select u.email from auth.users u where u.id = p_recipient_user_id))));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_status := 'skipped'; v_error := 'no_email_on_file';
  elsif public.fn_user_is_suspended(p_recipient_user_id)
        or (p_agent_id is not null and public.fn_agent_is_suspended(p_agent_id)) then
    v_status := 'skipped'; v_error := 'suspended';
  elsif public.fn_user_login_blocked(p_recipient_user_id)
        or (p_agent_id is not null and public.fn_user_login_blocked((select g.user_id from public.agents g where g.id = p_agent_id))) then
    v_status := 'skipped'; v_error := 'login_banned';
  elsif exists (select 1 from public.email_unsubscribes e where lower(btrim(e.email)) = v_email) then
    v_status := 'skipped'; v_error := 'unsubscribed';
  end if;

  insert into public.hire_lane_email_outbox
    (kind, dedupe_key, recipient_user_id, agent_id, to_email, subject, body_text, body_html, magic_destination,
     status, error, settled_at, meta)
  values
    (p_kind, p_dedupe_key, p_recipient_user_id, p_agent_id, coalesce(v_email, '(none)'), p_subject, p_body_text,
     p_body_html, p_magic_destination, v_status, v_error, case when v_status = 'skipped' then now() end,
     coalesce(p_meta, '{}'::jsonb))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_hire_lane_email_enqueue(text, text, uuid, uuid, text, text, text, text, text, jsonb) is
  'PKG2: queue one email (one row per dedupe key, ever). {{login_link}} in the body becomes a 72h one-tap login (minted at dispatch) when p_magic_destination is set. Suspended / unsubscribed / no-email rows are recorded as skipped. Sends nothing. Service role only.';

-- Dispatch: hand queued rows to send-email. p_dry_run defaults to TRUE (lists what would go, sends nothing).
create or replace function public.fn_hire_lane_email_dispatch(p_limit integer default 5, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_enabled boolean := coalesce(lower(btrim((select s.value from public.system_settings s
                                              where s.key = 'hire_lane_email_enabled'))) = 'true', false);
  v_key text := (select nullif(btrim(s.value), '') from public.system_settings s where s.key = 'service_role_key');
  v_base text := coalesce(nullif(btrim((select s.value from public.system_settings s where s.key = 'supabase_url')), ''),
                          'https://xrzweoneiieddzxogewk.supabase.co');
  r record;
  v_req bigint;
  v_token text;
  v_token_id uuid;
  v_link text;
  v_requested int := 0;
  v_skipped int := 0;
  v_plan jsonb := '[]'::jsonb;
begin
  if not v_enabled then
    return jsonb_build_object('skipped', 'hire_lane_email_enabled is not true', 'at', now());
  end if;
  if v_key is null and not p_dry_run then
    return jsonb_build_object('error', 'no service_role_key in system_settings', 'at', now());
  end if;

  for r in
    select o.*
      from public.hire_lane_email_outbox o
     where o.status = 'queued'
        -- only a failure settle PROVED unsent (retryable); an ambiguous one is never sent a second time
        or (o.status = 'failed' and o.retryable and o.attempts < 3 and o.requested_at < now() - interval '30 minutes')
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  loop
    -- Re-check the gates at send time: a suspension, a ban or an opt-out after enqueue wins.
    if public.fn_user_is_suspended(r.recipient_user_id)
       or (r.agent_id is not null and public.fn_agent_is_suspended(r.agent_id))
       or public.fn_user_login_blocked(r.recipient_user_id)
       or (r.agent_id is not null and public.fn_user_login_blocked((select g.user_id from public.agents g where g.id = r.agent_id))) then
      if not p_dry_run then
        update public.hire_lane_email_outbox set status = 'skipped', error = 'suspended_or_banned', settled_at = now() where id = r.id;
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if exists (select 1 from public.email_unsubscribes e where lower(btrim(e.email)) = lower(btrim(r.to_email))) then
      if not p_dry_run then
        update public.hire_lane_email_outbox set status = 'skipped', error = 'unsubscribed', settled_at = now() where id = r.id;
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_dry_run then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'agent_id', r.agent_id, 'recipient_user_id', r.recipient_user_id,
        'subject', r.subject, 'login_destination', r.magic_destination, 'attempt', r.attempts + 1));
      continue;
    end if;

    -- One-tap login link, minted now (not at enqueue) so a token exists only for a message really being sent:
    -- same 64-hex shape and table cron-newhire-portal-login uses, resolved by verify-magic-link and routed by
    -- MagicLogin.tsx (destination 'leads' -> /dashboard/my-leads). Settle stamps its send_status from the reply.
    v_token_id := null;
    v_link := case r.magic_destination
                when 'leads' then 'https://apex-financial.org/dashboard/my-leads'
                when 'numbers' then 'https://apex-financial.org/numbers'
                else 'https://apex-financial.org/agent-portal' end;
    if r.magic_destination is not null and r.agent_id is not null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      insert into public.magic_login_tokens (agent_id, email, token, destination, expires_at, send_status)
      values (r.agent_id, lower(btrim(r.to_email)), v_token, r.magic_destination, now() + interval '72 hours', 'pending')
      returning id into v_token_id;
      v_link := 'https://apex-financial.org/magic-login?token=' || v_token;
    end if;

    v_req := net.http_post(
      url := v_base || '/functions/v1/send-email',
      body := jsonb_build_object(
        'to', r.to_email,
        'subject', r.subject,
        'html', replace(r.body_html, '{{login_link}}', v_link),
        'text', replace(r.body_text, '{{login_link}}', v_link),
        'reply_to', 'info@kingofsales.net',
        -- no unsubscribe_token: sendEmail builds the link from the recipient address, the only thing the
        -- unsubscribe endpoint can record (a user id was silently dropped while the page said "unsubscribed")
        'tagName', 'hire-lane-' || r.kind),
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key,
                                    'apikey', v_key),
      timeout_milliseconds := 30000);
    update public.hire_lane_email_outbox
       set status = 'requested', req_id = v_req, requested_at = now(), attempts = attempts + 1,
           magic_token_id = coalesce(v_token_id, magic_token_id),
           settled_at = null, http_status = null, error = null, retryable = false
     where id = r.id;
    v_requested := v_requested + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'requested', v_requested, 'skipped', v_skipped,
                            'would_send', case when p_dry_run then v_plan end, 'at', now());
end;
$$;

comment on function public.fn_hire_lane_email_dispatch(integer, boolean) is
  'PKG2: hands up to p_limit queued rows to send-email (status requested + pg_net request id). p_dry_run defaults to TRUE. A requested row is NOT a send; settle reads the provider reply. Service role only.';

-- Settle: read send-email's reply. sent = ok + provider id; refused = send-email refused (suppressed / non-routable);
-- failed = anything else; no reply in 6h = failed. A failed row is marked retryable ONLY when the reply proves
-- nothing reached Resend; dispatch retries those (3 attempts) and never the ambiguous ones.
create or replace function public.fn_hire_lane_email_settle()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  r record;
  v_code integer;
  v_content text;
  v_err text;
  v_body jsonb;
  v_status text;
  v_retry boolean;
  v_error text;
  v_sent int := 0;
  v_failed int := 0;
  v_retryable int := 0;
  v_refused int := 0;
  v_expired int := 0;
begin
  for r in
    select o.id, o.req_id, o.requested_at, o.magic_token_id, o.kind, o.to_email, o.agent_id, o.subject, o.attempts
      from public.hire_lane_email_outbox o
     where o.status = 'requested' and o.req_id is not null and o.settled_at is null
     for update skip locked
  loop
    select h.status_code, h.content, h.error_msg into v_code, v_content, v_err
      from net._http_response h where h.id = r.req_id;
    if not found then
      if r.requested_at >= now() - interval '6 hours' then
        continue;
      end if;
      -- no reply at all: ambiguous (the request may have run), so never retried
      v_code := null;
      v_body := null;
      v_status := 'failed';
      v_retry := false;
      v_error := 'no response from send-email within 6h';
      v_expired := v_expired + 1;
    else
      v_body := null;
      begin
        v_body := v_content::jsonb;
      exception when others then
        v_body := null;
      end;

      v_retry := false;
      if v_code = 200 and coalesce(v_body ->> 'ok', '') = 'true' and nullif(v_body ->> 'id', '') is not null then
        v_status := 'sent';
        v_sent := v_sent + 1;
      elsif nullif(v_body ->> 'refused', '') is not null then
        v_status := 'refused';
        v_refused := v_refused + 1;
      else
        v_status := 'failed';
        v_failed := v_failed + 1;
        -- Proven unsent: send-email refused the caller before reading the body (401/403), the request was
        -- rate-limited before it ran (429) or Resend itself refused it for rate (its error text), or send-email had
        -- no Resend key. A timeout, any other 5xx, a crash or an unreadable reply is ambiguous: Resend may already
        -- have accepted the email and there is no idempotency key, so it is not retried.
        v_retry := coalesce(v_code, 0) in (401, 403, 429)
                   or coalesce(v_body ->> 'error', '') ~* '(rate[ _-]?limit|too many requests|RESEND_API_KEY missing)';
        if v_retry then v_retryable := v_retryable + 1; end if;
      end if;
      v_error := case when v_status = 'sent' then null
                      else left(coalesce(v_body ->> 'error', v_err, 'HTTP ' || coalesce(v_code::text, '?')), 300) end;
    end if;

    update public.hire_lane_email_outbox
       set status = v_status,
           settled_at = now(),
           http_status = v_code,
           provider_id = case when v_status = 'sent' then v_body ->> 'id' end,
           retryable = v_retry,
           error = case when v_status = 'failed' and not v_retry then left('not retried (may have been accepted): ' || v_error, 300)
                        else v_error end
     where id = r.id;

    if r.magic_token_id is not null then
      update public.magic_login_tokens
         set send_status = case v_status when 'sent' then 'sent' when 'refused' then 'refused' else 'failed' end,
             send_message_id = case when v_status = 'sent' then v_body ->> 'id' end,
             sent_at = case when v_status = 'sent' then now() end
       where id = r.magic_token_id;
    end if;

    -- One receipt per attempt in email_delivery_log (the touch model's ledger; keys registered above). The hire is
    -- the person only on the starter-pack email; the other kinds go to staff. A ledger failure never blocks settling.
    begin
      insert into public.email_delivery_log
        (template, recipient_email, agent_id, subject, provider, provider_message_id, status, error, retries,
         related_record_id, related_record_type, sent_at)
      values
        ('hire-lane-' || r.kind, r.to_email, case when r.kind = 'starter_pack' then r.agent_id end, r.subject, 'resend',
         case when v_status = 'sent' then v_body ->> 'id' end, v_status, v_error, greatest(coalesce(r.attempts, 1) - 1, 0),
         r.id, 'hire_lane_email_outbox', case when v_status = 'sent' then now() end);
    exception when others then
      raise warning 'fn_hire_lane_email_settle: email_delivery_log write failed for outbox row %: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'failed_retryable', v_retryable, 'refused', v_refused,
                            'expired', v_expired, 'at', now());
end;
$$;

comment on function public.fn_hire_lane_email_settle() is
  'PKG2: settles requested outbox rows from net._http_response (sent only with a provider id; failed rows retryable only when provably unsent) and writes one email_delivery_log receipt per attempt (template hire-lane-<kind>). Service role only.';

create or replace function public.fn_hire_lane_email_tick(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return jsonb_build_object(
    'settle', case when p_dry_run then null else public.fn_hire_lane_email_settle() end,
    'dispatch', public.fn_hire_lane_email_dispatch(5, p_dry_run));
end;
$$;

comment on function public.fn_hire_lane_email_tick(boolean) is
  'PKG2: cron entry point (every 5 minutes, called with false): settle replies, then dispatch up to 5 queued rows. Defaults to dry run.';

revoke all on function public.fn_hire_lane_email_enqueue(text, text, uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_hire_lane_email_dispatch(integer, boolean) from public, anon, authenticated;
revoke all on function public.fn_hire_lane_email_settle() from public, anon, authenticated;
revoke all on function public.fn_hire_lane_email_tick(boolean) from public, anon, authenticated;
grant execute on function public.fn_hire_lane_email_enqueue(text, text, uuid, uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.fn_hire_lane_email_dispatch(integer, boolean) to service_role;
grant execute on function public.fn_hire_lane_email_settle() to service_role;
grant execute on function public.fn_hire_lane_email_tick(boolean) to service_role;

select cron.schedule('apex-hire-lane-email', '*/5 * * * *', 'select public.fn_hire_lane_email_tick(false)');
