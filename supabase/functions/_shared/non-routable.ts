// 2026-10-21 (WIB resend-deliverability): an agent profile on placeholder.apex
// was mailed by numbers-reminder every business day, 27 sends in 30d, 27
// bounced. These domains cannot receive mail, so every send is a guaranteed
// bounce on apex-financial.org's reputation. Refuse before Resend sees it.
// .apex is not a delegated TLD (dig NS apex. is empty while app. answers);
// the rest are reserved by RFC 2606 / 6761.
const NON_ROUTABLE = [/\.apex$/, /(^|\.)example\.(com|net|org)$/, /\.(invalid|test|local|example|localhost)$/];

export function nonRoutableDomain(addr: string): string | null {
  const domain = String(addr ?? "").trim().toLowerCase().split("@")[1]?.replace(/>$/, "") ?? "";
  return domain && NON_ROUTABLE.some((re) => re.test(domain)) ? domain : null;
}
