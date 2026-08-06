/**
 * Sam's rule: interviews are not applications.
 *
 * `public.applications` does not only hold applications. It also holds:
 *   - `interview_booking` — a row synthesised from a Calendly booking for someone
 *     who NEVER submitted the apply form (34 rows were backfilled on 2026-08-01
 *     and were being counted as August applications, inflating the month 11 -> 45).
 *   - `test` — e2e / probe rows.
 *
 * Any query that REPORTS AN APPLICATION COUNT, funnel, or applicant feed must
 * filter on this value. Interview surfaces (the interview command center, the
 * Calendly queues, dedupe/data-quality audits) intentionally do NOT filter, because
 * those rows are exactly what they exist to show.
 *
 * Server side the same seam is `public.v_applications_real`, and
 * `public.v_applications_record_type_leak` must always be 0 rows.
 */
export const APPLICATION_RECORD_TYPE = "application";
