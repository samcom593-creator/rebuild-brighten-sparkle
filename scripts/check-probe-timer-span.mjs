#!/usr/bin/env node
/**
 * check:probe-timer-span — SupabaseHealthBanner's probe() must not time its own
 * code-loading as database latency.
 *
 * MP-521. probe() arms a 6000ms AbortController and samples performance.now()
 * to produce a "the database is slow/down" verdict. Both used to start ABOVE
 * `await import("@/integrations/supabase/client")`, so the 44,816-byte gz
 * vendor-supabase chunk the probe pulls on its first run was counted as query
 * latency. Measured on the live landing page, where this probe IS the first
 * importer of that chunk: at 2G it computed 5361ms of which 5278ms was its own
 * download and the query took 85ms; on a slower link the import alone blew the
 * 6000ms abort and the banner announced "The database is not answering".
 *
 * Two unit tests cover the import-FAILURE half (they go red on the old
 * ordering). Neither covers the ORDERING half, because making a mocked dynamic
 * import genuinely slow inside vitest's registry is a harness fight, not a
 * product fact. This guard covers it structurally instead: inside probe(), the
 * client import must appear BEFORE the abort timer and before the t0 sample.
 *
 * Deliberately anchored on probe()'s own body rather than the whole file, so an
 * unrelated performance.now() elsewhere in the component cannot fail this.
 */
import { readFileSync } from "node:fs";

const FILE = "src/components/SupabaseHealthBanner.tsx";
const src = readFileSync(FILE, "utf-8");

const fail = (m) => { console.error(`✗ check:probe-timer-span — ${m}`); process.exit(1); };

const startIdx = src.indexOf("const probe = useCallback(");
if (startIdx === -1) fail(`could not find probe() in ${FILE}. If it was renamed, update this guard — do not delete it.`);
// MP-522: this used to look for the literal "\n  }, []);". probe()'s dependency
// array is not a constant of nature -- adding one stable callback to it (which
// MP-522 did) moved the terminator and the guard refused to grade at all. That
// is the honest failure mode rather than a silent wrong slice, but it means any
// correct edit to the deps parks this check red. The anchor is now the SHAPE of
// a useCallback closing at this indentation, with the dep list left free. It is
// still a bounded match -- two-space indent, no nested "]" inside the deps -- so
// it cannot run away and swallow the rest of the file.
const endMatch = /\n {2}\}, \[[^\]]*\]\);/.exec(src.slice(startIdx));
if (!endMatch) fail("could not find the end of probe(); refusing to grade a slice I cannot bound.");
const endIdx = startIdx + endMatch.index;
const body = src.slice(startIdx, endIdx);

// Strip line comments so the prose ABOVE (which necessarily describes the old
// ordering, naming performance.now() and the abort) cannot be read as code.
// This is MP-277's recorded footnote bug: a scanner that reads raw text matches
// its own author.
const code = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const iImport = code.indexOf('import("@/integrations/supabase/client")');
const iAbort  = code.indexOf("ctrl.abort()");
const iT0     = code.indexOf("performance.now()");

// Assert every anchor was found before comparing, so the guard cannot pass on
// three -1s comparing equal — the trap MP-519's mount-position guard recorded.
if (iImport === -1) fail("probe() no longer imports @/integrations/supabase/client — this guard is stale, fix it deliberately.");
if (iAbort === -1)  fail("probe() no longer arms an abort timer; the 6s bound on the query is gone.");
if (iT0 === -1)     fail("probe() no longer samples performance.now(); the latency verdict has no clock.");

if (iImport > iAbort)
  fail(`the abort timer is armed BEFORE the client import (abort@${iAbort} < import@${iImport}).\n` +
       `  A slow chunk download will abort the probe and be reported as the database not answering.\n` +
       `  Move the import above the AbortController, as MP-521 did.`);
if (iImport > iT0)
  fail(`t0 is sampled BEFORE the client import (t0@${iT0} < import@${iImport}).\n` +
       `  Chunk fetch+parse time will be added to the query latency that feeds the >3000ms "slow" bar.\n` +
       `  Sample performance.now() after the import resolves, as MP-521 did.`);

// The import must also not be laundered into the DB verdict when it fails.
if (!/catch\s*\{[^}]*setProbing\(false\)[^}]*return;/s.test(code))
  fail("probe() no longer bails out on a failed client import. An import failure must leave state and failStreak untouched — it is our fault, not the database's.");

console.log(`✓ check:probe-timer-span — client import precedes the abort timer and the latency clock; import failure is not a database verdict`);
