-- Hold possible repeat coverage in the saved draft, before production or delivery.
-- Exact policy/retry identity retains the existing submit implementation. Names
-- alone never hold a deal. No card information, new customer identifiers or sends.
begin;

create table public.deal_coverage_reviews (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.deal_drafts(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  agent_id uuid not null references public.agents(id) on delete restrict,
  manager_agent_id uuid references public.agents(id) on delete set null,
  payload_hash text not null,
  evidence_hash text not null,
  matched_deal_ids uuid[] not null check (cardinality(matched_deal_ids) > 0),
  match_signals text[] not null check (cardinality(match_signals) > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','submitted')),
  version integer not null default 1 check (version > 0),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  decision_reason text,
  deal_id uuid references public.deals(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, idempotency_key),
  check ((status in ('approved','rejected','submitted')) = (reviewed_by is not null and reviewed_at is not null and decision_reason is not null)),
  check ((status = 'submitted') = (deal_id is not null))
);
create index deal_coverage_reviews_work_idx on public.deal_coverage_reviews(status, created_at);
create index deals_coverage_identity_idx on public.deals(carrier_id, client_dob)
  where duplicate_of_deal_id is null and status <> 'draft';
alter table public.deal_coverage_reviews enable row level security;
revoke all on public.deal_coverage_reviews from public, anon, authenticated, service_role;

-- A transaction-local permit closes direct table INSERT and draft-promotion
-- bypasses. Only the authenticated submit wrapper can create it; it is removed
-- before that function returns. No payload or customer data is stored here.
create table public.deal_coverage_post_permits (
  transaction_id bigint not null,
  owner_user_id uuid not null,
  idempotency_key uuid not null,
  agent_id uuid not null,
  primary key (transaction_id, owner_user_id, idempotency_key)
);
alter table public.deal_coverage_post_permits enable row level security;
revoke all on public.deal_coverage_post_permits from public, anon, authenticated, service_role;

create function public.deal_coverage_name(p_first text, p_last text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_first,'') || ' ' || coalesce(p_last,'')), '[[:space:]]+', ' ', 'g'));
$$;
create function public.deal_coverage_phone(p_phone text)
returns text language sql immutable set search_path = public as $$
  select case when length(d)=11 and left(d,1)='1' then substr(d,2) else d end
  from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d) normalized;
$$;
create function public.deal_coverage_payload_hash(p_payload jsonb, p_agent_id uuid)
returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(jsonb_build_object('agent_id',p_agent_id,'payload',p_payload)::text,'UTF8')),'hex');
$$;
create function public.deal_coverage_candidates(p_carrier_id uuid, p_dob date, p_name text, p_phone text, p_exclude uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with matched as (
    select d.id, d.agent_id, d.carrier_id, d.client_dob,
      public.deal_coverage_name(d.client_first_name,d.client_last_name) as name_key,
      public.deal_coverage_phone(d.client_phone) as phone_key,
      d.policy_number, d.status,
      p_name <> '' and public.deal_coverage_name(d.client_first_name,d.client_last_name)=p_name as name_match,
      length(p_phone)>=10 and public.deal_coverage_phone(d.client_phone)=p_phone as phone_match
    from public.deals d
    where d.carrier_id=p_carrier_id and d.client_dob=p_dob
      and d.duplicate_of_deal_id is null and d.status <> 'draft'
      and (p_exclude is null or d.id<>p_exclude)
      and ((p_name<>'' and public.deal_coverage_name(d.client_first_name,d.client_last_name)=p_name)
        or (length(p_phone)>=10 and public.deal_coverage_phone(d.client_phone)=p_phone))
  )
  select jsonb_build_object(
    'ids',coalesce(jsonb_agg(id order by id),'[]'::jsonb),
    'signals',to_jsonb(array_remove(array[
      case when bool_or(name_match) then 'name_dob' end,
      case when bool_or(phone_match) then 'phone_dob' end],null)),
    'hash',encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'agent',agent_id,'carrier',carrier_id,'dob',client_dob,
      'name',name_key,'phone',phone_key,'policy',policy_number,'status',status) order by id),'[]'::jsonb)::text,'UTF8')),'hex'))
  from matched;
$$;

create function public.deal_coverage_manager_access(p_agent_id uuid, p_manager_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.fn_user_login_blocked(auth.uid()) and not public.fn_user_is_suspended(auth.uid()) and (public.apex_is_admin() or (
    public.apex_has_any_role(array['manager']) and public.apex_can_read_agent(p_agent_id)
    and exists(select 1 from public.agents own join public.agents assigned on assigned.id=p_manager_id
      where own.user_id=auth.uid() and own.status::text='active' and not coalesce(own.is_inactive,false) and not coalesce(own.is_deactivated,false)
        and coalesce(own.canonical_agent_id,own.id)=coalesce(assigned.canonical_agent_id,assigned.id))));
$$;
create function public.deal_coverage_can_decide(p_agent_id uuid, p_manager_id uuid, p_matches uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  -- Book visibility was explicitly restricted to own records and the owner's
  -- full-reader list. Hierarchy membership must not reopen client-book access.
  select public.deal_coverage_manager_access(p_agent_id,p_manager_id) and public.api_is_full_reader();
$$;

create function public.deal_coverage_requires_admin(p_manager_id uuid,p_matches uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  with manager_users as (
    select distinct a.user_id from public.agents a join public.agents m on m.id=p_manager_id
    where a.user_id is not null and a.status::text='active' and not coalesce(a.is_inactive,false) and not coalesce(a.is_deactivated,false)
      and not public.fn_user_login_blocked(a.user_id) and not public.fn_user_is_suspended(a.user_id)
      and coalesce(a.canonical_agent_id,a.id)=coalesce(m.canonical_agent_id,m.id)
      and exists(select 1 from public.user_roles ur where ur.user_id=a.user_id and ur.role::text in ('manager','admin','super_admin','owner'))
  )
  select not exists(select 1 from manager_users m where exists(select 1 from public.user_roles ur where ur.user_id=m.user_id and ur.role::text='admin')
    or exists(select 1 from public.book_readers b where b.user_id=m.user_id));
$$;

create function public.enforce_deal_coverage_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_matches jsonb;
begin
  -- Trusted carrier ingestion has no end-user identity. Authenticated table
  -- writes, including admin bulk entry, still have to pass the same guard.
  if auth.uid() is null then return new; end if;
  if public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'This account cannot post deals' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.status <> 'draft'
    and old.agent_id is not distinct from new.agent_id
    and old.carrier_id is not distinct from new.carrier_id
    and old.client_dob is not distinct from new.client_dob
    and public.deal_coverage_name(old.client_first_name,old.client_last_name)=public.deal_coverage_name(new.client_first_name,new.client_last_name)
    and public.deal_coverage_phone(old.client_phone)=public.deal_coverage_phone(new.client_phone) then return new; end if;
  if new.carrier_id is null or new.client_dob is null or new.client_dob>=current_date
    or nullif(btrim(new.client_first_name),'') is null or nullif(btrim(new.client_last_name),'') is null
    or length(public.deal_coverage_phone(new.client_phone))<10 then
    raise exception 'A complete insured name, valid date of birth, phone and carrier are required. Use Post a Deal.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deal-coverage:' || new.carrier_id::text || ':' || new.client_dob::text,0));
  v_matches:=public.deal_coverage_candidates(new.carrier_id,new.client_dob,
    public.deal_coverage_name(new.client_first_name,new.client_last_name),public.deal_coverage_phone(new.client_phone),new.id);
  if jsonb_array_length(v_matches->'ids')>0 and not exists (
    select 1 from public.deal_coverage_post_permits p where p.transaction_id=txid_current()
      and p.owner_user_id=auth.uid() and p.idempotency_key=new.idempotency_key and p.agent_id=new.agent_id
  ) then
    raise exception 'Existing coverage needs manager review. Use Post a Deal to save a review request before posting.' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger zz_deal_coverage_review_guard
  before insert or update of agent_id, carrier_id, client_dob, client_first_name, client_last_name, client_phone, status, source
  on public.deals for each row execute function public.enforce_deal_coverage_review();

-- Preserve the exact deployed ledger/retry implementation; deny its renamed
-- entry point to API callers so the review gate cannot be bypassed by RPC.
do $$
declare v_source text;
begin
  if to_regprocedure('public.submit_apex_deal_before_coverage_review(uuid,jsonb,uuid)') is not null then
    raise exception 'Coverage baseline already exists; reconcile migration history instead of replacing it';
  end if;
  select pg_get_functiondef('public.submit_apex_deal(uuid,jsonb,uuid)'::regprocedure) into v_source;
  if position('submit_apex_deal_ledger_impl' in v_source)=0 or position('already_recorded' in v_source)=0
    or position('pg_advisory_xact_lock' in v_source)=0 then
    raise exception 'Unexpected submit contract; refusing to replace it';
  end if;
  alter function public.submit_apex_deal(uuid,jsonb,uuid) rename to submit_apex_deal_before_coverage_review;
end;
$$;
revoke all on function public.submit_apex_deal_before_coverage_review(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.submit_apex_deal_ledger_impl(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.submit_apex_deal(p_idempotency_key uuid, p_payload jsonb, p_agent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public,extensions as $$
declare
  v_user uuid:=auth.uid(); v_own uuid; v_agent uuid; v_manager uuid; v_carrier uuid; v_dob date;
  v_name text; v_phone text; v_hash text; v_evidence jsonb; v_matches uuid[]; v_signals text[];
  v_draft public.deal_drafts; v_review public.deal_coverage_reviews; v_result jsonb; v_policy text; v_npn text;
begin
  if v_user is null or public.fn_user_login_blocked(v_user) or public.fn_user_is_suspended(v_user) then raise exception 'An eligible authenticated account is required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>100000 then raise exception 'A valid bounded deal payload and retry key are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text,0));
  select a.id into v_own from public.agents a where a.user_id=v_user order by a.created_at limit 1;
  v_agent:=coalesce(p_agent_id,v_own);
  if v_agent is null then raise exception 'No agent record is linked to this account' using errcode='22023'; end if;
  if v_agent is distinct from v_own and not public.apex_is_admin()
    and not (public.apex_has_any_role(array['manager']) and public.apex_can_read_agent(v_agent)) then
    raise exception 'Writing-agent override is not permitted' using errcode='42501';
  end if;
  select a.manager_id, nullif(regexp_replace(coalesce(a.nipr_number,''),'[^0-9]','','g'),'')
    into v_manager,v_npn from public.agents a where a.id=v_agent;
  if not found then raise exception 'Writing agent does not exist' using errcode='22023'; end if;
  -- Existing receipts are still receipts, even if the book gained new coverage.
  if exists(select 1 from public.deals d where d.submitted_by_user_id=v_user and d.idempotency_key=p_idempotency_key) then
    return public.submit_apex_deal_before_coverage_review(p_idempotency_key,p_payload,p_agent_id);
  end if;
  begin
    v_carrier:=(p_payload->>'carrierId')::uuid; v_dob:=(p_payload->>'clientDob')::date;
  exception when others then raise exception 'A valid carrier and client date of birth are required' using errcode='22023'; end;
  v_name:=public.deal_coverage_name(p_payload->>'clientFirstName',p_payload->>'clientLastName');
  v_phone:=public.deal_coverage_phone(p_payload->>'clientPhone');
  if v_carrier is null or v_dob is null or v_dob>=current_date or v_name=''
    or nullif(btrim(p_payload->>'clientFirstName'),'') is null or nullif(btrim(p_payload->>'clientLastName'),'') is null
    or length(v_phone)<10 or length(v_phone)>15 then
    raise exception 'Complete the insured name, valid date of birth, phone and carrier before submitting' using errcode='22023';
  end if;
  if not exists(select 1 from public.carriers where id=v_carrier and coalesce(is_active,true)) then
    raise exception 'Selected carrier is not active' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('deal-coverage:' || v_carrier::text || ':' || v_dob::text,0));
  v_policy:=public.fn_normalize_policy_number(p_payload->>'policyNumber');
  if v_policy<>'' and v_npn is not null and exists(select 1 from public.deals d where d.carrier_id=v_carrier
    and lower(btrim(d.policy_number))=lower(v_policy) and d.writing_npn=v_npn and d.duplicate_of_deal_id is null) then
    return public.submit_apex_deal_before_coverage_review(p_idempotency_key,p_payload,p_agent_id);
  end if;
  -- Offline requests may reach the server before their earlier draft save.
  -- Store exactly the reviewed payload, never a stale merged form fragment.
  insert into public.deal_drafts(owner_user_id,idempotency_key,current_section,payload)
    values(v_user,p_idempotency_key,'review',p_payload)
    on conflict(owner_user_id,idempotency_key) do update
      set payload=excluded.payload,current_section='review',updated_at=now()
    returning * into v_draft;
  if v_draft.status<>'draft' then raise exception 'This draft is no longer open; refresh before retrying' using errcode='40001'; end if;
  v_hash:=public.deal_coverage_payload_hash(p_payload,v_agent);
  v_evidence:=public.deal_coverage_candidates(v_carrier,v_dob,v_name,v_phone);
  select coalesce(array_agg(x::uuid),'{}'::uuid[]) into v_matches from jsonb_array_elements_text(v_evidence->'ids') x;
  select coalesce(array_agg(x),'{}'::text[]) into v_signals from jsonb_array_elements_text(v_evidence->'signals') x;
  select * into v_review from public.deal_coverage_reviews where owner_user_id=v_user and idempotency_key=p_idempotency_key for update;
  if cardinality(v_matches)>0 then
    if v_review.id is null then
      insert into public.deal_coverage_reviews(draft_id,owner_user_id,idempotency_key,agent_id,manager_agent_id,payload_hash,evidence_hash,matched_deal_ids,match_signals)
        values(v_draft.id,v_user,p_idempotency_key,v_agent,v_manager,v_hash,v_evidence->>'hash',v_matches,v_signals) returning * into v_review;
    elsif v_review.payload_hash<>v_hash or v_review.evidence_hash<>v_evidence->>'hash'
      or v_review.agent_id<>v_agent or v_review.manager_agent_id is distinct from v_manager then
      insert into public.audit_log(action,actor_user_id,before_data,after_data,entity_id,entity_type)
        values('deal.coverage_review_invalidated',v_user,jsonb_build_object('status',v_review.status,'version',v_review.version),
          jsonb_build_object('reason','draft_or_coverage_changed'),v_review.id::text,'deal_coverage_review');
      update public.deal_coverage_reviews set draft_id=v_draft.id,agent_id=v_agent,manager_agent_id=v_manager,
        payload_hash=v_hash,evidence_hash=v_evidence->>'hash',matched_deal_ids=v_matches,match_signals=v_signals,
        status='pending',version=version+1,reviewed_by=null,reviewed_at=null,decision_reason=null,deal_id=null,updated_at=now()
        where id=v_review.id returning * into v_review;
    end if;
    if v_review.status<>'approved' then
      return jsonb_build_object('ok',false,'status',case when v_review.status='rejected' then 'review_rejected' else 'review_required' end,
        'reviewId',v_review.id,'reviewVersion',v_review.version,'matchCount',cardinality(v_matches));
    end if;
  elsif v_review.id is not null then
    -- A changed identity cannot reuse an earlier approval. The normal no-match
    -- path is re-evaluated from the actual payload; no policy is auto-deleted.
    if v_review.payload_hash<>v_hash or v_review.evidence_hash<>v_evidence->>'hash' then
      raise exception 'This reviewed draft changed. Start a new deal after correcting the insured details.' using errcode='40001';
    end if;
    if v_review.status<>'approved' then
      return jsonb_build_object('ok',false,'status',case when v_review.status='rejected' then 'review_rejected' else 'review_required' end,
        'reviewId',v_review.id,'reviewVersion',v_review.version,'matchCount',0);
    end if;
  end if;
  insert into public.deal_coverage_post_permits(transaction_id,owner_user_id,idempotency_key,agent_id)
    values(txid_current(),v_user,p_idempotency_key,v_agent);
  v_result:=public.submit_apex_deal_before_coverage_review(p_idempotency_key,p_payload,p_agent_id);
  delete from public.deal_coverage_post_permits where transaction_id=txid_current() and owner_user_id=v_user and idempotency_key=p_idempotency_key;
  if v_result->>'dealId' is null then raise exception 'Posting returned no durable deal receipt' using errcode='P0001'; end if;
  if v_review.id is not null then
    update public.deal_coverage_reviews set status='submitted',deal_id=(v_result->>'dealId')::uuid,version=version+1,updated_at=now()
      where id=v_review.id;
  end if;
  return v_result;
end;
$$;

create function public.decide_deal_coverage_review(p_review_id uuid, p_decision text, p_reason text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_review public.deal_coverage_reviews; v_draft public.deal_drafts; v_evidence jsonb;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then raise exception 'An eligible authenticated account is required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') or p_decision is null or length(btrim(coalesce(p_reason,'')))<20
    or length(btrim(p_reason))>2000 then raise exception 'Choose approve or reject and give a 20–2000 character reason' using errcode='22023'; end if;
  select * into v_review from public.deal_coverage_reviews where id=p_review_id for update;
  if not found or not public.deal_coverage_can_decide(v_review.agent_id,v_review.manager_agent_id,v_review.matched_deal_ids) then
    raise exception 'Only the assigned manager with matching-policy access or an administrator can decide this review' using errcode='42501'; end if;
  if p_expected_version is null or v_review.version<>p_expected_version or v_review.status<>'pending' then
    raise exception 'Review changed; refresh before deciding' using errcode='40001'; end if;
  select * into v_draft from public.deal_drafts where id=v_review.draft_id;
  if v_draft.status<>'draft' or public.deal_coverage_payload_hash(v_draft.payload,v_review.agent_id)<>v_review.payload_hash then
    raise exception 'Draft changed; the requester must resubmit it for review' using errcode='40001'; end if;
  v_evidence:=public.deal_coverage_candidates((v_draft.payload->>'carrierId')::uuid,(v_draft.payload->>'clientDob')::date,
    public.deal_coverage_name(v_draft.payload->>'clientFirstName',v_draft.payload->>'clientLastName'),public.deal_coverage_phone(v_draft.payload->>'clientPhone'));
  if v_review.evidence_hash<>v_evidence->>'hash' then
    raise exception 'Existing coverage changed; the requester must resubmit it for review' using errcode='40001'; end if;
  update public.deal_coverage_reviews set status=p_decision,version=version+1,reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where id=p_review_id returning * into v_review;
  insert into public.audit_log(action,actor_user_id,after_data,entity_id,entity_type)
    values('deal.coverage_review_decided',auth.uid(),jsonb_build_object('decision',p_decision,'reason',btrim(p_reason),'version',v_review.version),
      p_review_id::text,'deal_coverage_review');
  return jsonb_build_object('ok',true,'reviewId',p_review_id,'status',v_review.status,'version',v_review.version);
end;
$$;

create function public.resume_deal_coverage_review(p_review_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_review public.deal_coverage_reviews; v_draft public.deal_drafts;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then raise exception 'An eligible authenticated account is required' using errcode='42501'; end if;
  -- Do not lock the review before submit's per-user/carrier locks: that would
  -- invert the lock order against a simultaneous ordinary retry.
  select * into v_review from public.deal_coverage_reviews where id=p_review_id;
  if not found or v_review.owner_user_id<>auth.uid() then raise exception 'Only the original requester can post this reviewed draft' using errcode='42501'; end if;
  if p_expected_version is null or v_review.version<>p_expected_version or v_review.status not in ('approved','submitted') then
    raise exception 'Review changed; refresh before posting' using errcode='40001'; end if;
  select * into v_draft from public.deal_drafts where id=v_review.draft_id;
  if public.deal_coverage_payload_hash(v_draft.payload,v_review.agent_id)<>v_review.payload_hash then
    raise exception 'Draft changed; resubmit it for a new review' using errcode='40001'; end if;
  return public.submit_apex_deal(v_review.idempotency_key,v_draft.payload,v_review.agent_id);
end;
$$;

create function public.deal_coverage_review_queue()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then raise exception 'An eligible authenticated account is required' using errcode='42501'; end if;
  with visible as (
    select r.*,d.payload,d.status as draft_status,a.display_name as agent_name,m.display_name as manager_name,c.name as carrier_name,
      public.deal_coverage_payload_hash(d.payload,r.agent_id)=r.payload_hash and d.status='draft' as payload_current,
      (r.owner_user_id=auth.uid() or public.api_is_full_reader()) as can_read_draft,
      public.deal_coverage_can_decide(r.agent_id,r.manager_agent_id,r.matched_deal_ids) as decision_access
    from public.deal_coverage_reviews r join public.deal_drafts d on d.id=r.draft_id
    join public.agents a on a.id=r.agent_id left join public.agents m on m.id=r.manager_agent_id
    left join public.carriers c on c.id::text=d.payload->>'carrierId'
    where r.status<>'submitted' and (r.owner_user_id=auth.uid() or public.deal_coverage_manager_access(r.agent_id,r.manager_agent_id))
    order by case when r.status in ('pending','approved') then 0 else 1 end,r.created_at,r.id limit 101
  ), page as (select * from visible limit 100)
  select jsonb_build_object('viewer_user_id',auth.uid(),'as_of',now(),'has_more',(select count(*)>100 from visible),
    'reviews',coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'draft_id',r.draft_id,'owner_user_id',r.owner_user_id,'idempotency_key',r.idempotency_key,
      'agent_id',r.agent_id,'agent_name',r.agent_name,'manager_name',r.manager_name,'status',r.status,'version',r.version,
      'client_name',case when r.can_read_draft then btrim(coalesce(r.payload->>'clientFirstName','') || ' ' || coalesce(r.payload->>'clientLastName','')) else 'Client details restricted' end,
      'carrier_name',case when r.can_read_draft then r.carrier_name end,'product',case when r.can_read_draft then nullif(r.payload->>'product','') end,
      'policy_number',case when r.can_read_draft then nullif(r.payload->>'policyNumber','') end,
      'application_date',case when r.can_read_draft then nullif(r.payload->>'applicationDate','') end,
      'annual_premium',case when r.can_read_draft and r.payload->>'annualizedPaidPremium' ~ '^[0-9]+([.][0-9]+)?$' then (r.payload->>'annualizedPaidPremium')::numeric else null end,
      'match_count',cardinality(r.matched_deal_ids),'match_signals',to_jsonb(r.match_signals),
      'created_at',r.created_at,'updated_at',r.updated_at,'reviewed_at',r.reviewed_at,'decision_reason',case when r.can_read_draft then r.decision_reason end,
      'payload_current',r.payload_current,'can_decide',r.decision_access and r.payload_current and r.status='pending',
      'can_resume',r.owner_user_id=auth.uid() and r.status='approved' and r.payload_current,
      'requires_admin',public.deal_coverage_requires_admin(r.manager_agent_id,r.matched_deal_ids),
      'deal_id',r.deal_id,
      'matched_policies',(select coalesce(jsonb_agg(jsonb_build_object('deal_id',d.id,'policy_number',d.policy_number,
        'client_name',btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')),
        'carrier_name',c.name,'product',d.product_sold,'status',d.status,'agent_name',a.display_name) order by d.id),'[]'::jsonb)
        from public.deals d left join public.carriers c on c.id=d.carrier_id left join public.agents a on a.id=d.agent_id
        where d.id=any(r.matched_deal_ids) and (public.api_is_full_reader() or exists(select 1 from public.agents own where own.id=d.agent_id and own.user_id=auth.uid())))
    )),'[]'::jsonb)) into v_result from page r;
  return v_result;
end;
$$;

revoke all on function public.deal_coverage_name(text,text), public.deal_coverage_phone(text),
  public.deal_coverage_payload_hash(jsonb,uuid), public.deal_coverage_candidates(uuid,date,text,text,uuid),
  public.deal_coverage_manager_access(uuid,uuid), public.deal_coverage_can_decide(uuid,uuid,uuid[]),
  public.deal_coverage_requires_admin(uuid,uuid[]),
  public.enforce_deal_coverage_review() from public,anon,authenticated,service_role;
revoke all on function public.submit_apex_deal(uuid,jsonb,uuid), public.decide_deal_coverage_review(uuid,text,text,integer),
  public.resume_deal_coverage_review(uuid,integer), public.deal_coverage_review_queue() from public,anon;
grant execute on function public.submit_apex_deal(uuid,jsonb,uuid), public.decide_deal_coverage_review(uuid,text,text,integer),
  public.resume_deal_coverage_review(uuid,integer), public.deal_coverage_review_queue() to authenticated;
comment on table public.deal_coverage_reviews is 'Possible repeated insured coverage held before a deal exists. Manager/admin decisions bind the exact draft, writer and existing-policy evidence. No card data or automatic carrier decisions.';
commit;
