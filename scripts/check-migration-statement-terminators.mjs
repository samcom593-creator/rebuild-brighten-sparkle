#!/usr/bin/env node
/**
 * MP-406 — a migration whose function body is never terminated jams the whole deploy queue.
 *
 * supabase/migrations/20260903093500_mp401_agentlink_alert_delivery.sql ended two
 * CREATE OR REPLACE FUNCTION bodies with a bare `END $function$` and no `;`. Postgres
 * then read the following `CREATE` as a continuation of the same statement and died with
 * `syntax error at or near "CREATE"` (SQLSTATE 42601). Because `supabase db push` applies
 * pending migrations in filename order and stops at the first failure, that one missing
 * character took the "Deploy Supabase (functions + migrations)" gate red on every push
 * for ~6h (3 consecutive runs) and blocked every migration queued behind it.
 *
 * WHY IT HAPPENS, so the fix is the class and not the instance: this repo routinely
 * hand-applies functions via bot-sql and pastes `pg_get_functiondef()` output back into a
 * migration file. pg_get_functiondef NEVER emits a trailing semicolon. Any function
 * captured that way arrives unterminated, and it is invisible on review because the SQL
 * looks complete.
 *
 * WHAT THIS GRADES: every dollar-quoted body in supabase/migrations must be followed by a
 * `;` before the next statement. Comments and blank lines between the two are fine — the
 * sibling migration 20260903150000 puts the `;` on its own line, which is correct, and a
 * naive line-anchored regex reports it as broken. The first cut of this sweep did exactly
 * that and claimed 2 broken files where there was 1; the terminator is resolved by looking
 * ahead past whitespace and comments, never by inspecting the END line alone.
 *
 * This reads only the current commit's files. It needs no database, so it cannot go red on
 * history and cannot drift with prod. It does NOT prove a migration is semantically correct
 * — only that it parses as separate statements.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';

/**
 * NOTE ON `SET`: it is deliberately NOT a statement-start keyword. `CREATE FUNCTION ... AS
 * $$...$$ LANGUAGE plpgsql SET search_path = public;` carries SET as a function ATTRIBUTE
 * clause after the body, and treating it as a statement reported 2 more correct files as
 * broken. A top-level `SET ...;` in a migration is thereby unwatched — stated, not hidden.
 *
 * From `at`, walk forward and decide whether the statement TERMINATES before a new one
 * begins. The naive rule — "a `;` must immediately follow the body" — is wrong, and its
 * first cut here flagged 53 correct sites: `$$ ... $$);` closes a body passed as an
 * argument to cron.schedule(), and `$$ ... $$ LANGUAGE plpgsql;` carries the language
 * clause legitimately AFTER the body. Both are valid SQL. What actually jams the deploy
 * is reaching the next statement without ever passing a `;`.
 */
const STATEMENT_START = /^(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|INSERT|UPDATE|DELETE|TRUNCATE|DO)\b/i;

function terminatesBeforeNextStatement(text, at) {
  let i = at;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return { ok: true };
      i = nl + 1; continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return { ok: true };
      i = end + 2; continue;
    }
    if (c === "'") {                                  // skip a quoted literal
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") break;
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (c === ';') return { ok: true };               // terminated
    if (depth === 0 && STATEMENT_START.test(text.slice(i, i + 12))) {
      return { ok: false, token: text.slice(i, i + 40).split('\n')[0] };
    }
    i++;
  }
  return { ok: true };                                // EOF: psql accepts a final statement
}

/**
 * Walk the file tracking dollar-quoted bodies. Returns the offsets at which a body closed.
 * Scanning for the tag pair (rather than regexing `END $tag$`) is what lets this see a body
 * that ends on any statement, not just one whose last keyword happens to be END.
 *
 * Outside a body, `--` and `/* *\/` comments and quoted literals are skipped, because
 * Postgres never reads a dollar tag there. Until 2026-10-27 this regexed `$tag$` anywhere,
 * so a migration whose COMMENT mentioned `$h$` (20261026063000, 998ba93f) opened a phantom
 * body at the comment and reported an unterminated one; the author had to reword the
 * comment to get past it. Inside a body, only the matching close tag counts: Postgres does
 * not lex comments inside a dollar quote either, so a `-- ...` line there is body text.
 */
const TAG_AT = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

function closingOffsets(sql) {
  const closes = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {            // block comments nest in Postgres
      let depth = 1, j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      i = j; continue;
    }
    if (c === "'" || c === '"') {                     // '' / "" doubling; E'' backslash escapes
      const escapes = c === "'" && /[eE]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === c && sql[j + 1] === c) { j += 2; continue; }
        if (sql[j] === c) break;
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {  // `a$b$` is an identifier
      TAG_AT.lastIndex = i;
      const m = TAG_AT.exec(sql);
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length);
        if (close === -1) { closes.push(-(i + m[0].length)); return closes; }
        closes.push(close + m[0].length);
        i = close + m[0].length; continue;
      }
    }
    i++;
  }
  return closes;
}

/**
 * --selftest: each fixture carries the verdict the scanner must reach. The first three are
 * the shapes that used to read as a body; the rest pin what the rewrite must keep doing.
 */
const FIXTURES = [
  ['tag in a -- comment', "-- body uses a $h$ literal\nCREATE TABLE t(a int);\n", 0],
  ['tag in a /* */ comment', "/* $fn$ /* nested */ $x$ */\nCREATE TABLE t(a int);\n", 0],
  ['tag in a string literal', "COMMENT ON TABLE t IS 'quoted $fn$ here';\nCREATE TABLE u(a int);\n", 0],
  ['tag in an E-string with \\\'', "SELECT E'it\\'s $q$';\nCREATE TABLE u(a int);\n", 0],
  ['terminated body', "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\nCREATE TABLE t(a int);\n", 0],
  ['body passed to cron.schedule', "SELECT cron.schedule('j', '* * * * *', $$ SELECT 1 $$);\nCREATE TABLE t(a int);\n", 0],
  ['-- comment inside a body is body text', "CREATE FUNCTION f() RETURNS int AS $b$\n-- note\nSELECT 1 $b$ LANGUAGE sql;\nCREATE TABLE t(a int);\n", 0],
  ['unterminated body', "CREATE FUNCTION f() RETURNS int AS $function$ BEGIN RETURN 1; END $function$\nCREATE TABLE t(a int);\n", 1],
  ['unterminated after a commented tag', "-- see $h$\nCREATE FUNCTION f() RETURNS int AS $h$ SELECT 1 $h$\nCREATE TABLE t(a int);\n", 1],
  ['never-closed body', "CREATE FUNCTION f() RETURNS int AS $x$ SELECT 1;\n", 1],
];

function violationsIn(sql) {
  let n = 0;
  for (const off of closingOffsets(sql)) {
    if (off < 0 || !terminatesBeforeNextStatement(sql, off).ok) n++;
  }
  return n;
}

if (process.argv.includes('--selftest')) {
  let bad = 0;
  for (const [name, sql, want] of FIXTURES) {
    const got = violationsIn(sql);
    const pass = got === want;
    if (!pass) bad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${got} violation(s), want ${want}`);
  }
  if (bad) { console.error(`check-migration-statement-terminators --selftest: ${bad} of ${FIXTURES.length} FAILED`); process.exit(1); }
  console.log(`check-migration-statement-terminators --selftest: ${FIXTURES.length}/${FIXTURES.length} PASS`);
  process.exit(0);
}

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
} catch {
  console.error(`check-migration-statement-terminators: cannot read ${DIR}`);
  process.exit(2);
}

const violations = [];
for (const f of files) {
  const path = join(DIR, f);
  const sql = readFileSync(path, 'utf8');
  for (const off of closingOffsets(sql)) {
    if (off < 0) {
      const line = sql.slice(0, -off).split('\n').length;
      violations.push({ path, line, why: 'dollar-quoted body is never closed' });
      continue;
    }
    const verdict = terminatesBeforeNextStatement(sql, off);
    if (verdict.ok) continue;
    const line = sql.slice(0, off).split('\n').length;
    violations.push({
      path,
      line,
      why: `body closes here and \`${verdict.token}\` starts the next statement with no \`;\` in between`,
    });
  }
}

if (violations.length > 0) {
  console.error('\nUnterminated statement in a Supabase migration.\n');
  console.error('`supabase db push` applies migrations in filename order and STOPS at the first');
  console.error('failure, so this takes the deploy gate red and blocks every migration behind it.\n');
  for (const v of violations) console.error(`  ${v.path}:${v.line} — ${v.why}`);
  console.error('\nFix: add `;` after the closing dollar-quote. pg_get_functiondef() output never');
  console.error('carries one, so a function captured from prod always needs it added by hand.\n');
  process.exit(1);
}

console.log(`check-migration-statement-terminators: ${files.length} migrations, every function body terminated`);
