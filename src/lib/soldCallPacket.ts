// Shared display rules for ReadyMode sold-call booking packets, used by the Sold
// Calls page and the inline SoldCallPanel so both read the same way.
//
// Packets list the fields the transcription could not find as raw keys
// ("policy_number", "beneficiaries[0].dob"). Shown raw, every packet said it still
// needed a policy number from the client, which the carrier assigns after the
// application is submitted. clientAsks() turns the keys into the questions a caller
// actually asks the client and drops the ones the client cannot answer.

const IDX = String.raw`(?:\[\d*\]|\.\d+)?[._]?`;
const ben = (tail: string) => new RegExp(`^beneficiar(?:y|ies)${IDX}${tail}`);

const ASK_LABELS: Array<[RegExp, string]> = [
  [/^client_(first|last)_name$|^client_name$/, "Full legal name"],
  [/^client_dob|^dob$/, "Date of birth"],
  [/^client_email|^email$/, "Email"],
  [/^client_(street|city|zip|state|address)/, "Home address"],
  [/^client_(weight|height)/, "Height and weight"],
  [/^health/, "Health questions"],
  [/^ssn/, "Social Security number"],
  [/^bank_name/, "Bank name"],
  [/^(bank_)?routing/, "Routing number"],
  [/^(bank_account|account_number)/, "Account number"],
  [/^payment_method/, "Checking, savings or card"],
  [/^draft_day/, "Draft day"],
  [/^tobacco/, "Tobacco use"],
  [ben("(dob|dobs|dob_year|birth)"), "Beneficiary date of birth"],
  [ben("(pct|percentage|percentages|split)"), "Beneficiary percentages"],
  [ben("relationship"), "Beneficiary relationship"],
  [ben("(names?)?$"), "Beneficiary name"],
];

// Fields that come from the carrier or the agent, not from the client.
const NOT_FROM_CLIENT = /^(policy_number|carrier|product|face_amount|monthly_premium|policy_start)/;

// "candace_dob" / "carol_ssn": a second person on the application (usually a
// spouse) named by first name in the key.
const PERSON_FIELD = /^([a-z]+)_(dob|ssn)$/;
const PERSON_FIELD_LABEL: Record<string, string> = { dob: "date of birth", ssn: "Social Security number" };
const NOT_A_PERSON = new Set(["client", "beneficiary", "bank"]);

/**
 * The client questions still open on a packet, in a stable order and without
 * duplicates. `hasDialerPhone` drops "phone" when the dialer already holds the
 * number the agent called.
 */
export function clientAsks(missing: string[] | null | undefined, hasDialerPhone: boolean): string[] {
  const out: string[] = [];
  for (const raw of missing ?? []) {
    const key = raw.trim();
    if (!key || NOT_FROM_CLIENT.test(key)) continue;
    if (/^client_phone/.test(key)) {
      if (!hasDialerPhone && !out.includes("Phone number")) out.push("Phone number");
      continue;
    }
    const hit = ASK_LABELS.find(([re]) => re.test(key));
    const person = hit ? null : key.match(PERSON_FIELD);
    const label = hit
      ? hit[1]
      : person && !NOT_A_PERSON.has(person[1])
        ? `${person[1][0].toUpperCase()}${person[1].slice(1)}'s ${PERSON_FIELD_LABEL[person[2]]}`
        : key.replace(/[_[\].]+/g, " ").replace(/\s+/g, " ").trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Fields the agent or carrier still owes, shown separately from client asks. */
export function bookingGaps(missing: string[] | null | undefined): string[] {
  const names: Array<[RegExp, string]> = [
    [/^carrier/, "Carrier"],
    [/^product/, "Product"],
    [/^face_amount/, "Face amount"],
    [/^monthly_premium/, "Monthly premium"],
    [/^policy_start/, "Policy start date"],
  ];
  const out: string[] = [];
  for (const raw of missing ?? []) {
    const hit = names.find(([re]) => re.test(raw.trim()));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

export type NumberField = "ssn" | "bank_routing" | "bank_account";

export const NUMBER_LABEL: Record<NumberField, string> = {
  ssn: "SSN",
  bank_routing: "Routing number",
  bank_account: "Account number",
};

export interface NumberCheck {
  field: NumberField;
  digits: string;
  ok: boolean;
  /** Plain words for the caller when the number cannot be right, e.g. "10 digits, one more than an SSN has". */
  problem: string | null;
}

const howMany = (n: number) => (n === 1 ? "one" : String(n));

/** "SSN", "routing number", "account number": the noun used inside a sentence. */
export const numberNoun = (field: NumberField): string => (field === "ssn" ? "SSN" : NUMBER_LABEL[field].toLowerCase());

/** ABA check digit: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) is a multiple of 10 for every real routing number. */
export function routingChecksumOk(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/**
 * Whether a transcribed SSN, routing or account number can be right. These numbers are heard off the
 * call recording, and 2026-10-16 measured 16 of 85 SSNs at 10 digits, 4 at 7-8, and 8 of 58 routing
 * numbers wrong (4 the wrong length, 4 failing the check digit). A number that fails is still shown,
 * never guessed at or trimmed: the caller confirms it with the client. The same rules run again in
 * booking_packet_fix_number when a corrected number is saved. Returns null when nothing was heard.
 */
export function checkNumber(field: NumberField, value: string | null | undefined): NumberCheck | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = digits.length;
  let problem: string | null = null;
  if (field === "ssn") {
    if (n > 9) problem = `${n} digits, ${howMany(n - 9)} more than an SSN has`;
    else if (n < 9) problem = `${n} digits, ${howMany(9 - n)} fewer than an SSN has`;
    else if (digits.startsWith("000") || digits.startsWith("666")) problem = `starts with ${digits.slice(0, 3)}, which no SSN does`;
    else if (digits.slice(3, 5) === "00") problem = "the middle two digits are 00, which no SSN has";
    else if (digits.endsWith("0000")) problem = "ends in 0000, which no SSN does";
    else if (digits.startsWith("9")) problem = "starts with 9, which is a tax ID (ITIN), not an SSN";
  } else if (field === "bank_routing") {
    if (n !== 9) problem = `${n} digits, and a routing number has 9`;
    else if (!routingChecksumOk(digits)) problem = "fails the bank's check digit, so one digit is wrong";
  } else if (n < 4) {
    problem = `${n} digits, too short for a bank account`;
  } else if (n > 17) {
    problem = `${n} digits, more than any US bank account has (17 at most)`;
  }
  return { field, digits, ok: problem === null, problem };
}

// The generic clientAsks() label for each number, which a "Confirm the ..." ask replaces.
const GENERIC_ASK: Record<NumberField, string> = {
  ssn: "Social Security number",
  bank_routing: "Routing number",
  bank_account: "Account number",
};

/** The client asks with each mis-heard number's "Confirm the ..." line in place of its generic ask. */
export function withNumberAsks(asks: readonly string[], checks: ReadonlyArray<NumberCheck | null | undefined>): string[] {
  const bad = checks.filter((c): c is NumberCheck => !!c && !c.ok);
  const replaced = new Set<string>(bad.map((c) => GENERIC_ASK[c.field]));
  return [...asks.filter((a) => !replaced.has(a)), ...numberAsks(bad)];
}

/** The "Ask the client" line for each number that cannot be right as heard. */
export function numberAsks(checks: ReadonlyArray<NumberCheck | null | undefined>): string[] {
  return checks
    .filter((c): c is NumberCheck => !!c && !c.ok)
    .map((c) => `Confirm the ${numberNoun(c.field)}: ${c.problem}`);
}

/** 9 digits render as 123-45-6789; anything else is shown exactly as transcribed. */
export function formatSsn(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : raw;
}

export function paymentLabel(type: string | null | undefined): string | null {
  switch ((type ?? "").trim().toLowerCase()) {
    case "checking": return "Checking account";
    case "savings": return "Savings account";
    case "card": return "Debit or credit card";
    case "direct_express": return "Direct Express card";
    case "":
    case "unknown": return null;
    default: return type ?? null;
  }
}

/** "1" reads as "1st of the month"; free text ("fourth Wednesday") is kept as said. */
export function draftDayLabel(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (!/^\d{1,2}$/.test(raw)) return raw;
  const n = Number(raw);
  if (n < 1 || n > 31) return raw;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix} of the month`;
}

/** Packet DOBs are ISO dates; show them the way an application form asks. */
export function formatDob(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : raw;
}
