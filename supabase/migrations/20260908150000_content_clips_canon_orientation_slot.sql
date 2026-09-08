-- 20260908150000_content_clips_canon_orientation_slot.sql
--
-- content_clips_canon_tags appended the orientation tag LAST and then truncated
-- with out[1:9]. When the drone name-prepend fired on a clip that had already
-- reached 8 tags, the array hit 9 before the append, so the orientation tag
-- landed at position 10 and was silently sliced off. Reproduced against the live
-- function; control proves it load-bearing (same tags, a name without "drone"
-- keeps 'vertical' at position 9).
--
-- Consequence, measured rather than asserted: 1 of 3,541 captioned clips
-- (2026-03-24_223022_drone_0129.MP4). LaunchBoard's orientation FILTER reads the
-- folder column and the aspect-ratio render reads kind, so both are unaffected.
-- Only the text search reads tags -- src/pages/LaunchBoard.tsx:224 maps
-- reel/reels/tiktok -> "vertical" and youtube -> "horizontal", then requires
-- every word to appear in title+description+tags+name -- so the affected clip is
-- missed by a search for "vertical"/"reel"/"tiktok". No dollar figure is claimed.
--
-- The same missing guard made the function NON-IDEMPOTENT: the final append had
-- no dedupe, so canon(canon(x)) grew a second orientation tag. Measured on live
-- data, re-running 20260908010000's UPDATE body would have added a duplicate
-- orientation tag to 3,533 of 3,541 rows. That is the corruption MP-470 removed
-- from Check #62's printed remedy; this removes it from the function itself, so
-- the body is safe to re-run rather than merely un-recommended.
--
-- Fix: reserve the orientation slot BEFORE truncating (out[1:8] || ori) and
-- strip any existing copy first, so exactly one is always present and always
-- last. PROVEN output-identical to the previous definition on all 3,541 real
-- first-pass inputs (0 differ); the only behaviour change is the bug case and
-- the duplicate case.
--
-- This migration's UPDATE is idempotent by construction -- its predicate selects
-- only rows MISSING the orientation tag, which is empty once it has run. Check
-- #62's mutation classifier flags any `update` at line start and is deliberately
-- conservative, so expect it to name this file if it is ever unapplied; it is
-- safe to re-run.

create or replace function public.content_clips_canon_tags(p_tags text[], p_name text, p_kind text, p_desc text)
returns text[] language plpgsql immutable as $$
declare m jsonb := '{"workout":["gym","exercise","weights","weight","lifting","dumbbell","dumbbells","barbell","bench","squat","deadlift","fitness","training","muscle","treadmill","pushup","workout"],"car":["car","cars","vehicle","corvette","automobile","sedan","truck","suv","porsche","bmw","mercedes","lamborghini","tesla","driving","steering","dashboard","parking"],"drone":["drone","aerial","overhead","skyline","top-down","dji"],"office":["office","desk","computer","monitor","laptop","keyboard","headphones","workspace","chair"],"talking-head":["talking","speaking","presenting","microphone","podcast","interview","camera","selfie","vlog"],"outdoors":["outdoor","outdoors","street","road","highway","city","building","sky","sunset","sunrise","beach","park","trees","field"],"event":["crowd","audience","stage","conference","seminar","meeting","event","team","group","people"],"home":["home","kitchen","bedroom","living","couch","sofa","house","apartment"],"food":["food","restaurant","coffee","drink","meal","eating","plate"],"money":["money","cash","dollars","check","contract","paper","document"],"phone":["phone","smartphone","iphone","texting","calling"],"night":["night","dark","evening","lights","neon"]}'::jsonb;
  w text; k text; out text[] := '{}'; words text[]; ori text;
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
  -- Orientation is a guaranteed slot, not a best-effort append: reserve room for
  -- it before truncating, and remove any copy already in the body so a second
  -- pass cannot duplicate it.
  ori := case when p_kind = 'vertical' then 'vertical' else 'horizontal' end;
  out := array_remove(out, ori);
  return out[1:8] || ori;
end $$;

update public.content_clips
   set tags = public.content_clips_canon_tags(tags, name, kind, coalesce(description,''))
 where captioned_at is not null
   and not ((case when kind = 'vertical' then 'vertical' else 'horizontal' end) = any(tags));
