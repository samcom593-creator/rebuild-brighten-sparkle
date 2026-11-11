// Render-time hygiene for stage emails (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12). Pure.
//
// Every stage footer carried `or <a href="mailto:hello@apex-financial.org?subject=STOP">reply
// STOP</a>`. hello@apex-financial.org does not exist (550 at Google's MX), so "reply STOP"
// bounced and stopped nothing; the unsubscribe link next to it works. PKG1's migration
// removes the mailto from the applicant stage rows; this strip covers every other stage row
// (hire lane, course lane, reactivation) until their owners clean their templates, so no
// email leaves the dispatcher with the dead link.

const DEAD_REPLY_STOP =
  /\s*or\s+<a\s[^>]*href\s*=\s*"mailto:[^"]*@apex-financial\.org[^"]*"[^>]*>\s*reply\s+STOP\s*<\/a>/gi;

export function stripDeadReplyStop(html: string): string {
  return String(html ?? "").replace(DEAD_REPLY_STOP, "");
}

/** True when a rendered body links nowhere (a {{token}} rendered blank inside href). */
export function hasEmptyHref(html: string): boolean {
  return /href\s*=\s*(""|''|"\s+"|'\s+')/i.test(String(html ?? ""));
}
