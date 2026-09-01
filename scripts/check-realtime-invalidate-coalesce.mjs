#!/usr/bin/env node
/**
 * check:realtime-invalidate-coalesce — MP-361 (2026-08-31)
 *
 * A useRealtimeTable() subscription whose handler invalidates react-query keys
 * must set `coalesceMs`, or a write burst on the watched table multiplies into
 * a request stampede.
 *
 * WHY. ImoByAgency subscribed to four tables; each row event invalidated four
 * query keys, from a component mounted at three render sites, with no debounce
 * in useRealtimeTable. `deals` is written 11 rows per second in bursts. The
 * edge logs recorded the result: 27 identical GET /v_imo_by_agency inside ONE
 * second. That view costs ~1.9s per read, so the burst queued past the 8s
 * statement timeout — 195 of 269 reads of the view failed with 57014 in 24h.
 *
 * The cost is NOT confined to the surface that causes it. While the database is
 * jammed, unrelated requests time out too: apex-financial.org's PUBLIC
 * landing_live_stats and landing_recent_applicants 500'd inside exactly these
 * windows, which is what apex-site-health.sh had been paging about. Error
 * minutes carry LOW throughput (46-515 requests) while the busiest minute
 * measured (4,606) had zero errors — starvation from burst concurrency.
 *
 * BASELINE IS A SET OF IDENTITIES, NOT A COUNT. MP-356/MP-357: a count-only
 * floor is fungible — a real regression can sit red until an unrelated pay-down
 * absorbs it, and a brand-new violating site passes green as long as the total
 * did not move. Each tolerated site is listed by file + handler name, so a NEW
 * violation fails even when an old one is fixed in the same commit.
 *
 * Comments and string bodies are blanked before matching (MP-277: this file's
 * own prose names `coalesceMs` and `invalidateQueries`, and a raw-source scan
 * would read documentation as code).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const HOOK = "useRealtimeTable";

// Sites that existed when this guard shipped and are tolerated. Adding to this
// list is a deliberate act that shows up in review; it is not a number that
// drifts. Removing one is always allowed.
const BASELINE = new Set(JSON.parse(
  readFileSync("scripts/realtime-coalesce-baseline.json", "utf8"),
).tolerated);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Blank comment and string bodies, preserving offsets and newlines. */
function blank(src) {
  const out = src.split("");
  let i = 0, n = src.length;
  const kill = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; kill(i, j); i = j; continue; }
    if (c === "/" && d === "*") { let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++; kill(i, Math.min(j + 2, n)); i = j + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
      kill(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

/** Read the balanced argument list starting at the '(' index. */
function args(src, open) {
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

const violations = [];
let sites = 0;

for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes(HOOK)) continue;
  const src = blank(raw);
  let idx = 0;
  while ((idx = src.indexOf(HOOK + "(", idx)) !== -1) {
    const open = idx + HOOK.length;
    const body = args(src, open);
    idx = open + 1;
    if (body === null) continue;
    // Skip the hook's own definition/import lines.
    if (/^\s*options\s*:/.test(body) || file.includes("shared/realtime")) continue;
    sites++;
    // Second argument is the handler. Take everything after the first
    // top-level comma that closes the options object.
    const close = body.indexOf("}");
    if (close === -1) continue;
    const opts = body.slice(0, close + 1);
    const handler = body.slice(close + 1).replace(/^\s*,\s*/, "").trim();
    if (!handler) continue;

    // Resolve a named handler to its declaration in the same file.
    let handlerBody = handler;
    const named = handler.match(/^([A-Za-z_$][\w$]*)\s*$/);
    if (named) {
      const decl = new RegExp(`(?:const|function)\\s+${named[1]}\\b[\\s\\S]{0,900}`);
      const m = src.match(decl);
      handlerBody = m ? m[0] : "";
    }
    const invalidates = /invalidateQueries|refetchQueries|\brefetch\s*\(/.test(handlerBody);
    if (!invalidates) continue;
    if (/coalesceMs\s*:/.test(opts)) continue;

    // Key includes the WATCHED TABLE, not just file+handler. Five of the
    // pre-existing sites share one file and one handler name; keying on those
    // alone would let a SIXTH subscription — a new burst source on a new table
    // — inherit the tolerance of the five and pass green. That is the same
    // fungibility MP-356/MP-357 killed in count-only floors, one field over.
    // Read from the RAW source at the same offsets: blank() empties string
    // bodies, so the table name is only legible before blanking.
    const rawOpts = raw.slice(open + 1, open + 1 + close + 1);
    const tableName = (rawOpts.match(/table\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1] || "unknown-table";
    const key = `${file}::${named ? named[1] : "inline"}::${tableName}`;
    if (BASELINE.has(key)) continue;
    const line = raw.slice(0, idx).split("\n").length;
    violations.push({ key, file, line });
  }
}

// A silently truncated population passes every check while proving none
// (MP-283). Refuse to report clean over a scan that clearly failed to run.
if (sites < 20) {
  console.error(`check:realtime-invalidate-coalesce FAILED — only ${sites} subscription sites found; expected >=20. The scan is broken, not the code.`);
  process.exit(1);
}

if (violations.length) {
  console.error(`check:realtime-invalidate-coalesce FAILED — ${violations.length} new subscription(s) invalidate queries with no coalesceMs:`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  (${v.key})`);
  console.error("");
  console.error("Each row event refetches immediately. A write burst on the watched table");
  console.error("multiplies into a request stampede that times out at 57014 and starves");
  console.error("unrelated traffic, including the public landing_* RPCs. Set coalesceMs");
  console.error("on the subscription, or add the key to scripts/realtime-coalesce-baseline.json");
  console.error("with a reason if the handler genuinely needs per-event delivery.");
  process.exit(1);
}

console.log(`check:realtime-invalidate-coalesce OK — ${sites} subscription site(s), ${BASELINE.size} tolerated by name, 0 new.`);
