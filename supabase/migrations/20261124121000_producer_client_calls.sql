-- Client-owned call history. Reuse ReadyMode receipts and call_transcripts;
-- annotations add identity/category, not another copy of a provider recording.
-- Raw provider audio/text retains can_view_sold_calls(). No AI invocation.

create or replace function public.producer_can_access_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.agentlink_clients c join public.agents a on a.id = c.agent_id
     where c.id = p_client_id and public.producer_can_access_agent(coalesce(a.canonical_agent_id, a.id))
  )
$$;
revoke all on function public.producer_can_access_client(uuid) from public, anon;
grant execute on function public.producer_can_access_client(uuid) to authenticated;

create table if not exists public.producer_client_call_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.agentlink_clients(id) on delete cascade,
  provider_call_id uuid unique references public.readymode_dialer_calls(id) on delete cascade,
  transcript_id uuid unique references public.call_transcripts(id) on delete cascade,
  category text not null default 'uncategorized',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint producer_call_one_source check (num_nonnulls(provider_call_id, transcript_id) = 1),
  constraint producer_call_category check (category in ('uncategorized','discovery','presentation','objection','follow_up','sale','service'))
);
create index if not exists producer_client_call_links_client_idx on public.producer_client_call_links(client_id);
alter table public.producer_client_call_links enable row level security;
create policy producer_client_call_links_read on public.producer_client_call_links
  for select to authenticated using (public.producer_can_access_client(client_id));
revoke all on public.producer_client_call_links from public, anon, authenticated;
grant select on public.producer_client_call_links to authenticated;

-- Existing manager-wide transcript policies remain valid for recruiting history,
-- but cannot expose newly client-linked transcripts belonging to another producer.
create or replace function public.producer_transcript_allowed(p_transcript_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not exists (select 1 from public.producer_client_call_links l where l.transcript_id = p_transcript_id)
    or exists (select 1 from public.producer_client_call_links l
                where l.transcript_id = p_transcript_id and public.producer_can_access_client(l.client_id))
$$;
revoke all on function public.producer_transcript_allowed(uuid) from public, anon;
grant execute on function public.producer_transcript_allowed(uuid) to authenticated;
create policy producer_client_transcript_scope on public.call_transcripts
  as restrictive for all to authenticated
  using (public.producer_transcript_allowed(id))
  with check (public.producer_transcript_allowed(id));

create or replace function public.producer_call_matches_client(p_client_id uuid, p_call_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.producer_can_access_client(p_client_id) and exists (
    select 1 from public.agentlink_clients c
      join public.agents ca on ca.id = c.agent_id
      join public.readymode_dialer_calls r on r.id = p_call_id
      join public.agents ra on ra.id = r.agent_id
     where c.id = p_client_id
       and coalesce(ca.canonical_agent_id, ca.id) = coalesce(ra.canonical_agent_id, ra.id)
       and (
         exists (select 1 from public.producer_client_call_links l where l.provider_call_id = r.id and l.client_id = c.id)
         or (
           not exists (select 1 from public.producer_client_call_links l where l.provider_call_id = r.id)
           and length(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g')) >= 10
           and r.lead_phone10 = right(regexp_replace(c.phone, '[^0-9]', '', 'g'),10)
           -- Shared household numbers never silently attach the call to one person.
           and (select count(*) from public.agentlink_clients other
                  join public.agents oa on oa.id = other.agent_id
                 where coalesce(oa.canonical_agent_id, oa.id) = coalesce(ca.canonical_agent_id, ca.id)
                   and right(regexp_replace(coalesce(other.phone,''), '[^0-9]', '', 'g'),10) = r.lead_phone10) = 1
         )
       )
  )
$$;
revoke all on function public.producer_call_matches_client(uuid,uuid) from public, anon;
grant execute on function public.producer_call_matches_client(uuid,uuid) to authenticated;

create or replace function public.producer_client_calls(
  p_client_id uuid, p_category text default null,
  p_before_at timestamptz default null, p_before_key text default null
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_raw boolean := public.can_view_sold_calls(); v jsonb; v_agent uuid; v_phone text; v_unique boolean;
begin
  if not public.producer_can_access_client(p_client_id) then
    raise exception 'Client not found or access denied' using errcode = '42501';
  end if;
  if (p_before_at is null) <> (p_before_key is null) then raise exception 'Incomplete page cursor' using errcode = '22023'; end if;
  if p_category is not null and p_category not in ('uncategorized','discovery','presentation','objection','follow_up','sale','service') then
    raise exception 'Unknown call category' using errcode = '22023';
  end if;
  select coalesce(a.canonical_agent_id,a.id), right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)
    into v_agent, v_phone from public.agentlink_clients c join public.agents a on a.id = c.agent_id where c.id = p_client_id;
  select count(*) = 1 into v_unique from public.agentlink_clients c join public.agents a on a.id = c.agent_id
   where coalesce(a.canonical_agent_id,a.id) = v_agent
     and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10) = v_phone;

  with records as (
    select 'readymode:' || r.id::text as key, r.id as source_id, 'readymode'::text as source,
      coalesce(r.call_started_at,r.imported_at) as happened_at,
      coalesce(l.category, case
        when r.disposition = 'Completed Sale' then 'sale'
        when r.disposition in ('Bank Objection','No Bank Account','Social Objection') then 'objection'
        when r.disposition = '&rArr; Appointments' then 'follow_up' else 'uncategorized' end) as category,
      r.disposition as outcome, r.duration_seconds,
      case when v_raw then t.raw_text else null end as transcript,
      case when v_raw then r.recording_url else null end as audio_url,
      case when not v_raw then 'restricted' when t.raw_text is null then 'not_available' else 'available' end as transcript_access
      from public.readymode_dialer_calls r
      join public.agents a on a.id = r.agent_id
      left join public.producer_client_call_links l on l.provider_call_id = r.id
      left join lateral (select x.raw_text from public.readymode_call_transcripts x where x.call_id = r.id order by x.transcribed_at desc limit 1) t on v_raw
     where coalesce(a.canonical_agent_id,a.id) = v_agent
       and (l.client_id = p_client_id or (l.id is null and v_unique and length(v_phone) = 10 and r.lead_phone10 = v_phone))
    union all
    select 'manual:' || t.id::text, t.id, 'manual', t.created_at, l.category,
      t.call_outcome, t.duration_seconds, t.transcript, null::text,
      case when t.transcript is null then 'not_available' else 'available' end
      from public.producer_client_call_links l join public.call_transcripts t on t.id = l.transcript_id
     where l.client_id = p_client_id
  ), page as materialized (
    select * from records r
     where (p_category is null or r.category = p_category)
       and (p_before_at is null or (r.happened_at,r.key) < (p_before_at,p_before_key))
     order by r.happened_at desc,r.key desc limit 26
  ), shown as (select * from page order by happened_at desc,key desc limit 25)
  select jsonb_build_object(
    'client_id', p_client_id, 'raw_provider_access', v_raw,
    'ambiguous_phone', length(v_phone) = 10 and not v_unique,
    'calls', coalesce((select jsonb_agg(to_jsonb(s) order by happened_at desc,key desc) from shown s),'[]'::jsonb),
    'next_cursor', case when (select count(*) from page) > 25 then
      (select jsonb_build_object('at',happened_at,'key',key) from shown order by happened_at,key limit 1) else null end
  ) into v;
  return v;
end $$;
revoke all on function public.producer_client_calls(uuid,text,timestamptz,text) from public, anon;
grant execute on function public.producer_client_calls(uuid,text,timestamptz,text) to authenticated;

create or replace function public.producer_save_client_transcript(
  p_client_id uuid, p_transcript text, p_category text, p_outcome text default null
)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_agent uuid;
begin
  if not public.producer_can_access_client(p_client_id) then
    raise exception 'Client not found or access denied' using errcode = '42501';
  end if;
  if p_category not in ('uncategorized','discovery','presentation','objection','follow_up','sale','service') or p_category is null then
    raise exception 'Unknown call category' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_transcript,''))) not between 10 and 100000 then
    raise exception 'Transcript must contain 10 to 100,000 characters' using errcode = '22023';
  end if;
  select agent_id into v_agent from public.agentlink_clients where id = p_client_id;
  insert into public.call_transcripts(agent_id,recorded_by,transcript,call_outcome,status)
  values (v_agent,auth.uid(),btrim(p_transcript),nullif(left(btrim(p_outcome),160),''),'completed') returning id into v_id;
  insert into public.producer_client_call_links(client_id,transcript_id,category,created_by)
  values (p_client_id,v_id,p_category,auth.uid());
  insert into public.client_pipeline_activity(client_id,activity_type,body,metadata,created_by)
  values (p_client_id,'call_transcript_saved','Call transcript saved',jsonb_build_object('transcript_id',v_id,'category',p_category),auth.uid());
  return v_id;
end $$;
revoke all on function public.producer_save_client_transcript(uuid,text,text,text) from public, anon;
grant execute on function public.producer_save_client_transcript(uuid,text,text,text) to authenticated;

create or replace function public.producer_tag_client_call(p_client_id uuid,p_source text,p_source_id uuid,p_category text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.producer_can_access_client(p_client_id) then
    raise exception 'Client not found or access denied' using errcode = '42501';
  end if;
  if p_category not in ('uncategorized','discovery','presentation','objection','follow_up','sale','service') or p_category is null then
    raise exception 'Unknown call category' using errcode = '22023';
  end if;
  if p_source = 'readymode' then
    if not public.producer_call_matches_client(p_client_id,p_source_id) then
      raise exception 'Call does not belong to this client' using errcode = '42501';
    end if;
    insert into public.producer_client_call_links(client_id,provider_call_id,category,created_by)
    values (p_client_id,p_source_id,p_category,auth.uid())
    on conflict (provider_call_id) do update set category = excluded.category, updated_at = now()
      where producer_client_call_links.client_id = excluded.client_id;
    if not found then raise exception 'Call does not belong to this client' using errcode = '42501'; end if;
  elsif p_source = 'manual' then
    update public.producer_client_call_links set category = p_category,updated_at = now()
     where client_id = p_client_id and transcript_id = p_source_id;
    if not found then raise exception 'Call does not belong to this client' using errcode = '42501'; end if;
  else raise exception 'Unknown call source' using errcode = '22023';
  end if;
end $$;
revoke all on function public.producer_tag_client_call(uuid,text,uuid,text) from public, anon;
grant execute on function public.producer_tag_client_call(uuid,text,uuid,text) to authenticated;

comment on function public.producer_client_calls(uuid,text,timestamptz,text) is
  'Own-client history plus admin access. Provider calls require the same canonical producer and an unambiguous phone match or existing client link. No name-only match. Existing raw transcript/audio permission stays enforced. Manual client transcripts are saved without AI and never count as verified calling activity.';
