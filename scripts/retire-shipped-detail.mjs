#!/usr/bin/env node
// PL-WIB-SHIPPED-DATA-BUDGET (2026-10-11) — the remedy check-metric-truth names.
//
// shipped-data.ts ships as its own lazy chunk and only grows: every wave
// prepends an entry, and nothing ever retires one. check-metric-truth caps it
// at 1.2 MB and tells you to "drop the `detail` prose from the oldest entries
// (keep `label`)". This is that action as one command, so it is not a hand edit
// across a 3,000-line file that other workers are prepending to.
//
//   node scripts/retire-shipped-detail.mjs src/data/shipped-data.ts <keep-newest-N>          # dry run
//   node scripts/retire-shipped-detail.mjs src/data/shipped-data.ts <keep-newest-N> --write
//
// It edits through the TypeScript AST, never a regex: some `detail` values
// start on the line after the key, so a line-based cut would leave a dangling
// string. It refuses to run if a comment sits in front of a detail it would
// drop, unless that comment is a `// forbidden-allow:` line, which exists only
// to excuse that one detail line. Before writing it re-parses the result and
// proves: same entry count; every label, ts and commit byte-identical; the
// newest N details untouched; no detail left at index >= N. Any mismatch
// throws and nothing is written.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";

const [file, keepArg, mode] = process.argv.slice(2);
const KEEP = Number(keepArg);
if (!file || !Number.isInteger(KEEP) || KEEP < 0 || (mode && mode !== "--write")) {
  console.error("usage: retire-shipped-detail.mjs <shipped-data.ts> <keep-newest-N> [--write]");
  process.exit(2);
}

function parse(text) {
  const sf = ts.createSourceFile("shipped-data.ts", text, ts.ScriptTarget.Latest, true);
  let arr;
  ts.forEachChild(sf, (n) => {
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations)
        if (d.name.getText(sf) === "SHIPPED") arr = d.initializer;
  });
  if (!arr || !ts.isArrayLiteralExpression(arr)) throw new Error("SHIPPED array not found");
  return arr.elements.map((e, i) => {
    if (!ts.isObjectLiteralExpression(e)) throw new Error(`entry ${i} is not an object literal`);
    const o = {};
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.initializer))
        throw new Error(`entry ${i}: unexpected property ${p.getText(sf).slice(0, 80)}`);
      o[p.name.getText(sf)] = { text: p.initializer.text, node: p, sf };
    }
    return o;
  });
}

const src = readFileSync(file, "utf8");
const before = parse(src);
const cuts = [];
let allowCommentsDropped = 0;
before.forEach((o, i) => {
  if (i < KEEP || !o.detail) return;
  const p = o.detail.node;
  const start = p.getFullStart(); // includes the leading newline + indentation
  let end = p.getEnd();
  const comments = src
    .slice(start, p.getStart(o.detail.sf))
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("//") || x.startsWith("/*"));
  if (comments.some((c) => !c.startsWith("// forbidden-allow:")))
    throw new Error(`entry ${i}: a comment sits in front of its detail; edit it by hand`);
  if (comments.length) allowCommentsDropped++;
  if (src[end] === ",") end += 1;
  cuts.push([start, end]);
});

let out = src;
for (const [s, e] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + out.slice(e);

const after = parse(out);
if (after.length !== before.length) throw new Error("entry count changed");
let detailsKept = 0;
let detailsDropped = 0;
before.forEach((b, i) => {
  const a = after[i];
  for (const k of ["label", "ts", "commit"])
    if (b[k]?.text !== a[k]?.text) throw new Error(`entry ${i}: ${k} changed`);
  const unknown = Object.keys(a).filter((k) => !["label", "ts", "commit", "detail"].includes(k));
  if (unknown.length) throw new Error(`entry ${i}: unknown keys ${unknown.join(",")}`);
  if (i < KEEP) {
    if (b.detail?.text !== a.detail?.text) throw new Error(`entry ${i}: detail changed`);
    if (a.detail) detailsKept++;
  } else {
    if (a.detail) throw new Error(`entry ${i}: detail survived`);
    if (b.detail) detailsDropped++;
  }
});

console.log(JSON.stringify({
  entries: after.length,
  keepNewest: KEEP,
  detailsKept,
  detailsDropped,
  allowCommentsDropped,
  bytesBefore: Buffer.byteLength(src),
  bytesAfter: Buffer.byteLength(out),
  wrote: mode === "--write",
}));
if (mode === "--write") writeFileSync(file, out);
