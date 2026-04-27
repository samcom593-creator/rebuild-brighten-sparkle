import { Package, Star, Bot, Rocket, Dumbbell, GraduationCap, Crown, type LucideIcon } from "lucide-react";

export type OfferSku =
  | "gold"
  | "platinum"
  | "auto_dm"
  | "social_growth"
  | "fitness_reset"
  | "kingofsales_course"
  | "work_with_sam";

export interface OfferDef {
  sku: OfferSku;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  price: number;
  cadence: "weekly" | "monthly" | "one-time";
  popular?: boolean;
  category: "leads" | "social" | "fitness" | "course" | "high_ticket";
  icon: LucideIcon;
  accent: "amber" | "primary" | "fuchsia" | "violet" | "rose" | "blue" | "gold";
  /** Hero image rendered at the top of the offer card. Source it from Unsplash
   *  by keyword (deterministic — same query, same image) so we don't need to
   *  ship binary assets. Replace with a custom Cloudinary/CDN URL when ready. */
  heroImageUrl: string;
  /** Prompt to feed nanobanana / Sora when generating a custom hero image. */
  heroImagePrompt: string;
}

export const OFFERS: OfferDef[] = [
  {
    sku: "gold",
    name: "Gold Leads",
    tagline: "Standard subscription",
    description:
      "Quality leads under 30 days old. Perfect for agents building a consistent pipeline with proven prospects.",
    features: [
      "Unlimited leads every week",
      "30 days old or less",
      "Pre-qualified prospects",
      "Verified contact info",
      "Sunday midnight CST drop",
    ],
    price: 250,
    cadence: "weekly",
    category: "leads",
    icon: Package,
    accent: "amber",
    heroImageUrl: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Macro shot of a polished gold ingot stacked on a dark navy desk next to a glowing iPhone screen showing a CRM lead list, cinematic light, shallow depth of field",
  },
  {
    sku: "platinum",
    name: "Platinum Vet Leads",
    tagline: "Premium veteran subscription",
    description:
      "Fresh leads logged within the past week. The hottest prospects with maximum conversion potential.",
    features: [
      "Unlimited leads every week",
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
    heroImageUrl: "https://images.unsplash.com/photo-1542228262-3d663b306a55?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Veteran in dress uniform shaking hands with a young insurance agent across a clean desk, American flag softly blurred behind, golden-hour lighting, premium cinematic feel",
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
    cadence: "monthly",
    category: "social",
    icon: Bot,
    accent: "fuchsia",
    heroImageUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Phone screen overflowing with Instagram DM notification badges glowing magenta, set against a dark studio backdrop, hyper-realistic neon product shot",
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
    cadence: "monthly",
    popular: true,
    category: "social",
    icon: Rocket,
    accent: "violet",
    heroImageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Mission-control wall of screens showing real-time Instagram + TikTok analytics, follower counts climbing, dim purple ambient light, futuristic agency operations room",
  },
  {
    sku: "fitness_reset",
    name: "Fitness Reset Blueprint",
    tagline: "30-day digital plan",
    description:
      "Sam's exact 30-day reset: training split, nutrition framework, mindset prompts. Built for entrepreneurs who can't afford to be slow, soft, or tired. Lifetime access, instant download.",
    features: [
      "30-day training split (4 days/week, gym or home)",
      "Macro framework — no calorie counting required",
      "Daily mindset prompt + morning routine",
      "Supplement stack (every brand named)",
      "Lifetime access + free updates",
      "Instant PDF + private community link",
    ],
    price: 97,
    cadence: "one-time",
    category: "fitness",
    icon: Dumbbell,
    accent: "rose",
    heroImageUrl: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Cinematic gym shot at golden hour — barbell loaded with plates on a hardwood floor, chalk dust in the air, single shaft of warm light, premium magazine-cover quality",
  },
  {
    sku: "kingofsales_course",
    name: "King of Sales Course",
    tagline: "Sam's full closing system",
    description:
      "The same training Sam used to build APEX into a multi-million dollar agency. 9 modules, 627+ lessons, every objection handled, every script field-tested. One payment, lifetime access.",
    features: [
      "9 full modules (627+ lessons)",
      "Every objection-handling script",
      "Recorded live closes + breakdowns",
      "Onboarding playbook for new agents",
      "Private King of Sales Skool community",
      "Monthly group call with Sam",
      "Lifetime access + future updates",
    ],
    price: 497,
    cadence: "one-time",
    popular: true,
    category: "course",
    icon: GraduationCap,
    accent: "blue",
    heroImageUrl: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Sam on stage in front of a packed room, headset mic, audience taking notes, dramatic stage lighting, magazine-cover composition, premium brand feel",
  },
  {
    sku: "work_with_sam",
    name: "1:1 Work With Sam",
    tagline: "Done-with-you private consult",
    description:
      "60-minute private call with Sam to map your sales operation, plug your leaks, and design your first $100K month. Limited slots each month — pre-qualification required.",
    features: [
      "60-minute 1:1 strategy call",
      "Custom 90-day revenue plan",
      "Direct WhatsApp access for 30 days",
      "One follow-up review call (30 min)",
      "Audit of your current funnel + scripts",
      "Lifetime access to King of Sales Course included",
      "Pre-qualification — Sam personally reviews every booking",
    ],
    price: 5000,
    cadence: "one-time",
    category: "high_ticket",
    icon: Crown,
    accent: "gold",
    heroImageUrl: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=900&q=80",
    heroImagePrompt: "Black-and-white close-up of two men in suits shaking hands across a marble boardroom table, single dramatic spotlight, executive luxury feel, ultra-premium",
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
  rose: {
    ring: "border-rose-500/40",
    bg: "bg-rose-500/20",
    text: "text-rose-400",
    gradient: "from-rose-500/10 via-background to-background",
  },
  blue: {
    ring: "border-blue-500/40",
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    gradient: "from-blue-500/10 via-background to-background",
  },
  gold: {
    ring: "border-yellow-400/50",
    bg: "bg-yellow-400/20",
    text: "text-yellow-300",
    gradient: "from-yellow-400/10 via-background to-background",
  },
};
