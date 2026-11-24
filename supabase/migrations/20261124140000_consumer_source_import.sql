-- Consumer intake is separate from recruiting, carrier production and email.
-- No source data belongs in this public repository. Rows enter through this authenticated RPC.
create table if not exists public.consumer_import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  source_key text not null,
  source_name text not null,
  source_kind text not null check (source_kind in ('pos','mortgage')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  receipt jsonb not null default '{}'::jsonb
);
create table if not exists public.consumer_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.consumer_import_batches(id),
  source_key text not null,
  row_key text not null,
  source_row integer not null,
  status text not null check (status in ('imported','matched','review','duplicate')),
  lead_id uuid references public.client_leads(id),
  issues text[] not null default '{}',
  payload jsonb not null,
  resolved_by_row_id uuid references public.consumer_import_rows(id),
  created_at timestamptz not null default now(),
  unique(source_key,row_key)
);
create index if not exists consumer_import_rows_batch_idx on public.consumer_import_rows(batch_id);
create index if not exists consumer_import_rows_lead_idx on public.consumer_import_rows(lead_id) where lead_id is not null;
create or replace function public.consumer_phone10(p_value text)
returns text language sql immutable set search_path to 'public' as $$
  with n as (select regexp_replace(coalesce(p_value,''),'[^0-9]','','g') d)
  select case when d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then d
    when d ~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then substring(d from 2) end from n
$$;
revoke all on function public.consumer_phone10(text) from public,anon;
grant execute on function public.consumer_phone10(text) to authenticated;
create index if not exists consumer_client_phone_digits_idx on public.client_leads(phone_digits);
create index if not exists consumer_client_phone_e164_idx on public.client_leads(phone_e164);
create index if not exists consumer_client_phone_alt_idx on public.client_leads(public.consumer_phone10(phone_alt)) where phone_alt is not null;
create index if not exists consumer_client_email_idx on public.client_leads(lower(email)) where email is not null;
create index if not exists consumer_client_policy_idx on public.client_leads(policy_carrier,policy_number) where policy_number is not null;
create table if not exists public.consumer_policy_observations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.client_leads(id),
  import_row_id uuid not null unique references public.consumer_import_rows(id),
  policy_number text,
  carrier text,
  product text,
  source_policy_date date,
  source_status text,
  supplier_amount numeric,
  amount_cadence text not null default 'unknown' check (amount_cadence = 'unknown'),
  ownership_claim text not null default 'supplier_reported' check (ownership_claim = 'supplier_reported'),
  verified_at timestamptz check (verified_at is null),
  observed_at timestamptz not null default now()
);
alter table public.consumer_import_batches enable row level security;
alter table public.consumer_import_rows enable row level security;
alter table public.consumer_policy_observations enable row level security;
revoke all on public.consumer_import_batches, public.consumer_import_rows, public.consumer_policy_observations from public, anon, authenticated;
grant select on public.consumer_import_batches, public.consumer_import_rows, public.consumer_policy_observations to authenticated;
create policy consumer_import_batches_admin_read on public.consumer_import_batches for select to authenticated using (public.can_view_sold_calls());
create policy consumer_import_rows_admin_read on public.consumer_import_rows for select to authenticated using (public.can_view_sold_calls());
create policy consumer_policy_observations_admin_read on public.consumer_policy_observations for select to authenticated using (public.can_view_sold_calls());

create or replace function public.consumer_import_resolve_review(p_source_key text,p_source_row integer,p_payload jsonb,p_resolved_by uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.consumer_import_rows old set resolved_by_row_id = p_resolved_by
  where old.source_key = p_source_key and old.source_row = p_source_row
    and old.status = 'review' and old.resolved_by_row_id is null
    and (
      public.consumer_phone10(old.payload->>'phone_digits') = any(array[public.consumer_phone10(p_payload->>'phone_digits'),public.consumer_phone10(p_payload->>'phone_alt')])
      or public.consumer_phone10(old.payload->>'phone_alt') = any(array[public.consumer_phone10(p_payload->>'phone_digits'),public.consumer_phone10(p_payload->>'phone_alt')])
      or (nullif(btrim(old.payload->>'email'),'') is not null and lower(old.payload->>'email') = lower(p_payload->>'email'))
      or (nullif(btrim(old.payload->>'policy_carrier'),'') is not null and old.payload->>'policy_carrier' = p_payload->>'policy_carrier'
          and nullif(btrim(old.payload->>'policy_number'),'') is not null and old.payload->>'policy_number' = p_payload->>'policy_number')
    )
$$;
revoke all on function public.consumer_import_resolve_review(text,integer,jsonb,uuid) from public,anon,authenticated;

-- A bounded transaction per chunk, with a stable receipt for timeout/retry recovery.
create or replace function public.consumer_lead_import(p_source_key text, p_source_name text, p_source_kind text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_batch uuid; v_batch_key text; v_receipt jsonb; r jsonb; v_raw jsonb;
  v_key text; v_row_id uuid; v_lead uuid; v_match public.client_leads%rowtype;
  v_phone text; v_alt text; v_phones text[]; v_email text; v_state text; v_name text; v_dob date;
  v_policy_date date; v_lead_date date; v_dnc boolean; v_issues text[];
  v_status text; v_count int; v_inserted int := 0; v_matched int := 0;
  v_review int := 0; v_duplicate int := 0; v_suppressed int := 0;
begin
  if auth.uid() is null or not coalesce(public.can_view_sold_calls(),false) then
    raise exception 'Consumer imports require lead management access.' using errcode = '42501';
  end if;
  if nullif(btrim(p_source_key),'') is null or length(p_source_key) > 200
     or nullif(btrim(p_source_name),'') is null or length(p_source_name) > 200
     or p_source_kind not in ('pos','mortgage') or p_source_kind is null
     or jsonb_typeof(p_rows) <> 'array' or p_rows is null
     or jsonb_array_length(p_rows) not between 1 and 250 then
    raise exception 'Provide a named consumer source and 1 to 250 rows.' using errcode = '22023';
  end if;
  -- Serializes this intake writer, including separate sources sharing the same consumer.
  perform pg_advisory_xact_lock(hashtextextended('consumer_lead_import',0));
  v_batch_key := md5(p_source_key || ':' || p_source_kind || ':' || p_rows::text);
  select id, receipt into v_batch, v_receipt from public.consumer_import_batches where batch_key = v_batch_key;
  if found then return v_receipt || jsonb_build_object('replayed',true); end if;
  insert into public.consumer_import_batches(batch_key,source_key,source_name,source_kind,created_by)
  values(v_batch_key,p_source_key,p_source_name,p_source_kind,auth.uid()) returning id into v_batch;

  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' then raise exception 'Each row must be an object.' using errcode = '22023'; end if;
    v_issues := '{}'; v_lead := null; v_match := null; v_dob := null; v_policy_date := null; v_lead_date := null;
    v_raw := case when jsonb_typeof(r->'raw') = 'object' then r->'raw' else '{}'::jsonb end;
    v_key := md5((r - 'source_row' - 'issues' - 'raw')::text || ':' || (v_raw - 'source_row' - 'import_issues' - 'import_review_required')::text);
    select id,lead_id into v_row_id,v_lead from public.consumer_import_rows where source_key = p_source_key and row_key = v_key;
    if found then
      if v_lead is not null and (r->>'source_row') ~ '^[0-9]{1,7}$' then
        perform public.consumer_import_resolve_review(p_source_key,(r->>'source_row')::int,r,v_row_id);
      end if;
      v_duplicate := v_duplicate + 1; continue;
    end if;
    v_phone := public.consumer_phone10(r->>'phone_digits');
    v_alt := public.consumer_phone10(r->>'phone_alt');
    v_phones := array_remove(array[v_phone,v_alt],null);
    if v_phone is null then v_issues := array_append(v_issues,'invalid_phone'); end if;
    v_email := lower(nullif(btrim(r->>'email'),''));
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_email := null; end if;
    v_state := upper(nullif(btrim(r->>'state'),''));
    if v_state is null or not v_state = any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' ')) then
      v_state := null; v_issues := array_append(v_issues,'state_needs_review');
    end if;
    v_name := lower(regexp_replace(btrim(concat_ws(' ',r->>'first_name',r->>'last_name')),'\s+',' ','g'));
    if nullif(btrim(r->>'first_name'),'') is null or nullif(btrim(r->>'last_name'),'') is null then v_issues := array_append(v_issues,'incomplete_name'); end if;
    begin
      v_dob := nullif(r->>'dob','')::date; v_policy_date := nullif(r->>'policy_date','')::date; v_lead_date := nullif(r->>'lead_date','')::date;
    exception when invalid_datetime_format or datetime_field_overflow then v_issues := array_append(v_issues,'invalid_date');
    end;
    if p_source_kind = 'pos' and nullif(btrim(r->>'policy_number'),'') is null then v_issues := array_append(v_issues,'missing_policy_reference'); end if;
    -- Client-side warnings survive a missing/ambiguous cell; server checks cannot be bypassed by removing them.
    if jsonb_typeof(r->'issues') = 'array' then
      select coalesce(array_agg(distinct issue),'{}') into v_issues from (
        select unnest(v_issues) issue union all
        select value from jsonb_array_elements_text(r->'issues') where value in ('incomplete_name','invalid_phone','state_needs_review','missing_policy_reference','invalid_dob','invalid_source_date')
      ) z;
    end if;
    v_dnc := coalesce(r->>'dnc','false') = 'true' or coalesce(r->>'notes','') ~* '\m(d[ .]*n[ .]*c|do[[:space:]]*not[[:space:]]*(call|contact|text|email)|don[''’]?t[[:space:]]*(call|contact|text|email)|stop[[:space:]]*(calling|contacting|texting|emailing)|remove[[:space:]]+(me|my[[:space:]]+(number|name))|unsubscribe)\M';
    if v_dnc then
      insert into public.lead_contact_dnc(phone10,recorded_source) select distinct p,'consumer_import:' || p_source_key from unnest(v_phones) p on conflict(phone10) do nothing;
    end if;
    v_dnc := v_dnc or exists(select 1 from public.lead_contact_dnc where phone10 = any(v_phones));
    if v_dnc then v_suppressed := v_suppressed + 1; end if;
    if cardinality(v_issues) = 0 then
      -- A phone alone is not an identity. Exact names and non-conflicting DOBs are required.
      select count(*) into v_count from public.client_leads l where
        (l.phone_digits = any(v_phones) or l.phone_e164 = any(array['+1' || v_phone,'+1' || v_alt]) or public.consumer_phone10(l.phone_alt) = any(v_phones) or (v_email is not null and lower(l.email) = v_email)
         or (nullif(r->>'policy_carrier','') is not null and l.policy_carrier = r->>'policy_carrier' and l.policy_number = r->>'policy_number'));
      if v_count > 1 then v_issues := array_append(v_issues,'conflicting_contact_identifiers');
      elsif v_count = 1 then
        select count(*) into v_count from public.client_leads l where
          (l.phone_digits = any(v_phones) or l.phone_e164 = any(array['+1' || v_phone,'+1' || v_alt]) or public.consumer_phone10(l.phone_alt) = any(v_phones))
          and lower(regexp_replace(btrim(concat_ws(' ',l.first_name,l.last_name)),'\s+',' ','g')) = v_name
          and (l.dob is null or v_dob is null or l.dob::text = v_dob::text)
          and (v_email is null or nullif(l.email,'') is null or lower(l.email) = v_email);
        if v_count = 1 then
          select l.* into v_match from public.client_leads l where
            (l.phone_digits = any(v_phones) or l.phone_e164 = any(array['+1' || v_phone,'+1' || v_alt]) or public.consumer_phone10(l.phone_alt) = any(v_phones))
            and lower(regexp_replace(btrim(concat_ws(' ',l.first_name,l.last_name)),'\s+',' ','g')) = v_name
            and (l.dob is null or v_dob is null or l.dob::text = v_dob::text)
            and (v_email is null or nullif(l.email,'') is null or lower(l.email) = v_email) for update;
          v_lead := v_match.id; v_status := 'matched';
          -- Preserve assignment, dispositions, production and every original populated field.
          update public.client_leads set
            source_files = array(select distinct x from unnest(coalesce(v_match.source_files,array[v_match.source_file]) || array[p_source_name]) x where x is not null),
            dnc = coalesce(v_match.dnc,false) or v_dnc,
            raw = coalesce(v_match.raw,'{}'::jsonb) || jsonb_build_object('latest_consumer_import_batch',v_batch),
            updated_at = now()
          where id = v_lead;
          v_matched := v_matched + 1;
        else v_issues := array_append(v_issues,'identity_match_needs_review'); end if;
      end if;
    end if;
    if cardinality(v_issues) > 0 then v_status := 'review'; v_review := v_review + 1;
    elsif v_lead is null then
      insert into public.client_leads(
        external_id,source_file,source_files,first_name,last_name,phone_digits,phone_e164,phone_alt,email,state,street_address,dob,
        policy_number,policy_carrier,policy_product,policy_date,has_existing_policy,original_agent,original_agent_code,
        loan_amount,loan_type,lender_name,lead_date,lead_type,lead_pack,notes,dnc,status,last_disposition,raw)
      values(
        'consumer:' || p_source_key || ':' || v_key,p_source_name,array[p_source_name],btrim(r->>'first_name'),btrim(r->>'last_name'),
        v_phone,'+1' || v_phone,v_alt,v_email,v_state,nullif(r->>'street_address',''),v_dob,
        nullif(r->>'policy_number',''),nullif(r->>'policy_carrier',''),nullif(r->>'policy_product',''),v_policy_date,
        case when p_source_kind = 'pos' then true else null end,nullif(r->>'original_agent',''),nullif(r->>'original_agent_code',''),
        case when (r->>'loan_amount') ~ '^[0-9]+(\.[0-9]+)?$' then (r->>'loan_amount')::numeric end,
        nullif(r->>'loan_type',''),nullif(r->>'lender_name',''),v_lead_date,
        case when p_source_kind = 'pos' then 'policy_owner' else 'mortgage' end,p_source_name,nullif(r->>'notes',''),v_dnc,
        case when v_dnc then 'do not call' else 'new' end,case when v_dnc then 'do not call' else nullif(r->>'last_disposition','') end,
        v_raw || jsonb_build_object('source_type',p_source_kind,'source_key',p_source_key,'source_batch_id',v_batch,
          'state_evidence','supplier_explicit','policy_ownership_claim',case when p_source_kind = 'pos' then 'supplier_reported' end,
          'policy_status_verified_at',null,'import_review_required',false,'supplier_amount_cadence','unknown')) returning id into v_lead;
      v_status := 'imported'; v_inserted := v_inserted + 1;
    end if;
    insert into public.consumer_import_rows(batch_id,source_key,row_key,source_row,status,lead_id,issues,payload)
    values(v_batch,p_source_key,v_key,case when (r->>'source_row') ~ '^[0-9]{1,7}$' then (r->>'source_row')::int else 0 end,v_status,v_lead,v_issues,r)
    returning id into v_row_id;
    if v_lead is not null and (r->>'source_row') ~ '^[0-9]{1,7}$' then
      -- A corrected source cell resolves its old review entry without erasing the original receipt.
      perform public.consumer_import_resolve_review(p_source_key,(r->>'source_row')::int,r,v_row_id);
    end if;
    if v_lead is not null and p_source_kind = 'pos' then
      insert into public.consumer_policy_observations(lead_id,import_row_id,policy_number,carrier,product,source_policy_date,source_status,supplier_amount)
      values(v_lead,v_row_id,nullif(r->>'policy_number',''),nullif(r->>'policy_carrier',''),nullif(r->>'policy_product',''),v_policy_date,v_raw->>'policy_status_claim',
        case when (v_raw->>'supplier_amount') ~ '^[0-9]+(\.[0-9]+)?$' then (v_raw->>'supplier_amount')::numeric end);
    end if;
  end loop;
  v_receipt := jsonb_build_object('batch_id',v_batch,'source',p_source_name,'received',jsonb_array_length(p_rows),
    'imported',v_inserted,'matched',v_matched,'review',v_review,'duplicate',v_duplicate,'suppressed',v_suppressed,'replayed',false);
  update public.consumer_import_batches set receipt = v_receipt where id = v_batch;
  return v_receipt;
end $$;
revoke all on function public.consumer_lead_import(text,text,text,jsonb) from public,anon;
grant execute on function public.consumer_lead_import(text,text,text,jsonb) to authenticated;

create or replace function public.consumer_import_history(p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not coalesce(public.can_view_sold_calls(),false) then raise exception 'Consumer imports require lead management access.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select id,source_name,created_at,receipt from public.consumer_import_batches order by created_at desc limit greatest(1,least(coalesce(p_limit,40),100))
  ) r),'[]'::jsonb);
end $$;
create or replace function public.consumer_import_review(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not coalesce(public.can_view_sold_calls(),false) then raise exception 'Consumer imports require lead management access.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select r.id,r.source_row,r.issues,r.created_at,b.source_name,r.source_key,
      jsonb_build_object('first_name',r.payload->>'first_name','last_name',r.payload->>'last_name','state',r.payload->>'state') as payload
    from public.consumer_import_rows r join public.consumer_import_batches b on b.id=r.batch_id
    where r.status='review' and r.resolved_by_row_id is null
    order by r.created_at desc limit greatest(1,least(coalesce(p_limit,50),100))
  ) r),'[]'::jsonb);
end $$;
revoke all on function public.consumer_import_history(integer),public.consumer_import_review(integer) from public,anon;
grant execute on function public.consumer_import_history(integer),public.consumer_import_review(integer) to authenticated;

-- Rich source history follows the assigned pack, without exposing arbitrary consumers.
create or replace function public.my_lead_source_history(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_lead uuid;
begin
  select i.lead_id into v_lead from public.lead_bundle_items i
  join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
  where i.id = p_item and i.removed_at is null and i.source_kind = 'marketing'
    and (public.can_view_sold_calls() or exists(select 1 from public.lead_bundle_grants g where g.bundle_id = i.bundle_id and g.user_id = auth.uid() and g.revoked_at is null));
  if v_lead is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('observation_id',o.id,'policy_number',o.policy_number,'carrier',o.carrier,'product',o.product,
    'source_policy_date',o.source_policy_date,'source_status',o.source_status,'supplier_amount',o.supplier_amount,
    'amount_cadence',o.amount_cadence,'ownership_claim',o.ownership_claim,'verified_at',o.verified_at,
    'source_name',b.source_name,'source_row',r.source_row,'observed_at',o.observed_at) order by o.observed_at desc)
    from public.consumer_policy_observations o join public.consumer_import_rows r on r.id = o.import_row_id
    join public.consumer_import_batches b on b.id = r.batch_id where o.lead_id = v_lead),'[]'::jsonb);
end $$;
revoke all on function public.my_lead_source_history(uuid) from public,anon;
grant execute on function public.my_lead_source_history(uuid) to authenticated;
