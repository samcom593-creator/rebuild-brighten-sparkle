// One licensing-cost policy for every edge function (WP2, onboarding audit 2026-11-10).
//
// MIRRORS src/lib/apexConfig.ts LICENSING_COST (parity test:
// src/tests/config/schedulingLinksParity.test.ts).
//
// Six surfaces disagreed about who pays for the pre-licensing course: "Galaxy pays it",
// "we cover the course", "we reimburse your licensing fees", while the confirmation page
// said "buy the course" to unlock the licensing call. Sam has not answered who pays (AUDIT
// N1), so every surface ships NEUTRAL copy from here and makes no cost claim at all.
// When Sam answers: set whoPays, and seed public.licensing_state_requirements; surfaces
// read v_licensing_cost_public for the numbers.
//
// No remote imports.

export type LicensingCostPayer = "applicant" | "agency" | "reimbursed_after_contracting";

export const LICENSING_COST = {
  /** null until Sam answers N1. Nothing may claim who pays while this is null. */
  whoPays: null as LicensingCostPayer | null,
  /** Short card title. */
  title: "Costs explained up front",
  /** One neutral sentence: no claim about who pays. */
  short: "We walk you through course and exam costs before you buy anything.",
  /** For the gated proof step: the human path before any purchase. */
  askFirst: "Questions about cost before you buy? Ask us first.",
} as const;
