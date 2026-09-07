-- 20260907170000_content_cards.sql
-- Content Command board (admin-only content planner). One row per planned
-- video: idea -> recorded -> ready -> posted, with the systematic Launch-4 job
-- tag (REACH/AUTHORITY/PROOF/CONVERT), brand (@sellfordaddy / @imakesystems),
-- day slot, finished-clip filename, and caption. RLS gated to admin/manager
-- via has_role (same pattern as manual_interview_entries). Seeded with the
-- 2026-09-07 launch plan (4 story sequences + 3 launch posts + 7-day map).

create table if not exists public.content_cards (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  brand        text not null default 'SFD' check (brand in ('SFD','IMS')),
  content_type text not null default 'short',
  job          text not null default 'REACH' check (job in ('REACH','AUTHORITY','PROOF','CONVERT')),
  hook         text not null default '',
  caption      text not null default '',
  status       text not null default 'idea' check (status in ('idea','recorded','ready','posted')),
  day          integer not null default 0 check (day between 0 and 7),
  clip         text not null default '',
  sort         double precision not null default 0,
  posted_at    timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.content_cards enable row level security;

drop policy if exists content_cards_admin_all on public.content_cards;
create policy content_cards_admin_all on public.content_cards
  for all to authenticated
  using  (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role))
  with check (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role));

create index if not exists content_cards_status_idx on public.content_cards(status);
create index if not exists content_cards_day_idx on public.content_cards(day);

-- keep updated_at fresh (reuse the app's generic trigger fn if present, else inline)
create or replace function public.content_cards_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_content_cards_updated_at on public.content_cards;
create trigger trg_content_cards_updated_at before update on public.content_cards
  for each row execute function public.content_cards_touch_updated_at();

-- Seed the launch plan ONCE (only when the table is empty, so a re-run/db push
-- never duplicates the rows already inserted live via bot-sql on 2026-09-07).
do $$
begin
  if not exists (select 1 from public.content_cards) then
    insert into public.content_cards (title,brand,content_type,job,hook,caption,status,day,sort) values
    ('Story · START — who I am','SFD','story','REACH','3 frames: Samuel James / Sales. Business. Life. -> Founder of Apex -> the life around the work.','','ready',1,0),
    ('Story · APEX — the offer','SFD','story','CONVERT','Interested in life-insurance sales? Licensed -> apply. Not licensed -> pathway. Link sticker: Apply to Apex.','','ready',1,10),
    ('Story · SYSTEMS — how it works','IMS','story','PROOF','Sanitized app -> success page -> roster. One application, tracked in one place.','','ready',1,20),
    ('Story · APPLY — join CTA','IMS','story','CONVERT','Want to join the Apex team? Review the opportunity and apply. Link: apex-financial.org/apply','','ready',1,30),
    ('Intro carousel — the fuller story','SFD','carousel','REACH','Most people know me through insurance. There is more: sales, systems, cars, real life.','','ready',1,40),
    ('Sales lesson — objection is not rejection','SFD','short','AUTHORITY','When someone says I need to think about it, do not pitch harder. Ask what they still need clarity on.','','idea',2,50),
    ('Systems demo — what happens after you apply','IMS','demo','PROOF','Licensed -> interview. Unlicensed -> pathway. Tracked in the roster.','','idea',1,60),
    ('Work-to-gym mini-vlog','SFD','vlog','REACH','Human context — the work behind the offer, then the gym.','','idea',3,70),
    ('Agent story / training walkthrough','IMS','demo','PROOF','One approved agent story — accurate timeframe, real words.','','idea',3,80),
    ('Leadership lesson from real experience','SFD','short','AUTHORITY','A specific event or lesson — behind the scenes.','','idea',4,90),
    ('Car-business clip — partner access, honestly','SFD','short','REACH','Explain partner access honestly (access is not ownership).','','idea',5,100),
    ('Onboarding process demo','IMS','demo','PROOF','Show the work behind the offer — the onboarding steps.','','idea',5,110),
    ('Fitness progress / routine','SFD','vlog','REACH','Personal identity — real footage, no medical claims.','','idea',6,120),
    ('Weekly recap + apply CTA','SFD','short','CONVERT','What actually happened this week — only real results. End on the apply link.','','idea',7,130);
  end if;
end $$;
