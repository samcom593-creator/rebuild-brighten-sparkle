import type { LucideIcon } from "lucide-react";
import {
  Gauge,
  Lightbulb,
  Hash,
  Layers,
  Kanban,
  FlaskConical,
  TrendingUp,
  Waves,
  Users2,
  Trophy,
  ScrollText,
  CalendarCheck,
} from "lucide-react";

export type CwModuleKey =
  | "dashboard"
  | "ideation"
  | "hooks"
  | "formats"
  | "production"
  | "split-test"
  | "outliers"
  | "lake"
  | "recruiting"
  | "challenge"
  | "brand"
  | "weekly";

export interface CwModule {
  key: CwModuleKey;
  label: string;
  number: string;
  icon: LucideIcon;
  short: string;
  /** P1 ships dashboard. Rest are placeholders shipping in P2-P8. */
  phase: "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8";
}

/**
 * The 12 modules of ContentWheel, in cycle order.
 * Order = the cycle: Ideate → Hook → Shoot → Sequence → Test → Iterate.
 */
export const CW_MODULES: CwModule[] = [
  { key: "dashboard",  number: "01",  label: "Dashboard",         icon: Gauge,         short: "The cockpit.",                          phase: "P1" },
  { key: "ideation",   number: "02",  label: "Ideation Rolodex",  icon: Lightbulb,     short: "5 demand sources → ranked backlog.",    phase: "P2" },
  { key: "hooks",      number: "03",  label: "Hook Lab",          icon: Hash,          short: "3 C's. Min 2 variants per idea.",       phase: "P3" },
  { key: "formats",    number: "03b", label: "Format Rotation",   icon: Layers,        short: "Max 3 active formats. No sprawl.",      phase: "P3" },
  { key: "production", number: "04",  label: "Production Queue",  icon: Kanban,        short: "Shoot 2× what you post.",               phase: "P4" },
  { key: "split-test", number: "05",  label: "Split-Test Tracker",icon: FlaskConical,  short: "Test on TikTok. Post winner to IG.",    phase: "P5" },
  { key: "outliers",   number: "06",  label: "Outliers & Iteration", icon: TrendingUp, short: "Don't leave the spot till it's mined.", phase: "P5" },
  { key: "lake",       number: "07",  label: "The Lake",          icon: Waves,         short: "Library. Not a waterfall.",             phase: "P6" },
  { key: "recruiting", number: "08",  label: "Recruiting Funnel", icon: Users2,        short: "Top-of-funnel → Apex agents.",          phase: "P7" },
  { key: "challenge",  number: "09",  label: "Public Challenge",  icon: Trophy,        short: "Always-on credibility engine.",         phase: "P8" },
  { key: "brand",      number: "10",  label: "Brand Core",        icon: ScrollText,    short: "Pillars, dogmas, voice — locked.",      phase: "P1" },
  { key: "weekly",     number: "11",  label: "Weekly Review",     icon: CalendarCheck, short: "Close the wheel. Seed next week.",      phase: "P8" },
];

export const CW_MODULE_KEYS = CW_MODULES.map(m => m.key) as readonly CwModuleKey[];

export function isCwModuleKey(s: string | null | undefined): s is CwModuleKey {
  if (!s) return false;
  return (CW_MODULE_KEYS as readonly string[]).includes(s);
}
