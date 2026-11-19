-- MP-BEST-3 (2026-11-19): the "what happens next" card counted email templates as career stages.
--
-- v_next_step_candidate hardcoded 18 stages (`18 AS total_stages`, percent = order_index / 18.0).
-- The ladder has had 19 since "First $10K Week" was added, and next_step_stages has since gained
-- 60 retired rows that are email templates, not stages (reactivation touches, exam catch-ups).
-- On a producer's Home that read "Stage 19 / 18 · 106% progress · 18 done · 61 ahead" (12 people
-- today), and "Stage 99 / 18 · 550%" for the 91 people marked closed.
--
-- The ladder is now read from the table: rows that are not retired and not terminal (19 today).
-- total_stages is that count, percent is capped at 100 and is 0 off the ladder, and the
-- done / ahead lists only carry ladder rows (and are empty for someone marked closed, who was
-- shown every stage as done). Every other column is unchanged, and the row
-- guard (ops staff, own scope, own application) is untouched.
--
-- security_barrier is restated because CREATE OR REPLACE VIEW replaces the options list.
-- Previous expressions, for rollback:
--   18 AS total_stages
--   round(100.0 * s.order_index::numeric / 18.0, 0) AS percent_complete
--   ... WHERE n.order_index >= s.order_index)   /   ... WHERE n.order_index < s.order_index)

create or replace view public.v_next_step_candidate
with (security_barrier = true) as
 SELECT person_type,
    application_id,
    agent_id,
    first_name,
    last_name,
    stage_key,
    stage_display_name,
    next_action_label,
    next_action_url,
    stage_entered_at,
    sla_due_at,
    is_stalled,
    days_in_stage,
    candidate_message_template,
    icon_name,
    color_hex,
    dashboard_section,
    order_index,
    total_stages,
    percent_complete,
    upcoming_stages,
    completed_stages
   FROM ( SELECT c.person_type,
            c.application_id,
            c.agent_id,
            c.first_name,
            c.last_name,
            c.derived_stage_key AS stage_key,
            c.stage_display_name,
            c.next_action_label,
            c.next_action_url,
            c.stage_entered_at,
            c.sla_due_at,
            c.is_stalled,
            c.days_in_stage,
            s.candidate_message_template,
            s.icon_name,
            s.color_hex,
            s.dashboard_section,
            s.order_index,
            ( SELECT count(*)::integer AS count FROM next_step_stages l WHERE l.retired_at IS NULL AND NOT COALESCE(l.is_terminal, false)) AS total_stages,
            CASE WHEN COALESCE(s.is_terminal, false) OR s.retired_at IS NOT NULL THEN 0::numeric ELSE LEAST(100::numeric, round(100.0 * s.order_index::numeric / NULLIF(( SELECT count(*)::integer AS count FROM next_step_stages l WHERE l.retired_at IS NULL AND NOT COALESCE(l.is_terminal, false)), 0)::numeric, 0)) END AS percent_complete,
            ( SELECT jsonb_agg(jsonb_build_object('key', n.stage_key, 'name', n.display_name, 'order', n.order_index) ORDER BY n.order_index) AS jsonb_agg
                   FROM next_step_stages n
                  WHERE n.order_index >= s.order_index AND n.retired_at IS NULL AND NOT COALESCE(n.is_terminal, false)) AS upcoming_stages,
            ( SELECT jsonb_agg(jsonb_build_object('key', n.stage_key, 'name', n.display_name, 'order', n.order_index) ORDER BY n.order_index) AS jsonb_agg
                   FROM next_step_stages n
                  WHERE n.order_index < s.order_index AND n.retired_at IS NULL AND NOT COALESCE(n.is_terminal, false) AND NOT COALESCE(s.is_terminal, false)) AS completed_stages
           FROM v_next_step_current c
             LEFT JOIN next_step_stages s ON s.stage_key = c.derived_stage_key
          WHERE c.derived_stage_key IS NOT NULL) q
  WHERE (CURRENT_USER <> ALL (ARRAY['anon'::name, 'authenticated'::name])) OR ( SELECT api_is_ops_staff() AS api_is_ops_staff) OR (agent_id = ANY ((( SELECT api_scope_agent_ids() AS api_scope_agent_ids))::uuid[])) OR (application_id = ANY ((( SELECT api_my_application_ids() AS api_my_application_ids))::uuid[]));
