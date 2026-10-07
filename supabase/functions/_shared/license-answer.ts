// license-answer.ts — read the reply to welcome.start's one question.
//
// WHY THIS EXISTS
// telegram_templates.welcome.start ends: "One question to start: do you already
// have your life insurance license? Reply LICENSED or UNLICENSED." Nothing in
// telegram-webhook parsed that reply. Private free text went straight to
// aiAnswer(), which has never logged a single ai_answer row, so the reply the
// bot asked for came back as "Don't know that one for sure... Tap /manager."
//
// Measured 2026-10-07 on live telegram_messages: 1 of 1 applicants who
// answered got that fallback. Application 03be96c0 replied "UNLICENSED"
// at 22:09:20Z on 10-05, got ai.fallback_unknown, rephrased as "I'm
// unlicensed", got it again, and escalated to /manager. Low volume (12 chats
// ever), so this ships as a broken first touch, not as a dollar claim.
//
// WHAT COUNTS AS AN ANSWER
// Only a reply that IS the answer. "how do I get licensed?" or "when will I be
// licensed" are real questions and must still reach aiAnswer, so anything
// ending in "?" is never an answer, and the patterns are anchored at both ends.
//
// WHAT THIS DOES NOT DO
// It never writes license status. License truth is applications.license_status,
// corroborated by NIPR and the 2026-08-07 licensing trigger. A self-reported
// word in a chat only picks which next step to show.

export type LicenseAnswer = "licensed" | "unlicensed";

const UNLICENSED_RE =
  /^(?:i'?m |i am |im )?(?:un ?licen[cs]ed|not (?:yet )?licen[cs]ed(?: yet)?|no license)$/;
const LICENSED_RE =
  /^(?:i'?m |i am |im )?(?:already )?licen[cs]ed(?: in [a-z ]{2,20})?$/;

export function parseLicenseAnswer(text: string): LicenseAnswer | null {
  const raw = (text ?? "").trim();
  if (!raw || raw.endsWith("?")) return null;
  const t = raw
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (UNLICENSED_RE.test(t)) return "unlicensed";
  if (LICENSED_RE.test(t)) return "licensed";
  return null;
}
