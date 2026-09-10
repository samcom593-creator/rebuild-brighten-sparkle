create or replace function public.content_clips_find_label(p_name text, p_modified timestamptz, p_tags text[], p_id uuid)
returns text language plpgsql immutable as $FN$
declare
  m text[]; ts timestamptz; has_fname_ts boolean := false; subj text := null; setting text := null; lbl text; t text; suffix text;
  subjects text[] := array['car','workout','drone','money','food','event','office','home','talking-head'];
  junk text[] := array['urn','water','table','object','container','liquid','wall','room','space','thing','item','person','holding','screen','facade','landscape','lot','phone-upload','phone','man','woman','frame','people','hand','dark','light','image','video','clip','indoor','indoors','window','floor','ceiling','chair','plant','flowers','box'];
begin
  m := regexp_match(p_name, '(\d{4})-(\d{2})-(\d{2})[_-]?(\d{2})(\d{2})(\d{2})');
  if m is not null then
    begin ts := make_timestamptz(m[1]::int,m[2]::int,m[3]::int,m[4]::int,m[5]::int,m[6]::int); has_fname_ts := true; exception when others then ts := p_modified; end;
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
  subj := coalesce(subj, 'Clip');
  lbl := initcap(replace(subj, '-', ' '));
  if setting is not null then lbl := lbl || ' · ' || setting; end if;
  if ts is not null then lbl := lbl || ' · ' || to_char(ts at time zone 'America/Phoenix', 'Mon FMDD, FMHH12:MIam'); end if;
  -- tiebreaker so batch-imported clips (shared mtime, no filename time) stay unique:
  -- the filename's trailing number, else the last 4 of the id.
  if not has_fname_ts then
    m := regexp_match(p_name, '(\d{3,})\D*$');
    suffix := coalesce(m[1], right(replace(p_id::text,'-',''), 4));
    lbl := lbl || ' · #' || suffix;
  end if;
  return lbl;
end $FN$;
update public.content_clips set find_label = public.content_clips_find_label(name, modified_at, tags, id);
