-- Recruit Stages: move many people at once (2026-09-30). 700 of 870 active
-- recruits have sat in their stage 60+ days; cleanup has to be one action,
-- not 700. Each person still goes through set_recruit_stage() with its scope
-- check and refusals, so a bulk move can never do what a single move cannot.
create or replace function public.set_recruit_stage_bulk(p_people jsonb, p_to_stage text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare it jsonb; r jsonb; moved int := 0; kept int := 0; refused int := 0; failed int := 0; msgs text[] := '{}';
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' then raise exception 'pass an array of people'; end if;
  if jsonb_array_length(p_people) > 500 then raise exception 'at most 500 people per call'; end if;
  for it in select * from jsonb_array_elements(p_people) loop
    begin
      r := public.set_recruit_stage(nullif(it->>'application_id','')::uuid, nullif(it->>'agent_id','')::uuid, p_to_stage, p_reason);
      if coalesce((r->>'ok')::boolean, true) = false then
        refused := refused + 1; msgs := array_append(msgs, coalesce(r->>'message','refused'));
      elsif coalesce((r->>'matched')::boolean, true) then moved := moved + 1;
      else kept := kept + 1; msgs := array_append(msgs, coalesce(r->>'message','kept by evidence'));
      end if;
    exception when others then
      failed := failed + 1; msgs := array_append(msgs, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('moved', moved, 'kept', kept, 'refused', refused, 'failed', failed,
    'messages', coalesce((select jsonb_agg(distinct m) from unnest(msgs) m), '[]'::jsonb));
end;
$$;
revoke all on function public.set_recruit_stage_bulk(jsonb,text,text) from public, anon;
grant execute on function public.set_recruit_stage_bulk(jsonb,text,text) to authenticated;
