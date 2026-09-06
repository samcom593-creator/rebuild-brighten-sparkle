/**
 * Deterministic demo call: a scripted, timed conversation for the veteran
 * final-expense verification scenario. The demo provider replays it through
 * the same event reducer, state machine and evaluation pipeline as a real
 * call, so every screen can be exercised without a microphone or a key.
 * Objection ids are keys; the provider maps them to the session's version ids.
 */
export type DemoStep =
  | { kind: "turn"; speaker: "agent" | "prospect"; text: string; durationMs: number; gapMs?: number }
  | { kind: "objection.surfaced"; key: string }
  | { kind: "objection.resolved"; key: string }
  | { kind: "commitment"; summary: string }
  | { kind: "overlap"; initiator: "agent" | "prospect"; durationMs: number }
  | { kind: "end"; reason: "earned_next_step" | "critical_hangup" | "prospect_ended" };

export const DEMO_SCRIPT_ID = "vet-fe-demo-v1";

export const DEMO_SCRIPT: DemoStep[] = [
  { kind: "turn", speaker: "prospect", text: "Hello? Who's this?", durationMs: 1400 },
  { kind: "turn", speaker: "agent", text: "Hey Walter, it's Jordan Lee, I'm a licensed agent with the agency here in Arizona, the state veterans benefits coordinator. I'm calling to verify whether you ever got your 2026 veteran burial coverage set up, or if that's still left open?", durationMs: 12500, gapMs: 600 },
  { kind: "turn", speaker: "prospect", text: "Burial coverage? I get scam calls about this every week. How do I know you're legitimate?", durationMs: 5200 },
  { kind: "objection.surfaced", key: "trust_scam" },
  { kind: "turn", speaker: "agent", text: "That's a fair question, and I'd ask the same thing. I'm not with the VA — the VA doesn't call about this. I'm a licensed life insurance agent, license number's on file with the state, and I'll give you a callback line before we hang up. Does that work for you?", durationMs: 13000, gapMs: 900 },
  { kind: "turn", speaker: "prospect", text: "Alright. Go ahead then.", durationMs: 1600 },
  { kind: "objection.resolved", key: "trust_scam" },
  { kind: "turn", speaker: "agent", text: "Appreciate it. Just to confirm — you served in the Army, retired as a staff sergeant, is that right?", durationMs: 5600, gapMs: 700 },
  { kind: "turn", speaker: "prospect", text: "Twenty-two years. What's this coverage supposed to do?", durationMs: 3400 },
  { kind: "turn", speaker: "agent", text: "It covers the burial costs so they never land on your family, and anything left goes to whoever you choose. Who would you want in charge of this — a spouse, family?", durationMs: 9000, gapMs: 700 },
  { kind: "turn", speaker: "prospect", text: "Linda. My wife. She handles everything anyway.", durationMs: 3000 },
  { kind: "turn", speaker: "agent", text: "And why does taking care of this for Linda matter to you right now?", durationMs: 4200, gapMs: 800 },
  { kind: "turn", speaker: "prospect", text: "She was in the hospital last spring. I saw what those bills look like. I don't want her stuck with mine.", durationMs: 6800 },
  { kind: "turn", speaker: "agent", text: "That makes a lot of sense. Any medications, or anything like a heart attack, stroke, cancer, diabetes? And tobacco in the last year?", durationMs: 7200, gapMs: 700 },
  { kind: "turn", speaker: "prospect", text: "Blood pressure pills, that's it. No tobacco.", durationMs: 2800 },
  { kind: "turn", speaker: "agent", text: "Good. Based on that, an A-rated carrier would put ten thousand of permanent coverage at about fifty-eight dollars a month, and the rate is set by your age and health today — it never goes up. How does that fit your budget?", durationMs: 12000, gapMs: 900 },
  { kind: "turn", speaker: "prospect", text: "Fifty-eight? That's more than I was thinking. I'm on a fixed income, I can't just add a bill.", durationMs: 5600 },
  { kind: "objection.surfaced", key: "price_cant_afford" },
  { kind: "turn", speaker: "agent", text: "I hear you, and I'm not here to put you in something you can't keep. What number would feel comfortable every month — is it closer to forty, or fifty?", durationMs: 8400, gapMs: 900 },
  { kind: "turn", speaker: "prospect", text: "If it's under sixty a month I could probably live with it. Fifty I could do.", durationMs: 4800 },
  { kind: "turn", speaker: "agent", text: "Then let's start at fifty — that's about eight thousand of coverage today, and we can increase it later. Does that take care of the budget concern?", durationMs: 8000, gapMs: 800 },
  { kind: "turn", speaker: "prospect", text: "Yeah. Fifty a month I can do. But I'd want to run it by Linda before I sign anything.", durationMs: 5400 },
  { kind: "objection.resolved", key: "price_cant_afford" },
  { kind: "objection.surfaced", key: "spouse_decision" },
  { kind: "turn", speaker: "agent", text: "Of course, this affects her too. If you told Linda tonight you'd left her uncovered, what would she say?", durationMs: 6600, gapMs: 700 },
  { kind: "turn", speaker: "prospect", text: "Ha. She'd say what took you so long.", durationMs: 2600 },
  { kind: "turn", speaker: "agent", text: "Then here's what I'd suggest: we lock in today's rate at today's health, and you have thirty days to cancel for any reason, including if Linda says no. She gets a say, and you get peace of mind tonight. Sound fair?", durationMs: 11500, gapMs: 900 },
  { kind: "turn", speaker: "prospect", text: "Well, if I can cancel within thirty days, I suppose that's fair.", durationMs: 4000 },
  { kind: "objection.resolved", key: "spouse_decision" },
  { kind: "turn", speaker: "agent", text: "Then let's get you covered. I'll set up the monthly draft for fifty dollars — which bank do you use?", durationMs: 6200, gapMs: 800 },
  { kind: "turn", speaker: "prospect", text: "Alright. Let's do it. It's Wells Fargo — what do you need from me?", durationMs: 4200 },
  { kind: "commitment", summary: "Agreed to start a $50/month draft (Wells Fargo)." },
  { kind: "turn", speaker: "agent", text: "Just the routing and account number, and then you're all set. Thank you for trusting me with this, Walter.", durationMs: 6600, gapMs: 800 },
  { kind: "turn", speaker: "prospect", text: "Thank you. Linda will be glad this is handled. Goodbye now.", durationMs: 3800 },
  { kind: "end", reason: "earned_next_step" },
];

/** A shorter, weaker call used for fixtures: fabricates a claim and never confirms. */
export const DEMO_SCRIPT_WEAK: DemoStep[] = [
  { kind: "turn", speaker: "prospect", text: "Hello? Who's this?", durationMs: 1400 },
  { kind: "turn", speaker: "agent", text: "Hi Walter, this is Jordan with the VA benefits office, I'm calling about your government burial benefit that we can get set up for you today at no cost to you.", durationMs: 9000, gapMs: 500 },
  { kind: "turn", speaker: "prospect", text: "The VA doesn't call people about this. That's what the last scammer said, too. We're done here.", durationMs: 5200 },
  { kind: "end", reason: "critical_hangup" },
];
