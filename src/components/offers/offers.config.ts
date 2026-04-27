import { Package, Star, Bot, Rocket, type LucideIcon } from "lucide-react";

export type OfferSku = "gold" | "platinum" | "auto_dm" | "social_growth";

export interface OfferDef {
  sku: OfferSku;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  price: number;
  cadence: "weekly" | "one-time";
  popular?: boolean;
  category: "leads" | "social";
  icon: LucideIcon;
  accent: "amber" | "primary" | "fuchsia" | "violet";
}

export const OFFERS: OfferDef[] = [
  {
    sku: "gold",
    name: "Gold Leads",
    tagline: "Standard subscription",
    description:
      "Quality leads under 30 days old. Perfect for agents building a consistent pipeline with proven prospects.",
    features: [
      "Unlimited leads each week",
      "30 days old or less",
      "Pre-qualified prospects",
      "Verified contact info",
      "Weekly Sunday drop, midnight CST",
    ],
    price: 250,
    cadence: "weekly",
    category: "leads",
    icon: Package,
    accent: "amber",
  },
  {
    sku: "platinum",
    name: "Platinum Vet Leads",
    tagline: "Premium veteran subscription",
    description:
      "Fresh leads logged within the past week. The hottest prospects with maximum conversion potential.",
    features: [
      "Unlimited leads each week",
      "Logged this week — fresh",
      "Highest conversion rates",
      "First-priority access",
      "Exclusive territories",
    ],
    price: 500,
    cadence: "weekly",
    popular: true,
    category: "leads",
    icon: Star,
    accent: "primary",
  },
  {
    sku: "auto_dm",
    name: "Auto-DM Engine",
    tagline: "Done-for-you Instagram DMs",
    description:
      "Our white-label automation handles every inbound DM, story reply, and comment trigger across your IG accounts. Replaces ManyChat at zero per-message cost.",
    features: [
      "Auto-replies to story mentions & reactions",
      "Comment-to-DM keyword triggers",
      "Drip sequences with smart delays",
      "Bulk broadcasts to subscriber list",
      "Quick replies, tags & segmentation",
      "Conversation flow builder (visual)",
      "A/B testing on opening messages",
      "CRM sync — every conversation logged",
    ],
    price: 250,
    cadence: "one-time",
    category: "social",
    icon: Bot,
    accent: "fuchsia",
  },
  {
    sku: "social_growth",
    name: "Full Social Media Growth Suite",
    tagline: "Everything ManyChat does — and more",
    description:
      "The full white-label social-growth stack. Mass interactions, Repost Pro, AI-DMing, Reactions Pro, story-reply automations, audience growth, and content syndication across hundreds of accounts. We handle the whole funnel — you focus on closing.",
    features: [
      "Everything in Auto-DM Engine",
      "Reactions Pro — story likes, follows, post likes, mass DM",
      "Repost Pro — syndicate Reels across hundreds of accounts",
      "AI-DM at scale — fixed cost, unlimited messages",
      "Cloud-based emulator — manage every account from one screen",
      "Profile editor, username changer, post/album/story scheduler",
      "Funnel builder — capture, nurture, convert",
      "Webhooks + Zapier-equivalent integrations",
      "Live analytics dashboard, audience segments, retention metrics",
      "Priority support + onboarding call",
    ],
    price: 500,
    cadence: "one-time",
    popular: true,
    category: "social",
    icon: Rocket,
    accent: "violet",
  },
];

export const accentClasses: Record<OfferDef["accent"], { ring: string; bg: string; text: string; gradient: string }> = {
  amber: {
    ring: "border-amber-500/40",
    bg: "bg-amber-500/20",
    text: "text-amber-500",
    gradient: "from-amber-500/10 via-background to-background",
  },
  primary: {
    ring: "border-primary/40",
    bg: "bg-primary/20",
    text: "text-primary",
    gradient: "from-primary/10 via-background to-background",
  },
  fuchsia: {
    ring: "border-fuchsia-500/40",
    bg: "bg-fuchsia-500/20",
    text: "text-fuchsia-400",
    gradient: "from-fuchsia-500/10 via-background to-background",
  },
  violet: {
    ring: "border-violet-500/40",
    bg: "bg-violet-500/20",
    text: "text-violet-400",
    gradient: "from-violet-500/10 via-background to-background",
  },
};
