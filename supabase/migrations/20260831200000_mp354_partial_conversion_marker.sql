-- MP-354: the /apply "mark converted" write has never once landed.
--
-- Apply.tsx markAsConverted() did:
--     supabase.from("partial_applications").update({converted_at}).eq("session_id", ...)
-- from the ANON client on the public /apply page. Postgres applies SELECT
-- policies to the rows an UPDATE's WHERE clause has to read, and this table
-- has exactly one SELECT policy (admin/manager). anon therefore matched ZERO
-- rows. PostgREST answered 204 with `content-range: */0`, supabase-js returned
-- no error, and the call site did not destructure `error` anyway — three
-- layers of silence over a write that never happened. Proven live on a
-- throwaway row: 204, */0, converted_at still NULL.
--
-- Same disease, same table, one function over from the fix already in this
-- file's own comments: the partial-save upsert was moved to a SECURITY DEFINER
-- RPC for this exact reason and markAsConverted was left behind.
create or replace function public.mark_partial_application_converted(p_session_id text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return 0;
  end if;
  update partial_applications
     set converted_at = now()
   where session_id = p_session_id
     and converted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_partial_application_converted(text) from public;
grant execute on function public.mark_partial_application_converted(text) to anon, authenticated;

-- The rule for "this partial application was abandoned", in ONE place.
--
-- converted_at was the only thing AbandonedLeadsPanel graded on, so while the
-- marker was dead the panel showed Sam 62 rows of which 47 had already
-- completed a full application — 75.8% false, each with a one-click "Send
-- Followup" button beside it that texts a person who already applied.
-- recover_partial_applications() (cron job 31, hourly) had independently
-- encoded the correct rule and is why the 11 recovery SMS ever sent all went
-- to genuinely abandoned people. Two derivations of one question is how curl
-- --max-time and fn_agentlink_reap_stuck drifted; both now read this view.
create or replace view public.v_partial_applications_abandoned as
select pa.*
  from partial_applications pa
 where pa.converted_at is null
   and not exists (
     select 1 from applications a
      where pa.email is not null
        and lower(a.email) = lower(pa.email)
   );

revoke all on public.v_partial_applications_abandoned from anon, authenticated;

-- Admin/manager reader for the dashboard panel. Mirrors the table's existing
-- SELECT policy rather than inventing a second answer to "who may see partial
-- leads" — this view carries the email and phone of every partial lead, and a
-- plain auto-updatable view runs as its owner (MP-325).
create or replace function public.list_abandoned_partial_applications()
returns setof public.v_partial_applications_abandoned
language sql
security definer
set search_path to 'public'
as $$
  select * from public.v_partial_applications_abandoned
   where has_role(auth.uid(), 'admin'::app_role)
      or has_role(auth.uid(), 'manager'::app_role)
   order by created_at desc;
$$;

revoke all on function public.list_abandoned_partial_applications() from public, anon;
grant execute on function public.list_abandoned_partial_applications() to authenticated;
