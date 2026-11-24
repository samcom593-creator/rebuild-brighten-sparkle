const ONBOARDING_MEDIA_BASE =
  "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/onboarding/2026-08-31";

export const ONBOARDING_VIDEO = {
  title: "Welcome to Galaxy: Your Next Steps",
  description:
    "Your complete next-step briefing for licensing, communication, meetings, and training.",
  durationLabel: "1:45",
  src: `${ONBOARDING_MEDIA_BASE}/apex-new-agent-onboarding.mp4`,
  // Poster re-rendered Apex->Galaxy (the gold eyebrow said "APEX FINANCIAL", the
  // dead pre-2026-10-08 brand, to every prospect on the public /get-licensed funnel).
  // The .mp4 still carries the old brand burned into its title card, persistent
  // top-left header, outro card, a "APEX Daily Team Meeting" slide heading, and
  // nested website screenshots — that needs a source re-render, not a pixel patch.
  poster: `${ONBOARDING_MEDIA_BASE}/galaxy-new-agent-onboarding-poster.jpg`,
  pageUrl: "https://galaxyfinancial.org/get-licensed#apex-onboarding",
  ready: true,
} as const;
