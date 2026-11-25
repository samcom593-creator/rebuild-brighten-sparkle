/** Shared search semantics for loaded lead worklists; never searches a preview as if it were the full pool. */
export function matchesLeadQuery(query: string, fields: ReadonlyArray<unknown>, phones: ReadonlyArray<unknown> = []): boolean {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = normalize(query).trim();
  if (!needle) return true;
  if (/^[+\d\s().-]+$/.test(needle)) {
    let digits = needle.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits) return phones.some((phone) => String(phone ?? "").replace(/\D/g, "").includes(digits));
  }
  const text = [...fields, ...phones].map(normalize).join(" ");
  return needle.split(/\s+/).every((term) => text.includes(term));
}

export const LEAD_PAGE_SIZE = 25;
