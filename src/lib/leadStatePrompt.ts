// The small rules behind LeadStatePrompt (MP-MORNING-LEADS part 2, 2026-11-23).
import { US_STATES } from "@/lib/constants";

const KNOWN = new Set(US_STATES.map((s) => s.value));

/** Adds a state once, in the order chosen. An empty pick or an unknown code changes nothing. */
export function addState(current: readonly string[], code: string): string[] {
  const c = code.trim().toUpperCase();
  if (!c || !KNOWN.has(c) || current.includes(c)) return [...current];
  return [...current, c];
}

/** "Arizona" for "AZ"; the code itself when it is not one we list. */
export function stateName(code: string): string {
  return US_STATES.find((s) => s.value === code)?.label ?? code;
}
