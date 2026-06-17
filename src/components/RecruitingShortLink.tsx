import { useEffect } from "react";
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

  useEffect(() => {
    // Light-touch analytics so Sam can see which short links convert.
    // Fire-and-forget; failures don't block the redirect.
    if (slug) {
      try {
        void fetch("https://xrzweoneiieddzxogewk.supabase.co/functions/v1/short-link-tap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, ts: new Date().toISOString(), ua: navigator.userAgent.slice(0, 200) }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* swallow */
      }
    }
  }, [slug]);

  // Empty code = land on apply with no attribution
  if (!slug) return <Navigate to="/apply" replace />;
  return <Navigate to={`/apply?ref=${encodeURIComponent(slug)}`} replace />;
}

export default RecruitingShortLink;
