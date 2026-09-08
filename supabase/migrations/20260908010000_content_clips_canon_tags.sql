create or replace function public.content_clips_canon_tags(p_tags text[], p_name text, p_kind text, p_desc text)
returns text[] language plpgsql immutable as $$
declare m jsonb := '{"workout":["gym","exercise","weights","weight","lifting","dumbbell","dumbbells","barbell","bench","squat","deadlift","fitness","training","muscle","treadmill","pushup","workout"],"car":["car","cars","vehicle","corvette","automobile","sedan","truck","suv","porsche","bmw","mercedes","lamborghini","tesla","driving","steering","dashboard","parking"],"drone":["drone","aerial","overhead","skyline","top-down","dji"],"office":["office","desk","computer","monitor","laptop","keyboard","headphones","workspace","chair"],"talking-head":["talking","speaking","presenting","microphone","podcast","interview","camera","selfie","vlog"],"outdoors":["outdoor","outdoors","street","road","highway","city","building","sky","sunset","sunrise","beach","park","trees","field"],"event":["crowd","audience","stage","conference","seminar","meeting","event","team","group","people"],"home":["home","kitchen","bedroom","living","couch","sofa","house","apartment"],"food":["food","restaurant","coffee","drink","meal","eating","plate"],"money":["money","cash","dollars","check","contract","paper","document"],"phone":["phone","smartphone","iphone","texting","calling"],"night":["night","dark","evening","lights","neon"]}'::jsonb;
  w text; k text; out text[] := '{}'; words text[];
begin
  words := array_cat(coalesce(p_tags,'{}'), regexp_split_to_array(lower(coalesce(p_desc,'')), '[^a-z''-]+'));
  foreach w in array words loop
    w := lower(btrim(w, '.,;:()'));
    for k in select key from jsonb_each(m) where value ? w loop
      if not (k = any(out)) then out := out || k; end if;
    end loop;
  end loop;
  foreach w in array coalesce(p_tags,'{}') loop
    w := lower(btrim(w, '.,'));
    if w <> '' and not exists (select 1 from jsonb_each(m) where value ? w) and not (w = any(out)) and cardinality(out) < 8 then out := out || w; end if;
  end loop;
  if (lower(p_name) like '%dji%' or lower(p_name) like '%drone%') and not ('drone' = any(out)) then out := array_prepend('drone', out); end if;
  out := out || (case when p_kind = 'vertical' then 'vertical' else 'horizontal' end);
  return out[1:9];
end $$;
update public.content_clips set tags = public.content_clips_canon_tags(tags, name, kind, coalesce(description,'')) where captioned_at is not null;
