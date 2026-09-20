export type NormalizedRecoveryStatus =
  | "INITIAL_PREMIUM_FAILED"
  | "PENDING_INITIAL_PREMIUM"
  | "ROLLOVER_INCOMPLETE"
  | "APPLICATION_STARTED"
  | "POLICY_ACTIVE"
  | "POLICY_LAPSED"
  | "POLICY_TERMINATED"
  | "POLICY_CLOSED"
  | "UNDERWRITING_DECLINED"
  | "UNKNOWN_REVIEW";

export type RecoveryLane =
  | "LOW_HANGING"
  | "RECOVERY"
  | "ACTIVE_POLICY_REVIEW"
  | "BLOCKED"
  | "RECOVERED";

export type PriorityBand = "A" | "B" | "C" | "D";
export type ScoreConfidence = "complete" | "partial" | "low";

export type RecoveryScoreInput = {
  rawStatus: string | null | undefined;
  recordDate: string | null | undefined;
  resumeCapable: boolean;
  hasProductSelection: boolean;
  administrativeIssue: boolean;
  hasValidPhone: boolean;
  hasValidEmail: boolean;
  contactBasisConfirmed: boolean;
  lastAttemptAt: string | null | undefined;
  suppressed?: boolean;
  deceased?: boolean;
  probableDuplicate?: boolean;
  complianceReviewRequired?: boolean;
  hasLicensedAgentAvailable?: boolean;
  workflow?: string | null;
};

export type ScoreComponent = {
  key: "intent" | "recency" | "recoverability" | "contactability" | "attemptGap";
  label: string;
  points: number;
  maximum: number;
  reason: string;
};

export type RecoveryScore = {
  status: NormalizedRecoveryStatus;
  score: number;
  band: PriorityBand;
  confidence: ScoreConfidence;
  lane: RecoveryLane;
  eligible: boolean;
  blockReasons: string[];
  components: ScoreComponent[];
  reasons: string[];
};

const DAY_MS = 86_400_000;

function normalizedText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export function normalizeRecoveryStatus(rawStatus: string | null | undefined): NormalizedRecoveryStatus {
  const value = normalizedText(rawStatus);
  if (/premium paying|in force|inforce|active|issued paid/.test(value)) return "POLICY_ACTIVE";
  if (/initial premium.*fail|payment.*fail|draft.*fail|payment declined/.test(value)) return "INITIAL_PREMIUM_FAILED";
  if (/pending.*initial premium|pending.*payment|awaiting.*premium/.test(value)) return "PENDING_INITIAL_PREMIUM";
  if (/rollover.*incomplete|incomplete.*rollover|transfer.*incomplete/.test(value)) return "ROLLOVER_INCOMPLETE";
  if (/underwriting.*declin|declined.*underwriting|uninsurable/.test(value)) return "UNDERWRITING_DECLINED";
  if (/terminat|cancel/.test(value)) return "POLICY_TERMINATED";
  if (/lapse|not taken|not in force/.test(value)) return "POLICY_LAPSED";
  if (/started|application.*progress|in progress|quote started/.test(value)) return "APPLICATION_STARTED";
  if (/closed|withdrawn|expired/.test(value)) return "POLICY_CLOSED";
  return "UNKNOWN_REVIEW";
}

function dateAgeInDays(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed) / DAY_MS));
}

function intentComponent(status: NormalizedRecoveryStatus): ScoreComponent {
  const rules: Record<NormalizedRecoveryStatus, [number, string]> = {
    INITIAL_PREMIUM_FAILED: [35, "Initial premium failed — coverage intent is explicit"],
    PENDING_INITIAL_PREMIUM: [32, "Initial premium is still pending"],
    ROLLOVER_INCOMPLETE: [30, "Rollover was never completed"],
    POLICY_LAPSED: [26, "Previously active policy has lapsed"],
    POLICY_TERMINATED: [26, "Previously active policy was terminated"],
    APPLICATION_STARTED: [22, "Application was started but not completed"],
    POLICY_CLOSED: [10, "Closed record may still be reactivated"],
    UNDERWRITING_DECLINED: [10, "Underwriting decline requires an approved alternative path"],
    UNKNOWN_REVIEW: [10, "Source status needs review"],
    POLICY_ACTIVE: [0, "Active coverage belongs in compliance review"],
  };
  const [points, reason] = rules[status];
  return { key: "intent", label: "Intent", points, maximum: 35, reason };
}

function recencyComponent(recordDate: string | null | undefined, now: Date): ScoreComponent {
  const age = dateAgeInDays(recordDate, now);
  if (age === null) return { key: "recency", label: "Recency", points: 0, maximum: 25, reason: "Record date is missing" };
  if (age <= 3) return { key: "recency", label: "Recency", points: 25, maximum: 25, reason: `${age} days old` };
  if (age <= 7) return { key: "recency", label: "Recency", points: 22, maximum: 25, reason: `${age} days old` };
  if (age <= 14) return { key: "recency", label: "Recency", points: 18, maximum: 25, reason: `${age} days old` };
  if (age <= 30) return { key: "recency", label: "Recency", points: 14, maximum: 25, reason: `${age} days old` };
  if (age <= 60) return { key: "recency", label: "Recency", points: 10, maximum: 25, reason: `${age} days old` };
  if (age <= 180) return { key: "recency", label: "Recency", points: 5, maximum: 25, reason: `${age} days old` };
  return { key: "recency", label: "Recency", points: 0, maximum: 25, reason: `${age} days old — reactivation backlog` };
}

function attemptGapComponent(lastAttemptAt: string | null | undefined, now: Date): ScoreComponent {
  const age = dateAgeInDays(lastAttemptAt, now);
  if (age === null) return { key: "attemptGap", label: "Attempt gap", points: 10, maximum: 10, reason: "No attempt documented" };
  if (age >= 14) return { key: "attemptGap", label: "Attempt gap", points: 10, maximum: 10, reason: `Last attempt was ${age} days ago` };
  if (age >= 7) return { key: "attemptGap", label: "Attempt gap", points: 7, maximum: 10, reason: `Last attempt was ${age} days ago` };
  if (age >= 3) return { key: "attemptGap", label: "Attempt gap", points: 3, maximum: 10, reason: `Last attempt was ${age} days ago` };
  return { key: "attemptGap", label: "Attempt gap", points: 0, maximum: 10, reason: "Attempted within the last 3 days" };
}

export function priorityBand(score: number): PriorityBand {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function isRecoveredWorkflow(workflow: string | null | undefined): boolean {
  return workflow === "PREMIUM_PAYING";
}

export function scoreRecoveryOpportunity(input: RecoveryScoreInput, now = new Date()): RecoveryScore {
  const status = normalizeRecoveryStatus(input.rawStatus);
  const intent = intentComponent(status);
  const recency = recencyComponent(input.recordDate, now);
  const recoverabilityPoints = (input.resumeCapable ? 8 : 0) + (input.hasProductSelection ? 6 : 0) + (input.administrativeIssue ? 6 : 0);
  const recoverability: ScoreComponent = {
    key: "recoverability",
    label: "Recoverability",
    points: recoverabilityPoints,
    maximum: 20,
    reason: [
      input.resumeCapable ? "Application can resume" : null,
      input.hasProductSelection ? "Product and value are known" : null,
      input.administrativeIssue ? "Administrative issue, not underwriting" : null,
    ].filter(Boolean).join(" · ") || "No recoverability signals found",
  };
  const contactabilityPoints = (input.hasValidPhone ? 5 : 0) + (input.hasValidEmail ? 3 : 0) + (input.contactBasisConfirmed ? 2 : 0);
  const contactability: ScoreComponent = {
    key: "contactability",
    label: "Contactability",
    points: contactabilityPoints,
    maximum: 10,
    reason: [
      input.hasValidPhone ? "Valid phone" : null,
      input.hasValidEmail ? "Valid email" : null,
      input.contactBasisConfirmed ? "Contact basis documented" : null,
    ].filter(Boolean).join(" · ") || "No verified contact path",
  };
  const attemptGap = attemptGapComponent(input.lastAttemptAt, now);
  const components = [intent, recency, recoverability, contactability, attemptGap];
  const score = components.reduce((sum, component) => sum + component.points, 0);
  const blockReasons = [
    input.suppressed ? "Suppression or DNC flag" : null,
    input.deceased ? "Customer is deceased" : null,
    input.probableDuplicate ? "Probable duplicate requires resolution" : null,
    status === "UNDERWRITING_DECLINED" ? "Underwriting decline needs an approved alternative path" : null,
    input.hasLicensedAgentAvailable === false ? "No licensed agent is available for the customer state" : null,
    input.complianceReviewRequired ? "Compliance review is required" : null,
  ].filter((reason): reason is string => Boolean(reason));

  const missingSignals = [
    !input.recordDate,
    !input.hasValidPhone && !input.hasValidEmail,
    !input.hasProductSelection,
    input.hasLicensedAgentAvailable === undefined,
  ].filter(Boolean).length;
  const confidence: ScoreConfidence = missingSignals === 0 ? "complete" : missingSignals <= 2 ? "partial" : "low";

  const recovered = isRecoveredWorkflow(input.workflow);
  const eligible = blockReasons.length === 0 && status !== "POLICY_ACTIVE" && !recovered;
  const lane: RecoveryLane = recovered
    ? "RECOVERED"
    : status === "POLICY_ACTIVE"
      ? "ACTIVE_POLICY_REVIEW"
      : blockReasons.length > 0
        ? "BLOCKED"
        : (["INITIAL_PREMIUM_FAILED", "PENDING_INITIAL_PREMIUM", "ROLLOVER_INCOMPLETE", "APPLICATION_STARTED"] as NormalizedRecoveryStatus[]).includes(status) && score >= 60
          ? "LOW_HANGING"
          : "RECOVERY";

  return {
    status,
    score,
    band: priorityBand(score),
    confidence,
    lane,
    eligible,
    blockReasons,
    components,
    reasons: components
      .filter((component) => component.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((component) => component.reason),
  };
}

export function firstAttemptDueAt(assignedAt: string | null | undefined, band: PriorityBand): string | null {
  if (!assignedAt) return null;
  const assigned = new Date(assignedAt);
  if (!Number.isFinite(assigned.getTime())) return null;
  if (band === "A") return new Date(assigned.getTime() + 2 * 60 * 60 * 1000).toISOString();
  if (band === "B") {
    const due = new Date(assigned);
    due.setHours(23, 59, 59, 999);
    return due.toISOString();
  }
  if (band === "C") return new Date(assigned.getTime() + 2 * DAY_MS).toISOString();
  return null;
}
