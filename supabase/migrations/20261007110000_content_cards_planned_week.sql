-- Launch Board week view (2026-10-07): content_cards.day is a weekday (1-7) with no week,
-- so a card planned last Tuesday sat on this Tuesday forever, published or not, and
-- counted toward "Long-form planned 5/5". planned_week records the Phoenix Monday of the
-- week a card was put on a day. The trigger sets it whenever day changes, so every
-- writer (Move, drag, + Add, any script) stays correct without knowing about it.
alter table public.content_cards add column if not exists planned_week date;
comment on column public.content_cards.planned_week is
  'Phoenix Monday of the week the card was placed on a day (1-7); null when unplanned. Set by trg_content_cards_planned_week.';

create or replace function public.content_cards_set_planned_week()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(new.day, 0) = 0 then
    new.planned_week := null;
  elsif tg_op = 'INSERT' or new.day is distinct from old.day or new.planned_week is null then
    new.planned_week := date_trunc('week', (now() at time zone 'America/Phoenix'))::date;
  end if;
  return new;
end
$fn$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_content_cards_planned_week'
                 and tgrelid = 'public.content_cards'::regclass) then
    create trigger trg_content_cards_planned_week
      before insert or update of day, planned_week on public.content_cards
      for each row execute function public.content_cards_set_planned_week();
  end if;
end $$;

-- The five cards on the board today were planned this week (Monday 2026-10-05).
update public.content_cards set planned_week = date '2026-10-05'
 where coalesce(day, 0) > 0 and planned_week is null;
