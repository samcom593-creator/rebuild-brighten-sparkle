// The application_status enum members the Call Center is allowed to write.
//
// 2026-08-29 — the Call Center's status dropdown offered
//   ["new", "contacted", "no_pickup", "reviewing", "hired", "rejected"]
// for application leads. "contacted" and "hired" are not members of
// application_status ("hired" belongs to agent_status — the same cross-enum
// mix-up that blanked the Licensed Inbox for three days in July). PostgREST
// coerces the value to the column type, so picking either returned
// 400 / 22P02 and the write never landed. Proven against the live type:
//   select 'hired'::application_status
//   -> invalid input value for enum application_status: "hired"
//
// Contact state is NOT a status on this table. Every read-side filter defines
// "contacted" as `contacted_at IS NOT NULL` (CallCenter.tsx, CallCenterFilters.tsx),
// so the disposition buttons record the timestamp and leave status alone.
//
// This list is the single source the dropdown renders from, and
// scripts/check-enum-filter-literals.mjs validates it against the enum catalog
// so a member cannot be added here without being real.
export const APPLICATION_STATUS_OPTIONS = [
  "new",
  "reviewing",
  "contracting",
  "no_pickup",
  "rejected",
] as const;

// aged_leads.status is plain text with no CHECK, so these are labels, not enum
// members — kept separate precisely so nobody assumes the two tables agree.
export const AGED_LEAD_STATUS_OPTIONS = [
  "new",
  "contacted",
  "no_pickup",
  "hired",
  "bad_applicant",
] as const;
