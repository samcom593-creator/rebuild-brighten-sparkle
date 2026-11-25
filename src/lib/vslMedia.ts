import { resolveBrand } from "@/config/brand";
import { LICENSING_VIDEO } from "@/lib/licensingMedia";
import type { PublicRecruitingTrack } from "@/lib/publicRecruitingFlow";

const VSL_MEDIA_BASE =
  "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/vsl/2026-09-02";
const BRAND = resolveBrand();

/**
 * Canonical media for the public APEX recruiting VSL.
 *
 * Single source of truth, same contract as LICENSING_VIDEO and
 * ONBOARDING_VIDEO: every surface reads from here, so a future re-cut is one
 * file change and every link Sam has already handed out keeps working.
 *
 * durationSeconds is the ffprobe-measured length of the published object
 * (346.112s), not an estimate — the label is derived from it so the two
 * cannot drift the way a hand-typed "6:04" can.
 */
const DURATION_SECONDS = 346;

export const VSL_VIDEO = {
  title: `Why Producers Build With ${BRAND.platformName}`,
  description: `The full ${BRAND.platformName} walkthrough: the platform, the three paths, how production is tracked, and exactly how a licensed producer starts.`,
  src: `${VSL_MEDIA_BASE}/apex-vsl.mp4`,
  poster: `${VSL_MEDIA_BASE}/galaxy-vsl-poster.jpg`,
  pageUrl: "https://galaxyfinancial.org/vsl",
  durationSeconds: DURATION_SECONDS,
  durationLabel: `${Math.floor(DURATION_SECONDS / 60)}:${String(DURATION_SECONDS % 60).padStart(2, "0")}`,
} as const;

/** Rendered only beside the actual /vsl player, never on the license-choice home. */
export const VSL_VIDEO_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: VSL_VIDEO.title,
  description: VSL_VIDEO.description,
  thumbnailUrl: VSL_VIDEO.poster,
  uploadDate: VSL_MEDIA_BASE.slice(VSL_MEDIA_BASE.lastIndexOf("/") + 1),
  duration: `PT${Math.floor(DURATION_SECONDS / 60)}M${DURATION_SECONDS % 60}S`,
  contentUrl: VSL_VIDEO.src,
  embedUrl: VSL_VIDEO.pageUrl,
} as const;

/** The same licensing object used by /get-licensed, described on this public entry page. */
export const LICENSING_VSL_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: LICENSING_VIDEO.title,
  description: LICENSING_VIDEO.description,
  thumbnailUrl: LICENSING_VIDEO.poster,
  uploadDate: LICENSING_VIDEO.src.split("/").at(-2),
  duration: `PT${Math.floor(LICENSING_VIDEO.durationSeconds / 60)}M${LICENSING_VIDEO.durationSeconds % 60}S`,
  contentUrl: LICENSING_VIDEO.src,
  embedUrl: `${VSL_VIDEO.pageUrl}?track=licensing-roadmap`,
} as const;

/** Preserve the generic/agency-builder overview; the explicit unlicensed door gets licensing. */
export function recruitingVslForTrack(track: PublicRecruitingTrack | null) {
  if (track === "licensing-roadmap") {
    return {
      video: LICENSING_VIDEO,
      schema: LICENSING_VSL_SCHEMA,
      analyticsId: "licensing-2026-09-15",
      label: "Licensing walkthrough",
    } as const;
  }
  return {
    video: VSL_VIDEO,
    schema: VSL_VIDEO_SCHEMA,
    analyticsId: "vsl-2026-09-02",
    label: `${BRAND.shortName} producer overview`,
  } as const;
}
