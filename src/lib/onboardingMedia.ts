const ONBOARDING_MEDIA_BASE =
  "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/onboarding/2026-08-31";

export const ONBOARDING_VIDEO = {
  title: "Welcome to APEX: Your Next Steps",
  description:
    "Your complete next-step briefing for licensing, communication, meetings, and training.",
  durationLabel: "1:45",
  src: `${ONBOARDING_MEDIA_BASE}/apex-new-agent-onboarding.mp4`,
  poster: `${ONBOARDING_MEDIA_BASE}/apex-new-agent-onboarding-poster.jpg`,
  pageUrl: "https://apex-financial.org/get-licensed#apex-onboarding",
  ready: true,
} as const;
