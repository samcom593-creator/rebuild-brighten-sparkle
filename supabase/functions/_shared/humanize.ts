// De-AI-ify any string before we send it to agents.
//
// Strips the most common AI tics:
//   - em-dashes (—) that scream "ChatGPT wrote this"
//   - overused adverbs and filler phrases
//   - redundant preambles like "I hope this finds you well"
//   - "Additionally," / "Furthermore," / "Moreover," transitions
//
// This is a regex-level cleanup, not a full AI humanizer. Good enough
// for automated digests where we control the template input. For
// free-form copy, prefer the `humanizer` / `de-ai-ify` Claude skills
// at authoring time.
//
// Callers pass their HTML or plain-text through humanize() right before
// send. Idempotent — running twice is a no-op.

const AI_TICS: Array<[RegExp, string]> = [
  // Em-dash → double-hyphen (agents read it natively, ChatGPT defaults to —)
  [/—/g, " - "],
  // En-dash → hyphen
  [/–/g, "-"],
  // Smart quotes → straight
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  // "In today's fast-paced world" / "in the realm of"
  [/\bin (today's|the) (fast-paced world|realm of|landscape of)\b[^.]*\.\s*/gi, ""],
  // Preamble stripping
  [/\bI hope this (email|message)?\s*finds you well[.,]?\s*/gi, ""],
  [/\bI'?m reaching out to\s+/gi, ""],
  [/\bAs an AI language model[^.]*\.\s*/gi, ""],
  // Overused transitions
  [/\b(Additionally|Furthermore|Moreover),?\s+/g, ""],
  [/\bIn conclusion,\s*/gi, ""],
  // Flowery adverbs
  [/\b(utterly|profoundly|extremely|incredibly|remarkably) /gi, ""],
  // Hedging softeners
  [/\bIt is worth noting that\s+/gi, ""],
  [/\bPlease note that\s+/gi, ""],
  // Redundant "In the event that"
  [/\bIn the event that\b/gi, "If"],
  // "A plethora of" → "a lot of"
  [/\ba plethora of\b/gi, "a lot of"],
  // Collapse double spaces left by above
  [/  +/g, " "],
];

export function humanize(input: string): string {
  if (!input) return input;
  let out = input;
  for (const [pat, rep] of AI_TICS) {
    out = out.replace(pat, rep);
  }
  return out.trim();
}

// Async version for consistency with other helpers; identical output.
export async function humanizeAsync(input: string): Promise<string> {
  return humanize(input);
}
