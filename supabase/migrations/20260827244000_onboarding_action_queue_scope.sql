-- Keep the operational onboarding queue actionable. The prior view included
-- 66 inactive/departed records and generated placeholder copy such as
-- "Advance onboarding from stage: (none)." That buried today's hires.

create or replace view public.v_queue_hired_no_onboarding as
select
  a.id as agent_id,
  coalesce(a.display_name, p.full_name) as agent,
  a.onboarding_stage::text as onboarding_stage,
  a.license_status::text as license_status,
  coalesce(m.display_name, 'unassigned') as owner,
  coalesce(a.stage_changed_at, a.created_at) as last_action_at,
  coalesce(
    nullif(a.next_action_text, ''),
    case
      when a.license_status::text <> 'licensed' then 'Continue licensing roadmap and log the next milestone'
      when a.onboarding_stage::text = 'training_online' then 'Finish required training and pass the knowledge checks'
      when a.onboarding_stage::text = 'in_field_training' then 'Complete field release checklist and first-sale plan'
      when a.onboarding_stage::text = 'evaluated' then 'Confirm hire and start contracting'
      else 'Complete contracting and book the onboarding call'
    end
  ) as next_action,
  coalesce(a.next_action_due_at::timestamptz, a.next_step_due_at, a.created_at + interval '1 day') as due_at,
  (extract(epoch from now() - coalesce(a.stage_changed_at, a.created_at)) / 86400)::numeric(8,1) as days_stuck,
  case when a.license_status::text = 'licensed' then 1 else 2 end as priority,
  a.created_at as hired_at
from public.agents a
left join public.profiles p on p.id = a.profile_id
left join public.agents m on m.id = a.manager_id
where a.status::text = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and a.onboarding_completed_at is null
  and a.onboarding_stage::text is distinct from 'live'
order by
  case when a.license_status::text = 'licensed' then 1 else 2 end,
  (extract(epoch from now() - coalesce(a.stage_changed_at, a.created_at)) / 86400)::numeric(8,1) desc;

comment on view public.v_queue_hired_no_onboarding is
  'Active hires who still need an onboarding step. Inactive/deactivated/departed records are excluded; each row has a concrete next action and due date.';

