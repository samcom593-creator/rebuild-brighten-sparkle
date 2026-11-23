-- Mirror of a migration the finance lane applied live on 2026-11-21 and recorded as version 20261121140000
-- without a file in this directory. With the version recorded and no file here, `supabase db push` refused
-- every later push that carried migrations ("Remote migration versions not found in local migrations
-- directory": Deploy Supabase failed on d324b682 and c8e9b0fc). Mirrored 2026-11-23 from
-- ~/business-ops/finance-bot/scripts/mp-cfo-native-reconcile-write-path.sql after confirming the live
-- function body is identical to it. Already applied and recorded: db push skips it.

-- MP-CFO-NATIVE-RECONCILE-WRITE-PATH
-- The safe native-only payment write path specified in
-- reports/NATIVE-STATUS-WRITE-PATH-SAFE-REMEDY.md (authored 2026-11-16).
--
-- Root cause it closes: the native book (deals.source='apex_native', 251 rows,
-- $407,646.12 gross-written ALP) has pct_status_progressed = 0.0 — status has
-- NEVER advanced on a single native deal because there is no button to record a
-- confirmed first-payment. Today's ISSUED-NOT-PAID-CONFIRM-PACK funnels producer
-- answers ("yes this client paid / no it lapsed") into a dead end.
--
-- Why transition_apex_deal_status is a LOADED GUN for this cohort (verified live):
--   * all native deals are frozen at deals.status='submitted' v1; its state machine
--     cannot reach a paid state from 'submitted' in one hop;
--   * the approved/issued/in_force hops UNCONDITIONALLY fire outbox_events
--     (discord, skool, insuracloud 'deal.approved') and insert a production_ledger
--     'approved_alp' row with NO source='apex_native' guard — native deals have 0
--     production_ledger rows today, so that path would blast stale Discord
--     celebrations, mis-push months-old imports to InsuraCloud, and double-count
--     224 deals of fresh "qualifying" production.
--
-- Why THIS path is safe (verified against pg_trigger on public.deals 2026-11-21):
--   every SIDE-EFFECT trigger on deals (deal_broadcast, deal_celebration,
--   deal_closed_discord, deals_rollup, culture_loop, next_step, hot_streak,
--   referral_ask, native_discord, queue_deal_slack, bot_alert_big_deal,
--   deal_status_transition, and the *_native_post family) is gated on AFTER
--   UPDATE OF status / OF source / AFTER INSERT. This RPC writes ONLY
--   policy_status_standard + status_updated_at + updated_at + version and leaves
--   deals.status (the state machine) and deals.source untouched, so NONE OF THE
--   SIDE-EFFECT TRIGGERS fire.
--
--   PRECISION (do not read the line above as "no trigger fires at all"): exactly
--   FIVE non-side-effect triggers DO fire on this write, each verified harmless
--   against the live 251-row native book on 2026-11-21:
--     trg_deals_updated_at       BEFORE  sets updated_at (this RPC sets it too -> dup no-op)
--     trg_deals_ensure_posted_at BEFORE  posted_at := ... only IF NULL; 0 native rows null
--     trg_reject_junk_deals      BEFORE  RAISEs only on exact junk literals; 0 native rows match
--     zz_suppress_noop_update    BEFORE  suppresses a true no-op update only
--     trg_truth_dirty            AFTER   flips a cache-dirty flag so the recon view recomputes (desirable)
--   This safety rests on the trigger CONFIG, which changes outside this file. It
--   is frozen + watched daily by scripts/native-reconcile-trigger-guard.py
--   (wired into production-freshness-pulse.sh): if a future migration adds a
--   trigger that fires on this write set, or the SET column list above drifts
--   into a column a side-effect trigger watches, the guard pages CRITICAL before
--   the WIB Mark-Paid UI caller can blast the book. Keep that allowlist in sync
--   with any change to the UPDATE statement below.
--
-- The view v_cfo_native_payment_reconciliation buckets on lower(policy_status_standard),
-- so these writes re-bucket correctly:
--   'active'    -> confirmed_paid     (the only realized-revenue bucket)
--   'lapsed'    -> fell_off
--   'not_taken' -> fell_off
--
-- Outcome mapping is deliberately small: a native deal is either confirmed paid
-- (first premium cleared) or it fell off (lapsed / not-taken). "Still issued, not
-- paid" is the default the RPC moves rows OUT of, so it is not an outcome you
-- write back to.

create or replace function public.reconcile_native_deal_payment(
  p_deal_id uuid,
  p_outcome text,            -- 'paid' | 'lapsed' | 'not_taken'
  p_reason text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id        uuid := auth.uid();
  v_deal           public.deals;
  v_outcome        text := lower(btrim(coalesce(p_outcome, '')));
  v_from_pss       text;
  v_to_pss         text;
  v_new_version    integer;
  v_actor_role     text;
  v_correlation_id uuid := gen_random_uuid();
  v_is_admin       boolean;
  v_is_manager     boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reconciliation reason is required' using errcode = '22023';
  end if;
  if v_outcome not in ('paid', 'lapsed', 'not_taken') then
    raise exception 'Invalid outcome % (expected paid|lapsed|not_taken)', p_outcome using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  -- NATIVE-ONLY GUARD: this write path must never touch agent_link / imported-feed deals.
  if coalesce(v_deal.source, '') <> 'apex_native' then
    raise exception 'reconcile_native_deal_payment only operates on source=apex_native deals (got %)',
      coalesce(v_deal.source, '<null>') using errcode = '22023';
  end if;

  -- Optimistic concurrency, identical semantics to transition_apex_deal_status.
  if v_deal.version <> p_expected_version then
    raise exception 'Deal changed since it was opened; refresh and retry' using errcode = '40001';
  end if;

  -- Authorization: admin, or a manager who can read this agent. (Mirrors transition RPC.)
  v_is_admin   := public.apex_is_admin();
  v_is_manager := public.apex_has_any_role(array['manager']);
  if not v_is_admin and not (v_is_manager and public.apex_can_read_agent(v_deal.agent_id)) then
    raise exception 'Not permitted to reconcile this deal' using errcode = '42501';
  end if;

  v_from_pss := coalesce(nullif(btrim(v_deal.policy_status_standard), ''), v_deal.status);
  v_to_pss := case v_outcome
    when 'paid'      then 'active'       -- -> confirmed_paid bucket
    when 'lapsed'    then 'lapsed'       -- -> fell_off bucket
    when 'not_taken' then 'not_taken'    -- -> fell_off bucket
  end;

  v_new_version := v_deal.version + 1;
  select string_agg(ur.role::text, ',' order by ur.role::text)
    into v_actor_role
    from public.user_roles ur
   where ur.user_id = v_user_id;

  -- The ONLY mutation. deals.status (state machine) and deals.source are left
  -- untouched ON PURPOSE so no AFTER UPDATE OF status / OF source trigger fires:
  -- no outbox_events, no production_ledger, no Discord, no InsuraCloud push.
  update public.deals
     set policy_status_standard = v_to_pss,
         status_updated_at      = now(),
         updated_at             = now(),
         version                = v_new_version
   where id = p_deal_id;

  insert into public.deal_status_history(
    deal_id, from_status, to_status, reason, actor_id, actor_role,
    correlation_id, deal_version
  ) values (
    p_deal_id, v_from_pss, v_to_pss,
    'native-reconcile(' || v_outcome || '): ' || btrim(p_reason),
    v_user_id, v_actor_role, v_correlation_id, v_new_version
  );

  insert into public.audit_log(
    action, actor_role, actor_user_id, before_data, after_data,
    entity_id, entity_type, request_id
  ) values (
    'deal.native_payment_reconciled', v_actor_role, v_user_id,
    jsonb_build_object('policy_status_standard', v_from_pss, 'version', v_deal.version),
    jsonb_build_object('policy_status_standard', v_to_pss, 'outcome', v_outcome,
                       'version', v_new_version, 'reason', btrim(p_reason),
                       'correlation_id', v_correlation_id),
    p_deal_id::text, 'deal', v_correlation_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'dealId', p_deal_id,
    'outcome', v_outcome,
    'fromPolicyStatus', v_from_pss,
    'policyStatusStandard', v_to_pss,
    'version', v_new_version,
    'correlationId', v_correlation_id
  );
end;
$function$;

revoke all on function public.reconcile_native_deal_payment(uuid, text, text, integer) from public;
grant execute on function public.reconcile_native_deal_payment(uuid, text, text, integer) to authenticated;

comment on function public.reconcile_native_deal_payment(uuid, text, text, integer) is
  'Native-only (source=apex_native) carrier-payment reconciliation write path. Updates ONLY policy_status_standard + status_updated_at + version; fires NO outbox_events / production_ledger / Discord / InsuraCloud (unlike transition_apex_deal_status). admin OR manager-over-agent. Outcomes: paid->active(confirmed_paid), lapsed/not_taken->fell_off. Spec: reports/NATIVE-STATUS-WRITE-PATH-SAFE-REMEDY.md. MP-CFO-NATIVE-RECONCILE-WRITE-PATH.';
