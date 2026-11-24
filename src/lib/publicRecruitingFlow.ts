import { getRefSlug } from "@/lib/refSlug";
import { ATTRIBUTION_KEYS } from "@/lib/attribution";

export const PUBLIC_RECRUITING_TRACKS = ["licensed-producer", "agency-builder", "licensing-roadmap"] as const;
export type PublicRecruitingTrack = typeof PUBLIC_RECRUITING_TRACKS[number];
type PublicRecruitingPath = "/" | "/vsl" | "/apply" | "/get-licensed";

export function parsePublicRecruitingTrack(value: string | null | undefined): PublicRecruitingTrack | null {
  const normalized = value?.trim().toLowerCase();
  return PUBLIC_RECRUITING_TRACKS.find((track) => track === normalized) ?? null;
}

/** Keep referral attribution and the chosen audience across public funnel hops. */
export function buildPublicRecruitingHref(
  path: PublicRecruitingPath,
  searchParams: URLSearchParams,
  selectedTrack?: PublicRecruitingTrack,
): string {
  const params = new URLSearchParams();
  const ref = getRefSlug(searchParams.get("ref"));
  const track = parsePublicRecruitingTrack(selectedTrack ?? searchParams.get("track"));
  if (ref) params.set("ref", ref);
  if (track) params.set("track", track);
  // Use the existing attribution allowlist and its 200-character value cap.
  // In particular, source/utm_medium also select Apply's Quick Qualify flow.
  for (const key of ATTRIBUTION_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value && value.length <= 200) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Used only for a new form's defaults; saved and resumed answers take precedence. */
export function defaultLicenseStatusForTrack(value: string | null | undefined): "licensed" | "unlicensed" {
  return parsePublicRecruitingTrack(value) === "licensed-producer" ? "licensed" : "unlicensed";
}
