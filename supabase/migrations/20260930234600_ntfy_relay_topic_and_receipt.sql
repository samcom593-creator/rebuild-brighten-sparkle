-- MP-414: make the ntfy relay PROVABLE and make its refusals NAMEABLE.
--
-- WHY. postNtfyGraded grades the direct edge->ntfy leg honestly, but ntfy refuses
-- that leg on a per-visitor-IP daily quota (code 42908) against the SHARED
-- Supabase egress address. Measured 2026-09-30T23:43Z: edge probe = http:429
-- 42908, laptop control to the SAME topic = 200 in the same minute. apex-doctor
-- Check #21 has documented this recurring condition since 2026-09-14. So honest
-- grading alone converts a silent lost page into a LOGGED lost page - better, and
-- still not a page. The database egresses from an address ntfy accepts, which is
-- why manychat-webhook already relays through pg_net.
--
-- TWO DEFECTS THIS FIXES, both in the fallback the other fix depends on:
--
-- 1. The topic was HARDCODED, so the relay could only ever be exercised by
--    paging Sam's real phone. A fallback that cannot be tested without buzzing
--    its owner is a fallback nobody tests. p_topic defaults to Sam's topic, so
--    every existing named-argument caller is unchanged.
--
-- 2. fn_ntfy_relay_result returns NULL for a REFUSAL and NULL for NOT-YET-
--    ANSWERED. Those are different facts and the caller cannot tell them apart -
--    the same discarded-cause defect this whole wave is about, one layer down in
--    the path the fix falls back to. fn_ntfy_relay_receipt reports status, id and
--    ntfy's own error/code. fn_ntfy_relay_result is deliberately LEFT ALONE:
--    manychat-webhook is the no-lost-leads path Sam works personally and it
--    already handles a null correctly by falling through to email.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a defaulted parameter makes
-- a NEW overload, and a 4-argument call against both would be ambiguous. One
-- transaction, so no window exists where the function is missing.

begin;

drop function if exists public.fn_ntfy_relay(text, text, text, text);

create or replace function public.fn_ntfy_relay(
  p_title    text,
  p_body     text,
  p_priority text default '4',
  p_tags     text default 'bell',
  p_topic    text default 'sams-agent-yrkv9kbqp9e987nb'
)
returns bigint
language sql
security definer
set search_path to 'public', 'net'
as $function$
  select net.http_post(
    url := 'https://ntfy.sh/',   -- JSON publish goes to the root; the topic URL treats JSON as plain text
    body := jsonb_build_object(
      'topic',    coalesce(nullif(p_topic, ''), 'sams-agent-yrkv9kbqp9e987nb'),
      'title',    left(p_title, 200),
      'message',  left(p_body, 3000),
      'priority', coalesce(nullif(p_priority, '')::int, 4),
      'tags',     jsonb_build_array(p_tags)
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
$function$;

-- Names the outcome instead of collapsing refusal and pending into one NULL.
-- state: 'pending' (pg_net has no row yet) | 'ok' | 'refused'.
create or replace function public.fn_ntfy_relay_receipt(p_request_id bigint)
returns jsonb
language sql
security definer
set search_path to 'public', 'net'
as $function$
  select coalesce(
    (select jsonb_build_object(
       'state',  case when r.status_code = 200 then 'ok' else 'refused' end,
       'status', r.status_code,
       'id',     case when r.status_code = 200
                      then coalesce((r.content::jsonb)->>'id', 'ok') end,
       'code',   case when r.status_code <> 200
                      then nullif(((r.content::jsonb)->>'code'), '') end,
       'error',  case when r.status_code <> 200
                      then left(coalesce(r.content, ''), 300) end
     )
     from net._http_response r where r.id = p_request_id),
    jsonb_build_object('state', 'pending', 'status', null, 'id', null,
                       'code', null, 'error', null)
  );
$function$;

revoke all on function public.fn_ntfy_relay(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_ntfy_relay_receipt(bigint)              from public, anon, authenticated;
grant execute on function public.fn_ntfy_relay(text, text, text, text, text) to service_role;
grant execute on function public.fn_ntfy_relay_receipt(bigint)              to service_role;

commit;
