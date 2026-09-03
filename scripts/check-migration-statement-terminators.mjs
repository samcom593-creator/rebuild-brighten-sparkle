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
 */
function closingOffsets(sql) {
  const closes = [];
  const tagRe = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let m, openTag = null, openEnd = 0;
  while ((m = tagRe.exec(sql)) !== null) {
    const tag = m[1] ?? '';
    if (openTag === null) { openTag = tag; openEnd = m.index + m[0].length; continue; }
    if (tag === openTag) { closes.push(m.index + m[0].length); openTag = null; }
  }
  if (openTag !== null) closes.push(-openEnd);
  return closes;
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
