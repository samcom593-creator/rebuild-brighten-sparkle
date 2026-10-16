// Small display helpers for client facts shown on book rows (Book of Business, Book Flips).

/** Whole years between an ISO date of birth and today, or null when it cannot be read. */
export function ageFromDob(dob: string | null | undefined, today: Date = new Date()): number | null {
  const m = dob?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** ISO date of birth as an application form asks for it: MM/DD/YYYY. */
export function dobDisplay(dob: string | null | undefined): string | null {
  const m = dob?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

/** "Mary Ann Smith" -> first "Mary", last "Ann Smith"; blank parts for a missing name. */
export function splitClientName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}
