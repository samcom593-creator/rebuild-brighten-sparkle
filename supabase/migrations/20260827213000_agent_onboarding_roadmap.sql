-- Every hire gets one receipt-backed answer to "what do I do next?".
-- Entitlement flags (for example has_training_course) are not completion.

create or replace function public.apex_agent_onboarding_roadmap(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agent public.agents%rowtype;
  v_name text;
  v_licensed boolean;
  v_slack boolean;
  v_call boolean;
  v_intake boolean;
  v_contracting boolean;
  v_active_modules integer;
  v_started_modules integer;
  v_passed_modules integer;
  v_training boolean;
  v_dialer boolean;
  v_first_deal boolean;
  v_slack_url text;
  v_call_url text;
  v_steps jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_total integer;
  v_next jsonb;
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this onboarding roadmap' using errcode = '42501';
  end if;

  select * into v_agent from public.agents where id = p_agent_id;
  if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;

  select coalesce(nullif(trim(v_agent.display_name), ''), nullif(trim(p.full_name), ''), 'APEX agent')
    into v_name
    from public.profiles p
   where p.id = v_agent.profile_id or p.user_id = v_agent.user_id
   order by (p.id = v_agent.profile_id) desc
   limit 1;
  v_name := coalesce(v_name, nullif(trim(v_agent.display_name), ''), 'APEX agent');

  v_licensed := v_agent.license_status::text = 'licensed';
  select exists (
    select 1 from public.messaging_identity_links mil
     where mil.agent_id = p_agent_id
       and mil.verification_status = 'verified'
       and mil.revoked_at is null
  ) into v_slack;
  v_call := public.fn_agent_onboarding_call_booking(p_agent_id) is not null;
  select exists (
    select 1 from public.contracting_intakes ci
     where ci.status in ('accepted', 'completed')
       and (
         ci.agent_id = p_agent_id
         or (v_agent.nipr_number is not null and ci.npn = v_agent.nipr_number)
       )
  ) into v_intake;
  v_contracting := v_call and (v_intake or v_agent.contracted_at is not null);

  select count(*)::int into v_active_modules from public.onboarding_modules where is_active = true;
  select count(*)::int,
         count(*) filter (where p.passed = true or p.completed_at is not null)::int
    into v_started_modules, v_passed_modules
    from public.onboarding_progress p
    join public.onboarding_modules m on m.id = p.module_id and m.is_active = true
   where p.agent_id = p_agent_id;
  v_training := v_agent.onboarding_completed_at is not null
    or (v_active_modules > 0 and v_passed_modules >= v_active_modules);
  v_dialer := coalesce(v_agent.has_dialer_login, false);
  v_first_deal := v_agent.first_deal_at is not null or exists (
    select 1 from public.deals d where d.agent_id = p_agent_id limit 1
  );

  select value into v_slack_url from public.system_settings where key = 'slack_community_invite_url';
  select value into v_call_url from public.system_settings where key = 'onboarding_call_scheduling_url';
  v_slack_url := coalesce(nullif(trim(v_slack_url), ''), 'https://apex-financial.org/dashboard/community');
  v_call_url := coalesce(nullif(trim(v_call_url), ''), 'https://calendly.com/apexfinancialempire/apex-onboarding-call');

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'slack', 'label', 'Join the APEX Slack',
    'detail', case when v_slack then 'Workspace identity verified. Team support and daily updates are live.' else 'Join the primary team workspace now; your invite was also sent by email.' end,
    'status', case when v_slack then 'complete' else 'current' end,
    'action_label', case when v_slack then null else 'Join Slack' end,
    'action_url', case when v_slack then null else v_slack_url end
  ));
  if v_slack then v_done := v_done + 1; end if;

  if not v_licensed then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', 'license', 'label', 'Finish your licensing roadmap',
      'detail', case when v_licensed then 'License confirmed.' else 'Update course, exam, fingerprint, and license milestones as they happen.' end,
      'status', case when v_licensed then 'complete' when v_slack then 'current' else 'locked' end,
      'action_label', case when v_licensed then null else 'Open licensing roadmap' end,
      'action_url', case when v_slack and not v_licensed then '/get-licensed' else null end
    ));
    if v_licensed then v_done := v_done + 1; end if;
  end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'contracting',
    'label', case when v_call then 'Finish contracting with Milver' else 'Book your Milver onboarding call' end,
    'detail', case
      when v_contracting then 'Milver call booked and native contracting intake received.'
      when not v_call then 'Milver is your Contracting & Onboarding Manager. Book the 30-minute fast-track call.'
      else 'Your Milver call is booked. Submit the native APEX contracting intake to finish this milestone.' end,
    'status', case when v_contracting then 'complete' when v_slack and v_licensed then 'current' else 'locked' end,
    'action_label', case when v_contracting then null when not v_call then 'Book with Milver' else 'Complete contracting' end,
    'action_url', case when not (v_slack and v_licensed) or v_contracting then null when not v_call then v_call_url else '/start-contracting' end
  ));
  if v_contracting then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'training', 'label', 'Complete online onboarding',
    'detail', case when v_training then 'All required onboarding modules are complete.' when v_started_modules > 0 then v_passed_modules || ' of ' || v_active_modules || ' required modules complete.' else 'Watch the APEX, script, objections, ReadyMode, pipeline, deal-posting, and underwriting walkthroughs.' end,
    'status', case when v_training then 'complete' when v_contracting then 'current' else 'locked' end,
    'action_label', case when v_training then null else 'Open training' end,
    'action_url', case when v_contracting and not v_training then '/dashboard/recruiting/training/library' else null end
  ));
  if v_training then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'dialer', 'label', 'Get ReadyMode field-ready',
    'detail', case when v_dialer then 'ReadyMode access is confirmed.' else 'Finish the four system walkthroughs and have your manager confirm dialer access.' end,
    'status', case when v_dialer then 'complete' when v_training then 'current' else 'locked' end,
    'action_label', case when v_dialer then null else 'Review ReadyMode training' end,
    'action_url', case when v_training and not v_dialer then '/dashboard/recruiting/training/library' else null end
  ));
  if v_dialer then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'first_deal', 'label', 'Post your first deal',
    'detail', case when v_first_deal then 'First sale is recorded in the canonical production ledger.' else 'Launch into the field and post the sale immediately so production and commissions update live.' end,
    'status', case when v_first_deal then 'complete' when v_dialer then 'current' else 'locked' end,
    'action_label', case when v_first_deal then null else 'Post a deal' end,
    'action_url', case when v_dialer and not v_first_deal then '/dashboard/production' else null end
  ));
  if v_first_deal then v_done := v_done + 1; end if;

  v_total := jsonb_array_length(v_steps);
  select step into v_next
    from jsonb_array_elements(v_steps) step
   where step->>'status' = 'current'
   limit 1;

  return jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_name', v_name,
    'path', case when v_licensed then 'licensed' else 'unlicensed' end,
    'completed_steps', v_done,
    'total_steps', v_total,
    'progress_percent', case when v_total = 0 then 0 else round(100.0 * v_done / v_total)::int end,
    'next_step_key', v_next->>'key',
    'next_step_label', v_next->>'label',
    'next_step_detail', v_next->>'detail',
    'next_step_url', v_next->>'action_url',
    'next_step_action', v_next->>'action_label',
    'contact_name', 'Milver Taca',
    'contact_email', 'milver.taca@gmail.com',
    'steps', v_steps
  );
end;
$$;

revoke all on function public.apex_agent_onboarding_roadmap(uuid) from public, anon;
grant execute on function public.apex_agent_onboarding_roadmap(uuid) to authenticated;

comment on function public.apex_agent_onboarding_roadmap(uuid) is
  'Receipt-backed licensed/unlicensed launch roadmap: Slack, licensing where needed, Milver contracting, training, ReadyMode, first deal.';

-- Keep the historical column names for API compatibility while replacing the
-- retired AgentLink/Discord meanings with native contracting + verified Slack.
create or replace view public.v_onboarding_sequence
with (security_invoker = true)
as
with a as (
  select ag.id agent_id,
    coalesce(ag.display_name, p.full_name, '(agent ' || left(ag.id::text, 8) || ')') agent_name,
    coalesce(m.display_name, 'unassigned') manager,
    ag.license_status::text license_status, ag.onboarding_stage::text onboarding_stage,
    ag.created_at hired_at, coalesce(ag.profile_id, p.id) profile_id, ag.al_user_id, ag.insuracloud_user_id,
    ag.nipr_number, ag.comp_percentage, ag.contracted_at, ag.first_appointment_at,
    ag.has_discord_access, ag.has_training_course, ag.has_dialer_login,
    ag.field_training_started_at, ag.onboarding_completed_at, ag.first_deal_at,
    ag.stage_changed_at, ag.next_action_text, ag.next_action_due_at,
    public.fn_agent_onboarding_call_booking(ag.id) is not null onboarding_call_booked,
    exists (select 1 from public.messaging_identity_links mil where mil.agent_id = ag.id and mil.verification_status = 'verified' and mil.revoked_at is null) slack_joined,
    exists (select 1 from public.contracting_intakes ci where ci.status in ('accepted','completed') and (ci.agent_id = ag.id or (ag.nipr_number is not null and ci.npn = ag.nipr_number))) contracting_started,
    exists (select 1 from public.onboarding_progress op where op.agent_id = ag.id) training_started,
    ((select count(*) from public.onboarding_modules om where om.is_active = true) > 0
      and (select count(*) from public.onboarding_progress op join public.onboarding_modules om on om.id = op.module_id and om.is_active = true where op.agent_id = ag.id and (op.passed = true or op.completed_at is not null))
        >= (select count(*) from public.onboarding_modules om where om.is_active = true)) training_complete
  from public.agents ag
  left join public.profiles p on p.id = ag.profile_id or p.user_id = ag.user_id
  left join public.agents m on m.id = ag.manager_id
  where ag.is_deactivated is not true and ag.is_inactive is not true and ag.canonical_agent_id is null
), flags as (
  select a.*,
    profile_id is not null r1,
    (license_status <> 'licensed' or (nullif(regexp_replace(coalesce(nipr_number,''),'\D','','g'),'') is not null and comp_percentage between 50 and 200)) r2,
    (contracted_at is not null or contracting_started) r3,
    onboarding_call_booked r4,
    slack_joined r5,
    training_started r6,
    ((onboarding_completed_at is not null or training_complete) and has_dialer_login is true) r7,
    first_deal_at is not null r8
  from a
)
select agent_id,agent_name,manager,license_status,onboarding_stage,hired_at,profile_id,
  al_user_id,insuracloud_user_id,contracted_at,first_appointment_at,has_discord_access,
  has_training_course,field_training_started_at,onboarding_completed_at,first_deal_at,
  stage_changed_at,next_action_text,next_action_due_at,
  r1 r1_intake,r2 r2_agentlink,r3 r3_contracted,r4 r4_appointment,r5 r5_discord,
  r6 r6_training,r7 r7_launch_ready,r8 r8_first_sale,
  case when not r1 then '1. Complete profile'
       when not r5 then '2. Join Slack'
       when not r2 then '3. Complete licensing / add NPN + comp'
       when not r4 then '4. Book onboarding with Milver'
       when not r3 then '5. Submit native contracting intake'
       when not r6 then '6. Start online onboarding'
       when not r7 then '7. Finish training + ReadyMode setup'
       when not r8 then '8. Post first deal'
       else 'COMPLETE — active producer' end next_missing_step,
  (r1::int+r2::int+r3::int+r4::int+r5::int+r6::int+r7::int+r8::int) rungs_complete,
  (extract(epoch from now()-coalesce(stage_changed_at,hired_at))/86400)::numeric(8,1) days_since_progress
from flags
order by rungs_complete,days_since_progress desc;

comment on view public.v_onboarding_sequence is
  'Native APEX launch ladder. Compatibility fields r2_agentlink/r5_discord now mean native contracting profile/verified Slack.';
