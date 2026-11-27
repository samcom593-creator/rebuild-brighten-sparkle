-- MP-ONE-LINK-ETHOS (2): the public one-link now attests through the link owner (previous migration), but a
-- hire who came in another way (hire link, sweep-created intake) and adds their NPN later still had no
-- approval row, so the Ethos sheet leg could only ever park in manual_review. Samuel Nwankwo (hired 11-26)
-- is that case today: licensed, intake on file, NPN missing. Every 10 minutes this sweep finds licensed
-- intakes that carry an NPN, are linked to an active agent, and have no approval row and no delivered
-- Ethos row, and submits them through submit_downline_contracting on the service path with the agent's
-- manager as the attesting actor (principal fallback). Same gate, same attested-mode review findings,
-- nothing defaulted beyond what the manager path already defaults. Bounded to 10 per run; one failure
-- never stops the rest; each decision is returned so the cron log is the receipt.
--
-- Applied live 2026-11-27 03:52Z through the Supabase MCP apply_migration (version = file name).
-- Dry run at apply: 5 old intakes in scope; 4 refused by the function's own checks (2 npn_near_duplicate,
-- 2 email_belongs_to_other), 1 ok. Cron jobid 358.
create or replace function public.fn_contracting_ethos_autosubmit(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare r record; v_out jsonb := '[]'::jsonb; v_actor uuid; v_res jsonb; v_errors int := 0;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for r in
    select i.id as intake_id, i.agent_id, i.first_name, i.last_name, i.email, i.phone_e164, i.npn, a.manager_id
      from public.contracting_intakes i
      join public.agents a on a.id = i.agent_id
     where i.npn is not null and i.npn ~ '^[0-9]{5,10}$'
       and i.agent_id is not null
       and coalesce(i.license_status::text, '') = 'licensed'
       and a.status::text = 'active' and coalesce(a.is_deactivated, false) = false
       and not exists (select 1 from public.contracting_ethos_approvals ap where ap.intake_id = i.id)
       and not exists (select 1 from public.contracting_intake_deliveries d where d.intake_id = i.id and d.destination = 'ethos_sheet' and d.state = 'delivered')
     order by i.created_at desc
     limit 10
  loop
    v_actor := coalesce(r.manager_id, (select id from public.agents where nipr_number = public.fn_ethos_principal_npn() limit 1));
    if v_actor is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('intake_id', r.intake_id, 'decision', 'skip', 'reason', 'no manager and no principal agent'));
      continue;
    end if;
    begin
      v_res := public.submit_downline_contracting(jsonb_build_object(
        'first_name', r.first_name, 'last_name', r.last_name, 'email', r.email, 'phone', r.phone_e164, 'npn', r.npn,
        'license_status', 'licensed', 'actor_agent_id', v_actor, 'license_attested', true, 'eo_attested', false,
        'source', 'ethos_autosubmit', 'request_type', 'contracting'), p_dry_run);
      v_out := v_out || jsonb_build_array(jsonb_build_object('intake_id', r.intake_id, 'first_name', r.first_name, 'decision', coalesce(v_res->>'verdict', case when (v_res->>'ok')::boolean then 'submitted' else 'refused' end), 'delivery', v_res->>'delivery', 'message', v_res->>'message'));
    exception when others then
      v_errors := v_errors + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('intake_id', r.intake_id, 'first_name', r.first_name, 'decision', 'error', 'error', left(sqlstate || ' ' || sqlerrm, 200)));
    end;
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'decisions', v_out, 'errors', v_errors, 'at', now());
end $$;
revoke all on function public.fn_contracting_ethos_autosubmit(boolean) from public, anon, authenticated;

do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'apex-contracting-ethos-autosubmit') then
    perform cron.schedule('apex-contracting-ethos-autosubmit', '*/10 * * * *', $cmd$select public.fn_contracting_ethos_autosubmit(false);$cmd$);
  end if;
end $do$;

-- Dry run now: name who it would touch today without writing anything.
select public.fn_contracting_ethos_autosubmit(true);
