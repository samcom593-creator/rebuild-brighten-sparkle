// Small display helpers for client facts shown on book rows (Book of Business, Book Flips).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The date of birth when it can be a real one, else null. Carrier books fill a missing DOB with
 * 1900-01-01 (18 book rows on 2026-10-16) and the odd row carries an impossible date; those read
 * as "not on file" instead of a 126-year-old client.
 */
export function realDob(dob: string | null | undefined, today: Date = new Date()): string | null {
  const m = dob?.match(ISO_DATE);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1901 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return iso > todayIso ? null : iso;
}

/** Whole years between an ISO date of birth and today, or null when it cannot be read. */
export function ageFromDob(dob: string | null | undefined, today: Date = new Date()): number | null {
  const m = realDob(dob, today)?.match(ISO_DATE);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Age with the arithmetic shown, the way an agent checks it on a call: "2026 − 1958 = 68", or
 * "2026 − 1958 − 1 = 67 (birthday Nov 3 not yet)" before this year's birthday.
 */
export function ageEquation(dob: string | null | undefined, today: Date = new Date()): { age: number; text: string } | null {
  const m = realDob(dob, today)?.match(ISO_DATE);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const year = today.getFullYear();
  const hadBirthday = today.getMonth() + 1 > mo || (today.getMonth() + 1 === mo && today.getDate() >= d);
  const age = year - y - (hadBirthday ? 0 : 1);
  if (age < 0 || age >= 130) return null;
  return {
    age,
    text: hadBirthday ? `${year} − ${y} = ${age}` : `${year} − ${y} − 1 = ${age} (birthday ${MONTHS[mo - 1]} ${d} not yet)`,
  };
}

/** ISO date of birth as an application form asks for it: MM/DD/YYYY. */
export function dobDisplay(dob: string | null | undefined): string | null {
  const m = realDob(dob)?.match(ISO_DATE);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

/** "Mary Ann Smith" -> first "Mary", last "Ann Smith"; blank parts for a missing name. */
export function splitClientName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}
