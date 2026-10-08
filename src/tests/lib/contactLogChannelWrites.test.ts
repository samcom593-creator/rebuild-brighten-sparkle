/**
 * PL-WIB-CONTACT-LOG-CHANNEL (2026-10-08): every write into
 * application_contact_log.channel must be a word its CHECK admits.
 *
 * Four writers sent words the CHECK rejects ('contact', 'recovery_batch',
 * 'stage', 'phone'). Each one raised 23514, and none of them was visible:
 * log_contact_attempt is called `as any`, supabase-js RESOLVES with { error }
 * instead of rejecting, and the callers either ignored the result or wrapped it
 * in a .catch() that cannot see a resolved error. "Mark contacted" on an
 * applied lead had never recorded a contact; the Recovery Batch drawer toasted
 * "Logged: contacted" over a refused write. No compiler sees this, because
 * every one of those words is a valid `text`.
 *
 * The vocabulary is read from scripts/data/enum-catalog.json (check_vocab), the
 * one snapshot of what Postgres accepts, so this test cannot drift from the
 * other vocabulary guards. Apex-doctor's catalog refresh owns that snapshot.
 *
 * A channel that is not a string literal cannot be graded here. Those sites are
 * listed by identity below, each with the reason it is safe, so a NEW
 * non-literal site fails until someone looks at it (a count would let a new
 * one hide behind a removed one).
 *
 * Not graded: a channel spread in from another object (apex-outbox-dispatcher
 * builds `payload` then inserts `...payload`; its channel comes from
 * apex_contact_actions.channel, which is CHECKed to call / sms / email).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments, walk } from "../../../scripts/lib/scan-utils.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/enum-catalog.json"), "utf8"));
const ADMITTED: string[] = catalog.check_vocab["application_contact_log.channel"].members;

/** Non-literal channel expressions, by `file::expression`. Each is typed or sourced from a CHECKed column. */
const NON_LITERAL_REVIEWED: Record<string, string> = {
  "src/pages/CallCenter.tsx::channel": 'parameter typed "call" | "sms" | "email"',
  "src/pages/admin/RecoveryQueue.tsx::channel": 'parameter typed "call" | "sms" | "email"',
  "src/components/pipeline/worklist/useRecruitingWorklist.ts::input.channel": "record_recruiting_outcome refuses any channel outside its own list with invalid_channel, and recruitingQueues.test.ts holds that list inside the CHECK",
  "src/components/unlicensed/RecoveryBatchDrawer.tsx::outcomeChannel(outcome)": 'returns "call" | "sms" | "email" | "note"',
  "src/components/applicants/ApplicationDispositionCluster.tsx::channel": "logContact(channel) parameter, literal call sites graded below",
};
/** DB functions whose channel is a parameter: the CHECK still refuses a bad word, and the caller literals are graded above. */
const DB_NON_LITERAL_REVIEWED = new Set([
  "log_contact_attempt::p_channel",
  "record_recruiting_outcome::p_channel", // raises invalid_channel before the insert
]);

/** RPCs whose p_channel argument is written straight into application_contact_log.channel. */
const CHANNEL_RPCS = ["log_contact_attempt", "record_recruiting_outcome"];

/** Text from the bracket at `open` through its matching close (strings in the scanned source are left intact, so count only brackets). */
function balanced(text: string, open: number): string {
  const pair: Record<string, string> = { "(": ")", "{": "}" };
  const close = pair[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

type Site = { file: string; value: string; literal: boolean };

function valueAfter(text: string, keyRe: RegExp): { value: string; literal: boolean } | null {
  const m = keyRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).trimStart();
  const lit = /^(["'`])([^"'`]*)\1/.exec(rest);
  if (lit) return { value: lit[2], literal: true };
  return { value: rest.split(/[,\n}]/)[0].trim(), literal: false };
}

function clientSites(): Site[] {
  const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "supabase/functions"))]
    .filter((f) => !f.includes(`${path.sep}tests${path.sep}`) && !f.endsWith("shipped-data.ts"));
  const sites: Site[] = [];
  for (const abs of files) {
    const file = path.relative(ROOT, abs);
    const text = stripComments(fs.readFileSync(abs, "utf8"));
    // RPC writer: the p_channel argument of every log_contact_attempt call.
    const rpcRe = new RegExp(`\\(\\s*["'](?:${CHANNEL_RPCS.join("|")})["']\\s*(?:as\\s+\\w+\\s*)?,`, "g");
    for (const m of text.matchAll(rpcRe)) {
      const brace = text.indexOf("{", m.index! + m[0].length);
      if (brace === -1) continue;
      const v = valueAfter(balanced(text, brace), /\bp_channel\s*:/);
      if (v) sites.push({ file, ...v });
    }
    // Direct writer: .from("application_contact_log") ... .insert({ channel }).
    for (const m of text.matchAll(/\.from\(\s*["']application_contact_log["']/g)) {
      const tail = text.slice(m.index!, m.index! + 600);
      const ins = tail.indexOf(".insert(");
      const end = tail.search(/;|\.select\(/);
      if (ins === -1 || (end !== -1 && end < ins)) continue;
      const obj = balanced(tail, ins + ".insert".length);
      const keyed = valueAfter(obj, /\bchannel\s*:/);
      if (keyed) sites.push({ file, ...keyed });
      else if (/[{,]\s*channel\s*[,}]/.test(obj)) sites.push({ file, value: "channel", literal: false });
    }
  }
  return sites;
}

/** Split a SQL tuple body on top-level commas (quotes and parens respected). */
function splitTuple(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, cur = "";
  for (const ch of s) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Newest body of each function in supabase/migrations that inserts into application_contact_log. */
function migrationSites(): { fn: string; value: string; literal: boolean }[] {
  const dir = path.join(ROOT, "supabase/migrations");
  const latest = new Map<string, string>();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, name), "utf8");
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
    for (const m of sql.matchAll(fnRe)) {
      const after = sql.slice(m.index!);
      const tag = /\bas\s+(\$\w*\$)/i.exec(after);
      if (!tag) continue;
      const start = tag.index + tag[0].length;
      const stop = after.indexOf(tag[1], start);
      if (stop === -1) continue;
      latest.set(m[1].toLowerCase(), after.slice(start, stop));
    }
  }
  const sites: { fn: string; value: string; literal: boolean }[] = [];
  for (const [fn, body] of latest) {
    const insRe = /insert\s+into\s+(?:public\.)?application_contact_log\s*\(([^)]*)\)\s*values\s*\(/gi;
    for (const m of body.matchAll(insRe)) {
      const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
      const at = cols.indexOf("channel");
      if (at === -1) continue;
      let depth = 1, i = m.index! + m[0].length;
      const from = i;
      while (i < body.length && depth > 0) { if (body[i] === "(") depth++; if (body[i] === ")") depth--; i++; }
      const val = splitTuple(body.slice(from, i - 1))[at] ?? "";
      const lit = /^'([^']*)'$/.exec(val);
      if (lit) { sites.push({ fn, value: lit[1], literal: true }); continue; }
      // A CASE is graded on every word it can produce.
      if (/^case\b/i.test(val)) {
        for (const r of val.matchAll(/\b(?:then|else)\s+'([^']*)'/gi)) sites.push({ fn, value: r[1], literal: true });
        continue;
      }
      sites.push({ fn, value: val, literal: false });
    }
  }
  return sites;
}

describe("application_contact_log.channel writes use admitted words", () => {
  it("reads a non-empty vocabulary from the catalog", () => {
    expect(ADMITTED).toEqual(expect.arrayContaining(["call", "sms", "email", "note", "manual"]));
  });

  const client = clientSites();
  it("finds the writers it is meant to grade (the scan is not silently empty)", () => {
    expect(client.filter((s) => s.literal).length).toBeGreaterThanOrEqual(5);
    expect(client.some((s) => s.file.endsWith("RecoveryBatchDrawer.tsx"))).toBe(true);
    expect(client.some((s) => s.file.endsWith("UnlicensedAll.tsx"))).toBe(true);
  });

  it("every literal channel in src/ and supabase/functions/ is admitted by the CHECK", () => {
    const refused = client.filter((s) => s.literal && !ADMITTED.includes(s.value)).map((s) => `${s.file}: '${s.value}'`);
    expect(refused).toEqual([]);
  });

  it("every non-literal channel is a reviewed site, and no reviewed site is stale", () => {
    const seen = new Set(client.filter((s) => !s.literal).map((s) => `${s.file}::${s.value}`));
    expect([...seen].filter((k) => !(k in NON_LITERAL_REVIEWED))).toEqual([]);
    expect(Object.keys(NON_LITERAL_REVIEWED).filter((k) => !seen.has(k))).toEqual([]);
  });

  const db = migrationSites();
  it("the newest migration body of every DB writer uses an admitted channel", () => {
    expect(db.some((s) => s.fn === "unified_mark_contacted")).toBe(true);
    const refused = db.filter((s) => s.literal && !ADMITTED.includes(s.value)).map((s) => `${s.fn}: '${s.value}'`);
    expect(refused).toEqual([]);
    const unreviewed = db.filter((s) => !s.literal && !DB_NON_LITERAL_REVIEWED.has(`${s.fn}::${s.value}`));
    expect(unreviewed.map((s) => `${s.fn}::${s.value}`)).toEqual([]);
  });
});
