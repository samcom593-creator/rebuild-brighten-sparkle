#!/usr/bin/env node
/**
 * annotate-verify-failures.mjs — name every red verify:core link in the Actions UI.
 *
 * verify-core.yml tees `npm run verify:core:all` into verify-core.log. When the
 * step fails, this reads that log and emits one `::error` annotation per failing
 * check: the check's name as the title, and the last lines of that check's own
 * output as the message. Annotations are readable from the checks API, which is
 * where an operator without access to the raw log (the log download lives on a
 * host some networks refuse) actually finds out WHICH link went red. Before this,
 * the only annotation said "read which check failed in the log above".
 *
 * Usage: node scripts/annotate-verify-failures.mjs verify-core.log
 * Never fails the job itself: a missing or empty log prints one notice.
 */
import { readFileSync, existsSync } from "node:fs";

const file = process.argv[2] || "verify-core.log";
if (!existsSync(file)) {
  console.log(`::notice::annotate-verify-failures: ${file} not found, nothing to annotate`);
  process.exit(0);
}
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const lines = readFileSync(file, "utf8").split("\n").map(strip);
const FAIL = /^\[(\d+)\/(\d+)\]\s+✗\s+(\S+)/;
const START = /^>\s+\S+@\S+\s+(check:\S+|build)\s*$/;
const MAX_LINES = 40;
const MAX_CHARS = 3500;
const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

let count = 0;
for (let i = 0; i < lines.length; i++) {
  const m = FAIL.exec(lines[i]);
  if (!m) continue;
  const name = m[3];
  // Walk back to this check's own npm header so the tail is its output, not the previous link's.
  let start = i - 1;
  while (start > 0 && !START.test(lines[start]) && i - start < 400) start--;
  const body = lines.slice(Math.max(start, i - MAX_LINES), i + 1).filter((l) => l.trim() !== "");
  let text = body.join("\n");
  if (text.length > MAX_CHARS) text = "…" + text.slice(text.length - MAX_CHARS);
  console.log(`::error title=verify:core ✗ ${name}::${esc(text)}`);
  count++;
  if (count >= 10) {
    console.log("::notice::annotate-verify-failures: more than 10 failing checks; the rest are only in the log");
    break;
  }
}
if (count === 0) console.log("::notice::annotate-verify-failures: no '[n/N] ✗ check' line in the log; the failure is outside the roster (see the step output)");
