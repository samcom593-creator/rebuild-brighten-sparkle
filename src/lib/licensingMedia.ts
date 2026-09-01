const TRAINING_MEDIA_BASE =
  "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/licensing/2026-08-31";

/**
 * Canonical media for every unlicensed-prospect licensing flow.
 * Keep prospect messages pointed at pageUrl so future media swaps only need
 * one website change and applicants retain the guide, course, and next step.
 */
export const LICENSING_VIDEO = {
  title: "How to Get Your Life Insurance License",
  description:
    "The complete 2026 process: state requirements, pre-licensing, exam, fingerprints, application, and license verification.",
  src: `${TRAINING_MEDIA_BASE}/how-to-get-your-life-insurance-license.mp4`,
  poster: `${TRAINING_MEDIA_BASE}/how-to-get-your-life-insurance-license-poster.jpg`,
  pageUrl: "https://apex-financial.org/get-licensed#licensing-video",
  durationLabel: "6:04",
  durationSeconds: 364,
} as const;
