#!/usr/bin/env node
/**
 * check-team-hierarchy-rpc — the command-center "Team Hierarchy + Downline
 * Production" card MUST read through the admin-gated RPC, never the raw view.
 *
 * WHY THIS EXISTS (MP-WIB-TEAM-HIERARCHY-RPC, 2026-11-22). TeamHierarchyWidget
 * reads downline production for the DashboardCommandCenter. Its underlying view
 * v_agent_with_downline_production is a security_invoker view over `agents` +
 * `v_team_hierarchy`, which the `authenticated` role cannot SELECT — so a direct
 * .from("v_agent_with_downline_production") 403s EVERY caller, including Sam, and
 * the card went dark (it rendered "0 recruiters / $0 team MTD" until 399557c3
 * gave it an isError state). The tempting "fix" — flipping the view to a definer
 * view (security_invoker=false) to match its command-center siblings — is a LEAK:
 * unlike v_agent_command_center (which filters on auth.uid()), this view has NO
 * caller-uid filter and NO admin filter, so a definer flip would expose every
 * manager's downline production to every logged-in agent.
 *
 * The ONLY safe read path is the SECURITY DEFINER RPC get_team_downline_production(),
 * hard-gated by apex_is_admin(): the owner can read the base objects, non-admins
 * get a 42501 deny (proven both directions in prod before shipping). This guard
 * pins that path so the widget can never regress to either failure mode:
 *   1. back to the 403-ing direct view read (card goes dark again), or
 *   2. to a direct read that only works because someone flipped the view to a
 *      definer view (silent org-wide downline leak).
 *
 * WHAT IT ASSERTS (static, comments stripped so prose mentions never count):
 *   - TeamHierarchyWidget.tsx DOES call .rpc("get_team_downline_production")
 *   - TeamHierarchyWidget.tsx does NOT .from("v_agent_with_downline_production")
 *
 * `--selftest` proves the pure evaluator both directions with no fs. A file that
 * cannot be read is exit 2 and is NEVER laundered into a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WIDGET = "src/components/dashboard/TeamHierarchyWidget.tsx";
const REQUIRED_RPC = "get_team_downline_production";
const FORBIDDEN_VIEW = "v_agent_with_downline_production";

// Evaluate ALREADY-STRIPPED source. Returns the two facts the verdict needs.
export function evaluate(stripped) {
  const usesRpc = new RegExp(
    `\\.rpc\\(\\s*["'\`]${REQUIRED_RPC}["'\`]`,
  ).test(stripped);
  const readsRawView = new RegExp(
    `\\.from\\(\\s*["'\`]${FORBIDDEN_VIEW}["'\`]`,
  ).test(stripped);
  return { usesRpc, readsRawView };
}

function selftest() {
  let pass = 0;
  let total = 0;
  const ok = (cond, label) => {
    total++;
    if (cond) {
      pass++;
    } else {
      console.error(`  ✗ ${label}`);
    }
  };

  // Direction 1 — the healthy shape passes.
  ok(
    (() => {
      const r = evaluate(`const { data } = await supabase.rpc("${REQUIRED_RPC}" as never);`);
      return r.usesRpc && !r.readsRawView;
    })(),
    "the admin-gated RPC read is OK",
  );

  // Direction 2 — the 403-ing direct view read fails.
  ok(
    (() => {
      const r = evaluate(`const { data } = await supabase.from("${FORBIDDEN_VIEW}").select("*");`);
      return !r.usesRpc && r.readsRawView;
    })(),
    "a direct .from(view) read is caught",
  );

  // Footnote-bug robustness — the forbidden view named ONLY in a comment must
  // not count as a raw read. Prove end-to-end through the real stripComments.
  ok(
    (() => {
      const stripped = stripComments(
        `// a direct .from("${FORBIDDEN_VIEW}") 403s every caller\nconst { data } = await supabase.rpc("${REQUIRED_RPC}" as never);`,
      );
      const r = evaluate(stripped);
      return r.usesRpc && !r.readsRawView;
    })(),
    "the forbidden view named only in a comment is NOT a raw read",
  );

  // Whitespace/quote tolerance inside .rpc( ... ).
  ok(evaluate(`supabase.rpc( '${REQUIRED_RPC}' )`).usesRpc, "single-quoted + spaced rpc call counts");

  console.log(`\ncheck:team-hierarchy-rpc --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) {
    console.error("SELFTEST FAILED — the team-hierarchy-rpc verdict is wrong.");
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let stripped;
  try {
    stripped = stripComments(fs.readFileSync(path.join(repoRoot, WIDGET), "utf8"));
  } catch (e) {
    console.error(`check:team-hierarchy-rpc — COULD NOT READ ${WIDGET}: ${e.message}`);
    process.exit(2);
  }

  const { usesRpc, readsRawView } = evaluate(stripped);

  if (readsRawView) {
    console.error(
      `check:team-hierarchy-rpc — DANGEROUS READ PATH: ${WIDGET} reads .from("${FORBIDDEN_VIEW}") directly.`,
    );
    console.error(
      `  That view 403s every caller (security_invoker over agents + v_team_hierarchy) OR, if it was flipped to a definer view, leaks every manager's downline to every agent.`,
    );
    console.error(`  Read through supabase.rpc("${REQUIRED_RPC}") instead (SECURITY DEFINER + apex_is_admin() gate).`);
    process.exit(1);
  }

  if (!usesRpc) {
    console.error(
      `check:team-hierarchy-rpc — MISSING SAFE READ PATH: ${WIDGET} does not call .rpc("${REQUIRED_RPC}").`,
    );
    console.error(`  The team/downline card must read through the admin-gated RPC, not a direct table/view read.`);
    process.exit(1);
  }

  console.log(
    `check:team-hierarchy-rpc — OK: ${WIDGET} reads downline production via the admin-gated RPC ${REQUIRED_RPC}().`,
  );
  process.exit(0);
}
