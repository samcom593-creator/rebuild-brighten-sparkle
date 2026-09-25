-- Mirror of MCP-applied migration ayro_book_ingest (version 20260925024127).
-- Ayro Financial all-time production pulled from el.ayrofinancial.com into its own table.
begin;
create table if not exists public.ayro_book (
  id bigserial primary key, agent_name text not null, agent_id uuid, policy_number text, carrier text,
  annual_premium numeric not null default 0, status text, is_excluded boolean not null default false,
  source text not null default 'ayro', period text not null default 'all_time', imported_at timestamptz not null default now());
alter table public.ayro_book enable row level security;
drop policy if exists ayro_book_admin_read on public.ayro_book;
create policy ayro_book_admin_read on public.ayro_book for select using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role));
grant select on public.ayro_book to authenticated;
delete from public.ayro_book where period = 'all_time';
insert into public.ayro_book (agent_name, policy_number, carrier, annual_premium, status, is_excluded) values
  ('Dom Yous','FEXB776980','Transamerica',1392,'Sold / Approved',true),('snow flake','TA6713126413','Ethos',1620,'Sold / Approved',true),
  ('Tyler Krejcha','TA5754493179','Ethos',4234,'Sold / Approved',false),('Travis N','SI3269459103','Ethos',1620,'Sold / Approved',false),
  ('Dom Yous','FEXB776795','Transamerica',1856,'Sold / Approved',true),('Dom Yous','FEXB776822','Transamerica',1665,'Sold / Approved',true),
  ('Michael Kayembe','TA3908683927','Ethos',2235,'Sold / Approved',false),('Tyler Krejcha','TA6190630296','Ethos',3782,'Sold / Approved',false),
  ('Dom Yous','FEXB774711','Transamerica',1843,'Sold / Approved',true),('Dom Yous','FEXB775115','Transamerica',1931,'Sold / Approved',true),
  ('Michael Kayembe','TA5967410326','Ethos',1710,'Sold / Approved',false),('Michael Kayembe','TA1028405317','Ethos',1706,'Sold / Approved',false),
  ('Dom Yous','IULA088826','Transamerica',1487,'Sold / Approved',true),('snow flake','7GG78837','Chubb',1062,'Sold / Approved',true),
  ('Tyler Krejcha','7GG78675','Chubb',3169,'Sold / Approved',false),('David agbebaku',null,'Americo',763,'Sold / Approved',false),
  ('jontay taylor','TA4031411107','American Amicable',1700,'Sold / Approved',false),('Dom Yous','FEXB773873','Transamerica',1954,'Sold / Approved',true),
  ('Dom Yous','AM03721247','Americo',1116,'Sold / Approved',true),('Tyler Krejcha','7GG78679','Chubb',3169,'Sold / Approved',false);
update public.ayro_book b set agent_id = a.id from public.agents a
where a.canonical_agent_id is null and a.is_deactivated is not true and a.status::text <> 'terminated'
  and lower(regexp_replace(a.display_name,'\s+',' ','g')) = lower(regexp_replace(b.agent_name,'\s+',' ','g'));
create or replace view public.v_ayro_production with (security_invoker = true) as
  select agent_name, max(agent_id::text)::uuid as agent_id, count(*) as deals, round(sum(annual_premium),2) as all_time_production,
         string_agg(distinct carrier, ', ' order by carrier) as carriers
  from public.ayro_book where not is_excluded group by agent_name order by sum(annual_premium) desc;
create or replace view public.v_ayro_book with (security_invoker = true) as
  select id, agent_name, agent_id, policy_number, carrier, annual_premium, status, is_excluded,
         (policy_number is null or btrim(policy_number)='') as no_policy_number, imported_at
  from public.ayro_book order by is_excluded, annual_premium desc;
create or replace view public.v_ayro_totals with (security_invoker = true) as select
  (select count(*) from public.ayro_book where not is_excluded) as deals,
  (select round(sum(annual_premium),2) from public.ayro_book where not is_excluded) as production,
  (select count(distinct agent_name) from public.ayro_book where not is_excluded) as agents,
  (select round(sum(annual_premium),2) from public.ayro_book where is_excluded) as excluded_production,
  (select string_agg(distinct agent_name, ', ') from public.ayro_book where is_excluded) as excluded_agents,
  (select max(imported_at) from public.ayro_book) as as_of;
grant select on public.v_ayro_production, public.v_ayro_book, public.v_ayro_totals to authenticated;
commit;
