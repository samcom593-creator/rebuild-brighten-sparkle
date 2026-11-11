// The "pick a new time" link for the post-call message (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12).
// Pure; imports only the shared scheduling source (no remote imports).
//
// 'call_booked' sends ONE message the day after the call when no outcome was recorded
// (message_map G1: 13 of 13 calls in 30 days have no outcome and nothing told the recruit
// what happens next). The rebook link must be the call they actually booked: a licensed
// applicant who missed the licensed call gets the licensed call, an unlicensed applicant gets
// the call that is open to them. Prefilled, utm_content = application id, so the new booking
// lands on the same application (calendly-webhook matches utm_content first).

import { SCHEDULING_LINKS, buildBookingUrl } from "../_shared/scheduling-links.ts";

export interface RebookInput {
  callTrack?: string | null;
  licenseStatus?: string | null;
  applicationId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export function rebookBaseUrl(callTrack?: string | null, licenseStatus?: string | null): string {
  const track = String(callTrack ?? "").trim().toLowerCase();
  if (track === "licensing") return SCHEDULING_LINKS.licensing;
  if (track === "licensed" || track === "leader") return SCHEDULING_LINKS.licensed;
  if (String(licenseStatus ?? "").trim().toLowerCase() === "licensed") return SCHEDULING_LINKS.licensed;
  return SCHEDULING_LINKS.questions ?? SCHEDULING_LINKS.licensing;
}

export function rebookUrl(input: RebookInput): string {
  const built = buildBookingUrl(rebookBaseUrl(input.callTrack, input.licenseStatus), {
    applicationId: input.applicationId ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
  });
  try {
    const u = new URL(built);
    u.searchParams.set("utm_source", "nextstep");
    u.searchParams.set("utm_medium", "email");
    return u.toString();
  } catch {
    return built;
  }
}
