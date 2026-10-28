#!/usr/bin/env node
/**
 * annotate-verify-failures.mjs — name every red link in the Actions UI.
 *
 * verify-core.yml tees `npm test` into vitest.log and `npm run verify:core:all`
 * into verify-core.log. When the job fails, this reads whichever of those
 * exist and emits one `::error` annotation per failure: for verify:core, the
 * check's name as the title and the last lines of that check's own output as
 * the message; for vitest, each failed test with its assertion. Annotations are
 * readable from the checks API, which is where an operator without access to
 * the raw log (the log download lives on a host some networks refuse) actually
 * finds out WHAT went red. Before this, the only annotation said "read which
 * check failed in the log above".
 *
 * Usage: node scripts/annotate-verify-failures.mjs verify-core.log vitest.log
 * Never fails the job itself: a missing log prints one notice and moves on.
 */
import { readFileSync, existsSync } from "node:fs";

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const MAX_CHARS = 3500;
const MAX_ANNOTATIONS = 10;
const clip = (text) => (text.length > MAX_CHARS ? "…" + text.slice(text.length - MAX_CHARS) : text);

function annotateVerifyCore(lines) {
  const FAIL = /^\[(\d+)\/(\d+)\]\s+✗\s+(\S+)/;
  const START = /^>\s+\S+@\S+\s+(check:\S+|build)\s*$/;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = FAIL.exec(lines[i]);
    if (!m) continue;
    // Walk back to this check's own npm header so the tail is its output, not the previous link's.
    let start = i - 1;
    while (start > 0 && !START.test(lines[start]) && i - start < 400) start--;
    const body = lines.slice(Math.max(start, i - 40), i + 1).filter((l) => l.trim() !== "");
    console.log(`::error title=verify:core ✗ ${m[3]}::${esc(clip(body.join("\n")))}`);
    if (++count >= MAX_ANNOTATIONS) {
      console.log("::notice::annotate-verify-failures: more than 10 failing checks; the rest are only in the log");
      break;
    }
  }
  return count;
}

function annotateVitest(lines) {
  // vitest prints each failure in its summary as " FAIL  <file> > <suite> > <test>" followed by
  // the assertion and a few frames, until the next " FAIL " or a "⎯" rule.
  const FAIL = /^\s*FAIL\s+(\S+)(.*)$/;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = FAIL.exec(lines[i]);
    if (!m || !/\.(test|spec)\.[cm]?[jt]sx?/.test(m[1])) continue;
    const body = [lines[i].trim()];
    for (let j = i + 1; j < lines.length && j < i + 30; j++) {
      if (/^\s*FAIL\s+\S/.test(lines[j]) || /^\s*⎯/.test(lines[j])) break;
      if (lines[j].trim() !== "") body.push(lines[j]);
    }
    console.log(`::error title=vitest ✗ ${m[1]}::${esc(clip(body.join("\n")))}`);
    if (++count >= MAX_ANNOTATIONS) {
      console.log("::notice::annotate-verify-failures: more than 10 failing tests; the rest are only in the log");
      break;
    }
  }
  // The run can also die before any FAIL line (out of memory, a crashed worker): keep the last lines.
  if (count === 0) {
    const tail = lines.filter((l) => l.trim() !== "").slice(-25).join("\n");
    if (/error|Error|FAIL|failed|exit/i.test(tail)) {
      console.log(`::error title=vitest ended without a FAIL summary::${esc(clip(tail))}`);
      count = 1;
    }
  }
  return count;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["verify-core.log"];
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`::notice::annotate-verify-failures: ${file} not found, nothing to annotate`);
    continue;
  }
  const lines = readFileSync(file, "utf8").split("\n").map(strip);
  const n = /vitest/.test(file) ? annotateVitest(lines) : annotateVerifyCore(lines);
  if (n === 0) console.log(`::notice::annotate-verify-failures: no failure marker in ${file}`);
}
