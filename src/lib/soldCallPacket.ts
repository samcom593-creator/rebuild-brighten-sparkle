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
