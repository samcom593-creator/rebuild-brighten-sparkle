#!/usr/bin/env node
// check-detached-supabase — MP-LEAD-MANAGER-7 (2026-11-09). Baseline 0.
//
// A method aliased off the supabase client without .bind() detaches `this`:
// invoking the alias throws "Cannot read properties of undefined (reading
// 'rest')" BEFORE any network request fires. LeadManager.tsx shipped exactly
// that on 2026-11-03 (44abd68e3) and every data read on the page was dead for
// six days while the error wall blamed expired logins — the thrown TypeError
// is indistinguishable from a network failure to every caller.
//
// Flags, in .ts/.tsx under src/ (comments and string literals stripped first,
// so prose describing the bug can never trip the guard — the MP-277 footnote
// lesson):
//   1) `= supabase.rpc` / .from / .schema / .channel / .functions.invoke that
//      is NOT immediately called `(` and NOT re-bound `.bind(`
//   2) destructuring the client itself: `{ ... } = supabase;`
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(join(ROOT, "src"));

const strip = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length))
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => " ".repeat(m.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => " ".repeat(m.length));

const ALIAS = /=\s*supabase\.(rpc|from|schema|channel|functions\.invoke)(?!\s*[.(])/g;
const DESTRUCT = /\}\s*=\s*supabase\s*[;,\n)]/g;

const offenders = [];
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  if (!raw.includes("supabase")) continue;
  const s = strip(raw);
  for (const re of [ALIAS, DESTRUCT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const line = s.slice(0, m.index).split("\n").length;
      offenders.push(`${f.replace(ROOT, "")}:${line} — ${raw.split("\n")[line - 1].trim().slice(0, 110)}`);
    }
  }
}

if (offenders.length) {
  console.error(`check:detached-supabase FAILED — ${offenders.length} detached client method alias(es):`);
  for (const o of offenders) console.error("  " + o);
  console.error("Fix: call the method on the client, or alias with supabase.<m>.bind(supabase).");
  process.exit(1);
}
console.log(`check:detached-supabase OK — 0 detached aliases across ${files.length} files`);
