-- Consumer quote invitations are separate from producer recruiting/contracting.
-- No license scope is seeded and no automatic dispatcher is installed.
create table if not exists public.ethos_consumer_license_scope (
  owner_user_id uuid not null references auth.users(id),
  state text not null check (state ~ '^[A-Z]{2}$'),
  license_status text not null default 'unverified' check (license_status in ('unverified','active','inactive')),
  license_evidence_ref text,
  license_verified_at timestamptz,
  license_expires_at timestamptz,
  ethos_eligible boolean not null default false,
  ethos_evidence_ref text,
  ethos_verified_at timestamptz,
  verified_by uuid references auth.users(id),
  primary key (owner_user_id, state),
  check (license_status <> 'active' or (nullif(btrim(license_evidence_ref), '') is not null and license_verified_at is not null and license_expires_at is not null and verified_by is not null)),
  check (not ethos_eligible or (nullif(btrim(ethos_evidence_ref), '') is not null and ethos_verified_at is not null and verified_by is not null))
);

create table if not exists public.ethos_consumer_campaigns (
  campaign_key text primary key,
  owner_user_id uuid not null references auth.users(id),
  coverage_url text not null check (coverage_url = 'https://agents.ethoslife.com/invite/e1c102'),
  template_version text not null check (template_version = 'coverage-invitation-v1'),
  sends_enabled boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (not sends_enabled or (approved_by = owner_user_id and approved_at is not null))
);

create table if not exists public.ethos_consumer_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null references public.ethos_consumer_campaigns(campaign_key),
  lead_id uuid not null references public.client_leads(id),
  source_batch_id text not null,
  email text not null check (email = lower(btrim(email))),
  state text not null,
  audience_token text not null,
  scope_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','attempting','provider_accepted','blocked','unknown')),
  claim_id uuid,
  provider_id text,
  reason text,
  queued_by uuid references auth.users(id),
  queued_at timestamptz not null default now(),
  attempted_at timestamptz,
  settled_at timestamptz,
  unique (campaign_key, email),
  check (status <> 'provider_accepted' or nullif(provider_id, '') is not null)
);
create index if not exists ethos_consumer_queued_idx on public.ethos_consumer_deliveries (campaign_key, queued_at) where status = 'queued';
create index if not exists client_leads_consumer_batch_idx on public.client_leads ((raw ->> 'source_batch_id'));

alter table public.ethos_consumer_license_scope enable row level security;
alter table public.ethos_consumer_campaigns enable row level security;
alter table public.ethos_consumer_deliveries enable row level security;
revoke all on public.ethos_consumer_license_scope, public.ethos_consumer_campaigns, public.ethos_consumer_deliveries from public, anon, authenticated;
grant select on public.ethos_consumer_license_scope, public.ethos_consumer_campaigns, public.ethos_consumer_deliveries to authenticated;
grant all on public.ethos_consumer_license_scope, public.ethos_consumer_campaigns, public.ethos_consumer_deliveries to service_role;
create policy ethos_consumer_scope_owner_read on public.ethos_consumer_license_scope for select to authenticated using (owner_user_id = auth.uid());
create policy ethos_consumer_campaign_owner_read on public.ethos_consumer_campaigns for select to authenticated using (owner_user_id = auth.uid());
create policy ethos_consumer_delivery_owner_read on public.ethos_consumer_deliveries for select to authenticated using (exists (select 1 from public.ethos_consumer_campaigns c where c.campaign_key = ethos_consumer_deliveries.campaign_key and c.owner_user_id = auth.uid()));

insert into public.ethos_consumer_campaigns (campaign_key,owner_user_id,coverage_url,template_version)
select 'ethos-consumer-20261124-v1', public.fn_recruit_sam_user_id(), 'https://agents.ethoslife.com/invite/e1c102', 'coverage-invitation-v1'
where public.fn_recruit_sam_user_id() is not null
on conflict (campaign_key) do nothing;

create or replace function public.set_ethos_consumer_scope(p_campaign_key text,p_actor uuid,p_state text,p_active boolean,p_license_evidence_ref text default null,p_license_expires_at timestamptz default null,p_ethos_evidence_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_owner uuid; v_state text:=upper(btrim(p_state)); v_license text:=nullif(btrim(p_license_evidence_ref),''); v_ethos text:=nullif(btrim(p_ethos_evidence_ref),''); r public.ethos_consumer_license_scope;
begin
  select owner_user_id into v_owner from public.ethos_consumer_campaigns where campaign_key=p_campaign_key;
  if v_owner is null or p_actor is distinct from v_owner or not (coalesce(auth.role(),'')='service_role' or coalesce(auth.uid()=v_owner,false)) then raise exception 'Only the campaign owner can record state evidence' using errcode='42501'; end if;
  if v_state is null or v_state not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY') then raise exception 'Choose a valid licensed state'; end if;
  if p_active is not true then
    update public.ethos_consumer_license_scope set license_status='inactive',ethos_eligible=false where owner_user_id=v_owner and state=v_state returning * into r;
    if not found then raise exception 'No recorded state scope to deactivate'; end if;
  else
    if v_license is null or length(v_license)<3 or length(v_license)>2000 or p_license_expires_at is null or p_license_expires_at<=now() then raise exception 'Current license evidence and a future expiration are required'; end if;
    if v_ethos is not null and (length(v_ethos)<3 or length(v_ethos)>2000) then raise exception 'Ethos eligibility evidence reference is incomplete'; end if;
    insert into public.ethos_consumer_license_scope(owner_user_id,state,license_status,license_evidence_ref,license_verified_at,license_expires_at,ethos_eligible,ethos_evidence_ref,ethos_verified_at,verified_by)
      values(v_owner,v_state,'active',v_license,now(),p_license_expires_at,v_ethos is not null,v_ethos,case when v_ethos is not null then now() end,v_owner)
      on conflict(owner_user_id,state) do update set license_status=excluded.license_status,license_evidence_ref=excluded.license_evidence_ref,license_verified_at=excluded.license_verified_at,
        license_expires_at=excluded.license_expires_at,ethos_eligible=excluded.ethos_eligible,ethos_evidence_ref=excluded.ethos_evidence_ref,ethos_verified_at=excluded.ethos_verified_at,verified_by=excluded.verified_by
      returning * into r;
  end if;
  return to_jsonb(r);
end $fn$;

create or replace function public.set_ethos_consumer_campaign_enabled(p_campaign_key text,p_actor uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.ethos_consumer_campaigns;
begin
  select * into r from public.ethos_consumer_campaigns where campaign_key=p_campaign_key for update;
  if not found or p_actor is distinct from r.owner_user_id or not (coalesce(auth.role(),'')='service_role' or coalesce(auth.uid()=r.owner_user_id,false)) then raise exception 'Only the campaign owner can change sending' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Choose the send state'; end if;
  if p_enabled and not exists(select 1 from public.ethos_consumer_license_scope s where s.owner_user_id=r.owner_user_id and s.license_status='active' and s.license_verified_at<=now() and s.license_expires_at>now() and s.ethos_eligible and s.ethos_verified_at<=now()) then raise exception 'Record at least one current licensed state with verified Ethos eligibility before enabling sending'; end if;
  update public.ethos_consumer_campaigns set sends_enabled=p_enabled,approved_by=case when p_enabled then p_actor else approved_by end,approved_at=case when p_enabled then now() else approved_at end where campaign_key=p_campaign_key returning * into r;
  return to_jsonb(r);
end $fn$;
revoke all on function public.set_ethos_consumer_scope(text,uuid,text,boolean,text,timestamptz,text),public.set_ethos_consumer_campaign_enabled(text,uuid,boolean) from public,anon;
grant execute on function public.set_ethos_consumer_scope(text,uuid,text,boolean,text,timestamptz,text),public.set_ethos_consumer_campaign_enabled(text,uuid,boolean) to authenticated,service_role;

-- Full eligibility is recomputed at preview, queue, and claim. Email/state are
-- read from the consumer record; residence/phone area code never supplies either.
create or replace function public.ethos_consumer_batch_members(p_source_batch_id text)
returns table(lead_id uuid,source_type text) language plpgsql security definer set search_path = public as $fn$
begin
  -- Import receipts are introduced by the later 20261124140000 migration.
  -- PL/pgSQL resolves this read at execution; older installs still have the
  -- explicit raw-source fallback. Matched imports retain their original raw.
  if to_regclass('public.consumer_import_rows') is not null and to_regclass('public.consumer_import_batches') is not null then
    return query select distinct r.lead_id,b.source_kind from public.consumer_import_rows r join public.consumer_import_batches b on b.id=r.batch_id
      where r.batch_id::text=p_source_batch_id and r.status in ('matched','imported') and r.lead_id is not null;
  end if;
  return query select l.id,l.raw->>'source_type' from public.client_leads l where l.raw->>'source_batch_id'=p_source_batch_id;
end $fn$;
revoke all on function public.ethos_consumer_batch_members(text) from public,anon,authenticated;
grant execute on function public.ethos_consumer_batch_members(text) to service_role;

-- A suppression identity must never be manufactured by taking an international
-- number's final ten digits. Match the NANP send-side normalizer's prefixes.
create or replace function public.ethos_consumer_phone10(p_raw text)
returns text language sql immutable set search_path=public as $fn$
  with raw as (select btrim(coalesce(p_raw,'')) as v,regexp_replace(coalesce(p_raw,''),'[^0-9]','','g') as d),
  normalized as (select case when left(v,1)='+' then d when left(d,3)='011' then substring(d from 4)
    when left(d,2)='00' then substring(d from 3) when length(d)=10 then '1'||d
    when length(d)=11 and left(d,1)='1' then d end as d from raw)
  select case when d ~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then substring(d from 2) end from normalized;
$fn$;
revoke all on function public.ethos_consumer_phone10(text) from public,anon,authenticated;
grant execute on function public.ethos_consumer_phone10(text) to service_role;

create or replace function public.ethos_consumer_candidates(p_campaign_key text, p_source_batch_id text)
returns table (lead_id uuid,email text,first_name text,state text,reason text,audience_token text)
language sql security definer set search_path = public as $fn$
  with members as (select m.lead_id,max(m.source_type) as source_type from public.ethos_consumer_batch_members(p_source_batch_id) m group by m.lead_id), batch as (
    select l.*, m.source_type as consumer_source_type, lower(btrim(coalesce(l.email,''))) as normalized_email,
      upper(btrim(coalesce(l.state,''))) as normalized_state,
      row_number() over (partition by lower(btrim(coalesce(l.email,''))) order by l.id) as email_rank
    from public.client_leads l join members m on m.lead_id=l.id
  ), checked as (
    select l.id, l.normalized_email, l.first_name, l.normalized_state,
      case
        when c.campaign_key is null then 'campaign_not_configured'
        when coalesce(l.consumer_source_type,'') not in ('pos','mortgage') then 'consumer_source_unverified'
        when l.normalized_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[A-Za-z]{2,}$' then 'email_missing_or_invalid'
        when l.normalized_state not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY') then 'state_missing_or_invalid'
        when l.dnc is true or lower(coalesce(l.last_disposition,'')) in ('do_not_call','do not call','do_not_contact','unsubscribed') or l.raw ->> 'email_consent' = 'false' then 'do_not_contact'
        when exists (select 1 from public.lead_contact_dnc d where d.phone10 in (public.ethos_consumer_phone10(l.phone_digits),public.ethos_consumer_phone10(l.phone_e164))) then 'do_not_contact'
        when exists (select 1 from public.email_unsubscribes u where lower(btrim(u.email)) = l.normalized_email) then 'email_opt_out'
        when exists (select 1 from public.email_suppressions s where lower(btrim(s.email)) = l.normalized_email) then 'email_suppressed'
        when exists (select 1 from public.client_leads b where lower(btrim(coalesce(b.email,''))) = l.normalized_email and
          (b.dnc is true or lower(coalesce(b.last_disposition,'')) in ('do_not_call','do not call','do_not_contact','unsubscribed') or b.raw->>'email_consent'='false'
            or exists(select 1 from public.lead_contact_dnc d where d.phone10 in (public.ethos_consumer_phone10(b.phone_digits),public.ethos_consumer_phone10(b.phone_e164))))) then 'do_not_contact'
        when exists (select 1 from public.v_leads_suppression_all s join public.client_leads b on b.id=s.lead_id where lower(btrim(coalesce(b.email,''))) = l.normalized_email) then 'lead_suppressed'
        when (select count(distinct upper(btrim(coalesce(b.state,'')))) from public.client_leads b where lower(btrim(coalesce(b.email,''))) = l.normalized_email) > 1 then 'email_identity_conflict'
        when l.email_rank > 1 then 'duplicate_email'
        when s.license_status is distinct from 'active' or s.license_verified_at is null or s.license_verified_at > now() or s.license_expires_at <= now() or s.license_expires_at is null then 'licensed_state_not_verified'
        when s.ethos_eligible is distinct from true or s.ethos_verified_at is null or s.ethos_verified_at > now() then 'ethos_state_eligibility_not_verified'
        else 'eligible'
      end as verdict,
      encode(sha256(convert_to(concat_ws('|',l.id::text,l.normalized_email,l.normalized_state,p_source_batch_id,c.owner_user_id::text,c.template_version,c.coverage_url,s.license_evidence_ref,s.license_verified_at::text,s.license_expires_at::text,s.ethos_evidence_ref,s.ethos_verified_at::text),'UTF8')),'hex') as token
    from batch l
    left join public.ethos_consumer_campaigns c on c.campaign_key = p_campaign_key
    left join public.ethos_consumer_license_scope s on s.owner_user_id = c.owner_user_id and s.state = l.normalized_state
  ) select id,normalized_email,first_name,normalized_state,verdict,token from checked;
$fn$;
revoke all on function public.ethos_consumer_candidates(text,text) from public,anon,authenticated;
grant execute on function public.ethos_consumer_candidates(text,text) to service_role;

create or replace function public.preview_ethos_consumer_campaign(p_campaign_key text,p_source_batch_id text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_result jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if nullif(btrim(p_source_batch_id),'') is null then raise exception 'source batch required'; end if;
  with candidates as (select * from public.ethos_consumer_candidates(p_campaign_key,p_source_batch_id)),
  grouped as (select reason,count(*) as n from candidates group by reason)
  select jsonb_build_object(
    'source_batch_id',p_source_batch_id,'checked_at',now(),
    'counts',coalesce((select jsonb_object_agg(reason,n) from grouped),'{}'::jsonb),
    'eligible',coalesce((select jsonb_agg(to_jsonb(r)) from (select lead_id,email,first_name,state,audience_token from candidates where reason='eligible' and not exists (select 1 from public.ethos_consumer_deliveries d where d.campaign_key=p_campaign_key and d.email=candidates.email) order by lead_id limit 25) r),'[]'::jsonb),
    'already_queued',(select count(*) from public.ethos_consumer_deliveries d where d.campaign_key=p_campaign_key and d.source_batch_id=p_source_batch_id)
  ) into v_result;
  return v_result;
end $fn$;

create or replace function public.queue_ethos_consumer_deliveries(p_campaign_key text,p_source_batch_id text,p_selections jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r record; v_owner uuid; v_queued integer:=0; v_existing integer:=0; v_rows integer; v_ids uuid[] := '{}'; v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select owner_user_id into v_owner from public.ethos_consumer_campaigns where campaign_key=p_campaign_key;
  if v_owner is null or p_actor is distinct from v_owner then raise exception 'campaign owner required' using errcode='42501'; end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) not between 1 and 25 then raise exception 'select 1 to 25 preview recipients'; end if;
  for r in select s.lead_id,s.audience_token as expected_token,c.email,c.state,c.reason,c.audience_token from jsonb_to_recordset(p_selections) as s(lead_id uuid,audience_token text)
    left join public.ethos_consumer_candidates(p_campaign_key,p_source_batch_id) c using (lead_id)
  loop
    if r.reason is distinct from 'eligible' or r.expected_token is distinct from r.audience_token then raise exception 'Audience changed or recipient ineligible. Refresh the preview.'; end if;
    insert into public.ethos_consumer_deliveries(campaign_key,lead_id,source_batch_id,email,state,audience_token,scope_evidence,queued_by)
      values(p_campaign_key,r.lead_id,p_source_batch_id,r.email,r.state,r.audience_token,(select to_jsonb(s) from public.ethos_consumer_license_scope s where s.owner_user_id=v_owner and s.state=r.state),p_actor)
      on conflict(campaign_key,email) do nothing;
    get diagnostics v_rows = row_count;
    v_queued:=v_queued+v_rows; v_existing:=v_existing+(1-v_rows);
    select d.id into v_id from public.ethos_consumer_deliveries d where d.campaign_key=p_campaign_key and d.email=r.email and d.status='queued';
    if v_id is not null then v_ids:=array_append(v_ids,v_id); end if;
  end loop;
  return jsonb_build_object('queued',v_queued,'already_present',v_existing,'delivery_ids',v_ids,'sent',0);
end $fn$;

create or replace function public.claim_ethos_consumer_deliveries(p_campaign_key text,p_delivery_ids uuid[],p_limit integer default 5)
returns table(delivery_id uuid,claim_id uuid,email text,first_name text,state text)
language plpgsql security definer set search_path = public as $fn$
declare r public.ethos_consumer_deliveries; c public.ethos_consumer_campaigns; eligible record; token uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if coalesce(cardinality(p_delivery_ids),0) not between 1 and 25 then raise exception 'exact reviewed delivery ids required'; end if;
  select * into c from public.ethos_consumer_campaigns where campaign_key=p_campaign_key for share;
  if not found or not c.sends_enabled or c.approved_at is null or c.approved_by is distinct from c.owner_user_id then raise exception 'Campaign sends disabled or owner approval missing. Nothing sent.'; end if;
  for r in select d.* from public.ethos_consumer_deliveries d where d.campaign_key=p_campaign_key and d.id=any(p_delivery_ids) and d.status='queued' order by d.queued_at limit least(greatest(coalesce(p_limit,5),1),25) for update skip locked
  loop
    select * into eligible from public.ethos_consumer_candidates(p_campaign_key,r.source_batch_id) x where x.lead_id=r.lead_id;
    if not found or eligible.reason is distinct from 'eligible' or eligible.audience_token is distinct from r.audience_token then
      update public.ethos_consumer_deliveries d set status='blocked',reason=coalesce(eligible.reason,'recipient_changed'),settled_at=now() where d.id=r.id;
      continue;
    end if;
    token:=gen_random_uuid();
    update public.ethos_consumer_deliveries d set status='attempting',claim_id=token,attempted_at=now() where d.id=r.id;
    delivery_id:=r.id; claim_id:=token; email:=r.email; first_name:=eligible.first_name; state:=r.state; return next;
  end loop;
end $fn$;

create or replace function public.settle_ethos_consumer_delivery(p_id uuid,p_claim_id uuid,p_status text,p_provider_id text default null,p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_status not in ('provider_accepted','blocked','unknown') or (p_status='provider_accepted' and nullif(p_provider_id,'') is null) then raise exception 'invalid provider receipt'; end if;
  update public.ethos_consumer_deliveries set status=p_status,provider_id=p_provider_id,reason=left(p_reason,300),settled_at=now() where id=p_id and claim_id=p_claim_id and status='attempting';
  if not found then raise exception 'Claim is no longer current; reconcile its existing receipt.'; end if;
end $fn$;
revoke all on function public.preview_ethos_consumer_campaign(text,text),public.queue_ethos_consumer_deliveries(text,text,jsonb,uuid),public.claim_ethos_consumer_deliveries(text,uuid[],integer),public.settle_ethos_consumer_delivery(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.preview_ethos_consumer_campaign(text,text),public.queue_ethos_consumer_deliveries(text,text,jsonb,uuid),public.claim_ethos_consumer_deliveries(text,uuid[],integer),public.settle_ethos_consumer_delivery(uuid,uuid,text,text,text) to service_role;

comment on table public.ethos_consumer_license_scope is 'Evidence-backed owner life-license and Ethos eligibility scope. No residence or state dropdown is verification. Exact owner records evidence through guarded RPCs; initially empty.';
comment on table public.ethos_consumer_deliveries is 'One attempted consumer invitation per campaign/email. A provider id means accepted, not delivered. Unknown or unfinished attempts require reconciliation and are never automatically retried.';
