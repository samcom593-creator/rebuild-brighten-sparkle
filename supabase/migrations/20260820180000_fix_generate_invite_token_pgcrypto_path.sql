-- Invite links have NEVER generated (1 lifetime row in invite_tokens): the fn
-- is SECURITY DEFINER with search_path pinned to 'public', but pgcrypto lives
-- in the 'extensions' schema, so gen_random_bytes(24) raised 42883 on every
-- call and the UI toasted an error. Qualify the call; change nothing else.
CREATE OR REPLACE FUNCTION public.generate_invite_token(p_kind text, p_expires_hours integer DEFAULT 168, p_target_role text DEFAULT NULL::text, p_target_manager_id uuid DEFAULT NULL::uuid, p_prefill jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agent_id uuid;
  v_token text;
  v_row public.invite_tokens%rowtype;
  v_recent_count int;
  v_hours int;
begin
  select id into v_agent_id
    from public.agents
   where user_id = auth.uid()
     and coalesce(is_deactivated, false) = false
   limit 1;

  if v_agent_id is null then
    raise exception 'unauthorized: no active agent for caller';
  end if;

  if p_kind not in ('hire','join') then
    raise exception 'invalid kind: %', p_kind;
  end if;

  v_hours := greatest(1, least(coalesce(p_expires_hours, 168), 720));

  select count(*) into v_recent_count
    from public.invite_tokens
   where created_by = v_agent_id
     and created_at > now() - interval '1 hour';

  if v_recent_count >= 20 then
    raise exception 'rate_limit: 20 tokens/hour cap reached';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '+','-'), '/','_'), '=','');

  insert into public.invite_tokens (
    kind, token, created_by, created_by_user_id,
    expires_at, target_role, target_manager_id, prefill_json, notes
  ) values (
    p_kind, v_token, v_agent_id, auth.uid(),
    now() + make_interval(hours => v_hours),
    p_target_role, p_target_manager_id, coalesce(p_prefill,'{}'::jsonb), p_notes
  ) returning * into v_row;

  return jsonb_build_object(
    'token', v_row.token,
    'url',   'https://apex-financial.org/' || v_row.kind || '/' || v_row.token,
    'kind',  v_row.kind,
    'expires_at', v_row.expires_at,
    'id', v_row.id
  );
end;
$function$;
