-- MP-HIRE-RESUME (2026-11-10): a hire who activated but never got logged in was
-- locked out for good.
--
-- Measured on Danon Turner: /hire/<token> accepted 19:09:25Z, agent row + auth user
-- created, consume-invite-token minted a one-time login (magic_login_tokens) — and
-- that login was never used (used_at null, last_sign_in_at null). The login only
-- happens after the post-activation onboarding video ENDS (HireLink -> onEnded ->
-- /magic-login), and the video has no exit, so closing it, a load failure, or a
-- tab switch throws the login away. Reopening the hire link two minutes later
-- rendered "This link has already been used. Ask whoever invited you for a fresh
-- link" — wrong advice (the account exists) and no way in: /agent-login is
-- password-based and a link-activated hire has no password.
--
-- invite_resume_login hands the activation's own login back to the person who
-- activated, under the narrowest conditions that cover that case:
--   * the invitation is ACCEPTED and names the agent it created;
--   * the caller types the email the link was accepted with (accepted_email) —
--     the link alone is not enough once it has been used;
--   * the account has NEVER signed in (auth.users.last_sign_in_at is null) — after
--     a first sign-in the normal login is the way back, and this returns
--     'already_signed_in' so the page can say so;
--   * the acceptance is under 7 days old, the agent is not deactivated and the
--     login is not banned.
-- It reuses the newest unused, unexpired activation login; only if none remains
-- does it mint a fresh 24h one (same shape consume-invite-token writes).
create or replace function public.invite_resume_login(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv public.invite_tokens%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  v_last timestamptz;
  v_banned timestamptz;
  v_tok text;
  v_at int;
begin
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
  end if;
  select * into v_inv from public.invite_tokens where token = p_token limit 1;
  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
  end if;
  if v_inv.used_at is null or v_inv.used_by_agent_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_activated');
  end if;

  v_at := position('@' in coalesce(v_inv.accepted_email, ''));
  if v_email = '' or lower(coalesce(v_inv.accepted_email, '')) <> v_email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch',
      'email_hint', case when v_at > 1 then left(v_inv.accepted_email, 1) || '***' || substr(v_inv.accepted_email, v_at) end);
  end if;

  select a.user_id into v_user
    from public.agents a
   where a.id = v_inv.used_by_agent_id and coalesce(a.is_deactivated, false) = false;
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select u.last_sign_in_at, u.banned_until into v_last, v_banned from auth.users u where u.id = v_user;
  if not found or (v_banned is not null and v_banned > now()) then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  if v_last is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_signed_in');
  end if;
  if v_inv.used_at < now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'resume_window_closed');
  end if;

  select m.token into v_tok
    from public.magic_login_tokens m
   where m.agent_id = v_inv.used_by_agent_id and m.used_at is null and m.expires_at > now()
   order by m.created_at desc
   limit 1;
  if v_tok is null then
    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.magic_login_tokens (agent_id, email, token, destination, expires_at)
    values (v_inv.used_by_agent_id, lower(v_inv.accepted_email), v_tok, 'portal', now() + interval '24 hours');
  end if;

  return jsonb_build_object('ok', true, 'login_token', v_tok);
end $function$;

-- The hire page is public: a signed-out recipient calls this as anon.
revoke all on function public.invite_resume_login(text, text) from public;
grant execute on function public.invite_resume_login(text, text) to anon, authenticated, service_role;
