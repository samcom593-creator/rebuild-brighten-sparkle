#!/usr/bin/env node
/**
 * check:anon-table-writes — MP-354 (2026-08-31)
 *
 * THE CLASS. Postgres applies SELECT policies to the rows an UPDATE's WHERE
 * clause has to read. A table that grants the client role INSERT/UPDATE but no
 * SELECT policy therefore accepts an INSERT and silently matches ZERO rows on
 * an UPDATE. PostgREST answers 204 with `content-range: <star>/0`; supabase-js
 * returns no error; the call site sees success. Nothing anywhere goes red.
 *
 * THE INSTANCE. Apply.tsx markAsConverted() did exactly that against
 * partial_applications from the public /apply page, as anon, and had never
 * once landed. 47 of 62 partial applications stayed flagged "abandoned" on
 * DashboardCommandCenter after their owners had completed a full application,
 * each beside a one-click button that would text them about not applying.
 *
 * WHY A GUARD AND NOT JUST A FIX. The same table's partial-save upsert had
 * already been moved to a SECURITY DEFINER RPC for this exact reason, with the
 * reasoning written into a comment directly above the broken call. The comment
 * did not stop the next write. A contract in a comment is not a contract.
 *
 * SCOPE, stated honestly rather than implied: this greps the UNAUTHENTICATED
 * write surfaces only — the files reachable on /apply without a session. It is
 * not a policy-aware analyser and does not claim to be one; a table-by-table
 * RLS check belongs against the live catalog, where apex-doctor can query
 * pg_policy. This catches the shape that actually shipped, in the one place
 * the client runs as anon.
 */
import { readFileSync, existsSync } from "node:fs";

// Public, unauthenticated write surfaces. A file joins this list when it can
// issue a Supabase write with no logged-in user.
const ANON_SURFACES = [
  "src/pages/Apply.tsx",
  "src/pages/apply/QuickQualifyStep.tsx",
];

// `.from("x")` followed by `.update(` / `.upsert(` inside the next 200 chars.
const WRITE = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)\s*(?:\/\/[^\n]*\n|\s)*\.(update|upsert)\(/g;

let violations = 0;
let scanned = 0;

for (const file of ANON_SURFACES) {
  if (!existsSync(file)) {
    console.error(`FAIL: ${file} is on the anon-surface list but does not exist.`);
    console.error("      A renamed file must be re-listed, not silently dropped —");
    console.error("      a guard over an empty population passes while proving nothing.");
    process.exit(1);
  }
  scanned++;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(WRITE)) {
    const line = src.slice(0, m.index).split("\n").length;
    console.error(`FAIL ${file}:${line} — .from("${m[1]}").${m[2]}() runs as anon.`);
    console.error(`     If ${m[1]} has no SELECT policy for anon this write matches zero`);
    console.error(`     rows and reports success. Route it through a SECURITY DEFINER RPC`);
    console.error(`     that returns the affected row count, and read that count.`);
    violations++;
  }
}

if (scanned === 0) {
  console.error("FAIL: scanned 0 anon surfaces — the list is empty, not clean.");
  process.exit(1);
}

if (violations > 0) {
  console.error(`\ncheck:anon-table-writes FAILED — ${violations} direct table write(s) on an anon surface.`);
  process.exit(1);
}

console.log(`check:anon-table-writes OK — ${scanned} anon surface(s), 0 direct table writes.`);
