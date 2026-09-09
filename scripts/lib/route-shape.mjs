// route-shape.mjs — what shape of page is this URL?
//
// Extracted from link-audit.mjs so its proof can import the REAL matcher. A
// harness that reimplements the code it guards proves only that two copies
// agree (MP-274).
import fs from "node:fs";
import path from "node:path";

// A count of untraversed pages answers "how many URLs sat in a list". It does
// not say whether the tail is 600 instances of one template the crawl already
// sampled -- correct sampling, nothing owed -- or a route shape this audit has
// never once opened. Those want opposite responses and the number cannot tell
// them apart, which is the same operand error that turned a NULL-column count
// into a $2.34M leak that was never owed. App.tsx is the oracle for what shape
// a URL is, so the tail is grouped by the pattern the router would match.
export function readRoutePatterns(repoRoot) {
  const appPath = path.join(repoRoot, "src/App.tsx");
  if (!fs.existsSync(appPath)) return [];
  const source = fs.readFileSync(appPath, "utf8");
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((route) => route.startsWith("/"));
}

export function buildShapeMatcher(patterns) {
  const compiled = patterns.map((pattern) => {
    const segments = pattern.split("/").filter(Boolean);
    const body = segments
      .map((segment) =>
        segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return {
      pattern,
      regex: new RegExp(`^/${body}/?$`),
      literalSegments: segments.filter((segment) => !segment.startsWith(":")).length,
      depth: segments.length,
    };
  });
  // react-router ranks by specificity, not declaration order, so this does too.
  // HONEST ABOUT WHAT THAT BUYS: measured 2026-09-09 over 287 probes derived
  // from all 270 declared patterns, this and a naive first-match-wins agree on
  // every single one -- App.tsx happens to declare each static route above the
  // dynamic pattern that would shadow it. The ranking is therefore DEFENSIVE
  // against a future reordering of App.tsx, not a fix for a live mislabel, and
  // the proof asserts the parity rather than claiming a divergence it cannot
  // demonstrate.
  return (pathname) => {
    let best = null;
    for (const entry of compiled) {
      if (!entry.regex.test(pathname)) continue;
      if (
        !best ||
        entry.literalSegments > best.literalSegments ||
        (entry.literalSegments === best.literalSegments && entry.depth > best.depth)
      ) {
        best = entry;
      }
    }
    return best ? best.pattern : null;
  };
}
