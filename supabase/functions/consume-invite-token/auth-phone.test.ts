// MP-421. auth.users.phone must never be manufactured by truncation.
//
// THE BUG: consume-invite-token is the ONLY writer of auth.users.phone -- all
// 9 rows in prod carrying a phone have raw_user_meta_data->>'source' =
// 'magic_hire_link'. It built the value as `+1${phone_digits.slice(-10)}`.
// slice(-10) cannot fail, so a hire on +234 806 139 9263 would have been
// written as +1 806 139 9263: area code 806, Amarillo, Texas, a real number
// owned by a stranger -- into a column carrying a UNIQUE index
// (auth.users_phone_key), which then belongs to that stranger's number forever.
//
// Run: deno test --no-check --allow-read supabase/functions/consume-invite-token/auth-phone.test.ts
// Wired: npm run check:deno-tests (verify:core). MP-420 shipped
// nanp-phone.test.ts claiming it stopped the two copies drifting; nothing ran
// it. A contract in a "Run:" comment is not a contract.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nanpTenDigits } from "../_shared/nanp-phone.ts";

const SRC = new URL("./index.ts", import.meta.url);

// Every row auth.users actually holds today, read out of prod 2026-09-04:
// [what the hire submitted (profiles.phone), what auth.users.phone stores].
// Supabase strips the `+` on write, so the stored form is 1XXXXXXXXXX.
const PROD_AUTH_ROWS: [string, string][] = [
  ["6082172346", "16082172346"],
  ["1727250866", "11727250866"],
  ["8622912543", "18622912543"],
  ["2569756155", "12569756155"],
  ["7814625752", "17814625752"],
  ["9063965524", "19063965524"],
  ["2184340641", "12184340641"],
  ["9794124909", "19794124909"],
  ["4147327773", "14147327773"],
];

Deno.test("no regression: every phone auth.users holds today still resolves to the same value", () => {
  for (const [submitted, stored] of PROD_AUTH_ROWS) {
    const ten = nanpTenDigits(submitted);
    assert(ten !== null, `${submitted} must still be accepted -- it is a live row`);
    assertEquals(`1${ten}`, stored, `${submitted} must still produce ${stored}`);
  }
});

// Real applications.phone values from prod. These are the hires this function
// would have restamped as US numbers.
const PROD_NON_NANP: [string, string][] = [
  ["2348061399263", "8061399263"],
  ["4407458992081", "7458992081"],
  ["817018492118", "7018492118"],
  ["628211684958", "8211684958"],
];

Deno.test("an international hire yields NO auth phone rather than a stranger's", () => {
  for (const [stored, strangersNumber] of PROD_NON_NANP) {
    assertEquals(nanpTenDigits(stored), null, `${stored} must be refused`);
    // The old expression, spelled out, so this test can show what it produced.
    const legacy = `+1${stored.replace(/\D/g, "").slice(-10)}`;
    assertEquals(legacy, `+1${strangersNumber}`);
    assert(legacy.length === 12, "and it looked exactly like a valid US number");
  }
});

Deno.test("the function's own gate could only ever reject a number that is too SHORT", () => {
  // phone_digits.length < 10 is the gate consume-invite-token applies before
  // the write. It is satisfied by every value above, which is why it never
  // stopped one. Asserted rather than described.
  for (const [stored] of PROD_NON_NANP) {
    assert(stored.replace(/\D/g, "").length >= 10);
  }
});

Deno.test("the source binds the auth phone from nanpTenDigits and truncates nothing", async () => {
  const src = await Deno.readTextFile(SRC);
  // Comments carry the words `slice(-10)` on purpose (MP-277: a guard that
  // scans raw source counts its own footnotes), so grade code only.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  assert(
    !/\.slice\(\s*-10\s*\)/.test(code),
    "consume-invite-token must not truncate a phone anywhere",
  );
  assert(
    /nanpTenDigits\(\s*body\.phone/.test(code),
    "the auth phone must be bound from nanpTenDigits() on the RAW body value",
  );
  assert(
    /\.\.\.\(\s*authPhone\s*\?/.test(code),
    "a refused phone must be OMITTED from createUser, not defaulted",
  );
});
