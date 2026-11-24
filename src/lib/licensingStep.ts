// Licensing check-in (MP-LICENSING-STEP, 2026-11-23): the steps a person can be on and what comes next.
// The values are the ones set_agent_license_progress() accepts; "licensed" is left to staff because that
// function requires an NPN on file and it switches the person's whole account over.

export type LicensingStep =
  | "unlicensed" | "course_purchased" | "finished_course" | "test_scheduled"
  | "failed_test" | "passed_test" | "fingerprints_done" | "waiting_on_license";

export const LICENSING_STEPS: ReadonlyArray<{ value: LicensingStep; label: string; next: string }> = [
  { value: "unlicensed", label: "Not started", next: "Start the pre-licensing course for your state." },
  { value: "course_purchased", label: "In the course", next: "Finish the course. An hour a day gets most people through in a week." },
  { value: "finished_course", label: "Finished the course", next: "Book your state exam now, while the material is fresh." },
  { value: "test_scheduled", label: "Exam booked", next: "Take the practice exams until you pass them twice in a row." },
  { value: "failed_test", label: "Did not pass yet", next: "Rebook the exam this week. Most people pass on the second try." },
  { value: "passed_test", label: "Passed the exam", next: "Get fingerprinted and apply for your license with the state." },
  { value: "fingerprints_done", label: "Fingerprints done", next: "Submit the state license application if you have not yet." },
  { value: "waiting_on_license", label: "Waiting on the license", next: "Tell your manager the day it arrives so your account is switched on." },
];

/** Older records use synonyms the selector no longer writes. */
const ALIAS: Record<string, LicensingStep> = { exam_passed: "passed_test", waiting_fingerprints: "passed_test", course_started: "course_purchased" };

export function normalizeStep(step: string | null | undefined): LicensingStep {
  const s = (step ?? "").trim();
  if (LICENSING_STEPS.some((x) => x.value === s)) return s as LicensingStep;
  return ALIAS[s] ?? "unlicensed";
}

export function stepLabel(step: string | null | undefined): string {
  const v = normalizeStep(step);
  return LICENSING_STEPS.find((x) => x.value === v)?.label ?? "Not started";
}

export function nextStepLine(step: string | null | undefined): string {
  const v = normalizeStep(step);
  return LICENSING_STEPS.find((x) => x.value === v)?.next ?? "";
}
