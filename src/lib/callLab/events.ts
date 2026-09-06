/**
 * Normalized call events and the cockpit state machine. Pure TypeScript: no
 * React, no provider SDK. Every provider (demo, composed, OpenAI Realtime)
 * translates its own wire events into these; the reducer is the single source
 * of truth for the live transcript, the objection ledger and the session state.
 */

export type Speaker = "agent" | "prospect";
export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "failed";
export type EndReason =
  | "agent_ended" | "earned_next_step" | "max_duration" | "critical_hangup" | "prospect_ended"
  | "connection_lost" | "provider_error" | "abandoned";

export type AudioMetricSample = { level: number; clipped?: boolean; atMs: number };

export type CallEvent =
  | { type: "connection.changed"; state: ConnectionState; atMs: number; detail?: string }
  | { type: "speaker.changed"; speaker: Speaker | "none"; atMs: number }
  | { type: "transcript.partial"; speaker: Speaker; text: string; turnId: string; atMs: number }
  | { type: "transcript.final"; speaker: Speaker; text: string; turnId: string; startMs: number; endMs: number; uncertain?: boolean }
  | { type: "audio.metric"; speaker: Speaker; metric: AudioMetricSample }
  | { type: "overlap.detected"; initiator: Speaker; startMs: number; durationMs: number }
  | { type: "objection.surfaced"; objectionId: string; turnId: string; atMs: number }
  | { type: "objection.resolved"; objectionId: string; turnId: string; atMs: number }
  | { type: "commitment.recorded"; turnId: string; atMs: number; summary: string }
  | { type: "coach.cue"; atMs: number; cue: string | null }
  | { type: "session.warning"; code: string; recoverable: boolean; message: string; atMs: number }
  | { type: "session.ended"; reason: EndReason; atMs: number };

/** An event with a stable identity so replays and retries cannot double-apply it. */
export type StampedEvent = { eventId: string; seq: number } & CallEvent;

export const SESSION_STATES = [
  "preparing", "connecting", "ready", "agent_speaking", "prospect_thinking", "prospect_speaking",
  "reconnecting", "ending", "evaluating", "complete", "failed_recoverable",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

const LIVE: SessionState[] = ["ready", "agent_speaking", "prospect_thinking", "prospect_speaking"];

/** Allowed transitions. Anything not listed is forbidden and is reported, never silently applied. */
export const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  preparing: ["connecting", "failed_recoverable"],
  connecting: ["ready", "reconnecting", "failed_recoverable", "ending"],
  ready: ["agent_speaking", "prospect_thinking", "prospect_speaking", "reconnecting", "ending", "failed_recoverable"],
  agent_speaking: ["ready", "prospect_thinking", "prospect_speaking", "reconnecting", "ending", "failed_recoverable"],
  prospect_thinking: ["prospect_speaking", "ready", "agent_speaking", "reconnecting", "ending", "failed_recoverable"],
  prospect_speaking: ["ready", "agent_speaking", "prospect_thinking", "reconnecting", "ending", "failed_recoverable"],
  reconnecting: ["ready", "connecting", "failed_recoverable", "ending"],
  ending: ["evaluating", "failed_recoverable", "complete"],
  evaluating: ["complete", "failed_recoverable"],
  complete: [],
  failed_recoverable: ["connecting", "ending", "evaluating"],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isLiveState(s: SessionState): boolean {
  return LIVE.includes(s);
}

/** Plain-language description of what the system is doing, shown in the cockpit at all times. */
export const STATE_COPY: Record<SessionState, { label: string; detail: string }> = {
  preparing: { label: "Preparing", detail: "Loading the scenario and checking your microphone." },
  connecting: { label: "Connecting", detail: "Setting up the live conversation." },
  ready: { label: "Listening", detail: "The line is open. Speak when you are ready." },
  agent_speaking: { label: "You are speaking", detail: "Your words are being transcribed as you go." },
  prospect_thinking: { label: "Prospect is thinking", detail: "Your last turn is being considered." },
  prospect_speaking: { label: "Prospect is speaking", detail: "Speak to interrupt, the way you would on a real call." },
  reconnecting: { label: "Reconnecting", detail: "The connection dropped. Your transcript so far is saved." },
  ending: { label: "Ending the call", detail: "Closing the line and saving the final transcript." },
  evaluating: { label: "Evaluating", detail: "Scoring the call against the rubric with evidence." },
  complete: { label: "Complete", detail: "Your report is ready." },
  failed_recoverable: { label: "Connection problem", detail: "Nothing is lost. You can retry or end the call." },
};

export type Turn = {
  turnId: string; speaker: Speaker; text: string; startMs: number; endMs: number;
  final: boolean; seq: number; uncertain: boolean;
};

export type ObjectionLedgerEntry = {
  objectionId: string; surfacedTurnId: string; surfacedAtMs: number;
  resolvedTurnId: string | null; resolvedAtMs: number | null;
};

export type CallState = {
  session: SessionState;
  connection: ConnectionState;
  speaker: Speaker | "none";
  turns: Record<string, Turn>;
  order: string[]; // turnIds in display order (by startMs, then seq)
  objections: Record<string, ObjectionLedgerEntry>;
  overlaps: { initiator: Speaker; startMs: number; durationMs: number }[];
  commitments: { turnId: string; atMs: number; summary: string }[];
  warnings: { code: string; recoverable: boolean; message: string; atMs: number }[];
  coachCue: string | null;
  endReason: EndReason | null;
  endedAtMs: number | null;
  appliedEventIds: string[];
  lastAtMs: number;
  nextSeq: number;
  forbidden: { from: SessionState; to: SessionState; atMs: number }[];
};

export function initialCallState(session: SessionState = "preparing"): CallState {
  return {
    session, connection: "idle", speaker: "none", turns: {}, order: [], objections: {}, overlaps: [],
    commitments: [], warnings: [], coachCue: null, endReason: null, endedAtMs: null,
    appliedEventIds: [], lastAtMs: 0, nextSeq: 1, forbidden: [],
  };
}

function sortOrder(turns: Record<string, Turn>): string[] {
  return Object.values(turns)
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
    .map((t) => t.turnId);
}

function move(state: CallState, to: SessionState, atMs: number): CallState {
  if (state.session === to) return state;
  if (!canTransition(state.session, to)) {
    return { ...state, forbidden: [...state.forbidden, { from: state.session, to, atMs }] };
  }
  return { ...state, session: to };
}

/**
 * Idempotent, order-tolerant reducer. A duplicate eventId is a no-op; a final
 * transcript replaces any partial for the same turn; a partial that arrives
 * after its final is ignored; timestamps decide display order, not arrival.
 */
export function reduceCallEvent(state: CallState, ev: StampedEvent): CallState {
  if (state.appliedEventIds.includes(ev.eventId)) return state;
  const applied = [...state.appliedEventIds, ev.eventId];
  const atMs = "atMs" in ev ? ev.atMs : "startMs" in ev ? ev.startMs : state.lastAtMs;
  let s: CallState = { ...state, appliedEventIds: applied, lastAtMs: Math.max(state.lastAtMs, atMs) };

  switch (ev.type) {
    case "connection.changed": {
      s = { ...s, connection: ev.state };
      if (ev.state === "connecting" && s.session === "preparing") s = move(s, "connecting", ev.atMs);
      else if (ev.state === "connected" && (s.session === "connecting" || s.session === "reconnecting" || s.session === "failed_recoverable")) s = move(s, "ready", ev.atMs);
      else if (ev.state === "reconnecting" && isLiveState(s.session)) s = move(s, "reconnecting", ev.atMs);
      else if (ev.state === "reconnecting" && s.session === "connecting") s = move(s, "reconnecting", ev.atMs);
      else if (ev.state === "failed" && s.session !== "complete" && s.session !== "evaluating") s = move(s, "failed_recoverable", ev.atMs);
      return s;
    }
    case "speaker.changed": {
      s = { ...s, speaker: ev.speaker };
      if (!isLiveState(s.session)) return s;
      if (ev.speaker === "agent") return move(s, "agent_speaking", ev.atMs);
      if (ev.speaker === "prospect") return move(s, "prospect_speaking", ev.atMs);
      return move(s, "ready", ev.atMs);
    }
    case "transcript.partial": {
      const existing = s.turns[ev.turnId];
      if (existing?.final) return s; // late partial after final: ignore
      const turn: Turn = existing
        ? { ...existing, text: ev.text }
        : { turnId: ev.turnId, speaker: ev.speaker, text: ev.text, startMs: ev.atMs, endMs: ev.atMs, final: false, seq: s.nextSeq, uncertain: false };
      const turns = { ...s.turns, [ev.turnId]: turn };
      s = { ...s, turns, order: sortOrder(turns), nextSeq: existing ? s.nextSeq : s.nextSeq + 1 };
      if (isLiveState(s.session) && ev.speaker === "agent" && s.session !== "agent_speaking") s = move({ ...s, speaker: "agent" }, "agent_speaking", ev.atMs);
      return s;
    }
    case "transcript.final": {
      const existing = s.turns[ev.turnId];
      const turn: Turn = {
        turnId: ev.turnId, speaker: ev.speaker, text: ev.text, startMs: ev.startMs, endMs: ev.endMs,
        final: true, seq: existing?.seq ?? s.nextSeq, uncertain: Boolean(ev.uncertain),
      };
      const turns = { ...s.turns, [ev.turnId]: turn };
      s = { ...s, turns, order: sortOrder(turns), nextSeq: existing ? s.nextSeq : s.nextSeq + 1 };
      if (isLiveState(s.session)) {
        if (ev.speaker === "agent") s = move({ ...s, speaker: "none" }, "prospect_thinking", ev.endMs);
        else s = move({ ...s, speaker: "none" }, "ready", ev.endMs);
      }
      return s;
    }
    case "audio.metric":
      return s; // levels are consumed by the visualizer via refs; the reducer stays cheap
    case "overlap.detected":
      return { ...s, overlaps: [...s.overlaps, { initiator: ev.initiator, startMs: ev.startMs, durationMs: ev.durationMs }] };
    case "objection.surfaced": {
      if (s.objections[ev.objectionId]) return s;
      return { ...s, objections: { ...s.objections, [ev.objectionId]: { objectionId: ev.objectionId, surfacedTurnId: ev.turnId, surfacedAtMs: ev.atMs, resolvedTurnId: null, resolvedAtMs: null } } };
    }
    case "objection.resolved": {
      const entry = s.objections[ev.objectionId];
      if (!entry || entry.resolvedTurnId) return s;
      return { ...s, objections: { ...s.objections, [ev.objectionId]: { ...entry, resolvedTurnId: ev.turnId, resolvedAtMs: ev.atMs } } };
    }
    case "commitment.recorded":
      return { ...s, commitments: [...s.commitments, { turnId: ev.turnId, atMs: ev.atMs, summary: ev.summary }] };
    case "coach.cue":
      return { ...s, coachCue: ev.cue };
    case "session.warning":
      return { ...s, warnings: [...s.warnings.slice(-19), { code: ev.code, recoverable: ev.recoverable, message: ev.message, atMs: ev.atMs }] };
    case "session.ended": {
      s = { ...s, endReason: ev.reason, endedAtMs: ev.atMs, speaker: "none", connection: "closed" };
      if (s.session === "complete" || s.session === "evaluating") return s;
      return move(s, "ending", ev.atMs);
    }
    default:
      return s;
  }
}

export function reduceMany(state: CallState, events: StampedEvent[]): CallState {
  return events.reduce(reduceCallEvent, state);
}

export function finalTurns(state: CallState): Turn[] {
  return state.order.map((id) => state.turns[id]).filter((t) => t.final);
}

export function requiredObjectionProgress(state: CallState, requiredIds: string[]): { surfaced: number; resolved: number; total: number } {
  let surfaced = 0, resolved = 0;
  for (const id of requiredIds) {
    const e = state.objections[id];
    if (e) surfaced += 1;
    if (e?.resolvedTurnId) resolved += 1;
  }
  return { surfaced, resolved, total: requiredIds.length };
}

let counter = 0;
/** Stable-enough ids for client-originated events; server ids come from nanoid. */
export function stampEvent(ev: CallEvent, prefix = "ev"): StampedEvent {
  counter += 1;
  const eventId = `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
  return { eventId, seq: counter, ...ev };
}
