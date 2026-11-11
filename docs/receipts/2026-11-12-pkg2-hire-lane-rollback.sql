-- MP-ONBOARD-ANCHOR-PKG2 ROLLBACK for supabase/migrations/20261112000200..20261112000290 (10 files; 280 was dropped).
--
-- NOT A MIGRATION. It lives in docs/receipts so the deploy pipeline can never replay it. Pre-images were read from
-- production at 2026-11-11T21:57:26.076301+00:00 (pg_get_viewdef / pg_get_functiondef, reloptions, ACLs, comments) before anything in the
-- package was applied; regenerate them (scratch gen_rollback.py) if any of these objects changed live since.
--
-- ORDER (each step assumes the one before it):
--   0. Edge + app first: deploy supabase/functions/numbers-reminder and trigger-new-hire-flow from the commit before
--      PKG2 (the PKG2 versions call fn_numbers_reminder_audience / fn_new_hire_flow_claim, dropped below), and ship the
--      reverted src/ (MyLeads dial tap, EliteReferralUnlock, MagicLogin 'leads'). git revert of the PKG2 commit does
--      both. Use the Supabase CLI for functions if the Deploy Supabase workflow is blocked.
--   1. Run THIS FILE as one transaction (begin; ...; commit;). Dry-run it first with rollback instead of commit.
--   2. Remove the migration records so nothing looks applied that is not:
--        delete from supabase_migrations.schema_migrations where version between '20261112000200' and '20261112000299';
--      and make sure the migration FILES are gone from main (the revert) before the next Deploy Supabase run, or that run
--      would replay them.
--
-- KEPT ON PURPOSE: hire_lane_email_outbox and new_hire_flow_runs (they hold send receipts), the recruit_touch_kinds
-- registrations for 'hire-lane-%' (email_delivery_log rows written under them must stay classified), contracting_intakes
-- rows written by the request (records, not messages). Starter packs already granted stay with the agents unless the
-- optional block in step 7 is run (that is a people decision: they are working those leads).
--
-- NOT TOUCHED BY PKG2, so nothing to roll back: generate_weekly_dialer_invoices / dialer_billing_paused (peer 32,
-- 20261111220700_dialer_billing_pause) and dialer_weekly_payments.

-- 1. Stop the four PKG2 crons (absent jobs are skipped).
do $rbcron$
begin
  perform cron.unschedule(j.jobid) from cron.job j
   where j.jobname in ('apex-hire-lane-email', 'apex-starter-pack-daily', 'apex-contracting-request-sweep', 'apex-new-hire-flow-retry');
end
$rbcron$;

-- 2. New views that sit on top of replaced ones, and the functions that read them.
drop view if exists public.v_hire_activation_health;
drop function if exists public.fn_numbers_reminder_audience();
drop view if exists public.v_numbers_reminder_audience;
drop function if exists public.fn_backfill_contracted_at(boolean);
drop view if exists public.v_contracted_at_backfill_due;

-- 3. Replaced views. PKG2 appended columns, and CREATE OR REPLACE cannot drop columns, so each is dropped (no CASCADE:
--    an unexpected dependent makes this fail loudly instead of vanishing) and recreated from its pre-image.
--    v_activation_dialing_no_close is not PKG2's; it is dropped and restored only because it reads v_agent_dialer_state.
drop view public.v_activation_dialing_no_close;
drop view public.v_activation_seat_queue;
drop view public.v_licensed_hire_clock;
drop view public.v_agent_activation_state;
drop view public.v_agent_dialer_state;

-- v_agent_first_deal_any_source reads v_agent_first_deal_definer since PKG2: give it back its own definition first.
create or replace view public.v_agent_first_deal_any_source with (security_invoker=true) as
 WITH ids AS (
         SELECT a.id AS member_id,
                CASE
                    WHEN ((a.canonical_agent_id IS NOT NULL) AND (a.canonical_agent_id <> a.id)) THEN a.canonical_agent_id
                    ELSE a.id
                END AS agent_id
           FROM agents a
        ), src AS (
         SELECT i.agent_id,
            (min(COALESCE(m.posted_date, m.effective_date)))::timestamp with time zone AS at,
            'production_unified'::text AS source
           FROM (mat_production_unified m
             JOIN ids i ON ((i.member_id = m.agent_id)))
          GROUP BY i.agent_id
        UNION ALL
         SELECT i.agent_id,
            min(d.created_at) AS min,
            'deals'::text AS text
           FROM (deals d
             JOIN ids i ON ((i.member_id = d.agent_id)))
          GROUP BY i.agent_id
        UNION ALL
         SELECT i.agent_id,
            min(a.first_deal_at) AS min,
            'agents.first_deal_at'::text AS text
           FROM (agents a
             JOIN ids i ON ((i.member_id = a.id)))
          WHERE (a.first_deal_at IS NOT NULL)
          GROUP BY i.agent_id
        )
 SELECT agent_id,
    min(at) AS first_deal_at,
    array_agg(DISTINCT source ORDER BY source) AS sources
   FROM src
  GROUP BY agent_id;
revoke all on public.v_agent_first_deal_any_source from public, anon, authenticated, service_role;
grant all on public.v_agent_first_deal_any_source to service_role;
comment on view public.v_agent_first_deal_any_source is null;
drop view public.v_agent_first_deal_definer;

-- pre-image: v_agent_dialer_state
create view public.v_agent_dialer_state with (security_barrier=true) as
 WITH ids AS (
         SELECT a_1.id AS member_id,
            COALESCE(
                CASE
                    WHEN (a_1.canonical_agent_id <> a_1.id) THEN a_1.canonical_agent_id
                    ELSE NULL::uuid
                END, a_1.id) AS agent_id
           FROM agents a_1
        ), dials AS (
         SELECT i.agent_id,
            min(c.call_started_at) AS first_dial_at,
            max(c.call_started_at) AS last_dial_at,
            count(*) AS dials_total,
            count(*) FILTER (WHERE (c.call_started_at >= (now() - '7 days'::interval))) AS dials_7d,
            count(*) FILTER (WHERE (c.call_started_at >= (now() - '14 days'::interval))) AS dials_14d
           FROM (readymode_dialer_calls c
             JOIN ids i ON ((i.member_id = c.agent_id)))
          GROUP BY i.agent_id
        ), seats AS (
         SELECT s_1.agent_id,
            max(s_1.seat_label) AS seat_label,
            max(s_1.assigned_at) AS seat_assigned_at
           FROM agent_dialer_seats s_1
          WHERE (s_1.released_at IS NULL)
          GROUP BY s_1.agent_id
        )
 SELECT a.id AS agent_id,
    (s.agent_id IS NOT NULL) AS has_open_seat,
    s.seat_label,
    s.seat_assigned_at,
    d.first_dial_at,
    d.last_dial_at,
    (COALESCE(d.dials_total, (0)::bigint))::integer AS dials_total,
    (COALESCE(d.dials_7d, (0)::bigint))::integer AS dials_7d,
    (COALESCE(d.dials_14d, (0)::bigint))::integer AS dials_14d,
    ((s.agent_id IS NOT NULL) OR (COALESCE(d.dials_14d, (0)::bigint) > 0)) AS dialer_active_derived,
    COALESCE(a.has_dialer_login, false) AS has_dialer_login_column
   FROM ((agents a
     LEFT JOIN dials d ON ((d.agent_id = a.id)))
     LEFT JOIN seats s ON ((s.agent_id = a.id)))
  WHERE (((a.canonical_agent_id IS NULL) OR (a.canonical_agent_id = a.id)) AND (apex_is_admin() OR (has_role(auth.uid(), 'manager'::app_role) AND apex_can_read_agent(a.id)) OR (CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name, 'supabase_admin'::name]))));
revoke all on public.v_agent_dialer_state from public, anon, authenticated, service_role;
grant all on public.v_agent_dialer_state to service_role;
grant select on public.v_agent_dialer_state to authenticated;
comment on view public.v_agent_dialer_state is null;

-- pre-image: v_agent_activation_state
create view public.v_agent_activation_state with (security_barrier=true) as
 WITH pop AS (
         SELECT a.id AS agent_id,
            a.user_id,
            a.created_at AS hired_at,
            (a.license_status)::text AS license_status,
            (a.onboarding_stage)::text AS onboarding_stage,
            (a.status)::text AS status
           FROM agents a
          WHERE (((a.canonical_agent_id IS NULL) OR (a.canonical_agent_id = a.id)) AND ((a.status)::text = 'active'::text) AND (COALESCE(a.is_deactivated, false) = false) AND (COALESCE(a.is_inactive, false) = false))
        ), facts AS (
         SELECT p.agent_id,
            p.user_id,
            p.hired_at,
            p.license_status,
            p.onboarding_stage,
            p.status,
            ( SELECT (u.last_sign_in_at IS NOT NULL)
                   FROM auth.users u
                  WHERE (u.id = p.user_id)) AS has_signed_in,
            COALESCE(( SELECT t.required_complete
                   FROM v_training_required_completion t
                  WHERE (t.agent_id = p.agent_id)), false) AS required_training_complete,
            ( SELECT max(ie.scheduled_at) AS max
                   FROM interview_events ie
                  WHERE ((ie.call_track = 'onboarding'::text) AND (ie.canceled_at IS NULL) AND (ie.scheduled_at < now()) AND (ie.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = p.agent_id) OR (a2.canonical_agent_id = p.agent_id)))))) AS onboarding_call_at,
            ( SELECT ds.first_dial_at
                   FROM v_agent_dialer_state ds
                  WHERE (ds.agent_id = p.agent_id)) AS dialer_first_call_at,
            ( SELECT ds.dials_14d
                   FROM v_agent_dialer_state ds
                  WHERE (ds.agent_id = p.agent_id)) AS dials_14d,
            ( SELECT ds.has_open_seat
                   FROM v_agent_dialer_state ds
                  WHERE (ds.agent_id = p.agent_id)) AS has_open_seat,
            ( SELECT f.first_deal_at
                   FROM v_agent_first_deal_any_source f
                  WHERE (f.agent_id = p.agent_id)) AS first_deal_at
           FROM pop p
          WHERE (apex_is_admin() OR apex_can_read_agent(p.agent_id) OR (CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name, 'supabase_admin'::name])))
        )
 SELECT agent_id,
    hired_at,
    license_status,
    onboarding_stage,
    COALESCE(has_signed_in, false) AS has_signed_in,
    required_training_complete,
    onboarding_call_at,
    dialer_first_call_at,
    COALESCE(dials_14d, 0) AS dials_14d,
    COALESCE(has_open_seat, false) AS has_open_seat,
    first_deal_at,
        CASE
            WHEN (first_deal_at IS NOT NULL) THEN 'producing'::text
            WHEN ((COALESCE(dials_14d, 0) > 0) OR COALESCE(has_open_seat, false)) THEN 'dialing'::text
            WHEN (license_status <> 'licensed'::text) THEN 'licensing'::text
            WHEN (required_training_complete OR (onboarding_call_at IS NOT NULL)) THEN 'ready_to_dial'::text
            WHEN COALESCE(has_signed_in, false) THEN 'onboarding'::text
            ELSE 'not_signed_in'::text
        END AS derived_stage
   FROM facts;
revoke all on public.v_agent_activation_state from public, anon, authenticated, service_role;
grant all on public.v_agent_activation_state to service_role;
grant select on public.v_agent_activation_state to authenticated;
comment on view public.v_agent_activation_state is null;

-- pre-image: v_licensed_hire_clock
create view public.v_licensed_hire_clock with (security_barrier=true) as
 WITH cfg AS (
         SELECT c.version,
            fn_contracting_required_carriers() AS required,
            NULLIF(btrim(COALESCE(( SELECT s.value
                   FROM system_settings s
                  WHERE (s.key = 'contracting_owner_agent_id'::text)), ''::text)), ''::text) AS owner_setting,
            COALESCE(( SELECT array_agg(f.origin ORDER BY f.origin) AS array_agg
                   FROM v_production_origin_freshness f
                  WHERE (f.verdict = ANY (ARRAY['DARK'::text, 'DYING'::text]))), '{}'::text[]) AS dark_origins
           FROM contract_review_config c
          WHERE c.singleton
        ), pop AS (
         SELECT g.agent_id,
            g.hired_at,
            g.first_name,
            g.manager_id,
            g.marked_count,
            g.required_missing,
            g.has_deal,
            g.gap
           FROM fn_licensed_contracting_gaps() g(agent_id, hired_at, first_name, manager_id, marked_count, required_missing, has_deal, gap)
          WHERE (apex_is_admin() OR (has_role(auth.uid(), 'manager'::app_role) AND apex_can_read_agent(g.agent_id)) OR (CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name, 'supabase_admin'::name])))
        ), base AS (
         SELECT p.agent_id,
            p.first_name,
            p.hired_at,
            p.manager_id,
            p.marked_count,
            p.required_missing,
            p.gap,
            p.has_deal,
            (floor((EXTRACT(epoch FROM (now() - p.hired_at)) / (86400)::numeric)))::integer AS days_since_hire,
            a.user_id,
            a.nipr_number,
            ( SELECT jsonb_object_agg(m.carrier_key, m.confirmed_at) AS jsonb_object_agg
                   FROM contract_review_marks m,
                    cfg cfg_1
                  WHERE ((m.agent_id = p.agent_id) AND (m.version = cfg_1.version))) AS marks,
            (EXISTS ( SELECT 1
                   FROM agent_contract_profile cp
                  WHERE (cp.agent_id = p.agent_id))) AS contract_profile_present,
            ( SELECT min(ie.scheduled_at) AS min
                   FROM interview_events ie
                  WHERE ((ie.call_track = 'onboarding'::text) AND (ie.canceled_at IS NULL) AND (ie.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = p.agent_id) OR (a2.canonical_agent_id = p.agent_id)))))) AS onboarding_call_booked_at,
            (EXISTS ( SELECT 1
                   FROM interview_events ie
                  WHERE ((ie.call_track = 'onboarding'::text) AND (ie.canceled_at IS NULL) AND (ie.scheduled_at < now()) AND (ie.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = p.agent_id) OR (a2.canonical_agent_id = p.agent_id))))))) AS onboarding_call_held,
            ( SELECT min(g.granted_at) AS min
                   FROM lead_bundle_grants g
                  WHERE ((g.user_id = a.user_id) AND (a.user_id IS NOT NULL) AND (g.revoked_at IS NULL))) AS lead_grant_at,
            ( SELECT f.first_deal_at
                   FROM v_agent_first_deal_any_source f
                  WHERE (f.agent_id = p.agent_id)) AS first_deal_at
           FROM (pop p
             JOIN agents a ON ((a.id = p.agent_id)))
        )
 SELECT b.agent_id,
    b.first_name,
    b.hired_at,
    b.days_since_hire,
    b.manager_id,
    ( SELECT COALESCE(NULLIF(split_part(btrim(COALESCE(m.display_name, ''::text)), ' '::text, 1), ''::text), 'Unnamed'::text) AS "coalesce"
           FROM agents m
          WHERE (m.id = b.manager_id)) AS manager_first_name,
        CASE
            WHEN (cfg.owner_setting ~ '^[0-9a-f-]{36}$'::text) THEN (cfg.owner_setting)::uuid
            ELSE b.manager_id
        END AS owner_agent_id,
        CASE
            WHEN (cfg.owner_setting ~ '^[0-9a-f-]{36}$'::text) THEN 'contracting_owner'::text
            ELSE 'manager'::text
        END AS owner_source,
    ((NULLIF(regexp_replace(COALESCE(b.nipr_number, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) ~ '^[0-9]{5,10}$'::text) IS TRUE) AS has_npn,
    b.contract_profile_present,
    COALESCE(b.marks, '{}'::jsonb) AS marks,
    b.marked_count,
    cfg.required AS required_carriers,
    b.required_missing,
        CASE
            WHEN ((cardinality(cfg.required) = 0) AND (b.marked_count = 0)) THEN 'no_record'::text
            WHEN (cardinality(cfg.required) = 0) THEN 'marked_required_unset'::text
            WHEN (cardinality(b.required_missing) = 0) THEN 'required_complete'::text
            WHEN (b.marked_count = 0) THEN 'no_record'::text
            ELSE 'partial'::text
        END AS contracting_state,
    b.onboarding_call_booked_at,
    b.onboarding_call_held,
    ds.first_dial_at AS dialer_first_dial_at,
    COALESCE(ds.dials_14d, 0) AS dials_14d,
    COALESCE(ds.dials_total, 0) AS dials_total,
    COALESCE(ds.has_open_seat, false) AS has_open_seat,
    b.lead_grant_at,
    b.first_deal_at,
    (cardinality(cfg.dark_origins) > 0) AS production_truth_degraded,
    cfg.dark_origins,
        CASE
            WHEN (b.first_deal_at IS NOT NULL) THEN 'has_deal'::text
            WHEN (cardinality(cfg.dark_origins) > 0) THEN 'unprovable'::text
            ELSE 'none'::text
        END AS first_deal_state,
    ( SELECT max(x.x) AS max
           FROM unnest(ARRAY[3, 7, 14, 21]) x(x)
          WHERE ((b.hired_at + make_interval(days => x.x)) <= now())) AS last_checkpoint,
    ( SELECT min(x.x) AS min
           FROM unnest(ARRAY[3, 7, 14, 21]) x(x)
          WHERE ((b.hired_at + make_interval(days => x.x)) > now())) AS next_checkpoint,
    ( SELECT (b.hired_at + make_interval(days => min(x.x)))
           FROM unnest(ARRAY[3, 7, 14, 21]) x(x)
          WHERE ((b.hired_at + make_interval(days => x.x)) > now())) AS next_checkpoint_at,
    (b.gap AND (b.first_deal_at IS NULL) AND (b.days_since_hire >= 7)) AS stalled,
        CASE
            WHEN (b.first_deal_at IS NOT NULL) THEN 'Producing'::text
            WHEN b.gap THEN 'Get a carrier contract on file'::text
            WHEN (b.onboarding_call_booked_at IS NULL) THEN 'Book the onboarding call'::text
            WHEN (COALESCE(ds.dials_14d, 0) >= 300) THEN 'Coach the close (dialing, no deal)'::text
            WHEN ((NOT COALESCE(ds.has_open_seat, false)) AND (COALESCE(ds.dials_14d, 0) = 0)) THEN 'Decide on a dialer seat'::text
            WHEN (b.lead_grant_at IS NULL) THEN 'Decide on starter leads'::text
            ELSE 'Get the first deal'::text
        END AS next_action
   FROM ((base b
     CROSS JOIN cfg)
     LEFT JOIN v_agent_dialer_state ds ON ((ds.agent_id = b.agent_id)));
revoke all on public.v_licensed_hire_clock from public, anon, authenticated, service_role;
grant all on public.v_licensed_hire_clock to service_role;
grant select on public.v_licensed_hire_clock to authenticated;
comment on view public.v_licensed_hire_clock is null;

-- pre-image: v_activation_seat_queue
create view public.v_activation_seat_queue with (security_barrier=true) as
 SELECT p.agent_id,
    p.first_name,
    p.hired_at,
    (floor((EXTRACT(epoch FROM (now() - p.hired_at)) / (86400)::numeric)))::integer AS days_since_hire,
    COALESCE(t.required_complete, false) AS training_complete,
    (EXISTS ( SELECT 1
           FROM interview_events ie
          WHERE ((ie.call_track = 'onboarding'::text) AND (ie.canceled_at IS NULL) AND (ie.scheduled_at < now()) AND (ie.agent_id IN ( SELECT a2.id
                   FROM agents a2
                  WHERE ((a2.id = p.agent_id) OR (a2.canonical_agent_id = p.agent_id))))))) AS onboarding_call_held,
    ds.last_dial_at,
    ds.dials_total,
    (f.agent_id IS NOT NULL) AS has_deal,
    p.manager_id,
    'staged: Sam decides seats and leads (N8); nothing is granted automatically'::text AS decision_note
   FROM ((((fn_licensed_activation_population() p(agent_id, hired_at, first_name, manager_id)
     JOIN agents a ON ((a.id = p.agent_id)))
     LEFT JOIN v_training_required_completion t ON ((t.agent_id = p.agent_id)))
     LEFT JOIN v_agent_dialer_state ds ON ((ds.agent_id = p.agent_id)))
     LEFT JOIN v_agent_first_deal_any_source f ON ((f.agent_id = p.agent_id)))
  WHERE ((COALESCE(t.required_complete, false) OR (EXISTS ( SELECT 1
           FROM interview_events ie
          WHERE ((ie.call_track = 'onboarding'::text) AND (ie.canceled_at IS NULL) AND (ie.scheduled_at < now()) AND (ie.agent_id IN ( SELECT a2.id
                   FROM agents a2
                  WHERE ((a2.id = p.agent_id) OR (a2.canonical_agent_id = p.agent_id)))))))) AND (NOT COALESCE(ds.has_open_seat, false)) AND (COALESCE(ds.dials_7d, 0) = 0) AND (NOT (EXISTS ( SELECT 1
           FROM lead_bundle_grants g
          WHERE ((g.user_id = a.user_id) AND (g.revoked_at IS NULL))))));
revoke all on public.v_activation_seat_queue from public, anon, authenticated, service_role;
grant all on public.v_activation_seat_queue to service_role;
grant select on public.v_activation_seat_queue to authenticated;
comment on view public.v_activation_seat_queue is null;

-- pre-image: v_activation_dialing_no_close
create view public.v_activation_dialing_no_close with (security_barrier=true) as
 WITH prod AS (
         SELECT p_1.agent_id,
            (( SELECT count(*) AS count
                   FROM mat_production_unified m
                  WHERE ((m.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = p_1.agent_id) OR (a2.canonical_agent_id = p_1.agent_id)))) AND (COALESCE(m.posted_date, m.effective_date) >= (p_1.hired_at)::date))) + ( SELECT count(*) AS count
                   FROM deals d
                  WHERE ((d.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = p_1.agent_id) OR (a2.canonical_agent_id = p_1.agent_id)))) AND (d.created_at >= p_1.hired_at)))) AS deals_since_hire
           FROM fn_licensed_activation_population() p_1(agent_id, hired_at, first_name, manager_id)
        )
 SELECT p.agent_id,
    p.first_name,
    p.hired_at,
    (floor((EXTRACT(epoch FROM (now() - p.hired_at)) / (86400)::numeric)))::integer AS days_since_hire,
    ds.dials_14d,
    ds.dials_total,
    ds.last_dial_at,
    pr.deals_since_hire,
    'coach: review recordings, script and lead source before more dials'::text AS next_action
   FROM ((fn_licensed_activation_population() p(agent_id, hired_at, first_name, manager_id)
     JOIN v_agent_dialer_state ds ON ((ds.agent_id = p.agent_id)))
     JOIN prod pr ON ((pr.agent_id = p.agent_id)))
  WHERE ((ds.dials_14d >= 300) AND (pr.deals_since_hire = 0));
revoke all on public.v_activation_dialing_no_close from public, anon, authenticated, service_role;
grant all on public.v_activation_dialing_no_close to service_role;
grant select on public.v_activation_dialing_no_close to authenticated;
comment on view public.v_activation_dialing_no_close is null;

-- pre-image: v_hire_launch_board (PKG2 kept its columns, so it is replaced in place)
create or replace view public.v_hire_launch_board as
 WITH base AS (
         SELECT a.id AS agent_id,
            a.user_id,
            a.profile_id,
            a.display_name,
            (a.license_status)::text AS license_status,
            (a.onboarding_stage)::text AS onboarding_stage,
            fn_hire_stage_rank((a.onboarding_stage)::text) AS stage_rank,
            a.created_at AS hired_at,
            a.stage_changed_at,
            a.contracted_at,
            a.first_deal_at,
            a.source_application_id,
            a.invited_by_manager_id
           FROM agents a
          WHERE ((a.status = 'active'::agent_status) AND (a.canonical_agent_id IS NULL) AND (COALESCE(a.is_deactivated, false) = false) AND (COALESCE(a.is_inactive, false) = false))
        ), book AS (
         SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS agent_id,
            count(*) AS deals,
            COALESCE(sum(p.annual_premium), (0)::numeric) AS ap
           FROM (v_production_canonical p
             LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = p.agent_id)))
          WHERE (p.agent_id IS NOT NULL)
          GROUP BY COALESCE(cm.canonical_agent_id, p.agent_id)
        ), enriched AS (
         SELECT b.agent_id,
            b.user_id,
            b.profile_id,
            b.display_name,
            b.license_status,
            b.onboarding_stage,
            b.stage_rank,
            b.hired_at,
            b.stage_changed_at,
            b.contracted_at,
            b.first_deal_at,
            b.source_application_id,
            b.invited_by_manager_id,
            p.full_name,
            p.email,
            p.phone,
            mgr.display_name AS manager_name,
            GREATEST(0, (CURRENT_DATE - (COALESCE(b.stage_changed_at, b.hired_at))::date)) AS days_in_stage,
            GREATEST(0, (CURRENT_DATE - (b.hired_at)::date)) AS days_since_hired,
            act.calls_7d,
            act.calls_30d,
            act.conversations_30d,
            act.last_call_at,
            COALESCE(bk.deals, (0)::bigint) AS book_deals,
            COALESCE(bk.ap, (0)::numeric) AS book_ap,
            cal.next_call_at,
            cal.last_outcome AS last_call_outcome,
            tr.modules_done,
            (EXISTS ( SELECT 1
                   FROM agent_dialer_seats s
                  WHERE ((s.agent_id = b.agent_id) AND (s.released_at IS NULL)))) AS has_open_seat,
            (EXISTS ( SELECT 1
                   FROM lead_bundle_grants g
                  WHERE ((g.user_id = b.user_id) AND (b.user_id IS NOT NULL) AND (g.revoked_at IS NULL)))) AS has_lead_grant,
            dl.dials_7d AS alias_dials_7d,
            dl.dials_14d AS alias_dials_14d
           FROM (((((((base b
             LEFT JOIN profiles p ON ((p.id = b.profile_id)))
             LEFT JOIN agents mgr ON ((mgr.id = b.invited_by_manager_id)))
             LEFT JOIN book bk ON ((bk.agent_id = b.agent_id)))
             LEFT JOIN LATERAL ( SELECT min(oc.scheduled_at) FILTER (WHERE ((oc.scheduled_at > now()) AND (oc.canceled_at IS NULL))) AS next_call_at,
                    (array_agg(oc.outcome ORDER BY oc.scheduled_at DESC) FILTER (WHERE (oc.outcome IS NOT NULL)))[1] AS last_outcome
                   FROM v_onboarding_calls oc
                  WHERE (oc.agent_id = b.agent_id)) cal ON (true))
             LEFT JOIN LATERAL ( SELECT count(*) AS modules_done
                   FROM onboarding_progress op
                  WHERE ((op.agent_id = b.agent_id) AND (op.completed_at IS NOT NULL))) tr ON (true))
             LEFT JOIN v_hire_activity act ON ((act.agent_id = b.agent_id)))
             LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (c.call_started_at >= (now() - '7 days'::interval))) AS dials_7d,
                    count(*) FILTER (WHERE (c.call_started_at >= (now() - '14 days'::interval))) AS dials_14d
                   FROM readymode_dialer_calls c
                  WHERE (c.agent_id IN ( SELECT a2.id
                           FROM agents a2
                          WHERE ((a2.id = b.agent_id) OR (a2.canonical_agent_id = b.agent_id))))) dl ON (true))
        )
 SELECT agent_id,
    user_id,
    COALESCE(NULLIF(btrim(display_name), ''::text), full_name, 'Name not on file'::text) AS display_name,
    email,
    phone,
    license_status,
    onboarding_stage,
    stage_rank,
    hired_at,
    stage_changed_at,
    days_in_stage,
    days_since_hired,
    contracted_at,
    first_deal_at,
    source_application_id,
    invited_by_manager_id,
    manager_name,
    book_deals,
    book_ap,
    next_call_at,
    last_call_outcome,
    modules_done,
    calls_7d,
    calls_30d,
    conversations_30d,
    last_call_at,
    (hired_at >= (((date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)))::date)::timestamp with time zone + '07:00:00'::interval)) AS hired_this_month,
        CASE
            WHEN (license_status <> 'licensed'::text) THEN 'license'::text
            WHEN (stage_rank IS NULL) THEN 'off_ladder'::text
            WHEN ((stage_rank < 3) AND (book_deals > 0)) THEN 'mark_producing'::text
            WHEN (stage_rank = 0) THEN 'start_onboarding'::text
            WHEN ((stage_rank = 1) AND (next_call_at IS NULL)) THEN 'book_call'::text
            WHEN (stage_rank = 1) THEN 'move_to_course'::text
            WHEN (stage_rank = 2) THEN 'move_to_field'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (COALESCE(alias_dials_14d, (0)::bigint) >= 300)) THEN 'coach_closing'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_open_seat) AND (COALESCE(alias_dials_7d, (0)::bigint) = 0)) THEN 'assign_dialer'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_lead_grant)) THEN 'grant_leads'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0)) THEN 'first_deal'::text
            WHEN (stage_rank = 3) THEN 'mark_producing'::text
            ELSE 'coach'::text
        END AS next_action_key,
        CASE
            WHEN (license_status <> 'licensed'::text) THEN 'Get them licensed'::text
            WHEN (stage_rank IS NULL) THEN (('Off the ladder at '::text || COALESCE(onboarding_stage, 'no stage'::text)) || ' — put them back on it'::text)
            WHEN ((stage_rank < 3) AND (book_deals > 0)) THEN 'Already writing business — mark them producing'::text
            WHEN (stage_rank = 0) THEN 'Start onboarding'::text
            WHEN ((stage_rank = 1) AND (next_call_at IS NULL)) THEN 'Book the onboarding call'::text
            WHEN (stage_rank = 1) THEN 'Move them into the course'::text
            WHEN (stage_rank = 2) THEN 'Course done — send them to field training'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (COALESCE(alias_dials_14d, (0)::bigint) >= 300)) THEN 'Dialing hard, no deal yet — coach the close'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_open_seat) AND (COALESCE(alias_dials_7d, (0)::bigint) = 0)) THEN 'No dialer seat on record — decide on a seat'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_lead_grant)) THEN 'No leads granted — decide on a starter bundle'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0)) THEN 'Field training — get the first deal'::text
            WHEN (stage_rank = 3) THEN 'First deal is in — mark them producing'::text
            ELSE 'Producing — coach the next win'::text
        END AS next_action_label,
    ((COALESCE(stage_rank, 0) < 4) AND (GREATEST(0, (CURRENT_DATE - (COALESCE(stage_changed_at, hired_at))::date)) > 14)) AS is_stalled,
    ((email IS NULL) OR (btrim(email) = ''::text)) AS email_missing,
    ((phone IS NULL) OR (btrim(phone) = ''::text)) AS phone_missing,
    has_open_seat,
    has_lead_grant,
    (COALESCE(alias_dials_14d, (0)::bigint))::integer AS dials_14d
   FROM enriched e
  WHERE (apex_is_admin() OR crm_can_read_agent_scope(agent_id));
revoke all on public.v_hire_launch_board from public, anon, authenticated, service_role;
grant all on public.v_hire_launch_board to service_role;
grant select on public.v_hire_launch_board to authenticated;
comment on view public.v_hire_launch_board is 'One row per active, non-canonical hire with every signal the new-hire launch board renders: ladder rank, days parked in stage, onboarding call, course progress, book production, and the first unmet gate as next_action_key/label. Deliberately NOT filtered to the current month — the board it replaces was, which hid 15 mid-process hires and emptied itself on the 1st.';

-- 4. Replaced functions, from their pre-images. Grants are unchanged by CREATE OR REPLACE except my_referral_status,
--    which PKG2 revoked from public/anon (restored below).
-- pre-image: fn_licensed_activation_population()
CREATE OR REPLACE FUNCTION public.fn_licensed_activation_population()
 RETURNS TABLE(agent_id uuid, hired_at timestamp with time zone, first_name text, manager_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.created_at,
         coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'Unnamed'),
         coalesce(a.manager_id, a.invited_by_manager_id)
  from public.agents a
  join public.fn_contract_review_population() p on p.agent_id = a.id
  where a.license_status::text = 'licensed'
    and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
    and public.fn_wp5_staff_reader()
$function$;
comment on function public.fn_licensed_activation_population() is null;

-- pre-image: fn_derive_agent_contracted_at()
CREATE OR REPLACE FUNCTION public.fn_derive_agent_contracted_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
comment on function public.fn_derive_agent_contracted_at() is null;

-- pre-image: fn_recruit_sla_pager()
CREATE OR REPLACE FUNCTION public.fn_recruit_sla_pager()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  v_local timestamp := now() at time zone 'America/Phoenix';
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  r record;
  v_owner uuid;
  v_mgr uuid;
  v_log bigint;
  v_nid uuid;
  v_title text;
  v_body text;
  v_eligible int;
  v_paged int := 0;
  v_inbox int := 0;
  v_escalated int := 0;
  v_reassigned int := 0;
begin
  if v_cutoff = 'infinity'::timestamptz then
    return jsonb_build_object('skipped', 'no_cutoff_setting', 'at', now());
  end if;

  -- (a) Ownership repair, any hour: open recruits owned by someone who has not signed
  -- in for 7 days go back to the fallback (no page for pre-cutoff rows).
  for r in
    select a.id, a.recruiting_owner_user_id, a.license_status::text as lic, a.created_at
      from public.applications a
     where a.recruiting_owner_user_id is not null and a.recruiting_owner_user_id <> v_sam
       and coalesce(a.is_duplicate, false) = false
       and coalesce(a.record_type, 'application') = 'application'
       and a.do_not_contact_at is null and a.terminated_at is null and a.closed_at is null
       and a.created_at >= now() - interval '45 days'
       and (not public.fn_recruit_user_is_active(a.recruiting_owner_user_id)
            or (a.created_at >= v_cutoff and a.human_last_contact_at is null
                and a.created_at < now() - interval '72 hours'
                and coalesce(a.owner_alert_meta ->> 'reassigned_at', '') = ''))
     for update skip locked
  loop
    v_owner := public.fn_pick_recruit_owner(r.lic, r.recruiting_owner_user_id);
    update public.applications
       set recruiting_owner_user_id = v_owner,
           recruiting_owner_set_at = now(),
           recruiting_owner_set_by = null,
           owner_alerted_at = case when r.created_at >= v_cutoff and human_last_contact_at is null then null else owner_alerted_at end,
           owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('reassigned_at', now(), 'reassigned_from', r.recruiting_owner_user_id)
     where id = r.id;
    v_reassigned := v_reassigned + 1;
  end loop;

  -- Pages only inside 08:00-19:00 Phoenix.
  if extract(hour from v_local) < 8 or extract(hour from v_local) >= 19 then
    return jsonb_build_object('reassigned', v_reassigned, 'skipped', 'outside_phoenix_business_hours', 'at', now());
  end if;

  -- (b) First page for each NEW_UNTOUCHED recruit (15 business minutes, post-cutoff).
  select count(*) into v_eligible
    from public.fn_recruit_sla_open_untouched(v_cutoff) a
   where a.owner_alerted_at is null and public.fn_phx_business_minutes(a.created_at, now()) >= 15;

  if v_eligible > 5 then
    -- Storm guard: a burst (bulk import, replay) becomes ONE push, never N.
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
    values ('batch_page', v_sam, 'ntfy',
            public.fn_ntfy_relay(v_eligible || ' new recruits waiting',
              v_eligible || ' recruits applied with no human contact yet. Open the recruiting queue: ' || c_link,
              '4', 'telephone_receiver'),
            jsonb_build_object('eligible', v_eligible))
    returning id into v_log;
    update public.applications a
       set owner_alerted_at = now(),
           owner_alert_meta = coalesce(a.owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('log_id', v_log, 'channel', 'ntfy', 'batch', true, 'paged_at', now())
     where a.id in (select u.id from public.fn_recruit_sla_open_untouched(v_cutoff) u
                     where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15);
    v_paged := v_eligible;
  else
    for r in
      select u.id, u.first_name, u.state, u.license_status::text as lic, u.created_at,
             coalesce(u.recruiting_owner_user_id, v_sam) as owner
        from public.fn_recruit_sla_open_untouched(v_cutoff) u
       where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15
       order by u.created_at
    loop
      v_title := 'Call ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a new recruit')
                 || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
      v_body := 'Applied ' || greatest(1, round(extract(epoch from now() - r.created_at) / 60))::int
                || ' min ago. No human contact yet. Open the recruiting queue: ' || c_link;
      if r.owner = v_sam then
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
        values ('page', r.id, r.owner, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'telephone_receiver'))
        returning id into v_log;
        v_paged := v_paged + 1;
      else
        v_nid := public.fn_emit_inbox_notification(r.owner, 'recruit_sla_page', v_title, v_body,
                   '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
        values ('page', r.id, r.owner, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
        returning id into v_log;
        v_inbox := v_inbox + 1;
      end if;
      update public.applications
         set owner_alerted_at = now(),
             owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                                || jsonb_build_object('log_id', v_log, 'paged_user', r.owner, 'paged_at', now())
       where id = r.id;
    end loop;
  end if;

  -- (c) 2h escalation for recruits a non-Sam owner has not touched: the active
  -- va_manager's inbox, else Sam's phone. 24h is Sam's digest; 72h is (a) above.
  for r in
    select u.id, u.first_name, u.state, u.license_status::text as lic, u.recruiting_owner_user_id as owner
      from public.fn_recruit_sla_open_untouched(v_cutoff) u
     where u.owner_alerted_at < now() - interval '2 hours'
       and u.recruiting_owner_user_id is not null and u.recruiting_owner_user_id <> v_sam
       and coalesce(u.owner_alert_meta ->> 'escalated_at', '') = ''
  loop
    select ur.user_id into v_mgr from public.user_roles ur
     where ur.role = 'va_manager' and ur.user_id <> r.owner and public.fn_recruit_user_is_active(ur.user_id)
     order by ur.user_id limit 1;
    v_title := 'Still waiting 2h: ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a recruit')
               || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
    v_body := 'Owner ' || coalesce(public.fn_staff_first_name(r.owner), 'staff') || ' has not logged contact. Open: ' || c_link;
    if v_mgr is not null then
      v_nid := public.fn_emit_inbox_notification(v_mgr, 'recruit_sla_escalation', v_title, v_body,
                 '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
      values ('escalation', r.id, v_mgr, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
      returning id into v_log;
    else
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
      values ('escalation', r.id, v_sam, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'rotating_light'))
      returning id into v_log;
    end if;
    update public.applications
       set owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('escalated_at', now(), 'escalation_log_id', v_log)
     where id = r.id;
    v_escalated := v_escalated + 1;
  end loop;

  return jsonb_build_object('paged_ntfy', v_paged, 'paged_inbox', v_inbox, 'escalated', v_escalated,
                            'reassigned', v_reassigned, 'eligible', v_eligible, 'at', now());
end $function$;
comment on function public.fn_recruit_sla_pager() is null;

-- pre-image: fn_recruit_sla_digest()
CREATE OR REPLACE FUNCTION public.fn_recruit_sla_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  v_counts jsonb;
  v_last timestamptz;
  v_new_untouched int;
  v_backlog int;
  v_stalls int;
  v_total int;
  v_body text;
  v_log bigint;
  v_nid uuid;
  v_sent_inbox int := 0;
  r record;
begin
  if exists (select 1 from public.recruit_sla_push_log
              where kind = 'digest' and owner_user_id = v_sam and created_at > now() - interval '20 hours') then
    return jsonb_build_object('skipped', 'already_sent_today', 'at', now());
  end if;

  select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb), coalesce(sum(n), 0)::int
    into v_counts, v_total
    from (select sla_state, count(*) n from public.v_recruit_sla_queue group by 1) x;
  select count(*) filter (where post_deploy), count(*) filter (where not post_deploy)
    into v_new_untouched, v_backlog
    from public.v_recruit_sla_queue where sla_state = 'NEW_UNTOUCHED';
  v_last := greatest(v_cutoff, coalesce((select max(created_at) from public.recruit_sla_push_log
                                           where kind = 'digest' and owner_user_id = v_sam), v_cutoff));
  -- New stall crossings since the last digest, as a count. Never a per-row alert.
  select count(*) into v_stalls from public.next_step_progress
   where status = 'active' and is_stalled and stalled_at > v_last;

  v_body := 'New since go-live, no human contact: ' || v_new_untouched || E'\n'
         || 'Call ended, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0) || E'\n'
         || 'Callback due: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0) || E'\n'
         || 'Follow-up due: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0) || E'\n'
         || 'Licensed, never booked: ' || coalesce((v_counts ->> 'LICENSED_UNBOOKED')::int, 0) || E'\n'
         || 'Older untouched (before go-live, last 45 days): ' || v_backlog || E'\n'
         || 'New next-step stalls since last digest: ' || v_stalls || E'\n\n'
         || 'Open: ' || c_link;

  insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
  values ('digest', v_sam, 'ntfy',
          public.fn_ntfy_relay('Recruit queue: ' || v_total || ' need a human', v_body, '3', 'clipboard'),
          v_counts || jsonb_build_object('new_untouched_post_cutoff', v_new_untouched,
                                         'backlog_pre_cutoff', v_backlog, 'new_stalls', v_stalls, 'total', v_total))
  returning id into v_log;

  -- Other staff owners: their own counts in the app they work in. Owners come from
  -- the queue plus every active VA seat, so an active seat hears '0' rather than silence.
  for r in
    select o.uid from (
      select distinct q.owner_user_id as uid from public.v_recruit_sla_queue q where q.owner_user_id <> v_sam
      union
      select ur.user_id from public.user_roles ur
       where ur.role in ('va', 'va_manager') and public.fn_recruit_user_is_active(ur.user_id)
    ) o where o.uid is not null and o.uid <> v_sam
  loop
    select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb) into v_counts
      from (select sla_state, count(*) n from public.v_recruit_sla_queue where owner_user_id = r.uid group by 1) x;
    v_nid := public.fn_emit_inbox_notification(r.uid, 'recruit_sla_digest',
               'Your recruit queue today',
               'New, untouched: ' || coalesce((v_counts ->> 'NEW_UNTOUCHED')::int, 0)
               || ' · Call, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0)
               || ' · Callback: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0)
               || ' · Follow-up: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0),
               '/dashboard/recruiting', 'normal', v_counts);
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, notification_id, counts, settled_at, settle_note)
    values ('digest', r.uid, 'inbox', v_nid, v_counts, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end);
    v_sent_inbox := v_sent_inbox + 1;
  end loop;

  return jsonb_build_object('digest_log_id', v_log, 'total', v_total, 'backlog_pre_cutoff', v_backlog,
                            'new_stalls', v_stalls, 'inbox_digests', v_sent_inbox, 'at', now());
end $function$;
comment on function public.fn_recruit_sla_digest() is null;

-- pre-image: my_referral_status()
CREATE OR REPLACE FUNCTION public.my_referral_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select a.id, a.ref_slug, coalesce(pr.full_name, a.display_name) nm
    from public.agents a
    left join public.profiles pr on pr.id = a.user_id
    where a.user_id = auth.uid() limit 1),
  thresh as (select coalesce((select value::numeric from public.system_settings where key='referral_unlock_threshold'),20000) t),
  prod as (
    select coalesce(sum(b.annual_premium),0) ap
    from public.agentlink_book b, me
    where b.is_dead is not true
      and (b.agent_id = me.id or lower(trim(b.agent_name)) = lower(trim(me.nm)))),
  refs as (select count(*) n from public.referrals r, me where r.referrer_agent_id = me.id)
  select jsonb_build_object(
    'has_agent', (select count(*) from me) > 0,
    'ref_slug', (select ref_slug from me),
    'full_name', (select nm from me),
    'production_total', (select ap from prod),
    'threshold', (select t from thresh),
    'unlocked', (select ap from prod) >= (select t from thresh),
    'remaining', greatest((select t from thresh) - (select ap from prod), 0),
    'referrals_count', (select n from refs),
    'link', case when (select ref_slug from me) is not null
                 then 'https://apex-financial.org/r/' || (select ref_slug from me) end)
$function$;
comment on function public.my_referral_status() is null;

grant execute on function public.my_referral_status() to public, anon, authenticated, service_role;

-- 5. New triggers and functions.
drop trigger if exists trg_pkg2_contracted_from_deal on public.deals;
drop trigger if exists trg_pkg2_contracted_from_deal_native_post on public.deals;
drop trigger if exists trg_pkg2_contracted_from_external_deal on public.production_external_deals;
drop function if exists public.fn_stamp_contracted_at_from_deal();
drop function if exists public.fn_starter_pack_cron();
drop function if exists public.fn_grant_starter_packs(boolean, integer);
drop function if exists public.fn_starter_pack_inventory(text[], integer);
drop function if exists public.fn_starter_pack_candidates();
drop function if exists public.fn_contracting_request_backfill(boolean, timestamptz);
drop function if exists public.fn_contracting_request_sweep(boolean);
drop function if exists public.fn_contracting_request_open(uuid, boolean, boolean);
drop function if exists public.fn_contracting_request_due(timestamptz, timestamptz);
drop function if exists public.fn_contracting_request_cutoff();
drop function if exists public.fn_contracting_intake_draft(uuid);
drop function if exists public.fn_contracting_owner_user_id();
drop function if exists public.fn_new_hire_flow_retry_sweep();
drop function if exists public.fn_new_hire_flow_finish(uuid, jsonb, boolean, text);
drop function if exists public.fn_new_hire_flow_claim(uuid);
drop function if exists public.fn_recruit_owner_email_ok(uuid);
drop function if exists public.my_lead_dial_tap(uuid);
drop function if exists public.fn_hire_lane_email_tick(boolean);
drop function if exists public.fn_hire_lane_email_dispatch(integer, boolean);
drop function if exists public.fn_hire_lane_email_settle();
drop function if exists public.fn_hire_lane_email_enqueue(text, text, uuid, uuid, text, text, text, text, text, jsonb);
drop function if exists public.fn_pkg2_html_escape(text);
drop function if exists public.fn_user_login_blocked(uuid);
drop function if exists public.fn_agent_is_suspended(uuid);
drop function if exists public.fn_user_is_suspended(uuid);

-- 6. Settings PKG2 created (none of these keys existed before it).
delete from public.system_settings
 where key in ('dialer_status', 'onboarding_starter_pack_enabled', 'hire_lane_email_enabled', 'pkg2_contracting_request_cutoff');

-- 7a. contracted_at backfill: revert exactly the rows fn_backfill_contracted_at(false) stamped, and only while they still
--     hold the stamped value, with the same two triggers off (data only). Skipped entirely (no lock on agents) when the
--     live backfill never ran.
do $rbstamp$
begin
  if exists (select 1 from public.ops_preimage_snapshots p where p.reason = 'MP-ONBOARD-ANCHOR-PKG2 contracted_at backfill') then
    alter table public.agents disable trigger trg_next_step_agents_update;
    alter table public.agents disable trigger trg_agent_activated_discord;
    update public.agents a
       set contracted_at = null
      from (select (e ->> 'agent_id')::uuid as id, (e ->> 'stamp_at')::timestamptz as s
              from public.ops_preimage_snapshots p, jsonb_array_elements(p.payload) e
             where p.reason = 'MP-ONBOARD-ANCHOR-PKG2 contracted_at backfill') x
     where a.id = x.id and a.contracted_at = x.s;
    alter table public.agents enable trigger trg_next_step_agents_update;
    alter table public.agents enable trigger trg_agent_activated_discord;
  end if;
end
$rbstamp$;

-- 7b. OPTIONAL, a people decision: take back every starter pack (same writes as lead_bundle_archive: grants revoked,
--     leads returned to the pool, bundle archived, event logged). Leave commented unless Sam wants the leads back.
-- with packs as (select b.id from public.lead_bundles b
--                 where coalesce(b.criteria ->> 'starter_pack', '') = 'true' and b.archived_at is null),
--      g as (update public.lead_bundle_grants set revoked_at = now() where bundle_id in (select id from packs) and revoked_at is null returning bundle_id),
--      i as (update public.lead_bundle_items set removed_at = now() where bundle_id in (select id from packs) and removed_at is null returning bundle_id),
--      b as (update public.lead_bundles set archived_at = now() where id in (select id from packs) returning id)
-- insert into public.lead_bundle_events (bundle_id, actor, action, detail)
-- select b.id, null, 'archived', jsonb_build_object('reason', 'PKG2 rollback') from b;
