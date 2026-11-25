import { resolveBrand } from "@/config/brand";

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
