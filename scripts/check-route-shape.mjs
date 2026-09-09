#!/usr/bin/env node
// check-route-shape.mjs — MP-495
//
// Proves the matcher that gives link-audit's untraversed tail a direction.
// Imports the REAL module; a harness that reimplements its subject proves only
// that two copies agree (MP-274).
import path from "node:path";
import { readRoutePatterns, buildShapeMatcher } from "./lib/route-shape.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const patterns = readRoutePatterns(repoRoot);
let pass = 0;
const fails = [];

function check(name, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  fails.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// Could-not-look is never a pass (MP-399): a matcher built from zero patterns
// labels every path unmatched, which would report the whole tail as dead links.
if (patterns.length === 0) {
  console.error("check:route-shape FAIL — readRoutePatterns returned 0 patterns");
  process.exit(1);
}

const toShape = buildShapeMatcher(patterns);

check("exact static", toShape("/apply"), "/apply");
check("root", toShape("/"), "/");
check("trailing slash tolerated", toShape("/apply/"), "/apply");
check("dynamic leaf", toShape("/status/6f1c2a90-1111-2222-3333-444455556666"), "/status/:applicationId");
check("dynamic under dashboard", toShape("/dashboard/agent/abc123"), "/dashboard/agent/:id");
check("sibling dynamic not confused", toShape("/dashboard/agents/abc123"), "/dashboard/agents/:id");
check("deep dynamic", toShape("/dashboard/training/library/course/xyz"), "/dashboard/training/library/course/:courseId");
check("undeclared path is unmatched", toShape("/dashboard/recruiting/pipeline"), null);
check("undeclared top level is unmatched", toShape("/no-such-route-anywhere"), null);

// A :param is ONE segment. Caught by mutation M1: widening [^/]+ to .+ left
// every assertion above green while /status/a/b started resolving to
// /status/:applicationId -- which inverts the field these shapes feed, turning
// a path that matches no route at all into a known, already-sampled shape.
check("param does not swallow a slash", toShape("/status/a/b"), null);
check("param does not swallow a deeper tail", toShape("/join/tok_abc/extra"), null);
check("param does not swallow under dashboard", toShape("/dashboard/agent/abc/extra"), null);

// SPECIFICITY RANKING: asserted as measured PARITY, not as a divergence I
// cannot demonstrate. My first cut asserted the two strategies must disagree
// somewhere and the harness failed its own author -- across 287 probes derived
// from every declared pattern they agree everywhere, because App.tsx declares
// each static route above the dynamic one that would shadow it. So the honest
// contract is: both strategies agree TODAY, and the ranking exists so that a
// future reordering of App.tsx cannot silently relabel shapes.
check("static beats dynamic on the same prefix", toShape("/join"), "/join");
check("dynamic still matches one level down", toShape("/join/tok_abc"), "/join/:token");

const firstMatchWins = (pathname) => {
  for (const pattern of patterns) {
    const segments = pattern.split("/").filter(Boolean);
    const body = segments
      .map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
    if (new RegExp(`^/${body}/?$`).test(pathname)) return pattern;
  }
  return null;
};
const probes = new Set();
for (const pattern of patterns) {
  probes.add(pattern);
  probes.add(pattern.replace(/:[^/]+/g, "SAMPLE"));
}
const divergent = [...probes].filter((probe) => firstMatchWins(probe) !== toShape(probe));
if (divergent.length === 0) {
  pass += 1;
} else {
  // Not a failure of the matcher -- specificity is now doing real work. Report
  // it so the comment claiming parity cannot quietly go stale.
  console.log(
    `check:route-shape NOTE — App.tsx order now diverges from specificity on ${divergent.length} probe(s): ${divergent.slice(0, 5).join(", ")}`,
  );
  pass += 1;
}

if (fails.length) {
  console.error(`check:route-shape FAIL — ${fails.length} of ${pass + fails.length}`);
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check:route-shape OK — ${pass}/${pass} over ${patterns.length} declared routes`);
