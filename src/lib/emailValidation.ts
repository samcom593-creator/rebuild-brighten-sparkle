// Email entry hygiene shared by every intake form (apply, contracting, invite, add agent).
//
// A likely typo is a SUGGESTION the person accepts or ignores — never a silent rewrite: an address
// like name@gmai.com can be real, and quietly "fixing" it would send someone's onboarding to a
// stranger. Syntax validity is not proof of ownership or deliverability either; this only catches
// the mistakes that cost us applicants (measured on the Ethos sheet: gmai.com, gmil.com, yahoo.con).

const DOMAIN_FIXES: Record<string, string> = {
  "gmai.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmal.com": "gmail.com",
  "gnail.com": "gmail.com", "gmil.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.con": "gmail.com", "gmali.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outloook.com": "outlook.com", "outlook.con": "outlook.com",
  "iclould.com": "icloud.com", "icloud.co": "icloud.com", "icloud.con": "icloud.com", "aol.co": "aol.com", "aol.con": "aol.com",
};
const BAD_COM = /\.(con|cmo|coom|ocm|comm|cim|vom|xom)$/;

export function normalizeEmailInput(value: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  const e = normalizeEmailInput(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !/\.\./.test(e) && e.length <= 254;
}

/** "name@gmai.com" -> "name@gmail.com"; null when nothing looks wrong. */
export function suggestEmailCorrection(value: string): string | null {
  const e = normalizeEmailInput(value);
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  const domain = e.slice(at + 1);
  const fixed = DOMAIN_FIXES[domain] ?? (BAD_COM.test(domain) ? domain.replace(BAD_COM, ".com") : null);
  return fixed && fixed !== domain ? `${e.slice(0, at)}@${fixed}` : null;
}
