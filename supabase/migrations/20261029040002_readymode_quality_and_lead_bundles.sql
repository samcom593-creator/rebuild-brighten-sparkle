-- MP-310 wave 3 (2026-10-28). Sam: "track bad quality business, track people who are in slumps because of repeat
-- objections, track bad calls ... easy to get things back on book", and "assign leads at different bundles, formats,
-- packages, from quality of the leads, to agents or managers ... as leads called, as POSs ... revoke access, give
-- access ... only certain people". Applied live through bot-sql 2026-10-28; mirrored with its version recorded.

-- 0. Dialed numbers: bank / SSN objections tracked apart from "I Give Up" (column appended, existing columns unchanged).
create or replace view public.v_readymode_leads with (security_invoker = true) as
select c.lead_phone10 as phone10,
  (array_agg(c.lead_first_name order by c.call_started_at desc nulls last))[1] as first_name,
  (array_agg(c.lead_last_name order by c.call_started_at desc nulls last))[1] as last_name,
  (array_agg(c.lead_email order by c.call_started_at desc nulls last) filter (where nullif(c.lead_email, '') is not null))[1] as email,
  count(*)::int as attempts,
  min(c.call_started_at) as first_dialed_at, max(c.call_started_at) as last_dialed_at,
  (array_agg(c.disposition order by c.call_started_at desc nulls last))[1] as last_disposition,
  (array_agg(c.agent_raw order by c.call_started_at desc nulls last))[1] as last_agent,
  bool_or(c.disposition = 'Completed Sale') as ever_sold,
  bool_or(c.disposition = 'Do Not Call') as do_not_call,
  bool_or(c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', 'I Give Up')) as ever_objection,
  bool_or(c.disposition = '&rArr; Appointments') as ever_appointment,
  bool_or(c.disposition <> 'Not Available') as ever_reached,
  (array_agg(c.campaign_name order by c.call_started_at desc nulls last) filter (where nullif(c.campaign_name, '') is not null))[1] as campaign,
  bool_or(c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection')) as ever_late_objection
from public.readymode_dialer_calls c where c.lead_phone10 is not null group by c.lead_phone10;

-- 1. Slumps: each seat's last 14 days against its own prior 6 weeks, from the dialer's own outcomes.
create or replace view public.v_agent_slump with (security_invoker = true) as
with t as (select (now() at time zone 'America/Chicago')::date as today),
base as (
  select coalesce(ag.display_name, c.agent_raw) as agent_name, c.agent_id, c.agent_raw,
    (c.call_started_at at time zone 'America/Chicago')::date as day, c.disposition
  from public.readymode_dialer_calls c left join public.agents ag on ag.id = c.agent_id
  where c.call_started_at > now() - interval '60 days'
), agg as (
  select b.agent_name, b.agent_id, b.agent_raw,
    count(*) filter (where b.day > t.today - 14 and b.disposition <> 'Not Available') as recent_contacts,
    count(*) filter (where b.day > t.today - 14 and b.disposition = 'Completed Sale') as recent_sold,
    count(*) filter (where b.day > t.today - 14 and b.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', 'I Give Up')) as recent_objections,
    count(*) filter (where b.day > t.today - 14 and b.disposition in ('Bank Objection', 'No Bank Account')) as recent_bank,
    count(*) filter (where b.day > t.today - 14 and b.disposition = 'Social Objection') as recent_ssn,
    count(*) filter (where b.day > t.today - 14 and b.disposition = 'I Give Up') as recent_gave_up,
    count(*) filter (where b.day <= t.today - 14 and b.day > t.today - 56 and b.disposition <> 'Not Available') as base_contacts,
    count(*) filter (where b.day <= t.today - 14 and b.day > t.today - 56 and b.disposition = 'Completed Sale') as base_sold,
    count(*) filter (where b.day <= t.today - 14 and b.day > t.today - 56 and b.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', 'I Give Up')) as base_objections,
    max(b.day) filter (where b.disposition <> 'Not Available') as last_contact_day
  from base b cross join t
  group by b.agent_name, b.agent_id, b.agent_raw
)
select agg.*,
  round(100.0 * recent_sold / nullif(recent_contacts, 0), 1) as recent_close_pct,
  round(100.0 * base_sold / nullif(base_contacts, 0), 1) as base_close_pct,
  round(100.0 * recent_objections / nullif(recent_contacts, 0), 1) as recent_objection_pct,
  round(100.0 * base_objections / nullif(base_contacts, 0), 1) as base_objection_pct,
  case greatest(recent_bank, recent_ssn, recent_gave_up) when 0 then null when recent_bank then 'bank' when recent_ssn then 'ssn' else 'gave_up' end as top_objection,
  case
    when recent_contacts < 20 then 'too_few_calls'
    when base_contacts < 20 then 'new'
    when base_sold >= 2 and recent_sold::numeric / recent_contacts < 0.5 * base_sold::numeric / base_contacts
         and recent_objections::numeric / recent_contacts > 1.25 * base_objections::numeric / base_contacts then 'slump_objections'
    when base_sold >= 2 and recent_sold::numeric / recent_contacts < 0.5 * base_sold::numeric / base_contacts then 'slump'
    when recent_objections >= 5 and recent_objections::numeric / recent_contacts > 1.5 * greatest(base_objections, 1)::numeric / base_contacts then 'objections_rising'
    else 'steady'
  end as verdict
from agg;

-- 2. Business quality: every dialer sale, whether it reached the book, whether it stuck, and what the grader flagged.
create or replace view public.v_sold_call_quality with (security_invoker = true) as
select m.call_id, m.external_call_id, m.call_started_at, coalesce(ag.display_name, m.agent_raw) as agent_name, m.agent_id, m.agent_raw,
  m.lead_first_name, m.lead_last_name, m.in_book, m.book_status, m.status_group, m.book_carrier, m.book_policy_number,
  m.packet_id, m.packet_carrier, m.packet_monthly_premium, m.work_status,
  a.overall_score, a.coaching_priority, a.compliance_flags, a.coaching_notes,
  i.approval_status, i.declined_after_ssn_bank, i.price_objection, i.summary as resell_summary,
  (case when jsonb_typeof(a.compliance_flags) = 'array' then jsonb_array_length(a.compliance_flags) else 0 end) as compliance_flag_count,
  case
    when not m.in_book and m.packet_id is not null then 'not_in_book'
    when not m.in_book then 'not_in_book_no_packet'
    when m.status_group = 'dead' then 'fell_off'
    when m.status_group = 'lapsing' then 'lapsing'
    when (case when jsonb_typeof(a.compliance_flags) = 'array' then jsonb_array_length(a.compliance_flags) else 0 end) > 0 then 'compliance_flag'
    else 'ok'
  end as quality_verdict
from public.v_sold_call_book_match m
left join public.agents ag on ag.id = m.agent_id
left join public.readymode_call_analysis a on a.call_id = m.call_id and a.model = 'grade-v1'
left join public.readymode_call_insights i on i.call_id = m.call_id;

create or replace view public.v_agent_business_quality with (security_invoker = true) as
select agent_name, agent_id, agent_raw,
  count(*)::int as sold_calls,
  count(*) filter (where in_book)::int as in_book,
  count(*) filter (where not in_book)::int as not_in_book,
  count(*) filter (where status_group = 'active')::int as active,
  count(*) filter (where status_group = 'pending')::int as pending,
  count(*) filter (where status_group = 'lapsing')::int as lapsing,
  count(*) filter (where status_group = 'dead')::int as fell_off,
  count(*) filter (where in_book and status_group = 'unknown')::int as status_unknown,
  count(*) filter (where compliance_flag_count > 0)::int as compliance_flagged,
  count(*) filter (where coaching_priority = 'urgent')::int as urgent_flags,
  count(*) filter (where declined_after_ssn_bank)::int as declined_after_ssn_bank,
  round(100.0 * count(*) filter (where status_group in ('lapsing', 'dead')) / nullif(count(*) filter (where status_group in ('active', 'pending', 'lapsing', 'dead')), 0), 1) as fall_off_pct,
  max(call_started_at) as last_sale_at
from public.v_sold_call_quality
group by agent_name, agent_id, agent_raw;

-- 3. Lead bundles: Sam and Aisha (can_view_sold_calls) build bundles and give or revoke access per login. A grantee reads
--    only bundles holding a live grant; every write goes through the gated RPCs below. A number sits in one live bundle.
create table if not exists public.lead_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (format in ('called_leads', 'pos')),
  criteria jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists public.lead_bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.lead_bundles(id) on delete cascade,
  phone10 text not null,
  first_name text, last_name text, email text,
  quality_tier text, quality_reason text,
  attempts int, last_dialed_at timestamptz, last_disposition text, last_agent text,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  status text not null default 'new' check (status in ('new', 'no_answer', 'callback', 'appointment', 'sold', 'not_interested', 'bad_number', 'do_not_call')),
  status_note text, status_by uuid, status_at timestamptz
);
create unique index if not exists lead_bundle_items_one_live_bundle on public.lead_bundle_items (phone10) where removed_at is null;
create index if not exists lead_bundle_items_bundle on public.lead_bundle_items (bundle_id);
create table if not exists public.lead_bundle_grants (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.lead_bundles(id) on delete cascade,
  user_id uuid not null,
  granted_by uuid, granted_at timestamptz not null default now(),
  revoked_by uuid, revoked_at timestamptz,
  note text
);
create unique index if not exists lead_bundle_grants_one_live on public.lead_bundle_grants (bundle_id, user_id) where revoked_at is null;
create index if not exists lead_bundle_grants_user on public.lead_bundle_grants (user_id) where revoked_at is null;
create table if not exists public.lead_bundle_events (
  id bigserial primary key,
  bundle_id uuid references public.lead_bundles(id) on delete cascade,
  item_id uuid, user_id uuid, actor uuid,
  action text not null, detail jsonb,
  at timestamptz not null default now()
);
alter table public.lead_bundles enable row level security;
alter table public.lead_bundle_items enable row level security;
alter table public.lead_bundle_grants enable row level security;
alter table public.lead_bundle_events enable row level security;
revoke all on public.lead_bundles, public.lead_bundle_items, public.lead_bundle_grants, public.lead_bundle_events from anon;
revoke insert, update, delete, truncate on public.lead_bundles, public.lead_bundle_items, public.lead_bundle_grants, public.lead_bundle_events from authenticated;
grant select on public.lead_bundles, public.lead_bundle_items, public.lead_bundle_grants, public.lead_bundle_events to authenticated;
drop policy if exists lead_bundles_read on public.lead_bundles;
create policy lead_bundles_read on public.lead_bundles for select to authenticated using ((select public.can_view_sold_calls()) or exists (select 1 from public.lead_bundle_grants g where g.bundle_id = lead_bundles.id and g.user_id = (select auth.uid()) and g.revoked_at is null));
drop policy if exists lead_bundle_items_read on public.lead_bundle_items;
create policy lead_bundle_items_read on public.lead_bundle_items for select to authenticated using ((select public.can_view_sold_calls()) or (removed_at is null and exists (select 1 from public.lead_bundle_grants g where g.bundle_id = lead_bundle_items.bundle_id and g.user_id = (select auth.uid()) and g.revoked_at is null)));
drop policy if exists lead_bundle_grants_read on public.lead_bundle_grants;
create policy lead_bundle_grants_read on public.lead_bundle_grants for select to authenticated using ((select public.can_view_sold_calls()) or user_id = (select auth.uid()));
drop policy if exists lead_bundle_events_read on public.lead_bundle_events;
create policy lead_bundle_events_read on public.lead_bundle_events for select to authenticated using ((select public.can_view_sold_calls()));

-- 4. Lead quality: one tier per dialed number. Blocked reads every opt-out source the app holds: the dialer's Do Not
--    Call, Book Flips (status or client record), and an agent's own "Do not call" mark on a bundle lead.
create or replace view public.v_readymode_lead_quality with (security_invoker = true) as
with flip_dnc as (
  select distinct right(regexp_replace(coalesce(w.phone, ''), '[^0-9]', '', 'g'), 10) as phone10
  from public.v_book_flip_worklist w
  where (w.flip_status = 'do_not_call' or w.do_not_call) and length(regexp_replace(coalesce(w.phone, ''), '[^0-9]', '', 'g')) >= 10
), marked_dnc as (
  select distinct phone10 from public.lead_bundle_items where status = 'do_not_call'
)
select l.phone10, l.first_name, l.last_name, l.email, l.attempts, l.first_dialed_at, l.last_dialed_at, l.last_disposition, l.last_agent, l.campaign,
  t.tier as quality_tier,
  case t.tier
    when 'blocked' then 'Do not call: the dialer, Book Flips, or an agent marked it'
    when 'pos' then 'Bought on a dialer call: a policy owner to service or rewrite'
    when 'A' then 'Warm: booked an appointment, or reached bank or SSN and stopped'
    when 'B' then 'Talked to an agent, never bought'
    when 'C' then 'Never reached, dialed 3 times or fewer'
    else 'Never reached, dialed 4 times or more'
  end as quality_reason,
  ((now() at time zone 'America/Chicago')::date - (l.last_dialed_at at time zone 'America/Chicago')::date) as days_since_dialed
from public.v_readymode_leads l
left join flip_dnc f on f.phone10 = l.phone10
left join marked_dnc m on m.phone10 = l.phone10
cross join lateral (select case
    when l.do_not_call or f.phone10 is not null or m.phone10 is not null then 'blocked'
    when l.ever_sold then 'pos'
    when l.ever_appointment or l.ever_late_objection then 'A'
    when l.ever_reached then 'B'
    when l.attempts <= 3 then 'C'
    else 'D' end as tier) t;

-- 5. RPCs. Every one gates on can_view_sold_calls() except the grantee's own read and status mark.
create or replace function public.lead_bundle_pool(p_min_days_since_dialed int default 7)
returns table (quality_tier text, quality_reason text, available int, in_live_bundles int)
language sql stable security definer set search_path = public as $$
  select q.quality_tier, min(q.quality_reason),
    (count(*) filter (where i.phone10 is null and (p_min_days_since_dialed is null or q.days_since_dialed >= p_min_days_since_dialed)))::int,
    (count(*) filter (where i.phone10 is not null))::int
  from public.v_readymode_lead_quality q
  left join (select distinct phone10 from public.lead_bundle_items where removed_at is null) i on i.phone10 = q.phone10
  where public.can_view_sold_calls()
  group by q.quality_tier
  order by array_position(array['pos', 'A', 'B', 'C', 'D', 'blocked'], q.quality_tier)
$$;

create or replace function public.lead_bundle_create(p_name text, p_format text, p_tiers text[], p_min_days_since_dialed int default 7, p_limit int default 100, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int; v_tiers text[] := p_tiers;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can build lead bundles.' using errcode = '42501';
  end if;
  if p_format not in ('called_leads', 'pos') then
    raise exception 'Format must be called_leads or pos.' using errcode = '22023';
  end if;
  if p_format = 'pos' then
    v_tiers := array['pos'];
  elsif v_tiers is null or cardinality(v_tiers) = 0 or not (v_tiers <@ array['A', 'B', 'C', 'D']) then
    raise exception 'Called-lead tiers must be among A, B, C and D.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'A bundle holds 1 to 2,000 leads.' using errcode = '22023';
  end if;
  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (coalesce(nullif(btrim(p_name), ''), (case p_format when 'pos' then 'POS ' else 'Called leads ' end) || to_char(now() at time zone 'America/Phoenix', 'Mon DD')),
          p_format, jsonb_build_object('tiers', v_tiers, 'min_days_since_dialed', p_min_days_since_dialed, 'limit', p_limit), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  insert into public.lead_bundle_items (bundle_id, phone10, first_name, last_name, email, quality_tier, quality_reason, attempts, last_dialed_at, last_disposition, last_agent)
  select v_id, q.phone10, q.first_name, q.last_name, q.email, q.quality_tier, q.quality_reason, q.attempts, q.last_dialed_at, q.last_disposition, q.last_agent
  from public.v_readymode_lead_quality q
  where q.quality_tier = any (v_tiers)
    and (p_min_days_since_dialed is null or q.days_since_dialed >= p_min_days_since_dialed)
    and not exists (select 1 from public.lead_bundle_items i where i.phone10 = q.phone10 and i.removed_at is null)
  order by array_position(array['pos', 'A', 'B', 'C', 'D'], q.quality_tier), q.last_dialed_at desc nulls last
  limit p_limit;
  get diagnostics v_n = row_count;
  insert into public.lead_bundle_events (bundle_id, actor, action, detail) values (v_id, auth.uid(), 'created', jsonb_build_object('items', v_n, 'tiers', v_tiers, 'format', p_format));
  return jsonb_build_object('bundle_id', v_id, 'items', v_n);
end $$;

create or replace function public.lead_bundle_grant(p_bundle uuid, p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can give lead access.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lead_bundles where id = p_bundle and archived_at is null) then
    raise exception 'No open bundle %.', p_bundle using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No login %.', p_user using errcode = '22023';
  end if;
  select id into v_id from public.lead_bundle_grants where bundle_id = p_bundle and user_id = p_user and revoked_at is null;
  if v_id is null then
    insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note) values (p_bundle, p_user, auth.uid(), nullif(btrim(p_note), '')) returning id into v_id;
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail) values (p_bundle, p_user, auth.uid(), 'granted', jsonb_build_object('note', p_note));
  end if;
  return jsonb_build_object('grant_id', v_id);
end $$;

create or replace function public.lead_bundle_revoke(p_bundle uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can revoke lead access.' using errcode = '42501';
  end if;
  update public.lead_bundle_grants set revoked_at = now(), revoked_by = auth.uid() where bundle_id = p_bundle and user_id = p_user and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action) values (p_bundle, p_user, auth.uid(), 'revoked');
  end if;
  return jsonb_build_object('revoked', v_n);
end $$;

create or replace function public.lead_bundle_remove_item(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bundle uuid;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can take a lead out of a bundle.' using errcode = '42501';
  end if;
  update public.lead_bundle_items set removed_at = now() where id = p_item and removed_at is null returning bundle_id into v_bundle;
  if v_bundle is not null then
    insert into public.lead_bundle_events (bundle_id, item_id, actor, action) values (v_bundle, p_item, auth.uid(), 'removed');
  end if;
  return jsonb_build_object('removed', v_bundle is not null);
end $$;

create or replace function public.lead_bundle_archive(p_bundle uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_grants int; v_items int;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can archive a bundle.' using errcode = '42501';
  end if;
  update public.lead_bundle_grants set revoked_at = now(), revoked_by = auth.uid() where bundle_id = p_bundle and revoked_at is null;
  get diagnostics v_grants = row_count;
  update public.lead_bundle_items set removed_at = now() where bundle_id = p_bundle and removed_at is null;
  get diagnostics v_items = row_count;
  update public.lead_bundles set archived_at = now() where id = p_bundle and archived_at is null;
  insert into public.lead_bundle_events (bundle_id, actor, action, detail) values (p_bundle, auth.uid(), 'archived', jsonb_build_object('grants_revoked', v_grants, 'leads_returned', v_items));
  return jsonb_build_object('grants_revoked', v_grants, 'leads_returned', v_items);
end $$;

create or replace function public.lead_bundle_item_set(p_item uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bundle uuid;
begin
  select bundle_id into v_bundle from public.lead_bundle_items where id = p_item and removed_at is null;
  if v_bundle is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  if not (public.can_view_sold_calls() or exists (select 1 from public.lead_bundle_grants g where g.bundle_id = v_bundle and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;
  if p_status not in ('new', 'no_answer', 'callback', 'appointment', 'sold', 'not_interested', 'bad_number', 'do_not_call') then
    raise exception 'Unknown status %.', p_status using errcode = '22023';
  end if;
  update public.lead_bundle_items set status = p_status, status_note = left(nullif(btrim(p_note), ''), 500), status_by = auth.uid(), status_at = now() where id = p_item;
  insert into public.lead_bundle_events (bundle_id, item_id, user_id, actor, action, detail) values (v_bundle, p_item, auth.uid(), auth.uid(), 'status', jsonb_build_object('status', p_status, 'note', left(p_note, 500)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.my_lead_bundles()
returns table (item_id uuid, bundle_id uuid, bundle_name text, format text, phone10 text, first_name text, last_name text, email text,
               quality_tier text, quality_reason text, attempts int, last_dialed_at timestamptz, last_disposition text,
               status text, status_note text, status_at timestamptz, granted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, b.id, b.name, b.format, i.phone10, i.first_name, i.last_name, i.email, i.quality_tier, i.quality_reason, i.attempts,
         i.last_dialed_at, i.last_disposition, i.status, i.status_note, i.status_at, g.granted_at
  from public.lead_bundle_grants g
  join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
  join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
  where g.user_id = auth.uid() and g.revoked_at is null
    and not exists (select 1 from public.readymode_dialer_calls c where c.lead_phone10 = i.phone10 and c.disposition = 'Do Not Call')
  order by b.created_at desc, array_position(array['pos', 'A', 'B', 'C', 'D'], i.quality_tier), i.last_dialed_at desc nulls last
$$;

revoke execute on function public.lead_bundle_pool(int) from public, anon;
revoke execute on function public.lead_bundle_create(text, text, text[], int, int, text) from public, anon;
revoke execute on function public.lead_bundle_grant(uuid, uuid, text) from public, anon;
revoke execute on function public.lead_bundle_revoke(uuid, uuid) from public, anon;
revoke execute on function public.lead_bundle_remove_item(uuid) from public, anon;
revoke execute on function public.lead_bundle_archive(uuid) from public, anon;
revoke execute on function public.lead_bundle_item_set(uuid, text, text) from public, anon;
revoke execute on function public.my_lead_bundles() from public, anon;
grant execute on function public.lead_bundle_pool(int), public.lead_bundle_create(text, text, text[], int, int, text), public.lead_bundle_grant(uuid, uuid, text),
  public.lead_bundle_revoke(uuid, uuid), public.lead_bundle_remove_item(uuid), public.lead_bundle_archive(uuid), public.lead_bundle_item_set(uuid, text, text),
  public.my_lead_bundles() to authenticated;

-- 6. One row per bundle for the admin page: what is left, what moved, and who holds it.
create or replace view public.v_lead_bundle_summary with (security_invoker = true) as
select b.id as bundle_id, b.name, b.format, b.criteria, b.note, b.created_at, b.archived_at,
  count(i.id) filter (where i.removed_at is null)::int as live_items,
  count(i.id) filter (where i.removed_at is null and i.status = 'new')::int as untouched,
  count(i.id) filter (where i.status = 'appointment')::int as appointments,
  count(i.id) filter (where i.status = 'sold')::int as sold,
  count(i.id) filter (where i.status in ('not_interested', 'bad_number', 'do_not_call'))::int as closed_out,
  (select coalesce(jsonb_agg(jsonb_build_object('user_id', g.user_id, 'granted_at', g.granted_at,
      'name', (select a2.display_name from public.agents a2 where a2.user_id = g.user_id order by (a2.canonical_agent_id is null) desc, a2.created_at limit 1))
      order by g.granted_at), '[]'::jsonb)
   from public.lead_bundle_grants g where g.bundle_id = b.id and g.revoked_at is null) as holders
from public.lead_bundles b left join public.lead_bundle_items i on i.bundle_id = b.id
group by b.id;
