export interface CoachingPoints {
  items: string[];
  incomplete: boolean;
}

/** Accept complete text or text lists without coercing objects or reconstructing lost advice. */
export function normalizeCoachingPoints(value: unknown): CoachingPoints {
  if (value == null) return { items: [], incomplete: false };
  const source = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!source) return { items: [], incomplete: true };
  const text = source.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean);
  // The legacy writer iterated scalar strings, dropped spaces and kept only the first 4–6 letters.
  // Their missing suffix cannot be recovered by joining the surviving characters.
  if (text.length >= 3 && text.every(item => Array.from(item).length === 1)) {
    return { items: [], incomplete: true };
  }
  return { items: [...new Set(text)], incomplete: source.some(item => typeof item !== "string") };
}
