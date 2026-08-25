import { z } from "zod";

import { resolveBrand } from "@/config/brand";
import { normalizePhoneForDial } from "@/lib/phone";

const brand = resolveBrand();

export type ApexJourneyPath = "licensed" | "unlicensed";

export type RecruitMilestoneTone = "complete" | "progress" | "pending" | "failed" | "ready" | "muted";

export interface RecruitMilestoneStatus {
  label: string;
  tone: RecruitMilestoneTone;
}

export interface RecruitLifecycleInput {
  path: ApexJourneyPath;
  licenseStatus: string | null | undefined;
  licenseProgress: string | null | undefined;
  startedTraining: boolean | null | undefined;
  completedSteps: Iterable<string>;
  lastProgressAt: string;
  now?: Date;
}

export interface RecruitLifecycleSnapshot {
  percentComplete: number;
  welcome: RecruitMilestoneStatus;
  preLicensing: RecruitMilestoneStatus;
  examSchedule: RecruitMilestoneStatus;
  examResult: RecruitMilestoneStatus;
  license: RecruitMilestoneStatus;
  apexTraining: RecruitMilestoneStatus;
  certification: RecruitMilestoneStatus;
  launchReady: RecruitMilestoneStatus;
  firstSale: RecruitMilestoneStatus;
  nextAction: string;
  risk: RecruitMilestoneStatus;
}

export interface ApexJourneyStep {
  key: string;
  label: string;
  description: string;
  successCondition: string;
}

const SHARED_ACTIVATION_STEPS: ApexJourneyStep[] = [
  {
    key: "agentlink",
    label: "Profile & documents",
    description: "Complete the APEX profile, EFT details, E&O coverage, and required documents.",
    successCondition: "Required profile and document fields confirmed",
  },
  {
    key: "signatures",
    label: "Signatures",
    description: "Review and complete required agreements.",
    successCondition: "Required signatures complete",
  },
  {
    key: "contracting",
    label: "Contracting",
    description: "Track carrier requirements through the contracting spreadsheet and private support Discord.",
    successCondition: "Every required carrier is active, submitted, or has a recorded next action",
  },
  {
    key: "community",
    label: "Community",
    description: "Join the required communication channels.",
    successCondition: "Community access confirmed",
  },
  {
    key: "training",
    label: `${brand.platformName} Training`,
    description: "Complete core product, process, and sales preparation.",
    successCondition: "Training owner confirms completion",
  },
  {
    key: "certification",
    label: "Certification",
    description: `Pass the required ${brand.platformName} knowledge and readiness check.`,
    successCondition: "Certification result is recorded",
  },
  {
    key: "launch_ready",
    label: "Launch ready",
    description: "Confirm the required tools, knowledge, and approvals.",
    successCondition: "Launch checklist signed off",
  },
  {
    key: "production",
    label: "Producing",
    description: "Begin the approved prospecting and appointment plan.",
    successCondition: "Activity is visible and coached",
  },
  {
    key: "first_appointment",
    label: "First appointment",
    description: "Complete the first coached client appointment.",
    successCondition: "Appointment recorded and reviewed",
  },
  {
    key: "first_application",
    label: "First application",
    description: "Submit the first client application.",
    successCondition: "Application recorded and reviewed",
  },
  {
    key: "first_sale",
    label: "First sale",
    description: "Complete and review the first production milestone.",
    successCondition: "First sale recorded",
  },
  {
    key: "first_consistent_month",
    label: "First consistent month",
    description: "Complete the first repeatable month of production activity.",
    successCondition: "Consistent production month reviewed",
  },
  {
    key: "first_leadership_responsibility",
    label: "First leadership responsibility",
    description: "Take ownership of an approved coaching, support, or team responsibility.",
    successCondition: "Assigned leader confirms the responsibility",
  },
];

export const APEX_JOURNEY_STEPS: Record<ApexJourneyPath, ApexJourneyStep[]> = {
  licensed: [
    {
      key: "welcome",
      label: "Welcome",
      description: "Confirm the starting point, contact details, and onboarding owner.",
      successCondition: "Onboarding record confirmed",
    },
    ...SHARED_ACTIVATION_STEPS,
  ],
  unlicensed: [
    {
      key: "welcome",
      label: "Welcome",
      description: "Confirm contact details, communication channels, and support owner.",
      successCondition: "Onboarding record confirmed",
    },
    {
      key: "course_active",
      label: "Course active",
      description: "Open the pre-licensing course and begin the study plan.",
      successCondition: "Course access and first activity confirmed",
    },
    {
      key: "exam_ready",
      label: "Exam ready",
      description: "Complete the course and confirm exam readiness.",
      successCondition: "Course complete and readiness confirmed",
    },
    {
      key: "exam_scheduled",
      label: "Exam scheduled",
      description: "Establish and confirm the state exam date.",
      successCondition: "Exam date recorded",
    },
    {
      key: "exam_passed",
      label: "Exam passed",
      description: "Record the successful state exam result.",
      successCondition: "Passing result confirmed",
    },
    {
      key: "licensed",
      label: "Licensed",
      description: "Verify the issued state license before activation.",
      successCondition: "License obtained and verified",
    },
    ...SHARED_ACTIVATION_STEPS,
  ],
};

export const APEX_30_60_90_STEPS: ApexJourneyStep[] = [
  {
    key: "day_30_activated",
    label: "First 30 days",
    description: "Finish onboarding, licensing or verification, systems, contracting, and training.",
    successCondition: "Agent is launch ready",
  },
  {
    key: "day_60_activity",
    label: "Days 31-60",
    description: "Build consistent prospecting, appointment, follow-up, and coaching routines.",
    successCondition: "Weekly activity routine is visible",
  },
  {
    key: "day_90_consistency",
    label: "Days 61-90",
    description: "Improve conversion, product knowledge, and repeatable production activity.",
    successCondition: "Production routine is repeatable",
  },
];

const LICENSE_PROGRESS_ORDER = [
  "unlicensed",
  "course_purchased",
  "finished_course",
  "test_scheduled",
  "failed_test",
  "passed_test",
  "fingerprints_done",
  "waiting_on_license",
  "licensed",
] as const;

function licenseAtOrBeyond(current: string, target: string): boolean {
  const currentIndex = LICENSE_PROGRESS_ORDER.indexOf(current as (typeof LICENSE_PROGRESS_ORDER)[number]);
  const targetIndex = LICENSE_PROGRESS_ORDER.indexOf(target as (typeof LICENSE_PROGRESS_ORDER)[number]);
  return currentIndex >= targetIndex && targetIndex >= 0;
}

/**
 * Builds the master-pipeline cells from recorded facts only. Licensing fields
 * can prove licensing milestones even before a journey ledger exists; post-
 * license milestones require durable apex_agent_journey_steps receipts.
 */
export function buildRecruitLifecycleSnapshot(input: RecruitLifecycleInput): RecruitLifecycleSnapshot {
  const completed = new Set(input.completedSteps);
  const licenseProgress = (input.licenseProgress ?? "unlicensed").toLowerCase();
  const isLicensed = input.licenseStatus === "licensed" || licenseProgress === "licensed";
  const licensedPath = input.path === "licensed";

  const complete = (label = "Complete"): RecruitMilestoneStatus => ({ label, tone: "complete" });
  const pending = (label = "Not started"): RecruitMilestoneStatus => ({ label, tone: "pending" });
  const muted = (label: string): RecruitMilestoneStatus => ({ label, tone: "muted" });

  const welcome = completed.has("welcome") ? complete() : pending();
  const preLicensing: RecruitMilestoneStatus = licensedPath
    ? muted("Not required")
    : licenseAtOrBeyond(licenseProgress, "finished_course")
      ? complete()
      : licenseProgress === "course_purchased"
        ? { label: "In progress", tone: "progress" }
        : pending();
  const examSchedule: RecruitMilestoneStatus = licensedPath
    ? muted("Not required")
    : licenseAtOrBeyond(licenseProgress, "test_scheduled")
      ? complete("Scheduled")
      : pending("Not scheduled");
  const examResult: RecruitMilestoneStatus = licensedPath
    ? muted("Not required")
    : licenseProgress === "failed_test"
      ? { label: "Failed · retest", tone: "failed" }
      : licenseAtOrBeyond(licenseProgress, "passed_test")
        ? complete("Passed")
        : pending("Pending");
  const license: RecruitMilestoneStatus = isLicensed
    ? complete("Verified")
    : licenseProgress === "waiting_on_license"
      ? { label: "Pending", tone: "progress" }
      : pending("Not yet");
  const apexTraining: RecruitMilestoneStatus = completed.has("training")
    ? complete()
    : input.startedTraining
      ? { label: "In progress", tone: "progress" }
      : pending();
  const certification = completed.has("certification") ? complete("Passed") : pending();
  const launchReady: RecruitMilestoneStatus = completed.has("launch_ready") ? { label: "Ready", tone: "ready" } : pending("No");
  const firstSale = completed.has("first_sale") ? complete("Yes") : pending("No");

  const inferredComplete = (key: string): boolean => {
    if (completed.has(key)) return true;
    if (licensedPath && ["course_active", "exam_ready", "exam_scheduled", "exam_passed", "licensed"].includes(key)) return true;
    if (key === "course_active") return licenseAtOrBeyond(licenseProgress, "course_purchased");
    if (key === "exam_ready") return licenseAtOrBeyond(licenseProgress, "finished_course");
    if (key === "exam_scheduled") return licenseAtOrBeyond(licenseProgress, "test_scheduled");
    if (key === "exam_passed") return licenseAtOrBeyond(licenseProgress, "passed_test") && licenseProgress !== "failed_test";
    if (key === "licensed") return isLicensed;
    return false;
  };
  const nextStep = APEX_JOURNEY_STEPS[input.path].find((step) => !inferredComplete(step.key));

  const applicable = licensedPath
    ? [welcome, license, apexTraining, certification, launchReady, firstSale]
    : [welcome, preLicensing, examSchedule, examResult, license, apexTraining, certification, launchReady, firstSale];
  const completedCount = applicable.filter((status) => ["complete", "ready"].includes(status.tone)).length;
  const percentComplete = Math.round((completedCount / applicable.length) * 100);

  const now = input.now ?? new Date();
  const lastProgress = new Date(input.lastProgressAt);
  const elapsedMs = now.getTime() - lastProgress.getTime();
  const daysStalled = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 86_400_000)) : 0;
  const risk: RecruitMilestoneStatus = firstSale.tone === "complete"
    ? { label: "Green · launched", tone: "complete" }
    : daysStalled >= 14
      ? { label: `Red · ${daysStalled}d`, tone: "failed" }
      : daysStalled >= 7
        ? { label: `Yellow · ${daysStalled}d`, tone: "progress" }
        : { label: `Green · ${daysStalled}d`, tone: "complete" };

  return {
    percentComplete,
    welcome,
    preLicensing,
    examSchedule,
    examResult,
    license,
    apexTraining,
    certification,
    launchReady,
    firstSale,
    nextAction: nextStep?.label ?? "Coach consistent production",
    risk,
  };
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export const quickAddAgentSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80).refine(
    (value) => !hasControlCharacter(value),
    "First name contains unsupported characters",
  ),
  lastName: z.string().trim().min(1, "Last name is required").max(80).refine(
    (value) => !hasControlCharacter(value),
    "Last name contains unsupported characters",
  ),
  email: z.string().trim().email("Enter a valid email address").max(254),
  phone: z.string().trim().refine(
    (value) => normalizePhoneForDial(value) !== null,
    "Enter a valid US or international phone number",
  ),
  npn: z.string().trim().min(1, "NPN is required").max(32).refine(
    (value) => /^[0-9]{5,10}$/.test(value.replace(/[^0-9]/g, "")),
    "NPN must be 5 to 10 digits",
  ),
});

export type QuickAddAgentInput = z.infer<typeof quickAddAgentSchema>;

export function normalizeQuickAddAgent(input: QuickAddAgentInput): QuickAddAgentInput {
  const parsed = quickAddAgentSchema.parse(input);
  return {
    ...parsed,
    email: parsed.email.toLowerCase(),
    phone: normalizePhoneForDial(parsed.phone)!,
    npn: parsed.npn.replace(/[^0-9]/g, ""),
  };
}

export type CareerTrack = "producer" | "builder";

export interface ApexCareerLevel {
  level: number;
  title: string;
  producerThreshold: number | null;
  builderThreshold: number | null;
  qualifyingLegs: number;
}

export const APEX_CAREER_LEVELS: ApexCareerLevel[] = [
  { level: 60, title: "Rookie", producerThreshold: null, builderThreshold: null, qualifyingLegs: 0 },
  { level: 80, title: "Associate", producerThreshold: 10_000, builderThreshold: null, qualifyingLegs: 0 },
  { level: 85, title: "Sr. Associate", producerThreshold: 15_000, builderThreshold: 40_000, qualifyingLegs: 0 },
  { level: 90, title: "Partner", producerThreshold: 20_000, builderThreshold: 50_000, qualifyingLegs: 0 },
  { level: 95, title: "Senior Partner", producerThreshold: 25_000, builderThreshold: 60_000, qualifyingLegs: 0 },
  { level: 110, title: "Exec. Partner", producerThreshold: 30_000, builderThreshold: 100_000, qualifyingLegs: 0 },
  { level: 115, title: "Team Leader", producerThreshold: 35_000, builderThreshold: 175_000, qualifyingLegs: 0 },
  { level: 120, title: "Regional", producerThreshold: 50_000, builderThreshold: 250_000, qualifyingLegs: 0 },
  { level: 125, title: "Sr. Regional Director", producerThreshold: 80_000, builderThreshold: 325_000, qualifyingLegs: 0 },
  { level: 130, title: "Vice President", producerThreshold: 400_000, builderThreshold: 400_000, qualifyingLegs: 3 },
  { level: 135, title: "Senior VP", producerThreshold: 525_000, builderThreshold: 525_000, qualifyingLegs: 6 },
  { level: 140, title: "President", producerThreshold: 750_000, builderThreshold: 750_000, qualifyingLegs: 9 },
  { level: 145, title: "Founder", producerThreshold: 1_000_000, builderThreshold: 1_000_000, qualifyingLegs: 12 },
];

export interface CareerQualificationInput {
  track: CareerTrack;
  firstMonthProduction: number;
  secondMonthProduction: number;
  qualifyingLegs: number;
}

export interface CareerQualification {
  current: ApexCareerLevel;
  next: ApexCareerLevel | null;
  twoMonthProduction: number;
  productionRemaining: number;
  legsRemaining: number;
}

export function calculateCareerQualification(input: CareerQualificationInput): CareerQualification {
  const first = Number.isFinite(input.firstMonthProduction) ? Math.max(0, input.firstMonthProduction) : 0;
  const second = Number.isFinite(input.secondMonthProduction) ? Math.max(0, input.secondMonthProduction) : 0;
  const legs = Number.isFinite(input.qualifyingLegs) ? Math.max(0, Math.floor(input.qualifyingLegs)) : 0;
  const twoMonthProduction = Math.min(first, second);

  let current = APEX_CAREER_LEVELS[0];
  for (const level of APEX_CAREER_LEVELS.slice(1)) {
    const threshold = input.track === "producer" ? level.producerThreshold : level.builderThreshold;
    if (threshold === null) continue;
    if (twoMonthProduction >= threshold && legs >= level.qualifyingLegs) current = level;
  }

  const next = APEX_CAREER_LEVELS.find((level) => {
    if (level.level <= current.level) return false;
    return input.track === "producer"
      ? level.producerThreshold !== null
      : level.builderThreshold !== null;
  }) ?? null;
  const nextThreshold = next
    ? input.track === "producer" ? next.producerThreshold : next.builderThreshold
    : null;

  return {
    current,
    next,
    twoMonthProduction,
    productionRemaining: nextThreshold === null ? 0 : Math.max(0, nextThreshold - twoMonthProduction),
    legsRemaining: next ? Math.max(0, next.qualifyingLegs - legs) : 0,
  };
}
