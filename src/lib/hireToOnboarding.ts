import { supabase } from "@/integrations/supabase/client";

type LicenseStatus = "licensed" | "unlicensed" | "pending";

interface CanonicalHireInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseStatus: LicenseStatus;
  npn?: string | null;
  licenseStates?: string[] | null;
  city?: string | null;
  state?: string | null;
  instagramHandle?: string | null;
  managerId?: string | null;
  sourceApplicationId?: string | null;
}

export interface HireReceipt {
  agentId: string;
  partial: boolean;
  message: string;
}

function normalizedNpn(value?: string | null): string {
  return (value ?? "").replace(/\D+/g, "");
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Hire could not be completed";
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return fallback;
  try {
    const body = await context.clone().json() as { error?: string; message?: string };
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

async function resolveManagerId(preferred?: string | null): Promise<string> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Your session expired. Sign in and try again.");

  const { data: actorAgent, error: actorError } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("is_deactivated", false)
    .limit(1)
    .maybeSingle();
  if (actorError) throw actorError;

  const managerId = actorAgent?.id || preferred;
  if (!managerId) throw new Error("Assign a hiring manager before marking this person hired.");
  return managerId;
}

/** One canonical hire path used by Add Agent, interviews, the dialer, and the licensed inbox. */
export async function createCanonicalHire(input: CanonicalHireInput): Promise<HireReceipt> {
  const managerId = await resolveManagerId(input.managerId);
  const npn = normalizedNpn(input.npn);
  if (input.licenseStatus === "licensed" && (npn.length < 5 || npn.length > 10)) {
    throw new Error("Licensed hire needs a valid 5–10 digit NPN before contracting can start.");
  }
  if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim() || !input.phone.trim()) {
    throw new Error("First name, last name, email, and phone are required to create the agent account.");
  }

  const { data, error } = await supabase.functions.invoke("add-agent", {
    body: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      managerId,
      licenseStatus: input.licenseStatus,
      niprNumber: npn || undefined,
      licenseStates: input.licenseStates ?? undefined,
      city: input.city || undefined,
      state: input.state || undefined,
      instagramHandle: input.instagramHandle || undefined,
      // All hires enter training. Unlicensed hires receive XCEL; licensed
      // hires enter the onboarding curriculum and contracting workflow.
      hasTrainingCourse: true,
      sourceApplicationId: input.sourceApplicationId || undefined,
    },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(String(data.error));
  if (!data?.agentId) throw new Error("Hire returned no agent account. Nothing was marked complete.");
  return {
    agentId: String(data.agentId),
    partial: data.partial === true,
    message: typeof data.message === "string" ? data.message : "Agent hired and onboarding started.",
  };
}

export async function promoteApplicationToAgent(
  applicationId: string,
  options: { managerId?: string | null; npn?: string | null } = {},
): Promise<HireReceipt> {
  const { data: app, error } = await supabase
    .from("applications")
    .select("id,first_name,last_name,email,phone,city,state,instagram_handle,license_status,nipr_number,licensed_states,assigned_agent_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !app) throw new Error(error?.message || "Application was not found.");

  return createCanonicalHire({
    firstName: app.first_name,
    lastName: app.last_name,
    email: app.email,
    phone: app.phone || "",
    licenseStatus: app.license_status as LicenseStatus,
    npn: options.npn || app.nipr_number,
    licenseStates: app.licensed_states,
    city: app.city,
    state: app.state,
    instagramHandle: app.instagram_handle,
    managerId: options.managerId || app.assigned_agent_id,
    sourceApplicationId: app.id,
  });
}
