import { Navigate, useLocation, useParams } from "react-router-dom";
import { carriedQuery, shortLinkFallbackTarget } from "@/lib/recruitingShortLink";

/**
 * RecruitingShortLink: apex-financial.org/r/:code -> /apply?ref=:code
 *
 * 2026-06-16 Sam directive: "I'm gonna start recruiting in the next ten
 * minutes. Make this shit done ASAP." This component is the short URL
 * Sam can text / DM / paste anywhere. Tap -> applicant lands on /apply
 * with the recruiter already attributed (resolve-ref-slug edge fn picks
 * up the ref slug from the URL, then 63189081's magic-login flow signs
 * them in post-submission so they hit the course in one tap).
 *
 * Works with any case: /r/SJAMES01 · /r/sjames01 · /r/SamJames, all
 * forwarded as-is for the edge fn to resolve. Empty path falls back to
 * the bare /apply page.
 *
 * PUBLIC ROUTE. Mounted outside the authenticated shell in src/App.tsx
 * (next to /plaque/:slug) since 2026-10-15. Before that it sat under
 * AuthenticatedShell, whose ProtectedRoute sent every logged-out tap to
 * /login, and recruits have no login. The visitor's own query string and
 * #hash now ride along (utm_*, source, fbclid); a ?ref= in that query is
 * dropped because the path code is the recruiter.
 */
export function RecruitingShortLink() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const slug = (code ?? "").trim();

  // No tap beacon. One fired here from 2026-06-17 to 2026-10-14 to a
  // short-link-tap function that was never written: every tap sent a CORS
  // preflight that 404'd and recorded nothing. The tap is already a
  // navigation.page_view row in analytics_events (url /r/<code>, with
  // user_agent and created_at), and conversion is on applications.referral_*.

  // Empty code = land on apply with no attribution, keeping whatever the visitor brought.
  if (!slug) return <Navigate to={shortLinkFallbackTarget(location.search, location.hash)} replace />;
  return (
    <Navigate
      to={`/apply?ref=${encodeURIComponent(slug)}${carriedQuery(location.search)}${location.hash}`}
      replace
    />
  );
}

export default RecruitingShortLink;
