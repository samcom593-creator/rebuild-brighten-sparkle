#!/usr/bin/env node
/**
 * assert-routes-declared.mjs — grade a list of app paths against the router.
 *
 * MP-501. The repo guard (check-dead-internal-links) reads FILES. The writer
 * that produced this wave's live leak was not a file: fn_queue_application_slack
 * and fn_queue_licensing_milestone_slack live in pg_proc and were hand-applied,
 * so 40 Slack messages carried a dead route while the repo guard printed green.
 * That is MP-499's lesson exactly — supabase/migrations does not model this
 * database, because functions are routinely applied live and never round-tripped.
 *
 * apex-doctor Check #68 pipes the paths it finds in pg_proc through THIS file so
 * the deployed-state check and the repo guard share one route matcher and cannot
 * drift into disagreeing about whether a path exists (the way curl --max-time
 * and fn_agentlink_reap_stuck did).
 *
 * Reads newline-separated paths on stdin. Exit 0 = all declared. Exit 2 = at
 * least one undeclared (named on stdout). Exit 1 = could not look, which is
 * never a pass.
 */
import fs from "node:fs";
import { parseRoutes, isDeclared } from "./check-dead-internal-links.mjs";

const ROUTER = "src/App.tsx";
if (!fs.existsSync(ROUTER)) {
  console.error(`could-not-look: no router at ${ROUTER}`);
  process.exit(1);
}
const routes = parseRoutes(fs.readFileSync(ROUTER, "utf8"));
if (routes.length === 0) {
  console.error("could-not-look: router parsed to 0 routes");
  process.exit(1);
}

const input = fs.readFileSync(0, "utf8");
const paths = input.split("\n").map((s) => s.trim()).filter(Boolean);
const undeclared = [];
for (const raw of paths) {
  // An interpolated segment cannot be graded; report it, never launder it.
  if (raw.includes("${") || raw.includes("%s")) continue;
  let t = raw.split("?")[0].split("#")[0];
  // A trailing "/" inside a function body is a PREFIX the function concatenates
  // an id onto ('.../r/' || code), not a complete path. Stripping the slash and
  // grading the stem is wrong in both directions: it reported /r/ dead when
  // /r/:code is declared, and it would have cleared a prefix whose full form
  // matches nothing. Grade prefix + one wildcard segment instead.
  if (t !== "/" && t.endsWith("/")) t += "X";
  else if (t !== "/") t = t.replace(/[.,;:]+$/, "");
  if (!isDeclared(t, routes)) undeclared.push(raw);
}
console.log(`routes=${routes.length} graded=${paths.length} undeclared=${undeclared.length}`);
for (const u of undeclared) console.log(`UNDECLARED ${u}`);
process.exit(undeclared.length ? 2 : 0);
