import type { LucideIcon } from "lucide-react";
import {
  Gauge,
  Lightbulb,
  Hash,
} from "lucide-react";

export type CwModuleKey =
  | "dashboard"
  | "ideation"
  | "hooks";

export interface CwModule {
  key: CwModuleKey;
  label: string;
  number: string;
  icon: LucideIcon;
  short: string;
}

/**
 * Working ContentWheel modules, in cycle order. Future modules stay out of
 * navigation until their UI and data contract ship; every visible choice is
 * therefore a real destination.
 */
export const CW_MODULES: CwModule[] = [
  { key: "dashboard", number: "01", label: "Dashboard", icon: Gauge, short: "The cockpit." },
  { key: "ideation", number: "02", label: "Ideation Rolodex", icon: Lightbulb, short: "5 demand sources → ranked backlog." },
  { key: "hooks", number: "03", label: "Hook Lab", icon: Hash, short: "3 C's. Min 2 variants per idea." },
];

export const CW_MODULE_KEYS = CW_MODULES.map(m => m.key) as readonly CwModuleKey[];

export function isCwModuleKey(s: string | null | undefined): s is CwModuleKey {
  if (!s) return false;
  return (CW_MODULE_KEYS as readonly string[]).includes(s);
}
