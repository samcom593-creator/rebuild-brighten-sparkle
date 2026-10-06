-- MP-584 (2026-10-06). The placeholder rule's GRAIN, on the two sites where
-- the lexical spelling has a measured live consequence.
--
-- Check #90 (MP-583) froze 14 objects that inline a GHOST rule and deliberately
-- did NOT grade whether each uses the right grain. This is that wave. All 14
-- were read from pg_catalog and measured against their OWN predicate, not by
-- presence of the string:
--
--   correct grain already (rule is the projected is_sync_only column, not a
--   filter):            crm_agent_roster, crm_agent_roster_unguarded
--   lexical but LATENT (own predicate already excludes all 10 via status/scope):
--                       v_apex_roster (is_inactive=false), v_recent_hires,
--                       v_hire_notification_gaps, v_sales_challenges,
--                       landing_hire_meter (status='active'),
--                       contracting_checkin_list (0 of 10 in its scope)
--   lexical, write-path, deliberately left conservative: fn_notify_agent_hired,
--                       trg_fn_agent_inserted_discord, ingest_ayro_sales_deal,
--                       ingest_discord_production_deal — these SUPPRESS a
--                       broadcast on a GHOST_ code. Widening them makes a live
--                       Discord channel post, which is a greenlight item, and
--                       suppressing too much is the safe direction.
--   lexical AND LEAKING: the two fixed here.
--
-- THE HANDOFF NAMED THE WRONG OBJECT. 20261005003000's open item warned that "a
-- lexical-only copy on crm_agent_roster would be hiding 10 real producers
-- carrying 112 deals from Sam's CRM right now". Measured: crm_agent_roster is
-- one of the two that is already CORRECT, and its GHOST test is not even a
-- filter -- it is the is_sync_only boolean projected to the client. Its audience
-- is set by is_inactive=false.
--
-- WHAT IS ACTUALLY LEAKING. 10 agents carry a GHOST_ agent_code AND a real
-- user_id (112 deals: Parrish Lyon 34, Alyjah Rowland 30, Josiah Darden 28,
-- Alex Wordu 10, +6 more). is_placeholder_agent() says they are NOT
-- placeholders. The lexical form drops them anyway:
--
--   crm_agents_export() -- the CSV behind DashboardCRM's "download all agents"
--   button Sam asked for on 2026-09-30. Its own comment states the contract:
--   "every non-duplicate, NON-PLACEHOLDER agent at ANY STATUS". It has no status
--   filter and maps status -> inactive/terminated on purpose, so inactive people
--   are in scope by design. 193 rows today, 203 after. Sam downloads this and
--   works it.
--
--   recruit_pipeline_list() -- RecruitPipeline.tsx. REFUTED MY OWN HESITATION
--   WITH A MEASUREMENT: I nearly left this alone on the theory that admitting 10
--   inactive agents to an active recruiting board is a regression. 110 of its
--   193 agent-rows are ALREADY inactive non-ghost agents. The board shows
--   inactive people as a matter of course, so these 10 were hidden purely for
--   the spelling of their agent_code while 110 identical peers render. Fixing
--   the grain makes them consistent with their peers; it does not change the
--   board's scope.
--
-- BOTH DIRECTIONS, NOT JUST THE LOUD ONE. Removing the GHOST clause outright
-- would admit the 6 live GHOST_AYRO_* placeholders (all status='active',
-- is_inactive=false, so nothing else here stops them) and put 6 fabricated
-- people into Sam's CSV. not is_placeholder_agent() admits the 10 and keeps the
-- 6 out. The proof block below asserts both counts, because a fix that is right
-- in one direction and wrong in the other is how this rule got written wrong
-- twice already.
--
-- Bodies below are pg_get_functiondef() output with exactly ONE clause
-- substituted (asserted exact-1, and asserted no second lexical copy survives).

CREATE OR REPLACE FUNCTION public.crm_agents_export()
 RETURNS TABLE(first_name text, last_name text, email text, npn text, phone text, status text, license_status text, manager_name text, agent_code text, start_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(nullif(split_part(coalesce(pr.full_name, g.display_name), ' ', 1),''), g.display_name),
    nullif(regexp_replace(coalesce(pr.full_name, g.display_name), '^\S+\s*', ''), ''),
    coalesce(nullif(pr.email,''), (select ci.email from public.contracting_intakes ci where ci.agent_id = g.id and ci.email <> '' order by ci.created_at desc limit 1), ap.email),
    coalesce(nullif(g.nipr_number,''), (select ci.npn from public.contracting_intakes ci where ci.agent_id = g.id and ci.npn <> '' order by ci.created_at desc limit 1), nullif(ap.nipr_number,'')),
    coalesce(nullif(pr.phone,''), (select ci.phone_e164 from public.contracting_intakes ci where ci.agent_id = g.id and ci.phone_e164 <> '' order by ci.created_at desc limit 1), ap.phone),
    case when coalesce(g.is_deactivated,false) or g.status = 'terminated' then 'terminated'
         when coalesce(g.is_inactive,false) or g.status = 'inactive' then 'inactive' else g.status::text end,
    g.license_status::text, mg.display_name, g.agent_code, g.start_date
  from public.agents g
  left join public.profiles pr on pr.id = g.profile_id
  left join public.applications ap on ap.id = g.source_application_id
  left join public.agents mg on mg.id = g.manager_id
  where public.crm_can_read_roster()
    and g.canonical_agent_id is null
    and not public.is_placeholder_agent(g.agent_code, g.user_id)
  order by 2, 1;
$function$;

CREATE OR REPLACE FUNCTION public.recruit_pipeline_list()
 RETURNS TABLE(person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text, stage_key text, stage_name text, order_index integer, entered_at timestamp with time zone, days_in_stage numeric, is_stalled boolean, sla_due_at timestamp with time zone, next_action_label text, manager_name text, license_status text, license_progress text, npn text, last_contacted_at timestamp with time zone, manual_stage_key text, status text, instagram text, link_sent_at timestamp with time zone, link_used_at timestamp with time zone, last_sign_in_at timestamp with time zone, resident_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false)
  select p.person_type, p.application_id, p.agent_id,
         coalesce(g.display_name, nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'),''), '(no name)'),
         coalesce(nullif(pr.phone,''), nullif(a.phone,'')), coalesce(pr.email, a.email), a.state,
         p.current_stage_key, s.display_name, s.order_index, p.entered_at,
         round(extract(epoch from now() - p.entered_at) / 86400.0, 1), coalesce(p.is_stalled,false), p.sla_due_at, s.next_action_label,
         coalesce(mg.display_name, hm.display_name),
         coalesce(g.license_status::text, a.license_status::text),
         coalesce(g.license_progress::text, a.license_progress::text),
         coalesce(nullif(g.nipr_number,''), nullif(a.nipr_number,'')),
         coalesce(a.last_contacted_at, g.updated_at), p.manual_stage_key, p.status,
         public.fn_normalize_instagram_handle(coalesce(nullif(btrim(pr.instagram_handle),''), nullif(btrim(a.instagram_handle),''), nullif(btrim(sa.instagram_handle),''))),
         lk.link_sent_at, lk.link_used_at, u.last_sign_in_at,
         public.fn_normalize_us_state(coalesce(
           nullif(btrim(g.metadata->>'resident_state'),''),
           nullif(btrim(sa.state),''),
           nullif(btrim(ea.state),''),
           nullif(btrim(ala.residence_state),''), nullif(btrim(ala.state),''),
           (g.license_states)[1],
           nullif(btrim(a.state),'')))
  from public.next_step_progress p
  join public.next_step_stages s on s.stage_key = p.current_stage_key
  left join public.applications a on a.id = p.application_id
  left join public.agents g on g.id = p.agent_id
  left join public.profiles pr on pr.id = g.profile_id
  left join public.agents mg on mg.id = g.manager_id
  left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
  left join public.applications sa on sa.id = g.source_application_id
  left join lateral (select max(t.created_at) link_sent_at, max(t.used_at) link_used_at from public.magic_login_tokens t where t.agent_id = g.id) lk on true
  left join auth.users u on u.id = g.user_id
  left join lateral (select x.state from public.applications x where g.id is not null and pr.email is not null and lower(x.email) = lower(pr.email) and coalesce(x.is_duplicate,false) = false order by x.created_at desc limit 1) ea on true
  left join lateral (select x.residence_state, x.state from public.agentlink_agents x
                      where g.id is not null and (x.local_agent_id = g.id
                         or (g.insuracloud_user_id is not null and x.insuracloud_user_id = g.insuracloud_user_id)
                         or (g.al_user_id is not null and x.insuracloud_user_id = g.al_user_id)
                         or (pr.email is not null and lower(x.email) = lower(pr.email)))
                      order by x.updated_at desc nulls last limit 1) ala on true
  where auth.uid() is not null
    and (p.application_id is not null or (g.id is not null and g.canonical_agent_id is null and not public.is_placeholder_agent(g.agent_code, g.user_id)))
    and (a.id is null or coalesce(a.is_duplicate,false) = false)
    -- A person who already has an agent row is tracked as that agent; never show
    -- them a second time as an applicant stuck at "Applied".
    and (a.id is null or not exists (
          select 1 from public.agents ag
          left join public.profiles pr on pr.id = ag.profile_id
          where ag.canonical_agent_id is null
            and (ag.source_application_id = a.id
                 or (a.email is not null and pr.email is not null and lower(pr.email) = lower(a.email)))))
    and ( (select ok from staff)
          or ((select ok from mgr) and (
                (p.agent_id is not null and exists (select 1 from public.fn_contracting_checkin_scope() sc where sc.agent_id = p.agent_id))
             or (p.application_id is not null and (a.hiring_manager_user_id = auth.uid() or a.recruiter_id = auth.uid()
                  or a.assigned_agent_id = any(coalesce((select ids from mine),'{}')) or a.referral_manager_id = any(coalesce((select ids from mine),'{}'))))))
        );
$function$;
