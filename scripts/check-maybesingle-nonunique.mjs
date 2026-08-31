import fs from "node:fs";
import path from "node:path";

// wave-276 (2026-08-12) — .maybeSingle()-on-a-non-unique-filter ratchet.
//
// Class-of-fix round 12. Companion to wave-16 (internal-nav), 17 (tabnabbing),
// 18/20 (raw-db-slug), 19 (console-in-prod), 21/24 (empty-catch), 22 (debugger),
// 23 (blocking-modal), 25 (raw-SQL-in-JSX), 26 (@ts-ignore), 27 (hex-in-JSX-style),
// 28+ (stale-key-in-list). Same shape: commit-time ratchet, opt-out marker + reason.
//
// THE DISEASE
// PostgREST's .maybeSingle() sets data=null AND error.code='PGRST116' when the
// filter matches MORE than one row. Nearly every caller in this repo destructures
// { data } only and branches on `if (!row)`. So "two rows agree about this person"
// is indistinguishable from "this person does not exist."
//
// It is not hypothetical and it is not cosmetic:
//   - MP-273 (2026-08-11): two profiles rows that AGREED on carrier='tmobile' read
//     as "no carrier on file". The dispatcher recorded 5 SMS as sent that were
//     never attempted. Exactly one phone in the table had that collision — Sam's —
//     and it is the only number the dispatcher ever texts.
//   - MP-275 (2026-08-12): 51 sites doing agents.eq('user_id', uid).maybeSingle().
//     agents is unique on id and agent_code, NOT on user_id. On a duplicate,
//     ProtectedRoute denies the route and post-deal returns "no agent row for
//     caller" at a person who has two.
//
// WHAT COUNTS AS A VIOLATION (the operand, re-measured — do not inherit it)
// MP-275's commit message put this population at 163. That number was inflated and
// this guard deliberately does not reproduce it. Re-measuring against each site's
// ACTUAL predicate instead of a proxy — the same correction that took plaque_awards
// from a claimed 47 collisions to a real 0 — the honest figure is 82:
//   -57  chains carrying .limit(1). limit(1) caps the result set, so multi-match
//        returns one row rather than null. That is a different bug (arbitrary pick
//        without .order()), NOT ambiguity-reads-as-absence. Out of scope here.
//   -2   chains rooted at .rpc(), not .from(). A naive "walk back to the nearest
//        .from()" mis-attributes these to whatever table was read earlier in the
//        same expression. Dashboard.tsx's sync_health_summary was being blamed on
//        lead_purchases.
//   -56  reads whose target is a VIEW, or whose table name is a runtime variable.
//        Reported as `unprovable`, never laundered into pass or fail — a view
//        cannot carry a unique index, but it may still be one-row-per-key by
//        construction, and the catalog cannot answer that. Same three-state
//        discipline as v_bot_alert_delivery_summary's delivered_unprovable
//        (MP-272) and the Stripe verdict's dark_book_empty (MP-269).
//
// A site is UNSAFE when its target is a real table and its equality filters do not
// cover the full column set of any unique index Postgres actually enforces.
//
// TWO THINGS THIS GUARD KNOWS THAT THE OBVIOUS VERSION DOES NOT
//  1. PARTIAL unique indexes are not uniqueness. A partial index constrains only
//     the rows matching its predicate, so an equality filter can still match one
//     in-predicate row and one out. agents.ref_slug is partial — MP-275's own
//     commit message called it unique. 26 of the 495 unique indexes are partial.
//  2. .ilike()/.like() are pattern matches. A unique index on the exact value does
//     not bound them, and this is the SHARPER form of the bug because the unique
//     index gives the author false confidence. resolve-ref-slug does
//     .ilike('agent_code', slug) on a uniquely-indexed column; two agents whose
//     codes differ only in case both match, and the funnel renders "no such agent".
//     Live at time of writing: profiles.email has 8 case-colliding groups and
//     applications.email has 17. agents.agent_code and email_unsubscribes.email
//     have 0 — an "we are emailing unsubscribed people" headline was drafted
//     against that path and killed by measuring it.
//
// WHERE TRUTH LIVES (deliberately split, per MP-271)
// This script reads scripts/data/unique-index-catalog.json — a snapshot, because
// CI has no database. A snapshot can rot, and a guard that silently grades against
// a stale catalog is the fake-success disease wearing a new coat. So:
//   - THIS script is the authority on the repo's current commit. It can never go
//     red because of something that changed in prod.
//   - apex-doctor Check #23 re-queries pg_index weekly and is the authority on
//     deployed state. It goes red when the snapshot drifts.
// Regenerate with: bash scripts/refresh-unique-index-catalog.sh
//
// PAY-DOWN PATTERN
// Convert a site to resolveOne() from supabase/functions/_shared/resolve-one.ts
// (or its src/ equivalent), which returns { row, matched, ambiguous } so the caller
// can branch on ambiguity instead of rendering absence. Or, where a single row is
// genuinely guaranteed by something the catalog cannot see, annotate with
//   single-row-allow:<why-one-row-is-guaranteed-here>
// on the same line or the line directly above. When you pay a site down, run
//   node scripts/check-maybesingle-nonunique.mjs --write-baseline
// to lock the ground in; the guard fails until you do.
//
// Baseline history (a bare total until 2026-08-31; per-site-key after — see the
// MP-356 note further down for why the total alone could be laundered):
//   2026-08-12 wave-276 initial lock at 82. Distribution: 47 agents.user_id
//   (the MP-275 shape, 4 already converted), 9 plaque_awards (date/week-scoped,
//   measured at 0 live collisions — marker candidates), 11 profiles/applications
//   email incl. 7 pattern-match sites, and a long tail of no-filter reads.
//   2026-08-12 wave-277 -> 74. Two corrections in one commit:
//     (a) 82 was never real. The scan ran over raw source, so the phrase
//         ".maybeSingle()" in a CODE COMMENT counted as a call site. Three such
//         comments existed in HEAD (send-sms-auto-detect:213,
//         setup-agent-password:117, stripe-webhook-lead-purchase:215) — one
//         landed in `unsafe` and two in `safe`, so the honest pre-wave figures
//         were unsafe:81 safe:265, not 82/267. stripComments() fixes it at the
//         source. Left unfixed this would have compounded: every wave documents
//         the site it just converted, trading a real violation for a phantom
//         and leaving the number flat while the codebase genuinely improved.
//     (b) all 7 pattern-match sites paid down, 81 -> 74, verified as exactly 7
//         by running the fixed guard against the pre-wave tree.
//   Remaining 74: 47 agents.user_id, 9 plaque_awards, and a tail of no-filter
//   reads. No pattern-match (.ilike/.like) sites remain.

const CATALOG = "scripts/data/unique-index-catalog.json";
const ROOTS = ["src", "supabase/functions"];
const MARKER = "single-row-allow:";
const SITE_BASELINE = "scripts/data/maybesingle-baseline.json";

// The guard itself and the reusable resolver both discuss .maybeSingle() in prose.
// Narrative files describe history. None are call sites.
const EXEMPT = new Set([
  "scripts/check-maybesingle-nonunique.mjs",
  "supabase/functions/_shared/resolve-one.ts",
  "supabase/functions/_shared/resolve-one.test.ts",
  "src/data/shipped-data.ts",
]);

// Blank out COMMENTS ONLY, preserving every byte offset and newline so line
// numbers and lastIndexOf(".from(") arithmetic stay exact.
//
// String literals are skipped over (so a "//" inside "https://esm.sh/..." is not
// mistaken for a comment) but deliberately NOT blanked: the table name in
// .from("profiles") and the column in .eq("user_id", …) are the guard's entire
// input. Erasing them would turn every site into "table name is a variable".
//
// WHY (found 2026-08-12, MP-277, in this guard's own first pay-down): the scan
// used to run over raw source, so the phrase ".maybeSingle()" inside a CODE
// COMMENT counted as a call site. Converting a site and explaining why in the
// comment above it therefore replaced one real violation with one phantom —
// the ratchet read 77 where the truth was 75, and two of the "unprovable"
// entries were prose. Every future wave documents its conversions, so this
// would have inflated a little more each time and quietly stopped measuring.
// A guard that counts its own footnotes is not counting the codebase.
function stripComments(src) {
  const out = src.split("");
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      blank(i, j);
      i = j;
    } else if (two === "/*") {
      let j = src.indexOf("*/", i + 2);
      j = j === -1 ? src.length : j + 2;
      blank(i, j);
      i = j;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      // Skip the literal without altering it.
      const quote = src[i];
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === quote) break;
        else j++;
      }
      i = Math.min(j + 1, src.length);
    } else {
      i++;
    }
  }
  return out.join("");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

if (!fs.existsSync(CATALOG)) {
  console.error(`❌ ${CATALOG} is missing. Run: bash scripts/refresh-unique-index-catalog.sh`);
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const relKind = catalog.relation_kind ?? {};
const fullUnique = new Map(
  Object.entries(catalog.full_unique ?? {}).map(([t, sets]) => [t, sets.map((s) => new Set(s))]),
);

const unsafe = [];
const unprovable = [];
let safe = 0;
let marked = 0;

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const rel = file.split(path.sep).join("/");
  if (EXEMPT.has(rel)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const src = stripComments(raw);
  // Marker lookups read the RAW text — the opt-out annotation lives in a comment.
  const lines = raw.split("\n");
  let i = -1;

  while ((i = src.indexOf(".maybeSingle()", i + 1)) !== -1) {
    const lineNo = src.slice(0, i).split("\n").length;
    const here = lines[lineNo - 1] ?? "";
    const above = lines[lineNo - 2] ?? "";
    if (here.includes(MARKER) || above.includes(MARKER)) {
      marked++;
      continue;
    }

    const fromIdx = src.lastIndexOf(".from(", i);
    const rpcIdx = src.lastIndexOf(".rpc(", i);
    // An .rpc() nearer than .from() means this chain is an RPC, not a table read.
    if (rpcIdx > fromIdx) {
      safe++;
      continue;
    }
    if (fromIdx === -1) {
      unprovable.push({ rel, lineNo, why: "no .from() chain root found" });
      continue;
    }

    const chain = src.slice(fromIdx, i);
    const tm = chain.match(/^\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]/);
    const table = tm ? tm[1] : null;

    if (/\.limit\(\s*1\s*\)/.test(chain)) {
      safe++;
      continue;
    }

    // A write that returns its OWN row is bounded by the write, not by a filter.
    // .insert({...}) / .upsert({...}) of a SINGLE OBJECT returns exactly one row,
    // so .maybeSingle() has nothing to be ambiguous about and there is no filter
    // for a unique index to cover. Grading these on "does an .eq() column match a
    // unique index" asks a question the shape cannot answer, and the answer is
    // always no — so every such site was reported unsafe forever.
    //
    // WHY (found 2026-08-31, MP-356): all 9 "no equality filter" sites in the
    // baseline were this shape — 8 single-object .insert(), 1 .upsert() with
    // onConflict. Zero were genuine unfiltered reads. One of them
    // (provision-agent-accounts:128) pushed the count to 71 and held verify:core
    // RED for 8 commits over correct code, until an unrelated pay-down in another
    // file put the total back to 70 and the accusation was never adjudicated.
    //
    // An ARRAY argument returns one row per element, so it falls through and is
    // still graded (and, having no filter, still reported). A VARIABLE argument
    // could be either, so it is unprovable — never silently called safe.
    const writeArg = chain.match(/\.(insert|upsert)\(\s*([[{]?)/);
    if (writeArg && writeArg[2] !== "[") {
      if (writeArg[2] === "{") {
        safe++;
        continue;
      }
      unprovable.push({
        rel,
        lineNo,
        why: `.${writeArg[1]}() argument is a variable — cannot prove it is a single row`,
      });
      continue;
    }
    if (!table) {
      unprovable.push({ rel, lineNo, why: "table name is a variable or template literal" });
      continue;
    }
    const kind = relKind[table];
    if (kind === undefined) {
      unprovable.push({ rel, lineNo, why: `${table} is not in the public catalog snapshot` });
      continue;
    }
    if (kind !== "r" && kind !== "p") {
      unprovable.push({ rel, lineNo, why: `${table} is a view — cannot carry a unique index` });
      continue;
    }

    const cols = new Set();
    for (const m of chain.matchAll(/\.eq\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g)) cols.add(m[1]);
    for (const m of chain.matchAll(/\.match\(\s*\{([^}]*)\}/g)) {
      for (const km of m[1].matchAll(/["'`]?([A-Za-z0-9_]+)["'`]?\s*:/g)) cols.add(km[1]);
    }
    const fuzzy = [...chain.matchAll(/\.(i?like)\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g)].map(
      (m) => `${m[1]}(${m[2]})`,
    );

    const covered = (fullUnique.get(table) ?? []).some((ix) => [...ix].every((c) => cols.has(c)));
    if (covered && fuzzy.length === 0) {
      safe++;
      continue;
    }
    unsafe.push({
      rel,
      lineNo,
      table,
      why: fuzzy.length
        ? `${table}: ${fuzzy.join("+")} is a pattern match — a unique index on the exact value does not bound it`
        : `${table}(${[...cols].sort().join(",") || "no equality filter"}) matches no full unique index`,
    });
  }
}

const count = unsafe.length;

// ---------------------------------------------------------------------------
// WHY THIS GRADES PER SITE-KEY AND NOT ON THE TOTAL (2026-08-31, MP-356).
//
// This guard used to compare one integer against one BASELINE. An integer is
// FUNGIBLE: it cannot tell "nothing changed" from "one new violation here, one
// unrelated pay-down there". That is not hypothetical — it is what happened:
//
//   b1d38d91 wave-onboarding-accounts  added a site  -> 71, verify:core RED
//   ... 8 commits shipped with the ratchet red ...
//   d4b982c1 "Resolve dashboard agent deterministically"
//                                       paid down an UNRELATED site -> 70, GREEN
//
// The regression was never adjudicated; it was laundered. Worse, the pay-down
// was real ground gained and it got spent absorbing someone else's regression
// instead of ratcheting the floor down to 69. The `count < BASELINE` branch —
// the entire mechanism for locking in gains — is structurally unreachable
// whenever a regression offsets a pay-down, which is exactly when it is needed.
//
// The key is file + table + filter columns, and deliberately carries NO LINE
// NUMBER: MP-355 added one line to DealEntryForm.tsx and moved a site from :92
// to :93 without changing a thing about it. Keying on position would go red on
// every unrelated edit above a site — the permanently-red guard this repo has
// recorded ten costumes of.
const keyOf = (u) => `${u.rel}::${u.why.split(" ")[0]}`;
const observed = new Map();
for (const u of unsafe) observed.set(keyOf(u), (observed.get(keyOf(u)) ?? 0) + 1);

if (process.argv.includes("--write-baseline")) {
  const sites = Object.fromEntries([...observed.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(
    SITE_BASELINE,
    JSON.stringify(
      {
        _why:
          "Floor for check-maybesingle-nonunique.mjs, keyed per file+table+filter so a " +
          "regression in one file cannot be offset by a pay-down in another. No line " +
          "numbers: they shift under unrelated edits. See MP-356 in the guard header.",
        _generated_from_catalog: catalog._generated_at,
        total: count,
        sites,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${SITE_BASELINE}: ${observed.size} site-keys, ${count} sites`);
  process.exit(0);
}

let baseline;
try {
  baseline = new Map(Object.entries(JSON.parse(fs.readFileSync(SITE_BASELINE, "utf8")).sites));
} catch (e) {
  console.error(`\u274c ${SITE_BASELINE} is missing or unreadable (${e.message}).`);
  console.error("It is the floor this guard grades against — without it nothing is measured.");
  process.exit(1);
}

const baselineTotal = [...baseline.values()].reduce((a, b) => a + b, 0);
console.log(
  `maybeSingle audit — unsafe:${count} (baseline ${baselineTotal})  safe:${safe}  ` +
    `marked:${marked}  unprovable:${unprovable.length}`,
);
console.log(
  `  catalog snapshot ${catalog._generated_at} · unprovable is its own verdict, not a pass`,
);
console.log(`  grading ${observed.size} site-keys against ${baseline.size} baselined`);

const regressions = [];
const paydowns = [];
for (const [k, n] of observed) {
  const b = baseline.get(k) ?? 0;
  if (n > b) regressions.push(`${k}: ${b} -> ${n}`);
}
for (const [k, b] of baseline) {
  const n = observed.get(k) ?? 0;
  if (n < b) paydowns.push(`${k}: ${b} -> ${n}`);
}

if (regressions.length) {
  console.error(`\n\u274c ${regressions.length} new .maybeSingle() call(s) on a non-unique filter.\n`);
  console.error("PostgREST returns data=null when the filter matches >1 row, so an ambiguous");
  console.error("read is indistinguishable from a missing one. Use resolveOne() from");
  console.error("supabase/functions/_shared/resolve-one.ts, or annotate with");
  console.error(`  ${MARKER}<why-one-row-is-guaranteed-here>\n`);
  for (const r of regressions) console.error(`  ${r}`);
  for (const u of unsafe) {
    if (regressions.some((r) => r.startsWith(keyOf(u)))) console.error(`    at ${u.rel}:${u.lineNo}`);
  }
  if (paydowns.length) {
    console.error(`\n  (${paydowns.length} unrelated site-key(s) were paid down in the same tree.`);
    console.error("   They do NOT offset the above — that is the whole point of this baseline.)");
  }
  process.exit(1);
}

if (paydowns.length) {
  console.error(
    `\n\u274c ${paydowns.length} site-key(s) were paid down. Update ${SITE_BASELINE} ` +
      `so the ground gained cannot be given back:\n`,
  );
  for (const p of paydowns) console.error(`  ${p}`);
  console.error(`\nRegenerate with: node ${process.argv[1]} --write-baseline`);
  process.exit(1);
}

console.log("\u2705 No new ambiguity-reads-as-absence call sites.");
