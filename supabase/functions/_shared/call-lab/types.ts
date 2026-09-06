/** Call Lab shared types (Deno + browser safe). Mirrors the JSON stored in call_lab_scenarios / call_lab_sessions. */
export type Confidence = "high" | "medium" | "low" | "insufficient_evidence";
export type Evidence = { turnId: string; excerpt: string };
export type ObjectionData = {
  intent: string; underlyingConcern: string; canonicalForms: string[]; variations: string[];
  triggers: { afterPhase?: "open" | "discovery" | "positioning" | "close" | "any"; minAgentTurns?: number; keywords?: string[] };
  difficulty: 1 | 2 | 3; responsePrinciples: string[]; disallowedClaims: string[]; evidenceRefs: string[];
  resolutionChecks: string[]; followUps: { ifWeak: string[]; ifStrong: string[] }; example?: string; category?: string;
};
export type PersonaData = {
  role: string; companyProfile: string; situation: string; currentSolution: string; businessPressure: string; decisionProcess: string;
  knowledgeLevel: string; speakingStyle: string; hiddenPriorities: string[]; hardConstraints: string[]; age?: number;
  voice: { provider: "elevenlabs" | "browser"; voiceId?: string; label: string; pitchHint?: "low" | "mid" | "high" };
};
export type ScenarioData = {
  goal: string; agentGoal: string; prospectGoal: string; winCondition: string; difficulty: 1 | 2 | 3; segment: string; skills: string[];
  estimatedMinutes: number; maxDurationSec: number; difficultyPolicy: string; earlyEndConditions: string[]; allowedReferenceMaterial: string[];
  gradedSummary: string[]; openingLine: string;
};
export type RubricDimension = { id: string; label: string; points: number; description: string; excellent: string };
export type RubricData = {
  dimensions: RubricDimension[];
  objectionStages: { acknowledge: number; clarify: number; isolate: number; respond: number; proof: number; confirm: number };
  passRules: { overallMin: number; requiredObjectionMin: number; complianceMin: number; complianceCriterionId: string; evidenceCoverageMin: number };
  criticalFailureRules: { id: string; label: string; description: string }[];
  deliveryBenchmarks: { wordsPerMinute: [number, number]; fillersPerMinute: number; longestMonologueSec: number; talkRatioAgent: [number, number]; responseLatencyMs: [number, number] };
};
export type AudioAggregate = { meanLevel: number; peakLevel: number; clippedFrames: number; silentFrames: number; levelStdDev: number; qualityConfidence: Confidence };
export type ObjectionScore = {
  surfaced: boolean; resolved: boolean | null; score: number | null; confidence: Confidence;
  stages: { acknowledge: number | null; clarify: number | null; isolate: number | null; respond: number | null; proof: number | null; confirm: number | null };
  evidence: Evidence[]; coaching: string; meetsGate: boolean | null;
};
export type CriticalFailure = { ruleId: string; label: string; confidence: "high" | "medium" | "low"; evidence: Evidence[]; rationale: string; applied: boolean };
export type GateResult = { id: string; label: string; passed: boolean | null; detail: string };
export type CoachingSummary = { strongestBehavior: string; highestLeverageCorrection: string; recommendedDrill: { title: string; sourceObjectionVersionId: string | null; objective: string } };
export type EndReason = "agent_ended" | "earned_next_step" | "max_duration" | "critical_hangup" | "prospect_ended" | "connection_lost" | "provider_error" | "abandoned";
