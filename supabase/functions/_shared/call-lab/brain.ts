import type { ObjectionData, PersonaData, ScenarioData } from "./types.ts";

/**
 * The prospect brain decides what the AI prospect says next. It is a pure
 * function of (compiled scenario, conversation so far, brain state) so the
 * rules brain is deterministic and the LLM brains are drop-in replacements.
 * Tool-like outputs (objection surfaced/resolved, commitment, end) are hints
 * that the evaluator reconciles against the transcript — never grading truth.
 */

export type BrainTurnInput = {
  scenario: CompiledScenario;
  transcript: { turnId: string; speaker: "agent" | "prospect"; text: string }[];
  /** The agent's latest final turn (also the last item of transcript). */
  latest: { turnId: string; text: string };
  state: BrainState;
  elapsedMs: number;
};

export type BrainToolEvent =
  | { tool: "surface_objection"; objectionId: string }
  | { tool: "resolve_objection"; objectionId: string }
  | { tool: "record_commitment"; summary: string }
  | { tool: "end_scenario"; reason: "earned_next_step" | "max_duration" | "critical_hangup" | "prospect_ended" };

export type BrainTurnOutput = { text: string; events: BrainToolEvent[]; state: BrainState; interrupt?: boolean };

export type Phase = "open" | "discovery" | "positioning" | "close" | "ended";

export type BrainState = {
  phase: Phase;
  agentTurns: number;
  identityStated: boolean;
  purposeStated: boolean;
  beneficiaryAsked: boolean;
  whyAsked: boolean;
  healthAsked: boolean;
  budgetAsked: boolean;
  priceStated: boolean;
  bankAsked: boolean;
  monologueStrikes: number;
  unsupportedClaims: number;
  pending: string | null; // objection id awaiting resolution
  ledger: Record<string, { attempts: number; resolved: boolean; strongSignals: number }>;
  revealed: string[];
  committed: boolean;
  rngSeed: number;
  variantCursor: Record<string, number>;
  lastPrompted: string | null;
  /** A drill focuses the call on one objection: it is raised first. */
  focus?: string | null;
};

export type CompiledObjection = { id: string; key: string; data: ObjectionData; required: boolean };
export type CompiledScenario = {
  scenarioVersionId: string;
  scenario: ScenarioData;
  persona: PersonaData & { name: string };
  objections: CompiledObjection[];
  approvedClaims: string[];
  prohibitedPatterns: { text: string; patterns: string[]; severity: string }[];
  scriptSections: { title: string; body: string }[];
};

export function initialBrainState(seed: number): BrainState {
  return {
    phase: "open", agentTurns: 0, identityStated: false, purposeStated: false, beneficiaryAsked: false, whyAsked: false,
    healthAsked: false, budgetAsked: false, priceStated: false, bankAsked: false, monologueStrikes: 0, unsupportedClaims: 0,
    pending: null, ledger: {}, revealed: [], committed: false, rngSeed: seed, variantCursor: {}, lastPrompted: null,
  };
}

export interface ProspectBrain {
  readonly kind: "rules" | "anthropic" | "openai";
  nextTurn(input: BrainTurnInput): Promise<BrainTurnOutput>;
}

/* ── Deterministic helpers ─────────────────────────────────────────────── */

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const GENERIC_WEAK = ["You didn't answer what I asked.", "You keep moving on. I asked you something.", "I'm going to need more than that before we go any further.", "Hang on. Back up to my question."];
function pick(list: string[], state: BrainState, key: string): { text: string; state: BrainState } {
  if (list.length === 0) return { text: "", state };
  const cursor = state.variantCursor[key] ?? 0;
  const text = key.startsWith("weak:") && cursor >= list.length ? GENERIC_WEAK[(cursor - list.length) % GENERIC_WEAK.length] : list[cursor % list.length];
  return { text, state: { ...state, variantCursor: { ...state.variantCursor, [key]: cursor + 1 } } };
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%'\s]/g, " ").replace(/\s+/g, " ").trim();
const wordCount = (t: string) => norm(t).split(" ").filter(Boolean).length;
const hasQuestion = (t: string) => /\?/.test(t) || /\b(what|who|why|how|when|which|would|could|can|do you|did you|are you|is that|does that)\b/i.test(t);
const mentionsAny = (t: string, words: string[]) => { const n = norm(t); return words.some((w) => n.includes(w)); };
/** True when a question sentence (ends in ? or opens with a question word) itself mentions one of the words. Keeps a passing mention in a statement from triggering a reveal. */
const asksAbout = (t: string, words: string[]) => t.split(/(?<=[.!?])\s+/).some((sentence) => hasQuestion(sentence) && mentionsAny(sentence, words));

const ACK_WORDS = ["i hear you", "i understand", "understand", "makes sense", "that's fair", "fair enough", "i get that", "totally get", "appreciate", "of course", "absolutely", "i respect that", "no problem", "good question"];
const CHECKIN = ["does that make sense", "sound fair", "fair enough", "take care of", "does that help", "make sense", "is that fair", "would that work", "how does that sound", "does that answer"];
const IDENTITY = ["licensed", "agent", "apex", "agency", "my name is", "this is", "license number", "callback", "call you back", "insurance agent", "benefits coordinator", "coordinator"];
/** Implied affiliation phrases. Checked negation-aware: "I'm not with the VA" is compliance, not a claim. */
const GOV = ["from the va", "with the va", "this is the va", "the va calling", "government program", "government benefit", "from the government", "military benefit", "department of veterans", "on behalf of the va"];
const NEGATION = /\b(not|never|no|isn't|aren't|ain't|don't|doesn't|didn't|wasn't|nobody|neither)\b|n't\b/;

/** True when a negation token sits within the five words before the phrase (or the phrase is the object of a negated verb). */
export function negatedBefore(text: string, phrase: string): boolean {
  const n = norm(text); const idx = n.indexOf(norm(phrase));
  if (idx < 0) return false;
  const before = n.slice(0, idx).split(" ").slice(-5).join(" ");
  return NEGATION.test(before);
}
const PRICE = ["$", "dollars", "a month", "per month", "monthly", "premium", "fifty", "sixty", "seventy", "forty", "thirty", "hundred"];
const BENEFICIARY = ["who would", "in charge", "beneficiary", "leave", "loved one", "family member", "spouse", "wife", "husband", "daughter", "son"];
const WHY = ["why", "what's important", "what stopped", "reason", "matter to you", "important to you"];
const HEALTH = ["health", "medication", "diabetes", "heart", "cancer", "stroke", "tobacco", "smoke", "height", "weight", "hospital"];
const BUDGET = ["budget", "comfortable", "afford", "work for you", "fit", "what works"];
const BANK = ["bank", "routing", "account number", "draft", "checking", "debit", "card number"];
const CLOSE = ["lock in", "lock it in", "get this started", "set this up", "set up", "get you covered", "go ahead and", "start the", "application", "sign"];

export function detectUnsupportedClaim(text: string, prohibited: CompiledScenario["prohibitedPatterns"]): { hit: boolean; severity: string; pattern: string | null } {
  const n = norm(text);
  for (const p of prohibited) for (const pat of p.patterns) if (n.includes(norm(pat)) && !negatedBefore(text, pat)) return { hit: true, severity: p.severity, pattern: pat };
  if (/\bguarantee/.test(n) && !/no guarantee|can't guarantee|cannot guarantee|not guarantee|never guarantee|don't guarantee/.test(n)) return { hit: true, severity: "critical", pattern: "guarantee" };
  return { hit: false, severity: "none", pattern: null };
}

/** Implied government/VA affiliation, negation-aware. */
export function impliesGovernment(text: string): boolean {
  return GOV.some((g) => norm(text).includes(g) && !negatedBefore(text, g));
}

/**
 * Rules brain: a stateful persona driven by the scenario's objection plan.
 * Reveals facts only when asked, surfaces required objections when their
 * triggers are met, holds an objection open until it is genuinely handled at
 * the scenario's difficulty, challenges unsupported claims, and ends the call
 * for the scenario's early-end conditions. Deterministic per session seed.
 */
export class RulesBrain implements ProspectBrain {
  readonly kind = "rules" as const;

  async nextTurn(input: BrainTurnInput): Promise<BrainTurnOutput> {
    const { scenario, latest } = input;
    const persona = scenario.persona;
    let st: BrainState = { ...input.state, agentTurns: input.state.agentTurns + 1, ledger: { ...input.state.ledger } };
    const events: BrainToolEvent[] = [];
    const say: string[] = [];
    const text = latest.text;
    const n = norm(text);
    const difficulty = scenario.scenario.difficulty;
    const maxSec = scenario.scenario.maxDurationSec;

    if (input.elapsedMs > maxSec * 1000) {
      return { text: "I've given you a lot of time already. I need to go.", events: [{ tool: "end_scenario", reason: "max_duration" }], state: { ...st, phase: "ended" } };
    }

    /* 1. Compliance: implied government affiliation ends the call for this persona. */
    const gov = impliesGovernment(text);
    const claim = detectUnsupportedClaim(text, scenario.prohibitedPatterns);
    if (gov || (claim.hit && claim.severity === "critical")) {
      st.unsupportedClaims += 1;
      const hardStop = gov && persona.hardConstraints.some((c) => /government|va/i.test(c));
      if (hardStop || st.unsupportedClaims >= 2) {
        return {
          text: gov ? "The VA doesn't call people about this. That's what the last scammer said, too. We're done here." : "That's the second thing you've told me that doesn't sound right. I'm going to hang up now.",
          events: [{ tool: "end_scenario", reason: "critical_hangup" }], state: { ...st, phase: "ended" },
        };
      }
      say.push(gov ? "Hold on. Are you saying you're with the VA?" : `Wait — "${claim.pattern}"? Nobody can promise that. Where are you getting that from?`);
    }

    /* 2. Call control: long monologues get interrupted at higher difficulty. */
    const words = wordCount(text);
    const monologue = words > (difficulty >= 3 ? 70 : 110);
    if (monologue) {
      st.monologueStrikes += 1;
      if (difficulty >= 2 && st.monologueStrikes >= 2 && scenario.scenario.earlyEndConditions.some((c) => /60 seconds|monologue|without a question/i.test(c))) {
        return { text: "You're talking at me, not to me. I'm going to let you go.", events: [{ tool: "end_scenario", reason: "prospect_ended" }], state: { ...st, phase: "ended" }, interrupt: true };
      }
      say.push(difficulty >= 3 ? "Hang on, hang on — slow down. What is it you actually want from me?" : "Okay — that's a lot. What's the short version?");
    }

    /* 3. Track what the agent has done. */
    if (mentionsAny(text, IDENTITY)) st.identityStated = true;
    if (mentionsAny(text, ["burial", "coverage", "final expense", "protection", "policy", "insurance"])) st.purposeStated = true;
    if (mentionsAny(text, BENEFICIARY) && hasQuestion(text)) st.beneficiaryAsked = true;
    if (mentionsAny(text, WHY) && hasQuestion(text)) st.whyAsked = true;
    if (mentionsAny(text, HEALTH) && hasQuestion(text)) st.healthAsked = true;
    if (mentionsAny(text, BUDGET) && hasQuestion(text)) st.budgetAsked = true;
    if (mentionsAny(text, PRICE)) st.priceStated = true;
    if (mentionsAny(text, BANK)) st.bankAsked = true;

    /* 4. Pending objection: judge the agent's handling. */
    if (st.pending) {
      const obj = scenario.objections.find((o) => o.id === st.pending)!;
      const entry = st.ledger[obj.id] ?? { attempts: 0, resolved: false, strongSignals: 0 };
      const ack = mentionsAny(text, ACK_WORDS);
      const clarify = hasQuestion(text) && words < 60;
      const relevant = mentionsAny(text, relevanceWords(obj.key)) || obj.data.responsePrinciples.some((p) => principleHit(p, n));
      const checkin = mentionsAny(text, CHECKIN) || (hasQuestion(text) && mentionsAny(text, ["okay", "alright", "fair"]));
      let signals = (ack ? 1 : 0) + (clarify ? 1 : 0) + (relevant ? 1 : 0) + (checkin ? 1 : 0);
      if (claim.hit) signals = 0;
      const need = difficulty === 1 ? 1 : difficulty === 2 ? 2 : 3;
      const strong = signals + entry.strongSignals;
      st.ledger[obj.id] = { attempts: entry.attempts + 1, resolved: false, strongSignals: strong };
      if (relevant && strong >= need) {
        st.ledger[obj.id] = { ...st.ledger[obj.id], resolved: true };
        st.pending = null;
        events.push({ tool: "resolve_objection", objectionId: obj.id });
        const r = pick(obj.data.followUps.ifStrong, st, `strong:${obj.key}`); st = r.state;
        say.push(r.text || "Alright. That makes sense.");
      } else if (entry.attempts + 1 >= (difficulty >= 3 ? 4 : 3) && relevant) {
        // The agent has tried repeatedly with relevant content: concede without full marks, but move on.
        st.ledger[obj.id] = { ...st.ledger[obj.id], resolved: true };
        st.pending = null;
        events.push({ tool: "resolve_objection", objectionId: obj.id });
        say.push("Fine. Let's keep going, but I'm not fully sold.");
      } else {
        const r = pick(obj.data.followUps.ifWeak, st, `weak:${obj.key}`); st = r.state;
        say.push(r.text || "I'm still not sure about that.");
        return { text: say.join(" "), events, state: st };
      }
    }

    /* 5. Phase progression and fact reveal. */
    if (st.phase === "open" && st.identityStated && st.purposeStated) st.phase = "discovery";
    if (st.phase === "discovery" && (st.beneficiaryAsked || st.whyAsked) && (st.healthAsked || st.priceStated)) st.phase = "positioning";
    if ((st.phase === "positioning" || st.phase === "discovery") && (mentionsAny(text, CLOSE) || st.bankAsked)) st.phase = "close";

    /* 6. Surface the next eligible objection (one per turn). */
    const next = nextObjection(scenario, st, text);
    if (next && say.length === 0) {
      st.pending = next.id;
      st.ledger[next.id] = st.ledger[next.id] ?? { attempts: 0, resolved: false, strongSignals: 0 };
      events.push({ tool: "surface_objection", objectionId: next.id });
      const forms = difficulty >= 2 && next.data.variations.length ? [...next.data.canonicalForms, ...next.data.variations] : next.data.canonicalForms;
      const r = pick(forms, st, `surface:${next.key}`); st = r.state;
      say.push(r.text);
      return { text: say.join(" "), events, state: st };
    }

    /* 7. Otherwise answer in character, revealing only what was asked. */
    if (say.length === 0) {
      const reply = answerInCharacter(scenario, st, text);
      st = reply.state;
      say.push(reply.text);
    }

    /* 8. Commitment and end. */
    const allRequiredResolved = scenario.objections.filter((o) => o.required).every((o) => st.ledger[o.id]?.resolved);
    if (st.phase === "close" && !st.committed && allRequiredResolved && st.priceStated && (st.bankAsked || mentionsAny(text, CLOSE))) {
      st.committed = true;
      const bank = scenario.persona.name === "Walter Reyes" ? "Wells Fargo" : "Chase";
      const summary = `Agreed to start the monthly draft (${bank}).`;
      events.push({ tool: "record_commitment", summary });
      say.length = 0;
      say.push(`Alright. Let's do it. It's ${bank} — what do you need from me?`);
    } else if (st.committed && (mentionsAny(text, ["thank", "welcome", "congrat", "all set", "you're covered", "that's it"]) || st.agentTurns > 40)) {
      events.push({ tool: "end_scenario", reason: "earned_next_step" });
      say.length = 0;
      say.push("Thank you. Linda will be glad this is handled. Goodbye now.");
      st.phase = "ended";
    }

    return { text: say.join(" "), events, state: st };
  }
}

function relevanceWords(key: string): string[] {
  switch (key) {
    case "price_cant_afford": return ["$", "a month", "per month", "start", "lower", "comfortable", "increase later", "what happens", "no coverage", "budget", "fifty", "sixty", "thirty", "forty"];
    case "spouse_decision": return ["30 days", "thirty days", "cancel", "free look", "include", "get her", "get him", "both of you", "peace of mind", "lock in", "together", "she", "he"];
    case "think_about_it": return ["specifically", "price", "coverage amount", "carrier", "what part", "which part", "rate", "age", "health", "wait"];
    case "trust_scam": return ["licensed", "license", "agency", "agent", "not the va", "isn't the va", "callback", "call back", "carrier", "a-rated", "rated", "written", "confirmation", "verify"];
    case "existing_coverage": return ["term", "expire", "ends", "retire", "pays", "amount", "how much", "gap", "permanent", "whole life", "burial allowance", "reimburse"];
    case "healthy_not_now": return ["age", "health today", "today's", "never goes up", "rate", "lock", "cheaper now", "linda", "beneficiary", "qualify now"];
    default: return [];
  }
}

function principleHit(principle: string, n: string): boolean {
  const keys = norm(principle).split(" ").filter((w) => w.length > 6).slice(0, 4);
  return keys.length > 0 && keys.filter((k) => n.includes(k)).length >= 2;
}

function nextObjection(scenario: CompiledScenario, st: BrainState, latest: string): CompiledObjection | null {
  if (st.focus && !st.ledger[st.focus] && st.agentTurns >= 1) {
    const f = scenario.objections.find((o) => o.id === st.focus);
    if (f) return f;
  }
  const ordered = [...scenario.objections].sort((a, b) => Number(b.required) - Number(a.required));
  for (const o of ordered) {
    if (st.ledger[o.id]) continue;
    const t = o.data.triggers;
    const phaseOk = !t.afterPhase || t.afterPhase === "any" || phaseIndex(st.phase) >= phaseIndex(t.afterPhase);
    const turnsOk = !t.minAgentTurns || st.agentTurns >= t.minAgentTurns;
    const kwOk = !t.keywords || t.keywords.length === 0 || mentionsAny(latest, t.keywords) || (o.required && st.agentTurns >= (t.minAgentTurns ?? 0) + 3);
    if (phaseOk && turnsOk && kwOk) return o;
    if (!o.required) continue;
  }
  return null;
}

function phaseIndex(p: Phase | "any"): number {
  return ["open", "discovery", "positioning", "close", "ended", "any"].indexOf(p);
}

function answerInCharacter(scenario: CompiledScenario, st: BrainState, text: string): { text: string; state: BrainState } {
  const p = scenario.persona;
  const n = norm(text);
  const reveal = (key: string, line: string): string | null => {
    if (st.revealed.includes(key)) return null;
    st = { ...st, revealed: [...st.revealed, key] };
    return line;
  };
  const lines: string[] = [];
  const first = p.name.split(" ")[0];

  if (/\b(is that your name|speaking to|am i speaking|this is .* right)\b/.test(n) || (n.includes(first.toLowerCase()) && hasQuestion(text) && st.agentTurns <= 2)) lines.push("Yeah, this is him." + (p.speakingStyle.includes("suspicious") ? " Who's asking?" : ""));
  if (/\b(serve|military|branch|veteran)\b/.test(n) && hasQuestion(text)) lines.push(reveal("service", p.age && p.age > 65 ? "Army. Twenty-two years, retired as a staff sergeant." : "I did, yes.") ?? "Like I said, Army.");
  if (asksAbout(text, ["coverage", "policy in place", "have any", "anything in place", "insurance"]) && st.agentTurns > 1) lines.push(reveal("coverage", p.currentSolution) ?? "I told you what I have.");
  if (asksAbout(text, BENEFICIARY)) lines.push(reveal("beneficiary", p.hiddenPriorities[0]?.includes("Linda") ? "Linda. My wife. She handles everything anyway." : "My daughter, Maya. She's all I've got.") ?? "Same as I said — my family.");
  if (asksAbout(text, WHY)) lines.push(reveal("why", p.businessPressure) ?? "I already told you why.");
  if (asksAbout(text, HEALTH)) lines.push(reveal("health", p.age && p.age > 65 ? "Blood pressure pills, that's it. No tobacco. Six foot, about 190." : "I'm healthy. No medications, never smoked.") ?? "Nothing's changed since you asked.");
  if (asksAbout(text, BUDGET)) lines.push(reveal("budget", p.hiddenPriorities.find((h) => /\$/.test(h)) ? "If it's under sixty a month I could probably live with it." : "Something I can keep up with for good — not a big number.") ?? "I said what I could do.");
  if (asksAbout(text, ["priority", "cover the burial", "leave money", "both"])) lines.push(reveal("priority", "Both, I suppose. Mostly I don't want Linda stuck with a bill.") ?? "Both.");
  if (mentionsAny(text, PRICE) && !hasQuestion(text)) lines.push(st.budgetAsked ? "Okay. And that's the number every month, it doesn't change?" : "How much is that a month, exactly?");
  if (lines.length === 0) {
    if (hasQuestion(text)) lines.push(pickReply(["Go ahead.", "Depends what you mean.", "I suppose so.", "Mm-hm.", "What do you need to know?"], st, "generic-q"));
    else lines.push(pickReply(["Okay.", "Alright, go on.", "I'm listening.", "Uh-huh.", "And?"], st, "generic-s"));
  }
  return { text: lines.slice(0, 2).join(" "), state: st };

  function pickReply(list: string[], s: BrainState, key: string): string {
    const r = pick(list, s, key); st = r.state; return r.text;
  }
}
