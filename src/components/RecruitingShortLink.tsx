import { Navigate, useParams } from "react-router-dom";

/**
 * RecruitingShortLink — apex-financial.org/r/:code → /apply?ref=:code
 *
 * 2026-06-16 Sam directive: "I'm gonna start recruiting in the next ten
 * minutes. Make this shit done ASAP." This component is the short URL
 * Sam can text / DM / paste anywhere. Tap → applicant lands on /apply
 * with the recruiter already attributed (resolve-ref-slug edge fn picks
 * up the ref slug from the URL, then 63189081's magic-login flow signs
 * them in post-submission so they hit the course in one tap).
 *
 * Works with any case: /r/SJAMES01 · /r/sjames01 · /r/SamJames — all
 * forwarded as-is for the edge fn to resolve. Empty path falls back to
 * the bare /apply page.
 */
export function RecruitingShortLink() {
  const { code } = useParams<{ code: string }>();
  const slug = (code ?? "").trim();

  // No tap beacon. One fired here from 2026-06-17 to 2026-10-14 to a
  // short-link-tap function that was never written: every tap sent a CORS
  // preflight that 404'd and recorded nothing. The tap is already a
  // navigation.page_view row in analytics_events (url /r/<code>, with
  // user_agent and created_at), and conversion is on applications.referral_*.

  // Empty code = land on apply with no attribution
  if (!slug) return <Navigate to="/apply" replace />;
  return <Navigate to={`/apply?ref=${encodeURIComponent(slug)}`} replace />;
}

export default RecruitingShortLink;
