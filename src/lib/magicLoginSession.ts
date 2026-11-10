/**
 * Turn a one-time login token (magic_login_tokens) into a real session in THIS
 * browser, without leaving the page — the same two calls /magic-login makes
 * (verify-magic-link -> auth.verifyOtp).
 *
 * MP-HIRE-RESUME (2026-11-10): /hire/:token used to carry the hire's login in
 * the URL it navigated to only AFTER the onboarding video ended. Danon Turner
 * activated at 19:09Z, never reached the end of the video, and the login was
 * lost: the account existed, last_sign_in_at stayed null, and reopening the
 * hire link dead-ended. Signing in first means leaving mid-video costs nothing.
 *
 * Returns true only when Supabase accepted the OTP. On false the caller keeps
 * the old path (navigate to /magic-login?token=…), which retries inside
 * verify-magic-link's 5-minute grace window, so a failure here is never worse
 * than before.
 */
import { supabase } from "@/integrations/supabase/client";

/** The token inside a `/magic-login?token=…` redirect, or null for any other URL. */
export function loginTokenFromRedirect(redirect: string | null | undefined): string | null {
  if (!redirect || !redirect.startsWith("/magic-login?")) return null;
  const token = new URLSearchParams(redirect.slice(redirect.indexOf("?") + 1)).get("token");
  return token && token.trim() ? token.trim() : null;
}

export async function signInWithLoginToken(token: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("verify-magic-link", { body: { token } });
    const body = data as { success?: boolean; tokenHash?: string } | null;
    if (error || !body?.success || !body.tokenHash) return false;
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: body.tokenHash,
      type: "magiclink",
    });
    return !verifyError;
  } catch (err) {
    console.warn("signInWithLoginToken failed", err);
    return false;
  }
}
