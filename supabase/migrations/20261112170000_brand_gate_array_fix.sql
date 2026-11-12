-- MP-BRAND-ENGINE: content_cards_brand_gate() built its "missing" list with `missing || 'pillar'`, which
-- Postgres reads as array || array and rejects ('malformed array literal') instead of naming the gap.
-- Caught by the rolled-back proof before any card reached Scheduled. array_append is unambiguous.
create or replace function public.content_cards_brand_gate()
returns trigger
language plpgsql
set search_path = public
as $$
declare missing text[] := array[]::text[];
begin
  if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled') then
    if coalesce(btrim(new.title), '') = '' then missing := array_append(missing, 'title'); end if;
    if coalesce(btrim(new.brief->>'account'), '') = '' then missing := array_append(missing, 'account'); end if;
    if coalesce(btrim(new.brief->>'pillar'), '') = '' then missing := array_append(missing, 'pillar'); end if;
    if coalesce(btrim(new.brief->>'keyword'), '') = '' then missing := array_append(missing, 'CTA keyword'); end if;
    if coalesce(array_length(missing, 1), 0) > 0 then
      raise exception 'A card cannot be Scheduled without %. Add it on the Launch Board Plan tab.', array_to_string(missing, ', ')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
