#!/usr/bin/env node
/**
 * check-bot-token-jwt-gate — an edge function cannot authenticate a bot token
 * AND require a JWT at the gateway. One of the two is always a lie.
 *
 * THE INVARIANT. Supabase's `verify_jwt` is enforced by the gateway, before the
 * function boots. It accepts any structurally valid Supabase JWT. A handler that
 * authenticates `Bearer <apex_bot_token>` — a 64-char hex string, not a JWT —
 * can therefore never be reached by its own authorized caller when
 * verify_jwt = true. The request dies at the gateway with
 * {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT"} and the handler's own check, which
 * is the real boundary, never runs.
 *
 * IT IS NOT A SECURITY TRADE. verify_jwt = true accepts the public anon key that
 * ships inside the site bundle, so for these endpoints it is strictly WEAKER
 * than the in-handler check it silently disables. Turning it on buys nothing and
 * costs the caller.
 *
 * WHY THIS IS A GUARD AND NOT A LIST. scripts/sync-functions-config.sh has
 * carried the rule in prose since MP-441, and defaults every unlisted function
 * to verify_jwt = true. agentlink-clients-sync was defaulted that way on
 * 2026-08-20, deployed, and its 30-minute pg_cron caller had been 401ing for 16
 * days before anyone looked — while cron.job_run_details recorded 333
 * consecutive "succeeded", because that column reports whether net.http_post
 * enqueued, not whether anything answered. A rule written in a comment is not a
 * rule; the allowlist and this check now say the same thing in two places that
 * cannot drift, because this one is derived from the source every run.
 *
 * VERDICT
 *   FAIL     config says verify_jwt = true and the handler reads Authorization
 *            and accepts a bot token.
 *   UNKNOWN  a function's source or config stanza cannot be read. Never green.
 *
 * Comments are stripped with the shared lexer before matching, so a token name
 * in prose cannot vote (MP-277's footnote bug). MEASURED, not claimed: today the
 * raw and stripped scans agree on all 20 functions, so the lexer is currently
 * changing no verdict. It is here for the comment someone writes next, and this
 * sentence says plainly that it is not doing work yet.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import stripComments from "./lib/strip-comments.mjs";

const FUNCS = "supabase/functions";
const CONFIG = "supabase/config.toml";

// Credentials that are not JWTs. Presenting any of these as a Bearer token is
// refused by the gateway before the handler runs.
const BOT_TOKEN_NAMES = [
  "APEX_BOT_TOKEN",
  "apex_bot_token",
  "BOT_SQL_PERSISTENT_TOKEN",
];

function parseConfig(text) {
  const out = new Map();
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = /^\[functions\.([a-z0-9_-]+)\]$/.exec(line);
    if (head) { cur = head[1]; continue; }
    const vj = /^verify_jwt\s*=\s*(true|false)\s*$/.exec(line);
    if (vj && cur) { out.set(cur, vj[1] === "true"); cur = null; }
  }
  return out;
}

function main() {
  if (!existsSync(CONFIG) || !existsSync(FUNCS)) {
    console.error(`✗ ${CONFIG} or ${FUNCS} missing — UNKNOWN, not green`);
    process.exit(1);
  }
  const cfg = parseConfig(readFileSync(CONFIG, "utf8"));

  const violations = [];
  const unknown = [];
  let botAuthed = 0;

  for (const name of readdirSync(FUNCS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared" && d.name !== "tests")
    .map((d) => d.name)
    .sort()) {
    const entry = join(FUNCS, name, "index.ts");
    if (!existsSync(entry)) continue;

    let code;
    try {
      code = stripComments(readFileSync(entry, "utf8"));
    } catch (err) {
      unknown.push({ name, why: `unreadable source: ${err.message}` });
      continue;
    }

    // Does it authenticate a caller-presented bot token? Both halves are
    // required: a function may hold a bot token purely to send it OUTBOUND,
    // which is not an inbound auth decision and not this check's business.
    const readsAuthHeader = /headers\s*\.\s*get\(\s*["'`][Aa]uthorization["'`]\s*\)/.test(code);
    const namesBotToken = BOT_TOKEN_NAMES.some((t) => code.includes(t));
    if (!readsAuthHeader || !namesBotToken) continue;
    botAuthed++;

    if (!cfg.has(name)) {
      unknown.push({ name, why: "no [functions.*] stanza in config.toml — the sync script would default it to verify_jwt = true" });
      continue;
    }
    if (cfg.get(name) === true) violations.push(name);
  }

  console.log(`bot-token auth vs JWT gate — ${botAuthed} function(s) authenticate a caller-presented bot token`);

  for (const u of unknown) console.error(`  ⚠️  UNKNOWN ${u.name} — ${u.why}`);
  for (const v of violations)
    console.error(
      `  🔴 ${v} — config.toml says verify_jwt = true, but this handler authenticates a bot token.\n` +
      `      The gateway will refuse its caller with UNAUTHORIZED_INVALID_JWT_FORMAT before the\n` +
      `      handler runs, and pg_cron will still record the fire as "succeeded".\n` +
      `      Fix: set verify_jwt = false for [functions.${v}] and add it to PUBLIC_ALLOWLIST in\n` +
      `      scripts/sync-functions-config.sh, or stop authenticating a bot token in the handler.`,
    );

  if (violations.length || unknown.length) {
    console.error(`\n✗ ${violations.length} violation(s), ${unknown.length} unknown`);
    process.exit(1);
  }
  console.log("✓ every bot-token-authenticated function is reachable by its own caller");
}

main();
