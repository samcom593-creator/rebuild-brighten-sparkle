import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// wave-discord-client-pii (2026-08-11) — client PII must never reach a webhook.
//
// trg_fn_deal_celebration built its Discord embed title out of
// NEW.client_first_name || NEW.client_last_name, so every "first deal of the
// day" and every deal >= $3,000 AOP named a real life-insurance customer in a
// chat channel, next to the carrier, product, premium and effective date.
// Measured at the time of the fix: webhook SET, trigger ENABLED, 464 of 1,759
// deals matching the gate (77 in the trailing 30 days), and Discord's 204
// success recorded in net._http_response at 2026-08-11T03:58:35Z. Live, not
// theoretical.
//
// Why a guard and not just the fix: the leak was one `format()` argument in a
// 90-line trigger body. Nothing about it looked dangerous, nothing failed, and
// no test could notice — the post SUCCEEDS. Only a reader who happened to ask
// "whose name is this?" would ever catch it. That is exactly the shape that
// comes back.
//
// SCOPE — this checks what a COMMIT INTRODUCES, and nothing else.
//
// The first cut of this guard replayed every migration in version order, kept
// the last definition of each function, and checked those. It reported three
// violations. All three were false against the live database: one
// (trg_fn_chargeback_alert) does not exist in pg_proc at all, and the other two
// (data_quality_audit, trg_fn_deal_status_transition) have since been redefined
// live with neither the PII nor the sink. supabase/migrations is NOT a faithful
// model of this database — a large share of its functions were hand-applied
// through bot-sql and never round-tripped into a file. A guard built on that
// model starts red on history it cannot fix, and a permanently red guard is a
// guard everybody learns to skip.
//
// So the division of labour is:
//   * THIS script (commit-time, zero network): no NEW or MODIFIED migration may
//     introduce a function that hands client PII to an outbound sink. It reads
//     only the files in the commit, so it can never be red about history.
//   * apex-doctor Check #16 (live, weekly): queries pg_proc directly and is the
//     authority on what is actually deployed — including everything applied by
//     hand that never passed through this repo.
//
// Detection: a function definition inside a checked file fails when it contains
// both (a) an outbound sink and (b) a client-PII column reference. This is
// about the SINK, not PII in general — a function may freely read client_phone
// to write it to another internal table; it may not hand it to something that
// leaves the database.
//
// Opt-out: `discord-pii-allow:<reason>` anywhere in the function body. There is
// no legitimate case today; the marker exists so a future genuine one (say, a
// private compliance channel under a signed agreement) is declared in writing
// at the call site rather than by deleting this guard.
//
// Usage:
//   node scripts/check-discord-pii.mjs                 # staged migrations
//   node scripts/check-discord-pii.mjs <file.sql> ...  # explicit files

const repoRoot = path.resolve(import.meta.dirname, "..");

// Columns on public.deals that identify the insured human being.
const PII_COLUMNS = [
  "client_first_name",
  "client_last_name",
  "client_phone",
  "client_dob",
];

// Things that carry bytes off the database.
const SINK_PATTERNS = [
  /net\.http_post/i,
  /discord[_-]?webhook/i,
  /discord\.com/i,
  /'discord-webhook-notify'/i,
];

const ALLOW_MARKER = /discord-pii-allow:/i;

function targetFiles() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (argv.length > 0) return argv;

  // Default: migrations staged in this commit.
  try {
    return execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("supabase/migrations/") && s.endsWith(".sql"));
  } catch {
    return [];
  }
}

/** Split a .sql file into one chunk per function definition. */
function functionChunks(sql) {
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_."]+)\s*\(/gi;
  const marks = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    marks.push({
      name: m[1].replace(/"/g, "").replace(/^public\./i, ""),
      start: m.index,
    });
  }
  // Over-capture (a chunk may run past the function's real end) errs toward
  // flagging, which is the correct bias for a leak guard.
  return marks.map((mark, i) => ({
    name: mark.name,
    body: sql.slice(mark.start, i + 1 < marks.length ? marks[i + 1].start : sql.length),
  }));
}

const files = targetFiles();
const violations = [];

for (const rel of files) {
  const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;

  const sql = fs.readFileSync(abs, "utf8");
  for (const { name, body } of functionChunks(sql)) {
    if (ALLOW_MARKER.test(body)) continue;

    const sink = SINK_PATTERNS.find((p) => p.test(body));
    if (!sink) continue;

    const leaked = PII_COLUMNS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(body));
    if (leaked.length === 0) continue;

    violations.push({ name, file: rel, leaked, sink: String(sink) });
  }
}

if (violations.length > 0) {
  console.error(
    `\n[check-discord-pii] ${violations.length} function(s) in this commit send client PII to an outbound sink:\n`,
  );
  for (const v of violations) {
    console.error(`  ✖ ${v.name}()`);
    console.error(`      file:          ${v.file}`);
    console.error(`      client PII:    ${v.leaked.join(", ")}`);
    console.error(`      outbound sink: ${v.sink}`);
    console.error("");
  }
  console.error(
    "  A deal celebration is about the AGENT. The customer's name is never\n" +
      "  load-bearing for it. Remove the PII column from the payload, or, if a\n" +
      "  disclosure is genuinely authorised, write the reason inline as\n" +
      "  `discord-pii-allow:<reason>`.\n",
  );
  process.exit(1);
}

console.log(
  files.length === 0
    ? "[check-discord-pii] OK — no migrations in this commit."
    : `[check-discord-pii] OK — ${files.length} migration(s) checked, no client PII reaches an outbound sink.`,
);
