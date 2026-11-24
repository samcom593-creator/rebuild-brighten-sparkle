/** The same request is used for preview and assignment. Holds are never opt-out. */
export type LeadWorkFilters = {
  caller: string;
  outcome: string;
  touchedAfter: string;
  touchedBefore: string;
  minAttempts: string;
  maxAttempts: string;
  callbackBefore: string;
  sourceFile: string;
  sourceType: string;
  policyStanding: string;
  hold: string;
};

export const EMPTY_WORK_FILTERS: LeadWorkFilters = {
  caller: "", outcome: "", touchedAfter: "", touchedBefore: "", minAttempts: "", maxAttempts: "",
  callbackBefore: "", sourceFile: "", sourceType: "", policyStanding: "", hold: "",
};

export const OUTCOME_OPTIONS = [
  ["never_called", "Never called"], ["unknown", "Dialed, outcome unknown"], ["no_answer", "No answer"], ["voicemail", "Voicemail"],
  ["callback", "Callback"], ["appointment", "Appointment"], ["sold", "Sale reported"],
  ["bank_objection", "Bank objection"], ["no_bank_account", "No bank account"],
  ["ssn_objection", "SSN objection"], ["not_interested", "Not interested"],
  ["bad_number", "Bad number"], ["spanish_speaker", "Spanish speaker"],
  ["gave_up", "Gave up"], ["do_not_call", "Do not call"],
] as const;

export function workFilterParams(value: LeadWorkFilters): Record<string, unknown> {
  const out: Record<string, unknown> = { exclude_dnc: true, exclude_resold: true };
  const texts = { caller: value.caller, source_file: value.sourceFile, source_type: value.sourceType,
    policy_standing: value.policyStanding, hold: value.hold };
  for (const [key, text] of Object.entries(texts)) if (text.trim()) out[key] = text.trim();
  if (value.outcome) out.outcomes = [value.outcome];
  for (const [key, raw] of [["min_attempts", value.minAttempts], ["max_attempts", value.maxAttempts]] as const) {
    if (raw !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0) out[key] = Number(raw);
  }
  // Calendar days are sent unchanged; SQL interprets the interval in America/Phoenix.
  for (const [key, day] of [["touched_after", value.touchedAfter], ["touched_before", value.touchedBefore],
    ["callback_before", value.callbackBefore]] as const) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out[key] = day;
  return out;
}

export function holdLabels(flags: Record<string, unknown>): string[] {
  const labels: string[] = [];
  if (flags.true_dnc === true || (flags.true_dnc == null && flags.dnc === true && flags.current_client !== true)) labels.push("Do not call");
  if (flags.current_client === true) labels.push("Existing client");
  if (flags.in_bundle === true) labels.push("Already assigned");
  if (flags.already_sold === true) labels.push("Previously distributed");
  if (flags.import_review_required === true) labels.push("Import review");
  if (flags.invalid_number === true) labels.push("Invalid number");
  return labels;
}

export const LEAD_PACK_COLUMNS = [
  ["first_name", "First"], ["last_name", "Last"], ["phone10", "Phone"], ["email", "Email"],
  ["state", "State"], ["age", "Age"], ["grade", "Tier"], ["tags", "Tags"], ["status", "Status"],
  ["source_kind", "Pool"], ["source_type", "Source type"], ["source_file", "Source file"],
  ["source_batch_id", "Source batch"], ["policy_ownership_claim", "Ownership evidence"],
  ["last_caller", "Last caller"], ["last_outcome", "Last outcome"], ["last_touched_at", "Last touch"],
  ["attempts", "Attempts"], ["callback_at", "Callback at"], ["next_action", "Next action"],
  ["policy_standing", "Policy standing"], ["policy_carrier", "Reported carrier"],
  ["policy_product", "Reported product"], ["policy_monthly_premium", "Reported monthly premium"],
  ["policy_face_amount", "Reported face amount"], ["last_summary", "Last call summary"],
  ["recording_count", "Recordings"], ["work_history", "Recent work history"], ["call_history", "Recent dialer history"], ["hold_reasons", "Holds"],
] as const;

export type LeadPackRow = Record<string, string | number | boolean | null>;
