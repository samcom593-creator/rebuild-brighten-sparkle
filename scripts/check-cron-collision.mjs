#!/usr/bin/env node
// check-cron-collision.mjs — no two ONCE-DAILY scheduled workflows may share a
// fire-minute. (MP-WIB-CRON-COLLISION, 2026-11-17)
//
// THE BLIND SPOT THIS CLOSES
// --------------------------
// The live-edge guard family (brand-static-live, share-card-live,
// jsonld-asset-live, font-preload-live, crawl-entrypoints-live,
// robots-indexable-live, hero-carrier-count-live, funnel-share-card-live,
// lead-magnet-cta-live, vsl-media, apply-form-render, funnel-capture) is each a
// SEPARATE daily GitHub Actions workflow. GitHub's own docs say the `schedule`
// event is delayed under load and to avoid stacking workflows at the same time
// (MP-304 measured this origin's schedules drift p90 ~40min). Each of those
// workflows therefore carries a hand-written "offset from <siblings>" comment
// picking a minute meant to be unique.
//
// Those comments are load-bearing AND unverified: the next guard's author reads
// them to choose a free minute. On 2026-11-17 jsonld-asset-live shipped with
// `cron: 37 14`, its comment claiming "offset from share-card-live/vsl-media/
// brand-static-live" — a subset that never included crawl-entrypoints-live,
// which already owned :37. Two daily guards fired the same minute, and a second
// pre-existing pair (robots-indexable-live + funnel-share-card-live, both :42)
// had drifted the same way. A comment that asserts an offset it did not check
// is exactly the class of false-success this bot exists to kill — the schedule
// looked de-conflicted and was not, and nothing in CI went red.
//
// WHY STATUS/EXISTENCE CHECKS MISS IT. check:guard-wiring proves each guard is
// RUN by something; it says nothing about WHEN. The per-workflow `schedule:`
// blocks are valid YAML with valid cron, so no linter objects. The only signal
// was the prose comment, and prose cannot be trusted to stay true across
// concurrent waves. This guard makes the uniqueness a fact the tree must carry.
//
// SCOPE — ONCE-DAILY ONLY, AND WHY (the permanently-red trap, avoided)
// --------------------------------------------------------------------
// A naive "no two workflows share a minute" rule would be RED forever and
// unfixable: external-cron-backup runs `*/5` across five staggered entries =
// effectively every minute, so every daily guard would "collide" with it and
// the guard would join the permanently-yellow gates apex-doctor's own headers
// warn about. vantage-production-sync's hourly `7,22,37,52` occupies four
// minutes of every hour for the same structural reason. Neither is a daily
// guard and neither can be de-conflicted, so BOTH are excluded. The rule the
// tree can actually satisfy, and the intent the comments already state, is:
// among workflows that fire EXACTLY ONCE PER DAY, no two share (hour, minute).
// Landing a daily guard on a sweeper's minute is a softer, avoidable concern
// this guard deliberately does NOT fail on — grading it would re-introduce the
// permanently-red failure mode for a ~nil operational cost.
//
// A cron collision can only be introduced by editing a workflow, which always
// arrives via a push, so this is a static CI check (wired in verify:core), not
// a scheduled probe. Run with --selftest to prove it flags a collision and
// clears a clean set (incl. proving sweepers are excluded, so it cannot go
// permanently red).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WF_DIR = join(ROOT, ".github", "workflows");

// A cron field is "single" if it is one plain integer (no *, /, -, or ,).
const isSingleInt = (f) => /^\d+$/.test(f);

// Parse one cron string into {minute, hour, dailyOnce}. dailyOnce is true iff
// the schedule fires exactly once per day: a single minute, a single hour, and
// every-day for dom/month/dow. Anything else (lists, ranges, steps, wildcards
// in minute/hour) is a sub-daily or multi-time schedule and is NOT once-daily.
export function parseCron(cron) {
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length < 5) return { dailyOnce: false };
  const [minute, hour, dom, mon, dow] = parts;
  const dailyOnce =
    isSingleInt(minute) &&
    isSingleInt(hour) &&
    dom === "*" &&
    mon === "*" &&
    dow === "*";
  return { minute, hour, dailyOnce };
}

// Pure core: given [{file, cron}], return the list of (hour,minute) buckets that
// more than one DISTINCT file fires on (once-daily only). Sweepers / sub-daily
// schedules are dropped by parseCron().dailyOnce === false.
export function findDailyCronCollisions(entries) {
  const buckets = new Map(); // "H:M" -> Set(file)
  for (const { file, cron } of entries) {
    const p = parseCron(cron);
    if (!p.dailyOnce) continue;
    const key = `${p.hour}:${p.minute}`;
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key).add(file);
  }
  const collisions = [];
  for (const [key, files] of buckets) {
    if (files.size > 1) {
      const [hour, minute] = key.split(":");
      collisions.push({
        hour,
        minute,
        files: [...files].sort(),
      });
    }
  }
  // Stable order: by hour, then minute.
  collisions.sort(
    (a, b) => Number(a.hour) - Number(b.hour) || Number(a.minute) - Number(b.minute)
  );
  return collisions;
}

// Read every workflow file and pull out each `cron:` entry (comments stripped).
function collectEntries() {
  const entries = [];
  if (!existsSync(WF_DIR)) return entries;
  for (const name of readdirSync(WF_DIR)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const txt = readFileSync(join(WF_DIR, name), "utf8");
    if (!/^\s*schedule:/m.test(txt)) continue;
    for (const m of txt.matchAll(/^\s*-?\s*cron:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/gm)) {
      entries.push({ file: name, cron: m[1].trim() });
    }
  }
  return entries;
}

function runSelftest() {
  let failures = 0;
  const ok = (cond, label) => {
    if (cond) {
      console.log(`  ✓ ${label}`);
    } else {
      console.error(`  ✗ ${label}`);
      failures++;
    }
  };

  console.log("check:cron-collision --selftest");

  // RED direction: two distinct daily workflows on the same (hour,minute).
  const collided = findDailyCronCollisions([
    { file: "a.yml", cron: "37 14 * * *" },
    { file: "b.yml", cron: "37 14 * * *" },
    { file: "c.yml", cron: "15 14 * * *" },
  ]);
  ok(collided.length === 1, "flags a same-minute daily collision");
  ok(
    collided[0] &&
      collided[0].hour === "14" &&
      collided[0].minute === "37" &&
      collided[0].files.join(",") === "a.yml,b.yml",
    "names the exact minute + both colliding files"
  );

  // GREEN direction: unique daily minutes -> zero collisions.
  const clean = findDailyCronCollisions([
    { file: "a.yml", cron: "37 14 * * *" },
    { file: "b.yml", cron: "38 14 * * *" },
    { file: "c.yml", cron: "37 13 * * *" }, // same minute, DIFFERENT hour -> not a collision
  ]);
  ok(clean.length === 0, "clears unique daily minutes (and same-minute/diff-hour is not a collision)");

  // SWEEPER EXCLUSION: a once-daily guard sharing a minute with an every-5-min
  // sweeper and an hourly list must NOT be flagged — else the guard is red
  // forever against external-cron-backup / vantage-production-sync.
  const withSweepers = findDailyCronCollisions([
    { file: "guard.yml", cron: "30 14 * * *" },
    { file: "external-cron-backup.yml", cron: "0-59/5 * * * *" },
    { file: "external-cron-backup.yml", cron: "2-59/5 * * * *" }, // hits :32, :37... and :30-adjacent
    { file: "vantage.yml", cron: "7,22,37,52 * * * *" },
    { file: "vantage.yml", cron: "23 5 * * *" }, // vantage's OWN once-daily entry
  ]);
  ok(
    withSweepers.length === 0,
    "excludes sub-daily sweepers (cannot go permanently red on every-minute/hourly schedules)"
  );

  // Two once-daily entries in the SAME file at the same minute is not a
  // cross-workflow collision (dedup by file).
  const sameFile = findDailyCronCollisions([
    { file: "x.yml", cron: "10 9 * * *" },
    { file: "x.yml", cron: "10 9 * * *" },
  ]);
  ok(sameFile.length === 0, "same file listed twice at one minute is not a collision");

  if (failures) {
    console.error(`\n✗ selftest: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ selftest: all assertions passed (both directions + sweeper exclusion)");
  process.exit(0);
}

function main() {
  if (process.argv.includes("--selftest")) return runSelftest();

  const entries = collectEntries();
  const collisions = findDailyCronCollisions(entries);

  if (collisions.length === 0) {
    const dailyCount = entries.filter((e) => parseCron(e.cron).dailyOnce).length;
    console.log(
      `✓ check:cron-collision — ${dailyCount} once-daily scheduled workflow cron(s), all on unique (hour,minute) fire-slots.`
    );
    process.exit(0);
  }

  console.error("✗ check:cron-collision — once-daily workflows share a fire-minute:");
  for (const c of collisions) {
    const utc = `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")} UTC`;
    console.error(`  ${utc}  <-  ${c.files.join(" + ")}`);
  }
  console.error(
    "\n  GitHub delays the `schedule` event under load and recommends not stacking workflows at\n" +
      "  the same time (MP-304 measured p90 ~40min drift on this origin). Give each once-daily\n" +
      "  workflow a UNIQUE minute. Free minutes are plentiful; avoid 07/22/37/52 (vantage-\n" +
      "  production-sync's hourly slots) and update the cron comment to the TRUE neighbor set."
  );
  process.exit(1);
}

main();
