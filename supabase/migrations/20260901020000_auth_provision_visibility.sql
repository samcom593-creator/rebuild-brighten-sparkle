-- MP-362. handle_new_user swallowed EVERY exception, so a failed profile
-- provision left a signed-up auth user with no profile row and no record of it
-- anywhere. MP-359 measured this and deliberately scoped trg_block_profile_email_dup
-- to UPDATE, writing in its own body that "the INSERT half needs handle_new_user's
-- blanket swallow fixed first". This is that half.
--
-- MEASURED BEFORE SHIPPING (2026-09-01, live prod):
--   auth.users                      562
--   auth.users with no profile row    0   <- the swallow has not yet cost a profile
--   profiles.email dup groups         9  (18 rows, all with distinct user_ids)
-- So this is LATENT, not a live leak, and no dollar figure is claimed. What it
-- fixes is that the absence would be SILENT when it happens: no error to the
-- client, no row, no log, and the person can sign in to a portal where every
-- profile-keyed read returns nothing.
--
-- TWO defects, not one. The blanket swallow is the visible one. The second is
-- only visible once you read what PL/pgSQL does with the block's savepoint: the
-- two INSERTs shared ONE begin/exception block, so a failure on the user_roles
-- insert rolled the SUCCESSFUL profiles insert back with it. A role-assignment
-- fault therefore destroyed the profile. The blocks are now independent.
--
-- The RETURN NEW is KEPT ON PURPOSE and is not laziness: on_auth_user_created is
-- an AFTER INSERT trigger on auth.users, so raising here aborts the signup
-- transaction and Supabase answers the client with "Database error saving new
-- user". Blocking a real signup to avoid a recoverable provisioning gap is the
-- worse trade. The fix is that the gap now names itself instead of vanishing.

CREATE TABLE IF NOT EXISTS public.auth_provision_failures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  email       text,
  step        text NOT NULL,
  sqlstate    text,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  note        text
);

CREATE INDEX IF NOT EXISTS idx_auth_provision_failures_unresolved
  ON public.auth_provision_failures (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.auth_provision_failures ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. This table names the accounts whose provisioning
-- broke; only the service role and SECURITY DEFINER writers should ever see it.
-- MP-325's lesson applies: a table with RLS on and no policy is closed to anon
-- and authenticated, which is what is wanted here.

-- The recorder is exception-proof by construction. It is called from inside
-- another handler, where a second exception would propagate past the caller's
-- RETURN NEW and abort the signup this whole design exists to protect.
CREATE OR REPLACE FUNCTION public.fn_record_auth_provision_failure(
  p_user_id uuid, p_email text, p_step text, p_sqlstate text, p_message text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.auth_provision_failures (user_id, email, step, sqlstate, message)
    VALUES (p_user_id, p_email, p_step, p_sqlstate, left(coalesce(p_message,''), 2000));
  EXCEPTION WHEN OTHERS THEN
    -- Deliberately silent. If the log itself cannot be written there is nowhere
    -- left to say so, and killing the signup to report a logging fault would
    -- invert the priority this function exists to protect.
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_record_auth_provision_failure(NEW.id, NEW.email, 'profiles', SQLSTATE, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'agent')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_record_auth_provision_failure(NEW.id, NEW.email, 'user_roles', SQLSTATE, SQLERRM);
  END;

  RETURN NEW;
END;
$$;

-- Same disease, one trigger over, on the same table: auto_admin_for_sam also
-- ends in a blanket EXCEPTION WHEN OTHERS THEN RETURN NEW. Its comment reads
-- "Don't block signup if anything in the seed fails" — correct intent, no
-- record. It seeds ADMIN role + an active agent row for three of Sam's own
-- addresses, so its silent failure means Sam signs up and is not an admin, with
-- nothing anywhere saying why. Swept with the instance, per the contract's
-- fix-the-class rule.
CREATE OR REPLACE FUNCTION public.auto_admin_for_sam()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IN ('sam.com593@gmail.com', 'sam@apex-financial.org', 'info@kingofsales.net') THEN
    BEGIN
      INSERT INTO public.user_roles(user_id, role)
      VALUES (NEW.id, 'admin'::public.app_role)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.agents(user_id, status, license_status)
      SELECT NEW.id, 'active'::public.agent_status, 'licensed'::public.license_status
      WHERE NOT EXISTS (SELECT 1 FROM public.agents WHERE user_id = NEW.id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.fn_record_auth_provision_failure(NEW.id, NEW.email, 'auto_admin_for_sam', SQLSTATE, SQLERRM);
    END;
  END IF;
  RETURN NEW;
END;
$$;
