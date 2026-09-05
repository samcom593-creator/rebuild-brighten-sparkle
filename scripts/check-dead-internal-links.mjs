#!/usr/bin/env node
/**
 * check-dead-internal-links.mjs — every in-app link must point at a declared route.
 *
 * WHY: react-router renders path="*" for anything it does not recognise, and
 * vercel.json 200s every URL (MP-295), so a link to a route that does not exist
 * is invisible to HTTP monitoring, invisible to the post-deploy route smoke
 * (fixed list), and invisible to tsc (`to` is just a string). The only symptom
 * is a user clicking a button and landing on "That path doesn't exist."
 *
 * Found by MP-433: three such links shipped — a per-agent row pointing at
 * /admin/agents (no such route; /dashboard/agents is the real one) and two
 * CTAs on /dashboard/client-marketing pointing at /dashboard/recruiting/pipeline
 * (siblings /dashboard/recruiting/{follow-ups,hires,interviews} exist, that one
 * never did).
 *
 * NO BASELINE COUNT, deliberately. A count-only floor is fungible — a real
 * regression can be laundered by an unrelated pay-down and still read green
 * (MP-356/357). The contract here is zero, which cannot be traded against.
 *
 * Could-not-look is never a pass: if the router cannot be read or parses to
 * zero routes, this exits 1 rather than reporting a clean tree (MP-399).
 */
import fs from "node:fs";
import path from "node:path";

const ROUTER = "src/App.tsx";
const SRC = "src";

/** Strip // and /* *\/ comments, PRESERVING line count — a link inside a
 *  comment must not count (MP-277's footnote bug), but a collapsed block
 *  comment shifts every line number after it and makes the report lie. */
export function stripComments(src) {
  let out = "", i = 0;
  const n = src.length;
  let inStr = null, tpl = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (tpl) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === "`") tpl--;
      i++; continue;
    }
    if (c === '"' || c === "'") { inStr = c; out += c; i++; continue; }
    if (c === "`") { tpl++; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

export function parseRoutes(routerSrc) {
  return [...stripComments(routerSrc).matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
}

/** A concrete target is declared if some route matches segment-for-segment,
 *  with :param as a wildcard. path="*" is the 404 itself and never matches. */
export function isDeclared(target, routes) {
  const t = target.split("/").filter(Boolean);
  for (const r of routes) {
    if (r === "*") continue;
    const rs = r.split("/").filter(Boolean);
    if (rs.length !== t.length) continue;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i] === "*") { ok = true; break; }
      if (rs[i].startsWith(":")) continue;
      if (rs[i] !== t[i]) { ok = false; break; }
    }
    if (ok) return r;
  }
  return null;
}

const LINK_PATTERNS = [
  /\bto="(\/[^"]*)"/g,
  /\bhref="(\/[^"]*)"/g,
  /\bnavigate\(\s*["'`](\/[^"'`]*)["'`]/g,
  /\bto=\{\s*[`"'](\/[^`"']*)[`"']\s*\}/g,
];

export function scanFile(file, src, routes) {
  const dead = [], unprovable = [];
  const lines = stripComments(src).split("\n");
  const seen = new Set();
  lines.forEach((line, idx) => {
    for (const re of LINK_PATTERNS) {
      for (const m of line.matchAll(new RegExp(re.source, re.flags))) {
        const raw = m[1];
        if (raw.startsWith("//")) continue; // protocol-relative = external
        const key = `${idx}:${raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const interpolated = raw.includes("${");
        let t = raw.split("?")[0].split("#")[0].replace(/\$\{[^}]*\}/g, "X");
        if (t !== "/") t = t.replace(/\/$/, "");
        if (isDeclared(t, routes)) continue;
        (interpolated ? unprovable : dead).push({ file, line: idx + 1, raw });
      }
    }
  });
  return { dead, unprovable };
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git|dist|__pycache__/.test(e.name)) walk(p, acc); }
    else if (/\.(tsx|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function main() {
  if (!fs.existsSync(ROUTER)) {
    console.error(`❌ cannot read the router at ${ROUTER} — refusing to report a clean tree.`);
    process.exit(1);
  }
  const routes = parseRoutes(fs.readFileSync(ROUTER, "utf8"));
  if (routes.length === 0) {
    console.error(`❌ parsed 0 routes from ${ROUTER}. Either the router changed shape or this guard is broken; either way it cannot vouch for anything.`);
    process.exit(1);
  }
  let dead = [], unprovable = [], scanned = 0;
  for (const f of walk(SRC)) {
    if (path.normalize(f) === path.normalize(ROUTER)) continue;
    scanned++;
    const r = scanFile(f, fs.readFileSync(f, "utf8"), routes);
    dead.push(...r.dead);
    unprovable.push(...r.unprovable);
  }
  console.log(`dead-internal-links: ${routes.length} declared routes, ${scanned} files scanned`);
  if (unprovable.length) {
    // Reported as its own outcome, never laundered into pass or fail.
    console.log(`  ${unprovable.length} interpolated target(s) unprovable (target is built at runtime):`);
    for (const u of unprovable) console.log(`    ${u.file}:${u.line}  ${u.raw}`);
  }
  if (dead.length) {
    console.error(`\n❌ ${dead.length} internal link(s) point at a path the router does not declare.`);
    console.error(`   A user clicking these gets the 404 page. Nothing else in this repo can see it:`);
    console.error(`   vercel.json 200s every URL, route-smoke walks a fixed list, and tsc sees only a string.\n`);
    for (const d of dead) console.error(`    ${d.file}:${d.line}  ->  ${d.raw}`);
    console.error(`\n   Fix the target, or add the route to ${ROUTER}.`);
    process.exit(1);
  }
  console.log("✅ every literal internal link resolves to a declared route.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
