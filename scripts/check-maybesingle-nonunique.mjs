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
// on the same line or the line directly above. Lower BASELINE by exactly the
// number paid down in that commit.
//
// Baseline history:
//   2026-08-12 wave-276 initial lock at 82. Distribution: 47 agents.user_id
//   (the MP-275 shape, 4 already converted), 9 plaque_awards (date/week-scoped,
//   measured at 0 live collisions — marker candidates), 11 profiles/applications
//   email incl. 7 pattern-match sites, and a long tail of no-filter reads.

const CATALOG = "scripts/data/unique-index-catalog.json";
const ROOTS = ["src", "supabase/functions"];
const MARKER = "single-row-allow:";
const BASELINE = 82;

// The guard itself and the reusable resolver both discuss .maybeSingle() in prose.
// Narrative files describe history. None are call sites.
const EXEMPT = new Set([
  "scripts/check-maybesingle-nonunique.mjs",
  "supabase/functions/_shared/resolve-one.ts",
  "supabase/functions/_shared/resolve-one.test.ts",
  "src/data/shipped-data.ts",
]);

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
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
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
console.log(
  `maybeSingle audit — unsafe:${count} (baseline ${BASELINE})  safe:${safe}  ` +
    `marked:${marked}  unprovable:${unprovable.length}`,
);
console.log(
  `  catalog snapshot ${catalog._generated_at} · unprovable is its own verdict, not a pass`,
);

if (count > BASELINE) {
  console.error(`\n❌ ${count - BASELINE} new .maybeSingle() call(s) on a non-unique filter.\n`);
  console.error("PostgREST returns data=null when the filter matches >1 row, so an ambiguous");
  console.error("read is indistinguishable from a missing one. Use resolveOne() from");
  console.error("supabase/functions/_shared/resolve-one.ts, or annotate with");
  console.error(`  ${MARKER}<why-one-row-is-guaranteed-here>\n`);
  for (const u of unsafe) console.error(`  ${u.rel}:${u.lineNo} — ${u.why}`);
  process.exit(1);
}

if (count < BASELINE) {
  console.error(
    `\n❌ unsafe count is ${count}, below the baseline of ${BASELINE}. ` +
      `${BASELINE - count} site(s) were paid down — lower BASELINE to ${count} in ` +
      `scripts/check-maybesingle-nonunique.mjs so the ground gained cannot be given back.`,
  );
  process.exit(1);
}

console.log("✅ No new ambiguity-reads-as-absence call sites.");
