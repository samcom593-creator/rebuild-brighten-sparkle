#!/usr/bin/env node
/**
 * MP-327 ratchet: an agent's name must never fall back to a placeholder WORD.
 *
 * WHY THIS EXISTS
 * Until 2026-08-27 most surfaces resolved an agent's name through a PostgREST
 * embed, `profile:profiles(full_name)`. That only ever worked because
 * `public.profiles` was readable by every logged-in account. MP-325 closed that
 * (a plain agent reads their own row and their manager's, 613 -> 2) and every
 * such embed silently began returning null for everybody else. No error, no
 * 403, no empty state — each surface just rendered its own fallback. Measured
 * live as a real non-staff agent, 56 of 57 active agents on the agent portal
 * rendered as the literal string "Agent".
 *
 * That is the failure this guard is shaped around: the fallback is what makes
 * the breakage INVISIBLE. A surface that fell back to "—" looked merely empty;
 * two that fell back to "Agent" looked completely normal and were wrong about
 * every person on the page. So the thing worth forbidding is not the embed, it
 * is a fallback that reads like a real name.
 *
 * WHAT IT GRADES
 * Any `?? "..."` / `|| "..."` landing in a name-ish field, where the literal is
 * a WORD rather than a blank/em-dash. `AGENT_NAME_FALLBACK` ("—") is the
 * sanctioned value and is what `resolveAgentNames()` returns.
 *
 * WHAT IT DELIBERATELY DOES NOT GRADE
 * The embed itself. Admin and manager surfaces keep their profiles policy and
 * legitimately embed profiles for email/phone — banning the embed would go red
 * on correct code, and a permanently-red guard is one everybody learns to skip
 * (apex-doctor Check #19's header, learned the hard way four times).
 *
 * WHAT THE BASELINE NUMBER IS NOT
 * It is NOT a bug count. It is the number of sites not yet classified against
 * their own filter chain, and some are certainly legitimate — the "APEX Agent"
 * on the PUBLIC landing pages is marketing copy for a page with no specific
 * agent, and Numbers.tsx reads the viewer's OWN row, which MP-325 never closed.
 * Sizing a wave off this number without re-classifying each site is the operand
 * error that turned a NULL-timestamp count into a $2,336,292.84 leak nobody was
 * owed. This ratchet's job is to stop NEW ones; paying the 19 down is a
 * separate wave that must re-measure each site first.
 *
 * Baseline is a RATCHET, not a target: it may fall, never rise.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Fields whose value a human reads as somebody's name. */
const NAME_FIELD = /(agent_?name|full_?name|display_?name|nameMap\[[^\]]*\]|\bname)\s*[:=]/i;

/**
 * Placeholder WORDS. An em-dash, empty string, "Unknown"/"N/A" style blanks are
 * honest — they read as absent. A word like "Agent" reads as a person.
 */
const PLACEHOLDER_WORD = /(?:\?\?|\|\|)\s*["'`]\s*([A-Za-z][A-Za-z .'-]{1,30})\s*["'`]/;

/**
 * The violation is narrower than "a word": it is a ROLE NOUN standing in for a
 * person. "Unnamed agent", "No name on file", "Name missing" are honest — they
 * tell the reader the name is absent. "Agent" claims to BE the name, which is
 * why 56 wrong rows looked completely normal. Matching any word instead would
 * flag honest blanks, and a guard that goes red on correct code gets skipped.
 */
const ROLE_NOUN = /^(?:the\s+|an?\s+|APEX\s+)*(agent|producer|manager|rep|advisor|lead|user|member|apex|team\s*member)$/i;

const BASELINE = 19;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Strip line comments and block comments before scanning.
 * MP-277's footnote bug: a scanner over RAW SOURCE counts the very sentence
 * that documents the violation, so a wave that documents a site it fixed trades
 * a real violation for a phantom and the count stops meaning anything.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (state === "code") {
      if (two === "//") { state = "line"; i += 2; continue; }
      if (two === "/*") { state = "block"; i += 2; continue; }
      // Preserve string bodies verbatim: blanking them would make every
      // fallback literal vanish and the guard would pass by measuring nothing.
      if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
        const q = src[i];
        out += src[i++];
        while (i < src.length) {
          if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
          out += src[i];
          if (src[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      out += src[i++];
    } else if (state === "line") {
      if (src[i] === "\n") { state = "code"; out += "\n"; }
      i++;
    } else {
      if (two === "*/") { state = "code"; i += 2; continue; }
      if (src[i] === "\n") out += "\n";
      i++;
    }
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (rel.includes("shared/api/agentDisplayNames")) continue; // defines the sanctioned value
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, idx) => {
    if (!NAME_FIELD.test(line)) return;
    const m = PLACEHOLDER_WORD.exec(line);
    if (!m) return;
    if (!ROLE_NOUN.test(m[1].trim())) return;
    violations.push(`${rel}:${idx + 1} — name falls back to "${m[1]}"`);
  });
}

const count = violations.length;
for (const v of violations) console.log("  " + v);

if (count > BASELINE) {
  console.error(
    `\nFAIL check-agent-name-fallback: ${count} placeholder name fallback(s), baseline ${BASELINE}.\n` +
      `A name that falls back to a WORD renders a broken lookup as a real person.\n` +
      `Use resolveAgentNames() from @/shared/api/agentDisplayNames — it resolves\n` +
      `via get_leaderboard_profiles() (SECURITY DEFINER, survives the profiles\n` +
      `RLS lockdown) then display_name, and returns AGENT_NAME_FALLBACK ("—").`,
  );
  process.exit(1);
}
if (count < BASELINE) {
  console.error(
    `\nFAIL check-agent-name-fallback: ${count} < baseline ${BASELINE}. Lower BASELINE to ${count} to lock the win in.`,
  );
  process.exit(1);
}
console.log(`OK check-agent-name-fallback: ${count} placeholder name fallbacks (baseline ${BASELINE}).`);
