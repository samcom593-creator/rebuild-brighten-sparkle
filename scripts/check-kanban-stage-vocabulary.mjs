#!/usr/bin/env node
/**
 * check:kanban-stage-vocabulary — MP-342
 *
 * The pipeline board speaks a stage vocabulary that must stay reconciled with
 * the license_progress enum in BOTH directions. It was broken in both:
 *
 *   - "new_applicant" and "dormant" are board-only words. AgentPipeline wrote
 *     them straight into license_progress, so dropping a card on 2 of 7 columns
 *     raised 22P02, `throw error` fired, and the whole stage change was rolled
 *     back behind a red toast. The correct mapping already existed inline in
 *     DashboardApplicants — one rule, two implementations, only one right.
 *   - 4 real enum members (waiting_fingerprints, failed_test, exam_passed,
 *     in_field_training) were in NO column, so any applicant in those states
 *     silently fell through to "Needs Outreach" and was mislabelled.
 *
 * A literal-only check cannot see the first half: the value written is a
 * variable. So this guard grades the VOCABULARY and the write path, not the
 * instance.
 *
 * The enum snapshot is read out of check-enum-filter-literals.mjs rather than
 * copied, because two snapshots of one enum is the drift this guard exists to
 * stop.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const R = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");
const fail = [];

// ── enum snapshot (single-sourced) ───────────────────────────────────────────
const enumSrc = R("scripts/check-enum-filter-literals.mjs");
const enumBlock = enumSrc.match(/license_progress:\s*\[([\s\S]*?)\]/);
if (!enumBlock) {
  console.error("✗ could not read license_progress from check-enum-filter-literals.mjs ENUMS.");
  console.error("  That file is the single source for this enum — do not add a second copy here.");
  process.exit(1);
}
const MEMBERS = new Set([...enumBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

// ── board vocabulary ─────────────────────────────────────────────────────────
const board = R("src/components/pipeline/KanbanBoard.tsx");

const unionBlock = board.match(/export type KanbanStage =([\s\S]*?);/);
const UNION = new Set([...(unionBlock?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const uiOnlyBlock = board.match(/UI_ONLY_STAGES[^=]*=\s*\[([\s\S]*?)\]/);
const UI_ONLY = new Set([...(uiOnlyBlock?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const targetBlock = board.match(/COLUMN_TARGET_STAGE[^=]*=\s*\{([\s\S]*?)\}/);
const TARGETS = [...(targetBlock?.[1] ?? "").matchAll(/(\w+):\s*"([a-z_]+)"/g)]
  .map((m) => ({ column: m[1], stage: m[2] }));

const COVERED = new Set(
  [...board.matchAll(/stages:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]))
);

if (!UNION.size || !TARGETS.length || !COVERED.size) {
  console.error("✗ failed to parse KanbanBoard.tsx vocabulary — the shapes this guard anchors on moved.");
  process.exit(1);
}

// 1. Every drop target must resolve to something the column can hold.
for (const { column, stage } of TARGETS) {
  if (UI_ONLY.has(stage)) continue;               // routed through toDbStage()
  if (!MEMBERS.has(stage)) {
    fail.push(`drop target "${column}" writes "${stage}", which license_progress cannot hold (22P02).`);
  }
}

// 2. A board-only word must NOT be a real member — else toDbStage is silently
//    rewriting a legitimate stage into "unlicensed".
for (const s of UI_ONLY) {
  if (MEMBERS.has(s)) {
    fail.push(`"${s}" is declared UI-only but IS a license_progress member — toDbStage would erase a real stage.`);
  }
}

// 3. Every stage in the union is either storable or explicitly board-only.
for (const s of UNION) {
  if (!MEMBERS.has(s) && !UI_ONLY.has(s)) {
    fail.push(`KanbanStage "${s}" is neither a license_progress member nor declared in UI_ONLY_STAGES.`);
  }
}

// 4. Every enum member must land in a column, or it is silently mislabelled.
for (const m of MEMBERS) {
  if (!COVERED.has(m)) {
    fail.push(`license_progress member "${m}" is in no column's stages[] — it falls through to "Needs Outreach".`);
  }
}

// 5. Every license_progress assignment fed by a board stage must go through
//    toDbStage — the DB write AND the optimistic mirror beside it, which would
//    otherwise hold "dormant" locally while the row holds "unlicensed".
for (const f of ["src/pages/AgentPipeline.tsx", "src/pages/DashboardApplicants.tsx"]) {
  const src = R(f);
  for (const m of src.matchAll(/license_progress:\s*([^,\n}]+)/g)) {
    const rhs = m[1].trim();
    if (/newStage|KanbanStage/.test(rhs) && !rhs.includes("toDbStage")) {
      const line = src.slice(0, m.index).split("\n").length;
      fail.push(`${f}:${line} assigns a board stage (${rhs}) to license_progress without toDbStage().`);
    }
  }
}

// 6. Exactly one placement rule. A second derivation is how the Pipeline Funnel
//    came to contradict the board beneath it on 6 of 7 columns.
const placements = [...board.matchAll(/export function (getColumnFor\w+)/g)].map((m) => m[1]);
const extra = placements.filter((n) => n !== "getColumnForApp");
if (extra.length) {
  fail.push(`second column-placement rule exported: ${extra.join(", ")} — every surface must call getColumnForApp.`);
}

if (fail.length) {
  console.error(`✗ check:kanban-stage-vocabulary — ${fail.length} problem(s):\n`);
  for (const f of fail) console.error("  " + f);
  console.error("\nThe board's stage words and the license_progress enum must agree both ways.");
  process.exit(1);
}
console.log(
  `✓ check:kanban-stage-vocabulary — ${MEMBERS.size} enum members all mapped, ` +
  `${TARGETS.length} drop targets storable, ${UI_ONLY.size} board-only stages routed, 1 placement rule.`
);
