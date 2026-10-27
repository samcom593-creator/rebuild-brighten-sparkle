#!/usr/bin/env node
// Read-only P10 inventory. No runtime behavior is inferred from source presence.
// Usage: node scripts/ac-p10-inventory.mjs [bot-sql-catalog.json] > inventory.json
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const source = ts.createSourceFile('App.tsx', readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const routes = [];
function visit(node) {
  if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'Route') {
    const path = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'path');
    routes.push({ path: path?.initializer && ts.isStringLiteral(path.initializer) ? path.initializer.text : null,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  }
  ts.forEachChild(node, visit);
}
visit(source);
const items = [];
const add = (surface, item, reason, extra = {}) => items.push({ surface, item, role: 'not exercised', verdict: 'UNPROVEN', reason, ...extra });
for (const route of routes) add('route', `${route.path ?? '(pathless/expression)'}:${route.line}`, 'Source registration only; authenticated rendering and denial not exercised.', route);
for (const f of files.filter(f => /^src\/pages\/.*\.tsx$/.test(f))) add('page', f, 'Critical UI states and role/viewport matrix not exercised.');
for (const f of files.filter(f => /^supabase\/functions\/[^/]+\/index\.ts$/.test(f))) add('edge function', f, 'Not invoked; send/write handlers require individually safe probes and delivery receipts.');
for (const f of files.filter(f => /^scripts\/check-.*\.mjs$/.test(f))) add('guard', f, 'See verify-core log for execution; no per-guard failing mutation established by this inventory.');
for (const f of files.filter(f => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))) add('test file', f, 'See suite log; source inventory includes tests outside the npm test runner.');
for (const role of ['admin', 'manager', 'agent', 'va_manager', 'va']) add('role', role, 'Full 5-viewport and permission-denial sweep not performed.');
if (process.argv[2]) {
  const catalog = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (catalog.ok !== true || !Array.isArray(catalog.rows) || !catalog.rows.length) throw new Error('Refusing empty/failed DB catalog');
  for (const row of catalog.rows) {
    if (typeof row.table_name !== 'string' || typeof row.rls_enabled !== 'boolean') throw new Error('Invalid DB catalog row');
    add('DB table', `${row.schema_name}.${row.table_name}`, 'Catalog only; write path and RLS denial not exercised.', { rls_enabled: row.rls_enabled });
  }
}
if (!routes.length || !items.some(i => i.surface === 'edge function')) throw new Error('Refusing empty source inventory');
const counts = Object.fromEntries([...new Set(items.map(i => i.surface))].map(s => [s, items.filter(i => i.surface === s).length]));
console.log(JSON.stringify({ source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), counts,
  verdict_counts: { PASS: 0, FAIL: 0, UNPROVEN: items.length }, items }, null, 2));
