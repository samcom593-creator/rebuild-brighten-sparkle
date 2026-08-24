-- APEX one-link contracting intake.
--
-- Sam's requirement: /dashboard/contracting leads with one Start Contracting
-- action, and the intake asks for exactly five things — first name, last name,
-- email, phone, NPN. Nothing else. No PA number, no SSN, no DOB, no banking,
-- no password, no medical data, no document upload. Anything beyond those five
-- is a liability we do not need to hold to get a producer contracted.
--
-- Design notes that are load-bearing:
--
-- 1. RETRY MECHANICS ARE NOT DUPLICATED. public.outbox_events already owns
--    attempts, available_at, locked_at and last_error_redacted, and
--    public.delivery_attempts already owns per-attempt provider ids. Copying
--    those into a second table would create two sources of truth that drift,
--    which is the same defect class as the dashboard week-over-week number that
--    read one source for the current week and another for the baseline.
--    contracting_intake_deliveries holds only what the outbox does NOT: the
--    settled per-destination verdict and the real provider receipt.
--
-- 2. ENQUEUE IS NOT DELIVERY. Every destination starts at 'queued'. Only the
--    dispatcher, holding an actual provider response, may move a row to
--    'delivered', and it must write a receipt when it does. There is a CHECK
--    constraint enforcing that, so a future writer cannot report a delivery it
--    cannot evidence. This is the 465-fake-success rule expressed in DDL.
--
-- 3. 'not_configured' IS A FIRST-CLASS VERDICT, distinct from both success and
--    failure. The contracting Google Sheet has no service credential on this
--    project, so it says not_configured until that credential is installed. It must never
--    render as green, and they must never render as a failure that pages anyone.
--
-- 4. The intake row is created and both destinations are enqueued inside ONE
--    transaction by submit_contracting_intake(). A retry reuses the intake and
--    cannot enqueue a second set, because outbox_events.idempotency_key is
--    unique and derived from the intake id plus the destination.

-- ── Normalization ────────────────────────────────────────────────────────────
-- Deliberately IMMUTABLE and side-effect free so they can be used in generated
-- columns, indexes and tests, and so the edge function and the database cannot
-- disagree about what "normalized" means.

create or replace function public.fn_normalize_contracting_email(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_raw, ''))), '');
$$;

comment on function public.fn_normalize_contracting_email(text) is
  'Lowercase + trim. Returns null for blank so NOT NULL rejects it at the column.';

create or replace function public.fn_normalize_contracting_npn(p_raw text)
returns text
language sql
immutable
as $$
  -- NPNs are numeric. Strip everything else so "NPN 21346366", "21-346-366"
  -- and " 21346366 " all dedupe against the same producer instead of creating
  -- three rows for one person.
  select nullif(regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g'), '');
$$;

comment on function public.fn_normalize_contracting_npn(text) is
  'Digits only. Length is validated separately so the reason for rejection is specific.';

create or replace function public.fn_normalize_contracting_phone(p_raw text)
returns text
language sql
immutable
as $$
  -- E.164, North America only, because that is the only numbering plan this
  -- agency writes in. An unrecognised shape returns null rather than a guess:
  -- a wrong phone number on a contracting record costs a producer their start.
  with digits as (
    select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d
  )
  select case
    when length(d) = 10 and substring(d, 1, 1) between '2' and '9' then '+1' || d
    when length(d) = 11 and substring(d, 1, 1) = '1'
         and substring(d, 2, 1) between '2' and '9' then '+' || d
    else null
  end
  from digits;
$$;

comment on function public.fn_normalize_contracting_phone(text) is
  'NANP to E.164 (+1XXXXXXXXXX). Returns null on anything it cannot recognise; never guesses.';

-- ── Intake ───────────────────────────────────────────────────────────────────

create table if not exists public.contracting_intakes (
  id uuid primary key default gen_random_uuid(),

  -- The five fields. Stored already-normalized; the RPC is the only writer and
  -- it normalizes before insert, so a raw value cannot reach the table.
  first_name text not null check (btrim(first_name) <> '' and length(first_name) <= 100),
  last_name  text not null check (btrim(last_name)  <> '' and length(last_name)  <= 100),
  email      text not null check (email = lower(email) and email like '%_@_%.__%' and length(email) <= 254),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  npn        text not null check (npn ~ '^[0-9]{5,10}$'),

  status text not null default 'accepted'
    check (status in ('accepted', 'needs_review', 'completed')),

  -- Why a human has to look at it, when status = 'needs_review'. Null otherwise.
  review_reason text,

  idempotency_key text not null unique,
  source text not null default 'apex_contracting_page',
  submitted_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contracting_intakes is
  'APEX one-link contracting intake. Exactly five producer fields; this table is the source of truth and the spreadsheet is a downstream mirror.';

-- NPN is the producer's identity for contracting purposes. One row per NPN, so
-- a double-submit or a browser retry reuses the intake rather than creating a
-- second applicant downstream in Ethos.
create unique index if not exists contracting_intakes_npn_key
  on public.contracting_intakes (npn);

-- Email is a SECONDARY collision detector, not an identity. Two producers can
-- legitimately share a household email, so this is a non-unique lookup index and
-- a same-email-different-NPN submission goes to review rather than overwriting.
create index if not exists contracting_intakes_email_idx
  on public.contracting_intakes (email);

create index if not exists contracting_intakes_status_idx
  on public.contracting_intakes (status, created_at desc);

-- ── Per-destination delivery verdicts ────────────────────────────────────────

create table if not exists public.contracting_intake_deliveries (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.contracting_intakes(id) on delete cascade,

  destination text not null check (destination in (
    'contracting_discord',   -- APEX Discord Contracts / Contracting Support
    'ethos_sheet'            -- contracting spreadsheet upsert
  )),

  state text not null default 'queued' check (state in (
    'queued',          -- enqueued, nothing attempted
    'attempting',      -- write-ahead marker: a non-idempotent provider call is in flight
    'unknown_outcome', -- the provider may have acted; we could not record it. Never auto-retried.
    'accepted',        -- a provider took custody and gave us an id. NOT delivered.
    'delivered',       -- the thing actually exists at the destination
    'failed',          -- attempted, failed, will retry
    'dead_letter',     -- retries exhausted
    'manual_review',   -- a collision a machine must not resolve
    'not_configured'   -- no credential/destination exists; honestly unavailable
  )),

  -- ACCEPTED IS NOT DELIVERED. Resend returning 2xx with a message id means
  -- Resend has custody of the email — not that it reached a mailbox, and
  -- certainly not that anyone read it. Bounces, suppressions and silent drops
  -- all happen after that 2xx. Collapsing the two is how a support queue comes
  -- to believe it contacted people it never reached, so the states stay
  -- separate and only a real delivery signal may set 'delivered'.
  --
  -- Discord and Google Sheets are different: a 200 from a webhook means the
  -- message exists in the channel, and a read-back-verified range means the row
  -- exists in the sheet. Those legs can honestly claim 'delivered'.
  --
  -- 'attempting' and 'unknown_outcome' exist because a provider call and the
  -- database write that records it are two separate operations, and the gap
  -- between them is real. A Discord webhook has no idempotency key, so if the
  -- POST succeeds and the settlement write then fails, an automatic retry posts
  -- the producer's details into the channel a SECOND time. 'attempting' is
  -- written BEFORE the call; a later run that finds it knows the outcome is
  -- genuinely unknown and hands the row to a person instead of guessing.

  -- The real provider receipt: Resend message id, Discord HTTP status + webhook
  -- message id, Google Sheets updatedRange, or the export artifact reference.
  -- Redacted of PII and never containing a credential.
  receipt jsonb,

  accepted_at timestamptz,
  delivered_at timestamptz,
  last_error_redacted text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per destination per intake. A retry updates this row; it can never
  -- append a second delivery record for the same destination.
  unique (intake_id, destination),

  -- Enqueue alone may not report delivery. If state is 'delivered' there must be
  -- a receipt and a timestamp. A writer that cannot evidence the send cannot
  -- claim it happened.
  constraint contracting_delivery_receipt_required check (
    (state <> 'delivered' or (receipt is not null and delivered_at is not null))
    and (state <> 'accepted' or (receipt is not null and accepted_at is not null))
  )
);

comment on table public.contracting_intake_deliveries is
  'Settled per-destination verdict + real provider receipt. Retry mechanics live in outbox_events; this table does not duplicate them.';

comment on constraint contracting_delivery_receipt_required on public.contracting_intake_deliveries is
  'Delivery requires evidence. Blocks the fake-success class in DDL rather than in review.';

create index if not exists contracting_intake_deliveries_state_idx
  on public.contracting_intake_deliveries (state, destination);

-- ── updated_at ───────────────────────────────────────────────────────────────

create or replace function public.fn_touch_contracting_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contracting_intakes_touch on public.contracting_intakes;
create trigger trg_contracting_intakes_touch
  before update on public.contracting_intakes
  for each row execute function public.fn_touch_contracting_updated_at();

drop trigger if exists trg_contracting_deliveries_touch on public.contracting_intake_deliveries;
create trigger trg_contracting_deliveries_touch
  before update on public.contracting_intake_deliveries
  for each row execute function public.fn_touch_contracting_updated_at();

-- ── RLS: least privilege ─────────────────────────────────────────────────────
-- No public role may read or write these tables directly. The public submission
-- path is the submit-contracting-intake edge function, which holds the service
-- key and calls submit_contracting_intake(). Staff get read-only visibility.
-- Nobody but the service role may write a delivery verdict.

alter table public.contracting_intakes enable row level security;
alter table public.contracting_intake_deliveries enable row level security;

drop policy if exists contracting_intakes_staff_read on public.contracting_intakes;
create policy contracting_intakes_staff_read
  on public.contracting_intakes
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or public.has_role(auth.uid(), 'manager'::app_role)
  );

drop policy if exists contracting_deliveries_staff_read on public.contracting_intake_deliveries;
create policy contracting_deliveries_staff_read
  on public.contracting_intake_deliveries
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or public.has_role(auth.uid(), 'manager'::app_role)
  );

-- No INSERT/UPDATE/DELETE policy is defined for any role. With RLS enabled and
-- no permissive write policy, every non-service write is refused. This is
-- intentional and is the whole access-control story for the write path.

revoke all on public.contracting_intakes from anon, authenticated;
revoke all on public.contracting_intake_deliveries from anon, authenticated;
grant select on public.contracting_intakes to authenticated;
grant select on public.contracting_intake_deliveries to authenticated;

-- ── Submission ───────────────────────────────────────────────────────────────

create or replace function public.submit_contracting_intake(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_npn        text,
  p_source     text default 'apex_contracting_page',
  p_submitted_by uuid default null
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
  v_intake public.contracting_intakes%rowtype;
  v_existing_by_email uuid;
  v_replay boolean := false;
  v_review_reason text := null;
  v_dest text;
  v_destinations constant text[] := array['ethos_sheet', 'contracting_discord'];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email := public.fn_normalize_contracting_email(p_email);
  v_phone := public.fn_normalize_contracting_phone(p_phone);
  v_npn   := public.fn_normalize_contracting_npn(p_npn);

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
  if v_npn is null or v_npn !~ '^[0-9]{5,10}$' then
    return jsonb_build_object('ok', false, 'error', 'npn_invalid', 'field', 'npn');
  end if;

  -- Serialize every submission for this NPN before reading. Without this, two
  -- first-time submissions of the same NPN both see no row, both INSERT, and one
  -- dies on contracting_intakes_npn_key — so a producer who double-taps Submit
  -- on a slow phone connection gets an error on the request that was about to
  -- succeed. The lock is transaction-scoped and released at commit or rollback,
  -- and because READ COMMITTED takes a fresh snapshot per statement, the waiter
  -- sees the winner's committed row when it proceeds.
  perform pg_advisory_xact_lock(hashtext('contracting_intake:' || v_npn));

  -- Identity is the NPN. A replay returns the SAME intake id, so the caller can
  -- retry a dropped connection without producing a second producer downstream.
  select * into v_intake from public.contracting_intakes where npn = v_npn;

  if found then
    v_replay := true;

    -- A replay may carry a corrected email. That is legitimate, but it is NOT
    -- automatically safe: the new address may already belong to a DIFFERENT
    -- producer's intake, and silently taking it would let one submission
    -- redirect another producer's contracting correspondence. Re-run the
    -- collision check on every replay, not only on first insert.
    if v_email is distinct from v_intake.email then
      select id into v_existing_by_email
        from public.contracting_intakes
       where email = v_email
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
    -- Preserving only the email would still let the same request move the phone
    -- number and the name — the identical redirect, one field over. The whole
    -- contact block is held at its last trusted values until a person
    -- adjudicates; the review row records that a change was attempted.
    update public.contracting_intakes
       set first_name = case when v_review_reason is not null then v_intake.first_name else v_first end,
           last_name  = case when v_review_reason is not null then v_intake.last_name  else v_last  end,
           email      = case when v_review_reason is not null then v_intake.email      else v_email end,
           phone_e164 = case when v_review_reason is not null then v_intake.phone_e164 else v_phone end,
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
    -- Same email under a DIFFERENT NPN. Could be a household address, could be
    -- one producer mistyping their NPN. A machine must not decide which, so the
    -- intake is accepted and flagged; Ethos is held at manual_review so we
    -- cannot overwrite somebody else's row on a guess.
    select id into v_existing_by_email
      from public.contracting_intakes
     where email = v_email
     limit 1;
    if v_existing_by_email is not null then
      v_review_reason := 'email_matches_a_different_npn';
    end if;

    begin
      insert into public.contracting_intakes (
        first_name, last_name, email, phone_e164, npn,
        status, review_reason, idempotency_key, source, submitted_by
      ) values (
        v_first, v_last, v_email, v_phone, v_npn,
        case when v_review_reason is null then 'accepted' else 'needs_review' end,
        v_review_reason,
        'contracting-intake-' || v_npn,
        coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'apex_contracting_page'),
        p_submitted_by
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

  -- Enqueue exactly one job per destination, in this same transaction. Both
  -- inserts are ON CONFLICT DO NOTHING against unique keys, so a replay adds
  -- nothing: the delivery row already exists and the outbox idempotency key is
  -- already taken. That is what makes a retry safe rather than duplicative.
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
    'replay', v_replay
  );
end;
$$;

comment on function public.submit_contracting_intake(text, text, text, text, text, text, uuid) is
  'Service-role only. Normalizes, validates, dedupes on NPN, and enqueues exactly one job per destination in one transaction. Idempotent: a replay returns the same intake id and enqueues nothing new.';

revoke all on function public.submit_contracting_intake(text, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ── Status projection for the UI ─────────────────────────────────────────────
-- Joins the intake to its two verdicts and to the outbox retry state, so the
-- page shows one honest row per destination without the front end having to
-- know the outbox exists. Carries no credential and no raw provider payload.

create or replace view public.v_contracting_intake_status
with (security_invoker = true) as
select
  i.id                as intake_id,
  i.first_name,
  i.last_name,
  i.email,
  i.phone_e164,
  i.npn,
  i.status,
  i.review_reason,
  i.created_at,
  d.destination,
  d.state,
  d.receipt,
  d.accepted_at,
  d.delivered_at,
  d.last_error_redacted,
  o.attempts,
  o.available_at      as next_retry_at,
  o.status            as outbox_status
from public.contracting_intakes i
join public.contracting_intake_deliveries d on d.intake_id = i.id
left join public.outbox_events o
  on o.aggregate_type = 'contracting_intake'
 and o.aggregate_id = i.id
 and o.destination = d.destination;

comment on view public.v_contracting_intake_status is
  'One row per intake per destination. security_invoker, so the staff-read RLS policy on the base tables governs it.';

grant select on public.v_contracting_intake_status to authenticated;

-- Ethos Agents sheet. The sheet id and the fixed APEX configuration values are
-- not secrets and are recorded here so the dispatcher does not hardcode them.
-- Comp Level, Life Licensed and E&O are deliberately absent: none of them can be
-- derived from a five-field intake, and a guessed comp level or a false "YES" on
-- E&O is worse than a blank a human fills in from authoritative evidence.
insert into public.system_settings (key, value)
select 'ethos_agents_sheet', (jsonb_build_object(
  'sheet_id', '1R5ZEjfDai0dFp1z8xbfpaFGbOAEiXzPc0F1KxnWPSMY',
  'tab', 'Agents',
  'direct_upline_npn', '21346366',
  'advance_pay_tier', '6 Month Advance',
  'sub_agency_name', 'Apex Financial Empire',
  'comment_prefix', 'Apex Financial Empire / Level 8 Financial'
))::text
where not exists (select 1 from public.system_settings where key = 'ethos_agents_sheet');
