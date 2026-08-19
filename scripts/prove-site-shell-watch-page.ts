// MP-307 proof (supersedes MP-306's single-channel version).
//
// Extracts the REAL channel helpers AND the REAL ladder from the deployed
// source by delimiter, compiles them into a temp module, and drives them
// against local stubs. It does NOT eval a type-stripped copy -- stripping TS
// out of a slice is the MP-277 footnote bug waiting to happen (a regex that
// blanks a little too much turns a real call site into a comment and the proof
// still reads green). Both slices are asserted authoritative BEFORE any fixture
// runs: a harness that silently slices nothing passes every test while proving
// none (MP-283).
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
  for (const tok of ["async function pushNtfy", "async function pushDiscord", "fetch(NTFY", "wait=true", "JSON.parse(raw)"]) {
    if (!helpers.includes(tok)) throw new Error(`helper slice missing ${tok}`);
  }
  for (const tok of ["pushNtfy(body)", "pushDiscord(body)", "attempt <= 3", "attempt <= 2", "if (!paged) {", "pageError = errs.length"]) {
    if (!ladder.includes(tok)) throw new Error(`ladder slice missing ${tok}`);
  }
  if (/Deno\.env|import |cron\.job/.test(helpers + ladder)) throw new Error("slice can refetch its own operand");
  console.log(`SLICE OK  helpers=${helpers.split("\n").length}l ladder=${ladder.split("\n").length}l`);
}

type RunOut = {
  paged: boolean; pageError: string | null; pagedVia: string | null; ms: number;
  ntfyCalls: number; discordCalls: number; order: string;
};

const tmp = await Deno.makeTempDir();
let modSeq = 0;

async function build(src: string): Promise<string> {
  const { helpers, ladder } = slices(src);
  const mod = `
export async function drive(
  NTFY: string, DISCORD_ENV: string,
  sql: (p: string, i: RequestInit) => Promise<Response>,
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
  discordCodes: number[],
  opts: { webhook?: string | null } = {},
): Promise<RunOut> {
  hits = [];
  const ac = new AbortController();
  let nN = 0, nD = 0;
  const srv = Deno.serve({ port: 8933, signal: ac.signal, onListen: () => {} }, (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/ntfy")) {
      const c = ntfyCodes[nN] ?? 200; nN++; hits.push("ntfy");
      return new Response(
        c === 200 ? '{"id":"ntfyMSG123","time":1}' : `{"code":42901,"http":${c},"error":"limit reached: request limit"}`,
        { status: c, headers: { "content-type": "application/json" } },
      );
    }
    const c = discordCodes[nD] ?? 200; nD++; hits.push("discord");
    // Discord with ?wait=true answers 200 + the created message object.
    return new Response(
      c === 200 ? '{"id":"1539000000000000001","channel_id":"x"}' : '{"message":"Unknown Webhook","code":10015}',
      { status: c, headers: { "content-type": "application/json" } },
    );
  });

  const f = await build(src);
  const { drive } = await import("file://" + f);
  const settingsRow = opts.webhook === null ? [] : [{ value: "http://localhost:8933/dc" }];
  const sql = () => Promise.resolve(new Response(JSON.stringify(settingsRow), { status: 200 }));
  const t0 = Date.now();
  const out = await drive("http://localhost:8933/ntfy", "", sql, "STUB BODY");
  const ms = Date.now() - t0;
  ac.abort();
  await srv.finished;
  return {
    ...out, ms,
    ntfyCalls: hits.filter((h) => h === "ntfy").length,
    discordCalls: hits.filter((h) => h === "discord").length,
    order: hits.join(","),
  };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  :: ${JSON.stringify(got)}`);
};

// F1: the primary works -> Discord is NEVER touched. A fallback that fires on a
// healthy primary is not a fallback, it is a second pager.
let r = await run(src0, [200], []);
check("F1 ntfy 200 -> paged", r.paged === true, r.paged);
check("F1 receipt is the ntfy message id", r.pagedVia === "ntfy:ntfyMSG123", r.pagedVia);
check("F1 discord NOT called", r.discordCalls === 0, r.discordCalls);
check("F1 one ntfy attempt only", r.ntfyCalls === 1, r.ntfyCalls);
check("F1 no error recorded", r.pageError === null, r.pageError);

// F2: the 2026-08-19 case. ntfy refuses every attempt; Discord saves the page.
r = await run(src0, [429, 429, 429], [200]);
check("F2 ntfy exhausted then discord -> paged", r.paged === true, r.paged);
check("F2 receipt is the discord message id", r.pagedVia === "discord:1539000000000000001", r.pagedVia);
check("F2 ntfy tried exactly 3x", r.ntfyCalls === 3, r.ntfyCalls);
check("F2 ntfy ran BEFORE discord", r.order === "ntfy,ntfy,ntfy,discord", r.order);
// THE LOAD-BEARING ONE. Delivery succeeded, so every incentive is to report a
// clean row -- and that is exactly how a dead pocket-channel hides behind a
// working fallback. The primary's refusals must survive on the record.
check("F2 KEEPS the ntfy failures despite success", String(r.pageError).includes("42901"), r.pageError);
check("F2 records all 3 ntfy attempts", String(r.pageError).includes("3/3"), r.pageError);

// F3: both channels refuse -> honest failure, nothing marked delivered.
r = await run(src0, [429, 429, 429], [500, 500]);
check("F3 all channels refused -> paged false", r.paged === false, r.paged);
check("F3 no receipt invented", r.pagedVia === null, r.pagedVia);
check("F3 discord tried exactly 2x", r.discordCalls === 2, r.discordCalls);
check("F3 error names both channels", /42901/.test(String(r.pageError)) && /discord HTTP 500/.test(String(r.pageError)), r.pageError);

// F4: ntfy refuses twice then lands -> MP-306's fixture still holds, and the
// fallback stays untouched because the primary recovered.
r = await run(src0, [429, 429, 200], [200]);
check("F4 429,429,200 -> paged via ntfy", r.paged === true && String(r.pagedVia).startsWith("ntfy:"), r.pagedVia);
check("F4 discord untouched", r.discordCalls === 0, r.discordCalls);
check("F4 still records the 2 refusals", String(r.pageError).includes("2/3"), r.pageError);

// F5: the webhook cannot be resolved -> a NAMED error, never a silent skip. A
// quietly absent channel is indistinguishable from one that worked.
r = await run(src0, [429, 429, 429], [200], { webhook: null });
check("F5 unresolvable webhook -> paged false", r.paged === false, r.paged);
check("F5 says the webhook is missing", String(r.pageError).includes("no webhook"), r.pageError);
check("F5 did not silently succeed", r.pagedVia === null, r.pagedVia);

// F6: backoff is real, and bounded.
r = await run(src0, [429, 429, 429], [500, 500]);
check("F6 backed off >= 9.5s across both ladders", r.ms >= 9000, r.ms);
check("F6 bounded: 3 ntfy + 2 discord, no more", r.ntfyCalls === 3 && r.discordCalls === 2, [r.ntfyCalls, r.discordCalls]);

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

// M1: clear pageError once the page lands. This is the "tidy row" instinct, and
// it is the whole disease: Discord delivers, the row reads clean, and nobody
// ever learns the pocket channel went dark. F2's key assertion must break.
await mutate(
  "M1 dropping ntfy failures on success",
  '      pageError = errs.length ? errs.join(" | ") : null;',
  '      pageError = paged ? null : (errs.length ? errs.join(" | ") : null);',
  async (m) => {
    const rr = await run(m, [429, 429, 429], [200]);
    return rr.paged === true && !String(rr.pageError).includes("42901");
  },
);

// M2: promote Discord to a peer that always fires. F1's "discord NOT called"
// must break -- otherwise that assertion was decorative.
await mutate(
  "M2 promoting discord to a peer channel",
  "      if (!paged) {\n        for (let attempt = 1; attempt <= 2 && !paged; attempt++) {",
  "      if (true) {\n        for (let attempt = 1; attempt <= 2 && attempt <= 1; attempt++) {",
  async (m) => {
    const rr = await run(m, [200], [200]);
    return rr.discordCalls > 0;
  },
);

// M3: treat a non-2xx Discord answer as delivered (the MP-273 disease: a
// completed round-trip recorded as a send). F3 must break.
await mutate(
  "M3 accepting a refused discord post as delivered",
  '    return { receipt: null, error: `discord HTTP ${res.status}${detail ? " " + detail.slice(0, 200) : ""}` };',
  '    return { receipt: "discord:assumed", error: null };',
  async (m) => {
    const rr = await run(m, [429, 429, 429], [500, 500]);
    return rr.paged === true;
  },
);

await Deno.remove(tmp, { recursive: true });
console.log(`\n${fail === 0 ? "GREEN" : "RED"}  ${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
