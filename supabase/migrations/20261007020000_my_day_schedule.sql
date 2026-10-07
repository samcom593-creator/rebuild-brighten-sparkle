-- My Day schedule (Sam 2026-10-06): wake by 6 AM, every task with a time and length, tap to strike through.
-- Defaults are a template; each user gets their own editable copy via day_plan_ensure_seeded() on first open.
create table if not exists public.day_plan_defaults (
  id serial primary key, weekday smallint not null check (weekday between 1 and 7),
  start_min smallint not null check (start_min between 0 and 1439), duration_min smallint not null check (duration_min between 5 and 900),
  title text not null, detail text, category text not null, sort smallint not null default 0, unique (weekday, start_min, title));
create table if not exists public.day_plan_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  weekday smallint not null check (weekday between 1 and 7),
  start_min smallint not null check (start_min between 0 and 1439), duration_min smallint not null check (duration_min between 5 and 900),
  title text not null, detail text, category text not null default 'other', sort smallint not null default 0,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists day_plan_tasks_user_day_idx on public.day_plan_tasks (user_id, weekday, start_min);
create table if not exists public.day_plan_checks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  task_id uuid not null references public.day_plan_tasks(id) on delete cascade, day date not null,
  done_at timestamptz not null default now(), unique (user_id, task_id, day));
alter table public.day_plan_defaults enable row level security;
alter table public.day_plan_tasks enable row level security;
alter table public.day_plan_checks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='day_plan_defaults' and policyname='day_plan_defaults_read') then
    create policy day_plan_defaults_read on public.day_plan_defaults for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='day_plan_tasks' and policyname='day_plan_tasks_own') then
    create policy day_plan_tasks_own on public.day_plan_tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); end if;
  if not exists (select 1 from pg_policies where tablename='day_plan_checks' and policyname='day_plan_checks_own') then
    create policy day_plan_checks_own on public.day_plan_checks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); end if;
end $$;
-- This project adds no default grants to new tables (2026-10-06 lesson: the page silently read 0 rows).
grant select on public.day_plan_defaults to authenticated;
grant select, insert, update, delete on public.day_plan_tasks, public.day_plan_checks to authenticated;
grant all on public.day_plan_defaults, public.day_plan_tasks, public.day_plan_checks to service_role;
create or replace function public.day_plan_ensure_seeded() returns integer
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  select count(*) into n from public.day_plan_tasks where user_id = auth.uid();
  if n > 0 then return n; end if;
  insert into public.day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort)
    select auth.uid(), weekday, start_min, duration_min, title, detail, category, sort from public.day_plan_defaults;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.day_plan_ensure_seeded() from public, anon;
grant execute on function public.day_plan_ensure_seeded() to authenticated;
insert into public.day_plan_defaults (weekday, start_min, duration_min, title, detail, category, sort) values
(1,330,30,'Wake up + quiet time + top 3','Water, prayer or quiet, read today''s top 3','faith',0),
(1,360,75,'Gym','Train hard, phone away','health',1),
(1,435,15,'Shower + breakfast',null,'health',2),
(1,450,60,'Leadership huddle','Set the week: team targets, who needs help','leadership',3),
(1,510,180,'Recruiting calls','Work the ''Likely to join'' list first','recruiting',4),
(1,690,90,'Sales','Book and close. Grab a Short if a good moment happens','sales',5),
(1,780,30,'Lunch',null,'health',6),
(1,810,90,'CEO work','Your top 3 business moves','ceo',7),
(1,900,60,'Record today''s long-form: Sales skills','One take, talk to camera. The editor skill does the cut','content',8),
(1,960,45,'Record Shorts (aim 7)','Cut 5 from today''s long-form, film 2 fresh','content',9),
(1,1005,15,'Post Shorts via Repurpose','One post, every platform','content',10),
(1,1020,60,'Leadership','Team calls, wins, accountability','leadership',11),
(1,1080,60,'Dinner + family',null,'rest',12),
(1,1140,45,'Approve edits + pick tomorrow''s video','Review the long-form edit, choose tomorrow''s topic','content',13),
(1,1185,30,'Watch Later: 1 video, 1 idea','Save the idea to the Launch Board','learning',14),
(1,1215,75,'Free time',null,'rest',15),
(1,1290,30,'Shutdown: inbox zero + tomorrow''s top 3',null,'planning',16),
(1,1320,450,'Sleep (7.5 h)',null,'rest',17),
(2,330,30,'Wake up + quiet time + top 3','Water, prayer or quiet, read today''s top 3','faith',18),
(2,360,75,'Gym','Train hard, phone away','health',19),
(2,435,15,'Shower + breakfast',null,'health',20),
(2,450,60,'Sales training','Role-play, scripts, objections with the team','sales',21),
(2,510,180,'Recruiting calls','Work the ''Likely to join'' list first','recruiting',22),
(2,690,90,'Sales','Book and close. Grab a Short if a good moment happens','sales',23),
(2,780,30,'Lunch',null,'health',24),
(2,810,90,'CEO work','Your top 3 business moves','ceo',25),
(2,900,60,'Record today''s long-form: Money & proof','One take, talk to camera. The editor skill does the cut','content',26),
(2,960,45,'Record Shorts (aim 7)','Cut 5 from today''s long-form, film 2 fresh','content',27),
(2,1005,15,'Post Shorts via Repurpose','One post, every platform','content',28),
(2,1020,60,'Leadership','Team calls, wins, accountability','leadership',29),
(2,1080,60,'Dinner + family',null,'rest',30),
(2,1140,45,'Approve edits + pick tomorrow''s video','Review the long-form edit, choose tomorrow''s topic','content',31),
(2,1185,30,'Watch Later: 1 video, 1 idea','Save the idea to the Launch Board','learning',32),
(2,1215,75,'Free time',null,'rest',33),
(2,1290,30,'Shutdown: inbox zero + tomorrow''s top 3',null,'planning',34),
(2,1320,450,'Sleep (7.5 h)',null,'rest',35),
(3,330,30,'Wake up + quiet time + top 3','Water, prayer or quiet, read today''s top 3','faith',36),
(3,360,75,'Gym','Train hard, phone away','health',37),
(3,435,15,'Shower + breakfast',null,'health',38),
(3,450,60,'Recruiting push','Interviews and follow-ups from the Likely to join list','recruiting',39),
(3,510,180,'Recruiting calls','Work the ''Likely to join'' list first','recruiting',40),
(3,690,90,'Sales','Book and close. Grab a Short if a good moment happens','sales',41),
(3,780,30,'Lunch',null,'health',42),
(3,810,90,'CEO work','Your top 3 business moves','ceo',43),
(3,900,60,'Record today''s long-form: Team & the 9–5 exit','One take, talk to camera. The editor skill does the cut','content',44),
(3,960,45,'Record Shorts (aim 7)','Cut 5 from today''s long-form, film 2 fresh','content',45),
(3,1005,15,'Post Shorts via Repurpose','One post, every platform','content',46),
(3,1020,60,'Leadership','Team calls, wins, accountability','leadership',47),
(3,1080,60,'Dinner + family',null,'rest',48),
(3,1140,45,'Approve edits + pick tomorrow''s video','Review the long-form edit, choose tomorrow''s topic','content',49),
(3,1185,30,'Watch Later: 1 video, 1 idea','Save the idea to the Launch Board','learning',50),
(3,1215,75,'Free time',null,'rest',51),
(3,1290,30,'Shutdown: inbox zero + tomorrow''s top 3',null,'planning',52),
(3,1320,450,'Sleep (7.5 h)',null,'rest',53),
(4,330,30,'Wake up + quiet time + top 3','Water, prayer or quiet, read today''s top 3','faith',54),
(4,360,75,'Gym','Train hard, phone away','health',55),
(4,435,15,'Shower + breakfast',null,'health',56),
(4,450,60,'Production review','Who wrote what, who is stuck, fix it','ceo',57),
(4,510,180,'Recruiting calls','Work the ''Likely to join'' list first','recruiting',58),
(4,690,90,'Sales','Book and close. Grab a Short if a good moment happens','sales',59),
(4,780,30,'Lunch',null,'health',60),
(4,810,90,'CEO work','Your top 3 business moves','ceo',61),
(4,900,60,'Record today''s long-form: Habits & discipline','One take, talk to camera. The editor skill does the cut','content',62),
(4,960,45,'Record Shorts (aim 7)','Cut 5 from today''s long-form, film 2 fresh','content',63),
(4,1005,15,'Post Shorts via Repurpose','One post, every platform','content',64),
(4,1020,60,'Leadership','Team calls, wins, accountability','leadership',65),
(4,1080,60,'Dinner + family',null,'rest',66),
(4,1140,45,'Approve edits + pick tomorrow''s video','Review the long-form edit, choose tomorrow''s topic','content',67),
(4,1185,30,'Watch Later: 1 video, 1 idea','Save the idea to the Launch Board','learning',68),
(4,1215,75,'Free time',null,'rest',69),
(4,1290,30,'Shutdown: inbox zero + tomorrow''s top 3',null,'planning',70),
(4,1320,450,'Sleep (7.5 h)',null,'rest',71),
(5,330,30,'Wake up + quiet time + top 3','Water, prayer or quiet, read today''s top 3','faith',72),
(5,360,75,'Gym','Film 2 gym Shorts today (fitness day)','health',73),
(5,435,15,'Shower + breakfast',null,'health',74),
(5,450,60,'Finance + content review','Money in/out, then this week''s video numbers','ceo',75),
(5,510,180,'Recruiting calls','Work the ''Likely to join'' list first','recruiting',76),
(5,690,90,'Sales','Book and close. Grab a Short if a good moment happens','sales',77),
(5,780,30,'Lunch',null,'health',78),
(5,810,90,'CEO work','Your top 3 business moves','ceo',79),
(5,900,60,'Record today''s long-form: Fitness & health','One take, talk to camera. The editor skill does the cut','content',80),
(5,960,45,'Record Shorts (aim 7)','Cut 5 from today''s long-form, film 2 fresh','content',81),
(5,1005,15,'Post Shorts via Repurpose','One post, every platform','content',82),
(5,1020,60,'Leadership','Team calls, wins, accountability','leadership',83),
(5,1080,60,'Dinner + family',null,'rest',84),
(5,1140,45,'Approve edits + pick tomorrow''s video','Review the long-form edit, choose tomorrow''s topic','content',85),
(5,1185,30,'Watch Later: 1 video, 1 idea','Save the idea to the Launch Board','learning',86),
(5,1215,75,'Free time',null,'rest',87),
(5,1290,30,'Shutdown: inbox zero + tomorrow''s top 3',null,'planning',88),
(5,1320,450,'Sleep (7.5 h)',null,'rest',89),
(6,330,30,'Wake up + quiet time + top 3',null,'faith',90),
(6,360,75,'Gym','Film 2 gym Shorts','health',91),
(6,435,45,'Breakfast',null,'health',92),
(6,480,60,'Bonus long-form: Story & life','Only if a weekday long-form was missed','content',93),
(6,540,60,'Record Shorts (aim 7)','Day-in-the-life, story beats','content',94),
(6,600,15,'Post Shorts via Repurpose',null,'content',95),
(6,615,345,'Free day: family, rest, recharge',null,'rest',96),
(6,960,60,'Light work: DMs + replies',null,'sales',97),
(6,1020,270,'Free time',null,'rest',98),
(6,1290,30,'Shutdown: tomorrow''s top 3',null,'planning',99),
(6,1320,450,'Sleep (7.5 h)',null,'rest',100),
(7,360,30,'Wake up + quiet time',null,'faith',101),
(7,390,60,'Walk + reset','No screens','faith',102),
(7,450,390,'Family + rest',null,'rest',103),
(7,840,90,'Plan next week: 5 long-forms + 20 hooks','Pick Mon–Fri topics on the Launch Board week','content',104),
(7,930,30,'Schedule Sunday Shorts in Repurpose',null,'content',105),
(7,960,60,'Free time',null,'rest',106),
(7,1020,60,'CEO planning: week review',null,'ceo',107),
(7,1080,210,'Free time',null,'rest',108),
(7,1290,30,'Shutdown: Monday''s top 3',null,'planning',109),
(7,1320,450,'Sleep (7.5 h)',null,'rest',110)
on conflict (weekday, start_min, title) do nothing;
notify pgrst, 'reload schema';
