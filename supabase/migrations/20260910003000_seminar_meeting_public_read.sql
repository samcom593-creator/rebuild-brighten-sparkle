-- MP-498: the public seminar page's CTA was dead for every visitor.
--
-- TWO INDEPENDENT MECHANISMS, both proven live before this migration:
--
-- (A) system_settings has exactly one SELECT policy and it is TO authenticated,
--     so an anonymous visitor to /seminar reads zero rows. SeminarPage then took
--     its `|| "/seminar/join"` fallback, which is not a declared route in
--     src/App.tsx, so react-router's path="*" served <NotFound/>.
--
-- (B) For a reader who COULD see the row, the value is stored as the literal
--     characters "https://calendly.com/..." including two quote chars -- the
--     column is data_type text and the write was to_jsonb'd. Same corruption
--     MP-400 found in the AgentLink cookie, where both readers sent the quotes
--     verbatim and a live credential 401'd for 7h.
--
-- This migration fixes (B) in the data and makes (A) reachable, and the RPC
-- ALSO strips defensively so a future to_jsonb write cannot re-break the public
-- page. Fixing the data alone would leave the same landmine armed.

-- (B) recover the intended values. Only these two keys: no credential is touched.
update public.system_settings
   set value = btrim(value, '"')
 where key in ('seminar_meeting_url', 'seminar_meeting_url_label')
   and value like '"%"';

-- (A) a narrow read path for the two public seminar keys. This does NOT widen
-- table access: the function is security definer and returns those keys only.
create or replace function public.public_seminar_meeting()
returns table (url text, label text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(max(value) filter (where key = 'seminar_meeting_url'), '"'), ''), '') as url,
    coalesce(nullif(btrim(max(value) filter (where key = 'seminar_meeting_url_label'), '"'), ''), '') as label
  from public.system_settings
  where key in ('seminar_meeting_url', 'seminar_meeting_url_label');
$$;

revoke all on function public.public_seminar_meeting() from public;
grant execute on function public.public_seminar_meeting() to anon, authenticated;

comment on function public.public_seminar_meeting() is
  'MP-498: public read of the seminar CTA target only. btrim(value, ''"'') is load-bearing -- system_settings.value is text and has been written to_jsonb''d before (MP-400).';
