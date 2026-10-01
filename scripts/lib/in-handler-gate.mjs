// In-handler gate detection — the single source for "does this edge function
// check its caller's credential in code, above the thing that matters?"
//
// WHY THIS IS A MODULE AND NOT AN INLINE BLOCK: two guards ask this one
// question. check-credential-minting.mjs asks it about functions that mint and
// mail a login credential; check-function-contracts.mjs asks it about functions
// that ship verify_jwt = false. Two derivations of one question drift — the
// recorded cost is curl's --max-time against fn_agentlink_reap_stuck's 300s
// threshold, which disagreed for long enough to send 36 false pages a day.
//
// STATE OF THAT, HONESTLY: only check-function-contracts.mjs imports this
// module today. check-credential-minting.mjs still carries its own copy of the
// CRED table and sharedSecretGateAt, and that copy does NOT have the two
// conventions MP-415 added here (MAC_VERIFY, and the positional `json(body,
// 401)` refusal shape). So the drift this module exists to prevent currently
// EXISTS, in the safe direction: the older copy is the stricter one, so it can
// report a gate as absent on correct code but cannot acquit an ungated minter.
// Migrating it was deliberately not bundled into this wave — it is a green
// security guard, and widening a security gate at the end of a budget is how a
// real hole gets let through (MP-357). The migration owes a pre/post diff of
// that guard's full per-function annotation list, the same blast-radius
// measurement MP-413 shipped as its G3.
//
// KNOWN LIMIT, STATED RATHER THAN CLAIMED AWAY: this proves a refusal is
// WRITTEN and sits at a lower source offset than the protected operation. It
// cannot prove the refusal is reached on every path — an awaited-never
// requireAuth() reads as present too. It is a stronger operand than a name in a
// list, not a proof of correctness.

// Identifiers assigned from an expression matching `probe`, anywhere in the
// file. Bounded at 300 chars so a runaway match cannot swallow the rest of the
// source.
export function boundIdents(code, probe) {
  const out = new Set();
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*([\s\S]{0,300}?);/g)) {
    if (probe.test(m[2])) out.add(m[1]);
  }
  return out;
}

// A refusal is any of the shapes this repo actually uses to turn a caller away.
//
// MP-415: `status: 40x` alone was the whole test, and it is only ONE of the two
// shapes in the tree. brand-photo-upload gates correctly — an x-edit-code
// header compared against BRAND_EDIT_CODE from the environment — and refuses
// with `json({ error: "Wrong code." }, 401)`, a positional second argument to a
// local helper. Grading only `status:` called that function ungated. The cost
// of a gate that is red on correct code is recorded in this repo twice over
// (MP-452, MP-413): it is a gate everybody learns to skip.
const REFUSAL = /status\s*:\s*40[13]\b|,\s*40[13]\s*\)|\bthrow\b/;

export function refusalFollows(code, index, window = 240) {
  return REFUSAL.test(code.slice(index, index + window));
}

// CONVENTION 1 — a credential read off the request through a known helper or
// the Authorization header.
export const CRED_PATTERNS = [
  /requireAuth\s*\(/g,
  // MP-452: createHandler({ requireAuth: true }) makes the WRAPPER call
  // requireAuth(req) before the handler body runs. 6 functions gate this way
  // and every one read as ungated until this was added. Ordering still holds —
  // the opts object is necessarily at a lower offset than the handler.
  /requireAuth\s*:\s*true/g,
  /requireSendAuth\s*\(/g,
  /headers\s*\.\s*get\s*\(\s*["'`]\s*[Aa]uthorization/g,
  /auth\s*\.\s*get(User|Claims)\s*\(/g,
];

// CONVENTION 2 — a shared secret in a custom header, compared against the
// environment.
//
// WHAT IS DELIBERATELY NOT ACCEPTED: a BARE header read is not a gate. MP-357
// proved a security floor can be turned green by allowlisting a bystander, and
// the cheap version of this detector — matching headers.get("x-cron-secret") —
// hands a pass to any function that merely LOOKS at the header and proceeds.
// Three things must all hold, and the offset returned is the COMPARISON, never
// the read: an identifier bound from headers.get(), an identifier bound from
// Deno.env.get(), and an equality between them followed by a refusal.
export function sharedSecretGateAt(code) {
  const headerIds = boundIdents(code, /\bheaders\s*\.\s*get\s*\(/);
  const envIds = boundIdents(code, /Deno\s*\.\s*env\s*\.\s*get\s*\(/);
  if (headerIds.size === 0 || envIds.size === 0) return Infinity;

  let best = Infinity;
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*(?:!==|===|!=|==)\s*([\s\S]{0,120}?)(?:[)&|;\n])/g)) {
    if (!headerIds.has(m[1])) continue;
    // The secret may be the bare identifier or interpolated into a template
    // (`Bearer ${APEX_BOT_TOKEN}`), so the right-hand side is searched for any
    // env-bound name rather than required to equal one.
    let namesSecret = false;
    for (const e of envIds) { if (new RegExp("\\b" + e + "\\b").test(m[2])) { namesSecret = true; break; } }
    if (!namesSecret) continue;
    // A comparison nobody acts on is not a gate.
    if (!refusalFollows(code, m.index)) continue;
    if (m.index < best) best = m.index;
  }
  return best;
}

// CONVENTION 3 — a message authentication code verified against an env secret.
//
// MP-415: youtube-auth was hardened by MP-412 four hours before this module
// existed, with two gates proven live on prod (a derived connect key, and a
// `state` this function signed within 15 minutes). It has no `===` against a
// header anywhere, because the comparison IS the MAC verification — so both
// conventions above read it as completely ungated. Allowlisting it on that
// reading is precisely the hole MP-412 had just closed.
//
// Requires an env-bound secret passed as an argument to a crypto verify/sign
// call, with a refusal following. The secret binding is what makes this a gate
// rather than a hash of attacker-controlled input.
export function macVerifyGateAt(code) {
  const envIds = boundIdents(code, /Deno\s*\.\s*env\s*\.\s*get\s*\(/);
  if (envIds.size === 0) return Infinity;
  const envAlt = [...envIds].map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  let best = Infinity;
  // Either a direct crypto.subtle.verify/sign, or a local helper whose first
  // argument is the env-bound secret (signHex/verifyHex in youtube-auth).
  const pats = [
    new RegExp("crypto\\s*\\.\\s*subtle\\s*\\.\\s*(?:verify|sign)\\s*\\([\\s\\S]{0,200}?\\b(?:" + envAlt + ")\\b", "g"),
    new RegExp("\\b(?:verify|sign)[A-Za-z_$]*\\s*\\(\\s*(?:" + envAlt + ")\\b", "g"),
  ];
  for (const r of pats) {
    for (const m of code.matchAll(r)) {
      if (!refusalFollows(code, m.index, 400)) continue;
      if (m.index < best) best = m.index;
    }
  }
  return best;
}

// Earliest source offset at which any pattern in the list matches, or Infinity.
export function firstOffset(pats, src) {
  let best = Infinity;
  for (const r of pats) {
    r.lastIndex = 0;
    const m = r.exec(src);
    if (m && m.index < best) best = m.index;
  }
  return best;
}

// The earliest offset at which this function refuses an unproven caller by ANY
// known convention, plus which one answered. Infinity => no gate detected.
export function inHandlerGate(code) {
  const legs = {
    CRED: firstOffset(CRED_PATTERNS, code),
    SHARED_SECRET: sharedSecretGateAt(code),
    MAC_VERIFY: macVerifyGateAt(code),
  };
  let offset = Infinity;
  let via = null;
  for (const [name, at] of Object.entries(legs)) {
    if (at < offset) { offset = at; via = name; }
  }
  return { offset, via, legs };
}
