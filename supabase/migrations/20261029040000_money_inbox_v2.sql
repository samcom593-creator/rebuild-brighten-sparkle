-- Privacy fails closed for legacy rows until the Mac has reclassified them.
alter table public.money_inbox_threads
 add column if not exists source text not null default 'imessage',
 add column if not exists topics text[] not null default '{other}',
 add column if not exists priority integer not null default 3 check(priority between 1 and 3),
 add column if not exists private boolean not null default true,
 add column if not exists privacy_reason text,
 add column if not exists classified_at timestamptz,
 add column if not exists snoozed_until timestamptz,
 add column if not exists source_url text,
 add column if not exists send_supported boolean not null default false,
 add column if not exists send_started_at timestamptz,
 add column if not exists delivered_at timestamptz,
 add column if not exists delivery_latency_ms numeric;
-- The browser cannot overwrite classification, recipients or delivery receipts.
revoke update on public.money_inbox_threads from authenticated;
grant update(final_reply,status,approved_at,muted,snoozed_until) on public.money_inbox_threads to authenticated;
drop policy if exists money_inbox_sam_select on public.money_inbox_threads;
create policy money_inbox_sam_select on public.money_inbox_threads for select to authenticated
 using(auth.uid()='71826bba-5577-4810-a226-1f6f2ad5288a'::uuid and private=false and classified_at is not null);
drop policy if exists money_inbox_sam_update on public.money_inbox_threads;
create policy money_inbox_sam_update on public.money_inbox_threads for update to authenticated
 using(auth.uid()='71826bba-5577-4810-a226-1f6f2ad5288a'::uuid and private=false and classified_at is not null)
 with check(auth.uid()='71826bba-5577-4810-a226-1f6f2ad5288a'::uuid and private=false and classified_at is not null);
create or replace function public.fn_money_inbox_guard() returns trigger language plpgsql as $$
begin
 if current_user='authenticated' then
  if new.status not in ('approved','skipped',old.status) then raise exception 'Invalid inbox action'; end if;
  if new.status='approved' and old.status<>'approved' then
   if old.status not in ('pending','failed') or not old.send_supported or old.private or length(trim(coalesce(new.final_reply,'')))=0 then raise exception 'Thread cannot be approved'; end if;
   new.approved_at=clock_timestamp();
  end if;
 end if;
 return new;
end $$;
drop trigger if exists money_inbox_guard on public.money_inbox_threads;
create trigger money_inbox_guard before update on public.money_inbox_threads for each row execute function public.fn_money_inbox_guard();
create table if not exists public.money_inbox_sources (
 source text primary key, connected boolean not null, reason text not null, last_ingested_at timestamptz, checked_at timestamptz not null default now()
);
alter table public.money_inbox_sources enable row level security;
revoke all on public.money_inbox_sources from anon,authenticated;
grant select on public.money_inbox_sources to authenticated;
drop policy if exists money_sources_sam on public.money_inbox_sources;
create policy money_sources_sam on public.money_inbox_sources for select to authenticated using(auth.uid()='71826bba-5577-4810-a226-1f6f2ad5288a'::uuid);
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='money_inbox_threads') then alter publication supabase_realtime add table public.money_inbox_threads; end if;
end $$;
create index if not exists money_inbox_recent_idx on public.money_inbox_threads(private,last_inbound_at desc);
