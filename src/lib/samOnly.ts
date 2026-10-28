// Shared gate for Sam's private dashboard tools. Database RLS remains authoritative.
export const SAM_EMAILS = new Set<string>([
  "sam.com593@gmail.com",
  "sam@apex-financial.org",
]);

export function isSamEmail(email?: string | null): boolean {
  return Boolean(email && SAM_EMAILS.has(email.toLowerCase()));
}
