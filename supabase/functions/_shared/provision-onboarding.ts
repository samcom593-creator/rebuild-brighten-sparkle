// Shared onboarding provisioning for the contracting intake paths.
//
// Lifted verbatim from submit-contracting-intake/index.ts (MP-304, 2026-11-23) so the manager/one-link
// function (contracting-downline) creates logins, profiles and agent rows through the SAME code the public
// intake has run since August — one provisioning path, not two that drift. The only additions are three
// optional knobs: which manager a brand-new agent lands under, the provenance path name, and the auth
// user_metadata.source tag. Every default reproduces the previous behaviour byte-for-byte.
import { findAuthUserByEmail, type AuthUserLister } from "./find-auth-user.ts";
import { emailPattern } from "./like-escape.ts";

/** Samuel James — the roster root a contracting signup lands under when nothing else is known. */
export const DEFAULT_MANAGER_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

export type LicensePath = "licensed" | "unlicensed" | "pending";

export type ProvisionOptions = {
  /** The upline for a NEW agent row. An existing agent keeps their manager. */
  managerId?: string | null;
  /** agents.metadata.created_by_path for a NEW row. */
  createdByPath?: string;
  /** auth user_metadata.source for a NEW login. */
  userSource?: string;
};

export async function provisionOnboarding(
  // supabase-js does not carry this project's generated database schema inside
  // edge functions, so an inferred generic collapses table writes to `never`.
  // Runtime validation remains in Postgres; keep this boundary SDK-agnostic.
  sb: any,
  payload: { first_name: string; last_name: string; email: string; phone: string; npn: string },
  licensePath: LicensePath,
  opts: ProvisionOptions = {},
) {
  const email = payload.email.trim().toLowerCase();
  const fullName = `${payload.first_name.trim()} ${payload.last_name.trim()}`.trim();
  const authLookup = await findAuthUserByEmail(sb as unknown as AuthUserLister, email);
  if (!authLookup.exhaustive) throw new Error("account_lookup_incomplete");

  let userId = authLookup.user?.id ?? null;
  if (!userId) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, source: opts.userSource ?? "contracting_one_link" },
    });
    if (error || !created.user) throw new Error(error?.message ?? "account_create_failed");
    userId = created.user.id;
  }

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .upsert({ user_id: userId, email, phone: payload.phone, full_name: fullName }, { onConflict: "user_id" })
    .select("id")
    .single();
  if (profileError || !profile?.id) throw new Error(profileError?.message ?? "profile_create_failed");

  const { error: roleError } = await sb
    .from("user_roles")
    .upsert({ user_id: userId, role: "agent" }, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (roleError) throw new Error(roleError.message);

  const { data: existing, error: existingError } = await sb
    .from("agents")
    .select("id,manager_id,invited_by_manager_id,license_status,onboarding_stage")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let agentId = existing?.id ?? null;
  const preLicense = licensePath !== "licensed";
  // A pre-license submission must never regress a producer who is already
  // licensed on the roster (an unlicensed re-submit from a licensed agent's
  // email is a mistake, not a downgrade). Licensed submissions always advance.
  const alreadyLicensed = existing?.license_status === "licensed";
  const licenseFields = preLicense
    ? (alreadyLicensed
      ? {}
      : {
        license_status: licensePath,
        license_progress: "unlicensed",
        onboarding_stage: existing?.onboarding_stage ?? "pre_licensed",
      })
    : {
      license_status: "licensed",
      license_progress: "licensed",
      onboarding_stage: "onboarding",
      nipr_number: payload.npn,
      // A typed NPN is a claim, not an official registry verification. A
      // correction must never inherit the previous number's verified badge.
      nipr_verified: false,
      nipr_verified_at: null,
    };
  const agentPatch = {
    user_id: userId,
    profile_id: profile.id,
    display_name: fullName,
    status: "active",
    ...licenseFields,
    has_training_course: true,
    manager_id: existing?.manager_id ?? opts.managerId ?? DEFAULT_MANAGER_ID,
    invited_by_manager_id: existing?.invited_by_manager_id ?? opts.managerId ?? DEFAULT_MANAGER_ID,
    start_date: new Date().toISOString().slice(0, 10),
  };

  if (agentId) {
    const { error } = await sb.from("agents").update(agentPatch).eq("id", agentId);
    if (error) throw new Error(error.message);
  } else {
    // WP5 provenance (new rows only). Link an application only on a UNIQUE email match no other agent holds.
    let linkedApplicationId: string | null = null;
    const { data: appMatches, error: appMatchErr } = await sb
      .from("applications")
      .select("id")
      .ilike("email", emailPattern(email))
      .or("is_duplicate.is.null,is_duplicate.eq.false")
      .limit(2);
    if (!appMatchErr && (appMatches ?? []).length === 1) {
      const candidate = String((appMatches as Array<{ id: string }>)[0].id);
      const { data: holder } = await sb.from("agents").select("id").eq("source_application_id", candidate).limit(1);
      if ((holder ?? []).length === 0) linkedApplicationId = candidate;
    }
    const origin = linkedApplicationId ? "application" : "direct_add";
    const provenance: Record<string, string> = { origin, created_by_path: opts.createdByPath ?? "submit-contracting-intake" };
    if (linkedApplicationId) provenance.source_application_match = "unique_email";
    else provenance.no_application_reason = "contracting intake link (no application on file)";
    const { data: inserted, error } = await sb.from("agents").insert({
      ...agentPatch,
      origin,
      recruiter_agent_id: agentPatch.invited_by_manager_id,
      source_application_id: linkedApplicationId,
      metadata: provenance,
    }).select("id").single();
    if (error || !inserted?.id) throw new Error(error?.message ?? "agent_create_failed");
    agentId = inserted.id;
  }

  return { agentId };
}
