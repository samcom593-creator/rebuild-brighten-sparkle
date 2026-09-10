-- 20260910140000_content_clips_find_label.sql
-- Sam, 2026-09-10: the funny hook titles REPEAT ("My daily coffee ritual" on 28
-- clips, "Nobody drives this daily" on 43) so he can't tell clips apart or find
-- one. Add a distinct, findable label built from reliable signals — the
-- filename date/time (unique per clip) + the best real subject tag + setting —
-- so every clip is searchable and unmistakable. The funny hook stays for
-- posting; this is the disambiguator shown + searched in the Library.
alter table public.content_clips add column if not exists find_label text;

create or replace function public.content_clips_find_label(p_name text, p_modified timestamptz, p_tags text[])
returns text language plpgsql immutable as $$
declare
  m text[]; ts timestamptz; subj text := null; setting text := null; lbl text; t text;
  subjects text[] := array['car','workout','drone','money','food','phone','event','talking-head','office','home'];
  junk text[] := array['urn','water','table','object','container','liquid','wall','room','space','thing','item','person','holding','screen','facade','landscape','lot'];
begin
  m := regexp_match(p_name, '(\d{4})-(\d{2})-(\d{2})[_-]?(\d{2})(\d{2})(\d{2})');
  if m is not null then
    begin ts := make_timestamptz(m[1]::int,m[2]::int,m[3]::int,m[4]::int,m[5]::int,m[6]::int); exception when others then ts := p_modified; end;
  else
    m := regexp_match(p_name, '(\d{4})-(\d{2})-(\d{2})');
    if m is not null then begin ts := make_timestamptz(m[1]::int,m[2]::int,m[3]::int,12,0,0); exception when others then ts := p_modified; end;
    else ts := p_modified; end if;
  end if;
  foreach t in array coalesce(p_tags,'{}') loop
    if subj is null and t = any(subjects) then subj := t; end if;
    if setting is null and t in ('night','outdoors') then setting := t; end if;
  end loop;
  if subj is null then
    foreach t in array coalesce(p_tags,'{}') loop
      if subj is null and not (t = any(junk)) and t not in ('horizontal','vertical','night','outdoors') then subj := t; end if;
    end loop;
  end if;
  subj := coalesce(subj, 'clip');
  lbl := initcap(replace(subj, '-', ' '));
  if setting is not null then lbl := lbl || ' · ' || setting; end if;
  if ts is not null then lbl := lbl || ' · ' || to_char(ts at time zone 'America/Phoenix', 'Mon FMDD, FMHH12:MIam'); end if;
  return lbl;
end $$;

update public.content_clips set find_label = public.content_clips_find_label(name, modified_at, tags);
create index if not exists content_clips_find_label_idx on public.content_clips (lower(find_label));
