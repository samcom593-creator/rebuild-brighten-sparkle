#!/usr/bin/env node
/**
 * MP-408 (2026-09-03) — a delivery receipt may not be stamped by something that
 * cannot deliver.
 *
 * THE BUG THIS EXISTS FOR. recover_partial_applications() stamped
 * partial_applications.recovery_sms_sent_at = now() on every abandoned lead,
 * hourly, from cron job 31, across 1,435 successful fires. It has no dispatch
 * mechanism of any kind, cron discards its return value, and all 6 real
 * abandoned humans carrying the marker had ZERO notification_log rows on any
 * channel, ever. The column never once represented a sent SMS.
 *
 * It did not only lie. The function's own eligibility clause was
 * `recovery_sms_sent_at is null`, so stamping it permanently disqualified the
 * row — the day a real sender is wired up it would skip exactly the people it
 * should have contacted first. A false receipt is worse than no receipt,
 * because a false receipt also closes the ticket.
 *
 * WHAT IS GRADED. Every `create [or replace] function` body in
 * supabase/migrations/. If the body WRITES a receipt-named column
 * (`*_sent_at`, `*_sent`, `*_delivered_at`, `*_notified_at`) and contains NO
 * dispatch mechanism, that is a finding.
 *
 * ONLY THE LAST DEFINITION PER FUNCTION NAME IS GRADED. Migrations are
 * append-only history: the pre-MP-408 body of this very function is still in
 * the tree at 20260618110000 and 20260831200100 and always will be. Grading
 * every historical body would pin this guard red forever, which is the
 * permanently-red-guard disease apex-doctor's own Check #19 header warns
 * about — and a guard whose output never changes is one nobody audits.
 *
 * COMMENTS ARE STRIPPED FIRST, AND THAT IS LOAD-BEARING. Three separate
 * predicates in this wave answered TRUE against prose rather than code: one
 * matched the word "email" in a RETURNS TABLE column list, one matched
 * `recovery_sms_sent_at` inside the fix's own comment saying it never writes
 * that column, and MP-277 recorded the same footnote bug a month earlier. A
 * scanner that reads raw source is measuring its own documentation.
 *
 * THIS GUARD IS NOT THE AUTHORITY ON DEPLOYED STATE. Functions in this project
 * are routinely hand-applied through bot-sql and never round-tripped into
 * supabase/migrations, so the tree does not model the database (MP-a71 proved
 * that at 3/3 false). apex-doctor Check #57 queries pg_proc and owns the
 * deployed question. This one owns "no migration in this commit reintroduces
 * the pattern".
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

// A real way to get a message out of Postgres. Deliberately narrow: anything
// not on this list is treated as "cannot dispatch", so an unrecognised
// mechanism is loud rather than silently acquitted.
const DISPATCH = /net\.http_post|net\.http_get|pg_notify|functions\/v1|supabase_functions|perform\s+net\./i;

// Columns whose NAME asserts that something reached a recipient.
const RECEIPT_COL = /\b(\w*(?:_sent_at|_sent|_delivered_at|_delivered|_notified_at))\b/gi;

// Names that read like a receipt but are not one: a queue mark, a request, an
// attempt. Kept explicit so widening this list is a visible decision.
const NOT_A_RECEIPT = new Set(["queued_at", "requested_at", "attempted_at"]);

// AN ATTESTED RECEIPT IS NOT AN UNEARNED ONE, and this is the discriminator
// rather than an allowlist. apex_set_agent_contract_status() stamps
// contract_sent_at and was the guard's first finding — correctly matched, and
// not the bug. It gates on auth.uid(), refuses non-admins, and writes
// contract_sent_by = auth.uid() beside the timestamp: a named human recording
// that THEY sent a carrier contract, out in the world, where the database
// cannot watch. That is attestation.
//
// recover_partial_applications() had no actor at all. SECURITY DEFINER, fired
// by cron with nobody on the other end, stamping "sent" for a message no
// process ever composed. Exempting the file would have made this floor
// fungible — a brand-new unattended stamper could be waved through by adding a
// line to a list. Requiring an authenticated actor cannot be satisfied by an
// unattended cron job, which is exactly the population this guard exists for.
const ATTESTS = /auth\.uid\(\)/i;

export function stripSqlComments(sql) {
  // Order matters: block comments first, then line comments, then string
  // bodies. Strings are blanked (not deleted) so offsets stay sane and a
  // literal containing "--" cannot eat the rest of the line.
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/--[^\n]*/g, "");
  s = s.replace(/'(?:[^']|'')*'/g, (m) => " ".repeat(m.length));
  return s;
}

export function extractFunctionBodies(sql) {
  const clean = stripSqlComments(sql);
  const out = [];
  // $function$ / $$ / $body$ delimited bodies preceded by a CREATE FUNCTION.
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(([\s\S]*?)\)\s*[\s\S]*?(\$[a-z_]*\$)([\s\S]*?)\3/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    out.push({ name: m[1].replace(/"/g, "").replace(/^public\./, ""), body: m[4] });
  }
  return out;
}

export function findings(bodiesByName) {
  const bad = [];
  for (const [name, { body, file }] of bodiesByName) {
    if (DISPATCH.test(body)) continue;
    if (ATTESTS.test(body)) continue; // see ATTESTS: a human is on the hook for this one
    // Only a WRITE counts. Reading a receipt column to decide eligibility is
    // correct and common; stamping one you cannot earn is the defect.
    const writes = [...body.matchAll(/\bset\s+([\s\S]*?)(?=\bwhere\b|\breturning\b|;)/gi)]
      .map((w) => w[1])
      .join(" ");
    const cols = new Set();
    let c;
    RECEIPT_COL.lastIndex = 0;
    while ((c = RECEIPT_COL.exec(writes)) !== null) {
      const col = c[1].toLowerCase();
      if (![...NOT_A_RECEIPT].some((n) => col.endsWith(n))) cols.add(col);
    }
    if (cols.size) bad.push({ name, file, cols: [...cols] });
  }
  return bad;
}

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  // Last definition per name wins — see header.
  const byName = new Map();
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), "utf8");
    for (const fn of extractFunctionBodies(sql)) byName.set(fn.name, { body: fn.body, file: f });
  }
  const bad = findings(byName);
  if (bad.length) {
    console.error(`check:unsent-receipt-marker FAILED — ${bad.length} function(s) stamp a delivery receipt with no way to deliver:\n`);
    for (const b of bad) {
      console.error(`  ${b.name}()  [${b.file}]`);
      console.error(`    writes: ${b.cols.join(", ")}`);
      console.error(`    but its body contains no net.http_post / net.http_get / pg_notify / functions-v1 invoke.`);
      console.error(`    A marker that says "sent" without a send closes the ticket on a lead nobody contacted.`);
      console.error(`    Fix: stamp a *_queued_at column instead, and let whatever actually delivers write the receipt from the provider's response.\n`);
    }
    process.exit(1);
  }
  console.log(`check:unsent-receipt-marker OK — ${byName.size} function definition(s) graded (last-definition-per-name), 0 stamp an unearned delivery receipt.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
