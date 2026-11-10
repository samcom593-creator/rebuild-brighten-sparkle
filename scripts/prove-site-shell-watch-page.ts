// MP-SITE-WATCH-EMAIL proof (supersedes MP-307's ntfy+Discord version).
//
// Extracts the REAL channel helpers AND the REAL ladder from the deployed
// source by delimiter, compiles them into a temp module, and drives them
// against local stubs. It does NOT eval a type-stripped copy -- stripping TS
// out of a slice is the MP-277 footnote bug waiting to happen (a regex that
// blanks a little too much turns a real call site into a comment and the proof
// still reads green). Both slices are asserted authoritative BEFORE any fixture
// runs: a harness that silently slices nothing passes every test while proving
// none (MP-283).
//
// 2026-11-10: this harness had been throwing "slice can refetch its own operand"
// since the NTFY_TOKEN read landed inside pushNtfy (MP-NTFY-QUOTA-RELAY), and
// nothing runs it, so nobody saw. The token read now lives at module scope and
// the email sender is handed in by name, so the slice is pure again.
//
//   deno run -A scripts/prove-site-shell-watch-page.ts
const SRC = "supabase/functions/site-shell-watch/index.ts";
const src0 = await Deno.readTextFile(SRC);

function slices(src: string) {
  const ha = src.indexOf("type ChannelResult =");
  const hb = src.indexOf("Deno.serve(async (req) => {");
  const la = src.indexOf("      const errs: string[] = [];");
  const lb = src.indexOf("      // A failed push is a FAILURE, not a page.");
  if (ha < 0 || hb <= ha) throw new Error("HELPER SLICE FAILED - anchors moved");
  if (la < 0 || lb <= la) throw new Error("LADDER SLICE FAILED - anchors moved");
  return { helpers: src.slice(ha, hb), ladder: src.slice(la, lb) };
}

{
  const { helpers, ladder } = slices(src0);
  for (const tok of ["async function pushNtfy", "async function pushEmail", "fetch(NTFY", "JSON.parse(raw)", "sendPageEmail(", "email:${r.id}"]) {
    if (!helpers.includes(tok)) throw new Error(`helper slice missing ${tok}`);
  }
  for (const tok of ["pushNtfy(body)", "pushEmail(body)", "attempt <= 3", "attempt <= 2", "if (!paged) {", "pageError = errs.length"]) {
    if (!ladder.includes(tok)) throw new Error(`ladder slice missing ${tok}`);
  }
  if (/Deno\.env|import |cron\.job/.test(helpers + ladder)) throw new Error("slice can refetch its own operand");
  if (/discord/i.test(helpers.replace(/\/\/[^\n]*/g, "") + ladder.replace(/\/\/[^\n]*/g, ""))) {
    throw new Error("a Discord rung is still live in the ladder code");
  }
  console.log(`SLICE OK  helpers=${helpers.split("\n").length}l ladder=${ladder.split("\n").length}l`);
}

type Outcome = "ok" | "err" | "noid" | "throw";
type RunOut = {
  paged: boolean; pageError: string | null; pagedVia: string | null; ms: number;
  ntfyCalls: number; emailCalls: number; order: string; emailTo: string[] | null;
};

const tmp = await Deno.makeTempDir();
let modSeq = 0;

async function build(src: string): Promise<string> {
  const { helpers, ladder } = slices(src);
  const mod = `
type EmailSendResult = { id: string | null; error: string | null };
export async function drive(
  NTFY: string, NTFY_TOKEN: string, PAGE_EMAIL_TO: string[],
  sendPageEmail: (to: string[], subject: string, text: string) => Promise<EmailSendResult>,
  body: string,
) {
${helpers}
  let paged = false, pageError: string | null = null, pagedVia: string | null = null;
${ladder}
  return { paged, pageError, pagedVia };
}
`;
  const f = `${tmp}/mod${modSeq++}.ts`;
  await Deno.writeTextFile(f, mod);
  return f;
}

let hits: string[] = [];

async function run(
  src: string,
  ntfyCodes: number[],
  emailOutcomes: Outcome[],
  opts: { to?: string[] } = {},
): Promise<RunOut> {
  hits = [];
  const ac = new AbortController();
  let nN = 0, nE = 0;
  let emailTo: string[] | null = null;
  const srv = Deno.serve({ port: 8933, signal: ac.signal, onListen: () => {} }, () => {
    const c = ntfyCodes[nN] ?? 200; nN++; hits.push("ntfy");
    return new Response(
      c === 200 ? '{"id":"ntfyMSG123","time":1}' : `{"code":42901,"http":${c},"error":"limit reached: request limit"}`,
      { status: c, headers: { "content-type": "application/json" } },
    );
  });
  const sendStub = (to: string[]) => {
    hits.push("email"); emailTo = to;
    const o = emailOutcomes[nE] ?? "ok"; nE++;
    if (o === "throw") return Promise.reject(new Error("esm.sh resolution failed"));
    if (o === "err") return Promise.resolve({ id: null, error: "rate_limit_exceeded" });
    if (o === "noid") return Promise.resolve({ id: null, error: null });
    return Promise.resolve({ id: "re_MSG123", error: null });
  };

  const f = await build(src);
  const { drive } = await import("file://" + f);
  const t0 = Date.now();
  const out = await drive("http://localhost:8933/ntfy", "", opts.to ?? ["sam@example.test"], sendStub, "STUB BODY");
  const ms = Date.now() - t0;
  ac.abort();
  await srv.finished;
  return {
    ...out, ms, emailTo,
    ntfyCalls: hits.filter((h) => h === "ntfy").length,
    emailCalls: hits.filter((h) => h === "email").length,
    order: hits.join(","),
  };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  :: ${JSON.stringify(got)}`);
};

// F1: the primary works -> email is NEVER touched. A fallback that fires on a
// healthy primary is not a fallback, it is a second pager.
let r = await run(src0, [200], []);
check("F1 ntfy 200 -> paged", r.paged === true, r.paged);
check("F1 receipt is the ntfy message id", r.pagedVia === "ntfy:ntfyMSG123", r.pagedVia);
check("F1 email NOT called", r.emailCalls === 0, r.emailCalls);
check("F1 one ntfy attempt only", r.ntfyCalls === 1, r.ntfyCalls);
check("F1 no error recorded", r.pageError === null, r.pageError);

// F2: the 2026-08-19 case. ntfy refuses every attempt; email saves the page.
r = await run(src0, [429, 429, 429], ["ok"]);
check("F2 ntfy exhausted then email -> paged", r.paged === true, r.paged);
check("F2 receipt is the Resend message id", r.pagedVia === "email:re_MSG123", r.pagedVia);
check("F2 ntfy tried exactly 3x", r.ntfyCalls === 3, r.ntfyCalls);
check("F2 ntfy ran BEFORE email", r.order === "ntfy,ntfy,ntfy,email", r.order);
check("F2 email went to the configured recipients", JSON.stringify(r.emailTo) === '["sam@example.test"]', r.emailTo);
// THE LOAD-BEARING ONE. Delivery succeeded, so every incentive is to report a
// clean row -- and that is exactly how a dead pocket-channel hides behind a
// working fallback. The primary's refusals must survive on the record.
check("F2 KEEPS the ntfy failures despite success", String(r.pageError).includes("42901"), r.pageError);
check("F2 records all 3 ntfy attempts", String(r.pageError).includes("3/3"), r.pageError);

// F3: both channels refuse -> honest failure, nothing marked delivered.
r = await run(src0, [429, 429, 429], ["err", "err"]);
check("F3 all channels refused -> paged false", r.paged === false, r.paged);
check("F3 no receipt invented", r.pagedVia === null, r.pagedVia);
check("F3 email tried exactly 2x", r.emailCalls === 2, r.emailCalls);
check("F3 error names both channels", /42901/.test(String(r.pageError)) && /email: rate_limit_exceeded/.test(String(r.pageError)), r.pageError);

// F4: ntfy refuses twice then lands -> the fallback stays untouched because the
// primary recovered.
r = await run(src0, [429, 429, 200], ["ok"]);
check("F4 429,429,200 -> paged via ntfy", r.paged === true && String(r.pagedVia).startsWith("ntfy:"), r.pagedVia);
check("F4 email untouched", r.emailCalls === 0, r.emailCalls);
check("F4 still records the 2 refusals", String(r.pageError).includes("2/3"), r.pageError);

// F5: no recipient -> a NAMED error, never a silent skip, and no send attempted.
r = await run(src0, [429, 429, 429], ["ok"], { to: [] });
check("F5 no recipient -> paged false", r.paged === false, r.paged);
check("F5 says no recipient is configured", String(r.pageError).includes("no recipient"), r.pageError);
check("F5 sender never called", r.emailCalls === 0, r.emailCalls);

// F6: backoff is real, and bounded.
r = await run(src0, [429, 429, 429], ["err", "err"]);
check("F6 backed off >= 9.5s across both ladders", r.ms >= 9000, r.ms);
check("F6 bounded: 3 ntfy + 2 email, no more", r.ntfyCalls === 3 && r.emailCalls === 2, [r.ntfyCalls, r.emailCalls]);

// F7: the SDK fails to load (MP-273's esm.sh failure, moved to send time). It
// must be an error on the row, never a crash and never a page.
r = await run(src0, [429, 429, 429], ["throw", "throw"]);
check("F7 SDK load failure -> paged false", r.paged === false, r.paged);
check("F7 failure is recorded, not swallowed", String(r.pageError).includes("esm.sh resolution failed"), r.pageError);

// F8: Resend answers with neither an id nor an error. No id is not a send.
r = await run(src0, [429, 429, 429], ["noid", "noid"]);
check("F8 no message id -> paged false", r.paged === false, r.paged);
check("F8 names the missing id", String(r.pageError).includes("no message id"), r.pageError);

// --------------------------------------------------------------------------
// MUTATION PROOFS. Each asserts the mutation LANDED before believing the
// verdict -- MP-282's red-proof printed GREEN because an unquoted heredoc ate
// the mutation and the test proved nothing.
// --------------------------------------------------------------------------
async function mutate(name: string, from: string, to: string, expectBroken: (m: string) => Promise<boolean>) {
  if (!src0.includes(from)) throw new Error(`${name}: mutation anchor absent -- proof would be vacuous`);
  const m = src0.replace(from, to);
  if (m === src0) throw new Error(`${name}: mutation did not land`);
  const broken = await expectBroken(m);
  console.log(`${broken ? "PASS" : "FAIL"}  ${name} (assertion is load-bearing) :: ${broken}`);
  broken ? pass++ : fail++;
}

// M1: clear pageError once the page lands -- the "tidy row" instinct that hides
// a dead primary behind a working fallback. F2's key assertion must break.
await mutate(
  "M1 dropping ntfy failures on success",
  '      pageError = errs.length ? errs.join(" | ") : null;',
  '      pageError = paged ? null : (errs.length ? errs.join(" | ") : null);',
  async (m) => {
    const rr = await run(m, [429, 429, 429], ["ok"]);
    return rr.paged === true && !String(rr.pageError).includes("42901");
  },
);

// M2: promote email to a peer that always fires. F1's "email NOT called" must
// break -- otherwise that assertion was decorative.
await mutate(
  "M2 promoting email to a peer channel",
  "      if (!paged) {\n        for (let attempt = 1; attempt <= 2 && !paged; attempt++) {",
  "      if (true) {\n        for (let attempt = 1; attempt <= 2 && attempt <= 1; attempt++) {",
  async (m) => {
    const rr = await run(m, [200], ["ok"]);
    return rr.emailCalls > 0;
  },
);

// M3: accept a failed send as delivered (the MP-273 disease: a completed
// round-trip recorded as a send). F3 must break.
await mutate(
  "M3 accepting a failed email as delivered",
  '  if (r.error || !r.id) return { receipt: null, error: `email: ${r.error ?? "no message id"}` };',
  "  if (false) return { receipt: null, error: null };",
  async (m) => {
    const rr = await run(m, [429, 429, 429], ["err", "err"]);
    return rr.paged === true;
  },
);

await Deno.remove(tmp, { recursive: true });
console.log(`\n${fail === 0 ? "GREEN" : "RED"}  ${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
