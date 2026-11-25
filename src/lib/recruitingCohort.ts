import { z } from "zod";
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  viewer_user_id: z.string(), start: day, end: day, observed_through: z.string().datetime({ offset: true }),
  applications: count, booked: count, linked_producers: count, posted: count, without_producer_link: count,
  basis: z.string(),
}).refine(c => c.booked <= c.applications && c.linked_producers <= c.applications
  && c.posted <= c.linked_producers && c.linked_producers + c.without_producer_link === c.applications,
  "Cohort outcomes must reconcile to the same applicant denominator.");
export type RecruitingCohort = z.infer<typeof schema>;
export function parseRecruitingCohort(value: unknown): RecruitingCohort | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function recordedConversion(numerator: number, applications: number) {
  return applications > 0 && numerator >= 0 && numerator <= applications
    ? Math.round(numerator / applications * 1000) / 10 : null;
}
