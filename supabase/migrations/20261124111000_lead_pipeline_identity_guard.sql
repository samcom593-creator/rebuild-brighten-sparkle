-- A lead's own source record is authoritative for contact enrichment. A shared
-- phone alone never selects a household member's DOB/address or pipeline record.
begin;
create or replace function public.my_lead_to_pipeline(p_item uuid)
returns jsonb language plpgsql security definer set search_path to 'public' set row_security to 'off' as $$
declare v record; v_agent uuid; v_client uuid; v_addr text; v_city text; v_zip text; v_dob date;
  v_phone_count int; v_identity_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select i.id,i.bundle_id,i.lead_id,i.source_kind,i.attrs,i.phone10,i.first_name,i.last_name,i.email,i.state,i.status,i.quality_tier,b.name as bundle_name
    into v from public.lead_bundle_items i join public.lead_bundles b on b.id=i.bundle_id and b.archived_at is null
   where i.id=p_item and i.removed_at is null;
  if v.id is null then raise exception 'That lead is no longer in a live bundle.' using errcode='22023'; end if;
  if not exists(select 1 from public.lead_bundle_grants g where g.bundle_id=v.bundle_id and g.user_id=auth.uid() and g.revoked_at is null) then
    raise exception 'This lead is not assigned to you.' using errcode='42501';
  end if;
  if v.phone10 is null or v.phone10 !~ '^[0-9]{10}$' then raise exception 'This lead has no usable phone number.' using errcode='22023'; end if;
  -- Same lock as suppression/assignment: a concurrent opt-out cannot be missed.
  perform pg_advisory_xact_lock(hashtextextended(v.phone10,951));
  if v.status='do_not_call' or exists(select 1 from public.lead_contact_dnc d where d.phone10=v.phone10 or d.phone10=v.attrs->>'replaced_phone10')
    or exists(select 1 from public.mat_lead_pool m where m.phone10=v.phone10 and
      (coalesce((m.flags->>'true_dnc')::boolean,m.dnc) or m.flags @> '{"current_client":true}' or m.flags @> '{"import_review_required":true}')) then
    raise exception 'This lead is held from contact or needs review. Ask the lead administrator to review its hold reason.' using errcode='23514';
  end if;
  v_agent := public.get_agent_id(auth.uid());
  if v_agent is null then raise exception 'No agent record is linked to this login. An admin can link it on the agent profile, then retry.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_agent::text || ':' || v.phone10,952));

  if v.source_kind='marketing' and v.lead_id is not null then
    select cl.street_address,cl.city,cl.zip,cl.dob into v_addr,v_city,v_zip,v_dob
      from public.client_leads cl where cl.id=v.lead_id;
  else
    select l.address,l.city,l.zip into v_addr,v_city,v_zip from public.readymode_leads l
     where l.phone10=v.phone10 and nullif(btrim(v.first_name),'') is not null and nullif(btrim(v.last_name),'') is not null
       and lower(btrim(l.first_name))=lower(btrim(v.first_name)) and lower(btrim(l.last_name))=lower(btrim(v.last_name))
     order by l.rm_lead_id desc limit 1;
  end if;

  select count(*)::int,count(*) filter(where nullif(btrim(v.first_name),'') is not null and nullif(btrim(v.last_name),'') is not null
       and lower(btrim(c.first_name))=lower(btrim(v.first_name)) and lower(btrim(c.last_name))=lower(btrim(v.last_name))
       and (v_dob is null or c.date_of_birth is null or c.date_of_birth=v_dob))::int
    into v_phone_count,v_identity_count from public.agentlink_clients c where c.agent_id=v_agent
      and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)=v.phone10;
  if v_identity_count=1 then
    select c.id into v_client from public.agentlink_clients c where c.agent_id=v_agent
      and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)=v.phone10
      and lower(btrim(c.first_name))=lower(btrim(v.first_name)) and lower(btrim(c.last_name))=lower(btrim(v.last_name))
      and (v_dob is null or c.date_of_birth is null or c.date_of_birth=v_dob);
    return jsonb_build_object('client_id',v_client,'created',false);
  elsif v_phone_count>0 then
    raise exception 'This phone matches a different or ambiguous client identity. A lead administrator must review the household match.' using errcode='23514';
  end if;

  insert into public.agentlink_clients(agent_id,first_name,last_name,phone,email,street_address,city,state,zip_code,date_of_birth,
    communication_notes,pipeline_stage,external_source,created_at,updated_at)
  values(v_agent,left(coalesce(nullif(btrim(v.first_name),''),'Lead'),120),left(coalesce(nullif(btrim(v.last_name),''),'(last name not on file)'),120),
    v.phone10,nullif(left(btrim(coalesce(v.email,'')),254),''),nullif(left(btrim(coalesce(v_addr,'')),200),''),
    nullif(left(btrim(coalesce(v_city,'')),100),''),case when btrim(coalesce(v.state,'')) ~ '^[A-Za-z]{2}$' then upper(btrim(v.state)) end,
    nullif(left(btrim(coalesce(v_zip,'')),10),''),v_dob,'From My Leads: ' || v.bundle_name,'NEW_INITIAL','apex',now(),now()) returning id into v_client;
  insert into public.client_pipeline_activity(client_id,activity_type,body,created_by)
    values(v_client,'client_created','Added from My Leads (' || v.bundle_name || ')',auth.uid());
  insert into public.lead_bundle_events(bundle_id,item_id,user_id,actor,action,detail)
    values(v.bundle_id,p_item,auth.uid(),auth.uid(),'to_pipeline',jsonb_build_object('client_id',v_client,'lead_id',v.lead_id));
  return jsonb_build_object('client_id',v_client,'created',true);
end $$;
revoke all on function public.my_lead_to_pipeline(uuid) from public,anon;
grant execute on function public.my_lead_to_pipeline(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
