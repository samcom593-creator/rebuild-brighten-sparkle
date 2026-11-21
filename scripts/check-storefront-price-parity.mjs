#!/usr/bin/env node
/**
 * check-storefront-price-parity.mjs — assert that wherever the frontend hardcodes
 * the SAME Stripe Payment Link (buy.stripe.com/<code>), every surface displays the
 * SAME price. A commit-time, Stripe-free guard on Apex's ONLY recurring-revenue line.
 *
 * WHY THIS EXISTS (2026-11-21, MP-WIB-STOREFRONT-CROSS-SURFACE-PRICE):
 *   The gold ($250/wk) + platinum ($500/wk) lead subscriptions are served by TWO
 *   customer-facing surfaces that each HARDCODE the price next to the buy link:
 *     - src/pages/Storefront.tsx            price: "$250 / week"  href: buy.stripe.com/<code>
 *     - src/components/dashboard/OffersTiles amount: 250, cadence: "weekly"  paymentLink: ...
 *   Stripe Payment Link prices are IMMUTABLE — raising a price means minting a NEW
 *   link (new code) and repointing the site. finance-bot/scripts/stripe-site-price-parity.py
 *   already ties each displayed price to the amount Stripe actually CHARGES — but that
 *   runs POST-DEPLOY on a ~6h launchd cadence and needs the live Stripe API. Nothing
 *   catches a one-surface price/link edit at COMMIT time, so a wrong price on the only
 *   recurring-revenue line can ship and sit live (bait-and-switch / confused buyer)
 *   until the next finance-bot pulse. This guard shifts that detection LEFT: it blocks
 *   a PR where two places reference the same buy.stripe.com code but disagree on price.
 *   It is the pre-merge COMPLEMENT, not a replacement: it cannot see displayed!=charged
 *   when both surfaces agree-but-are-both-wrong (that stays finance-bot's Stripe check).
 *
 * HONESTY (per the 465-fake-success lesson):
 *   - A MISMATCH requires a code with >=2 DISTINCT confidently-parsed (dollars, interval).
 *     That alone fails the build.
 *   - A code that appears but whose price cannot be parsed ANYWHERE -> "unprovable":
 *     reported, suppresses the clean all-clear, but does NOT fail (it may be a
 *     comment-only reference, never a false page).
 *   - Zero buy.stripe.com codes in src -> NOTE + exit 0 (links legitimately could move
 *     to env/DB; a hard fail there would be wrong).
 *   - Aggregated per CODE, not per occurrence: a code priced+matching in one file is
 *     verified even if it also appears price-less in a comment.
 *
 * Extractor mirrors finance-bot/scripts/stripe-site-price-parity.py (same CODE/PRICE/
 * CADENCE regexes + interval vocab + balanced-brace enclosing-object) so the two
 * guards cannot disagree on what a displayed price IS.
 *
 * Usage:
 *   node scripts/check-storefront-price-parity.mjs [srcDir]     # default: ./src
 *   node scripts/check-storefront-price-parity.mjs --selftest   # in-memory, writes nothing
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const CODE_RE = /buy\.stripe\.com\/([A-Za-z0-9]+)/g;
const PRICE_STR_RE = /price\s*:\s*"\$\s*([\d,]+)\s*\/\s*([A-Za-z]+)"/;
const AMOUNT_NUM_RE = /amount\s*:\s*(\d+)/;
const CADENCE_RE = /cadence\s*:\s*"([A-Za-z-]+)"/;
const INTERVAL = {
  week: "week", weekly: "week", wk: "week",
  month: "month", monthly: "month", mo: "month",
  year: "year", yearly: "year", annual: "year", annually: "year",
  once: "once", "one-time": "once", onetime: "once", one: "once",
  day: "day", daily: "day",
};
const normInterval = (w) => (w ? INTERVAL[w.trim().toLowerCase()] ?? null : null);

// Return the balanced {...} object literal that encloses position `at`, or null.
function enclosingObject(text, at) {
  let depth = 0, openIdx = -1;
  for (let j = at; j >= 0; j--) {
    const c = text[j];
    if (c === "}") depth++;
    else if (c === "{") { if (depth === 0) { openIdx = j; break; } depth--; }
  }
  if (openIdx < 0) return null;
  depth = 0;
  for (let k = openIdx; k < text.length; k++) {
    const c = text[k];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(openIdx, k + 1); }
  }
  return null;
}

// Extract (dollars:int, interval:str) displayed inside an object literal, or null.
function priceOfObject(obj) {
  if (!obj) return null;
  const m = PRICE_STR_RE.exec(obj); // Storefront.tsx: price: "$250 / week"
  if (m) {
    const dollars = parseInt(m[1].replace(/,/g, ""), 10);
    const iv = normInterval(m[2]);
    return iv ? { dollars, interval: iv } : null;
  }
  const ma = AMOUNT_NUM_RE.exec(obj); // OffersTiles.tsx: amount: 250, cadence: "weekly"
  const mc = CADENCE_RE.exec(obj);
  if (ma && mc) {
    const iv = normInterval(mc[1]);
    return iv ? { dollars: parseInt(ma[1], 10), interval: iv } : null;
  }
  return null;
}

function* iterSourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", "build"].includes(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* iterSourceFiles(p);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) yield p;
  }
}

// Returns { codes: Map<code, {prices:Set<"d/iv">, priced:[{dollars,interval,file}], files:Set} > }
function analyze(srcDir) {
  const codes = new Map();
  for (const path of iterSourceFiles(srcDir)) {
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    const rel = relative(srcDir, path);
    CODE_RE.lastIndex = 0;
    let m;
    while ((m = CODE_RE.exec(text))) {
      const code = m[1];
      if (!codes.has(code)) codes.set(code, { prices: new Map(), files: new Set() });
      const entry = codes.get(code);
      entry.files.add(rel);
      const obj = enclosingObject(text, m.index);
      const price = priceOfObject(obj);
      if (price) {
        const key = `${price.dollars}/${price.interval}`;
        if (!entry.prices.has(key)) entry.prices.set(key, { ...price, file: rel });
      }
    }
  }
  return codes;
}

function run(srcDir) {
  const codes = analyze(srcDir);
  const mismatches = [], unprovable = [], verified = [];
  for (const [code, e] of codes) {
    if (e.prices.size >= 2) {
      mismatches.push({ code, prices: [...e.prices.values()], files: [...e.files] });
    } else if (e.prices.size === 1) {
      const p = [...e.prices.values()][0];
      verified.push({ code, dollars: p.dollars, interval: p.interval, files: [...e.files] });
    } else {
      unprovable.push({ code, files: [...e.files] });
    }
  }
  return { mismatches, unprovable, verified, total: codes.size };
}

// ---- selftest ----
function selftest() {
  let fails = 0;
  const check = (name, cond) => { console.log(`${cond ? "ok" : "FAIL"}: ${name}`); if (!cond) fails++; };

  const mk = (files) => {
    const d = mkdtempSync(join(tmpdir(), "sf-parity-"));
    for (const [n, body] of Object.entries(files)) writeFileSync(join(d, n), body);
    return d;
  };
  const GOLD = "buy.stripe.com/goldCODE00000000000000";
  const PLAT = "buy.stripe.com/platCODE00000000000000";

  // (1) matching across both surfaces -> verified, no mismatch
  let d = mk({
    "Storefront.tsx": `const S=[{name:"Gold",price:"$250 / week",href:"https://${GOLD}"},{name:"Plat",price:"$500 / week",href:"https://${PLAT}"}];`,
    "OffersTiles.tsx": `const K=[{id:"gold",cadence:"weekly",amount:250,paymentLink:"https://${GOLD}"},{id:"plat",cadence:"weekly",amount:500,paymentLink:"https://${PLAT}"}];`,
  });
  let r = run(d); rmSync(d, { recursive: true, force: true });
  check("matching surfaces -> 0 mismatch", r.mismatches.length === 0);
  check("matching surfaces -> 2 verified", r.verified.length === 2);
  check("matching surfaces -> 0 unprovable", r.unprovable.length === 0);

  // (2) dollar drift on one surface -> mismatch
  d = mk({
    "Storefront.tsx": `const S=[{name:"Gold",price:"$250 / week",href:"https://${GOLD}"}];`,
    "OffersTiles.tsx": `const K=[{id:"gold",cadence:"weekly",amount:300,paymentLink:"https://${GOLD}"}];`,
  });
  r = run(d); rmSync(d, { recursive: true, force: true });
  check("dollar drift -> mismatch named", r.mismatches.length === 1 && r.mismatches[0].code === "goldCODE00000000000000");

  // (3) interval drift (same dollars, week vs month) -> mismatch
  d = mk({
    "Storefront.tsx": `const S=[{name:"Gold",price:"$250 / month",href:"https://${GOLD}"}];`,
    "OffersTiles.tsx": `const K=[{id:"gold",cadence:"weekly",amount:250,paymentLink:"https://${GOLD}"}];`,
  });
  r = run(d); rmSync(d, { recursive: true, force: true });
  check("interval drift -> mismatch", r.mismatches.length === 1);

  // (4) a code with no parseable price anywhere -> unprovable, not a mismatch
  d = mk({
    "Note.tsx": `// see https://${GOLD} for the gold plan (no price here)`,
  });
  r = run(d); rmSync(d, { recursive: true, force: true });
  check("price-less code -> unprovable", r.unprovable.length === 1 && r.mismatches.length === 0);

  // (5) priced in one file, comment-only in another -> verified (per-code aggregate)
  d = mk({
    "Storefront.tsx": `const S=[{name:"Gold",price:"$250 / week",href:"https://${GOLD}"}];`,
    "Note.tsx": `// buy.stripe.com/goldCODE00000000000000 is the gold link`,
  });
  r = run(d); rmSync(d, { recursive: true, force: true });
  check("priced + comment-only -> verified not unprovable", r.verified.length === 1 && r.unprovable.length === 0 && r.mismatches.length === 0);

  // (6) no codes at all -> empty (caller emits NOTE, exit 0)
  d = mk({ "Empty.tsx": `export const x = 1;` });
  r = run(d); rmSync(d, { recursive: true, force: true });
  check("no codes -> total 0", r.total === 0);

  console.log(fails === 0 ? "\nSELFTEST PASS" : `\nSELFTEST FAIL (${fails})`);
  process.exit(fails === 0 ? 0 : 1);
}

// ---- main ----
const arg = process.argv[2];
if (arg === "--selftest") {
  selftest();
} else {
  const srcDir = arg || "src";
  const { mismatches, unprovable, verified, total } = run(srcDir);

  if (total === 0) {
    console.log("NOTE: no buy.stripe.com payment links found in src — nothing to check.");
    process.exit(0);
  }

  for (const v of verified) {
    console.log(`  ✓ ${v.code}: $${v.dollars}/${v.interval} (${v.files.join(", ")})`);
  }
  for (const u of unprovable) {
    console.log(`  ? ${u.code}: referenced but no displayed price parseable (${u.files.join(", ")})`);
  }
  for (const mm of mismatches) {
    const shown = mm.prices.map((p) => `$${p.dollars}/${p.interval} (${p.file})`).join("  vs  ");
    console.error(`  ✗ ${mm.code}: SAME buy link shows DIFFERENT prices across surfaces — ${shown}`);
  }

  if (mismatches.length > 0) {
    console.error(`\n✗ ${mismatches.length} buy.stripe.com link(s) priced inconsistently across surfaces. ` +
      `A customer sees one price, another surface shows a different one on the same checkout. ` +
      `Fix the hardcoded price so every surface referencing the code agrees (and matches Stripe).`);
    process.exit(1);
  }
  if (unprovable.length > 0) {
    console.log(`\n⚠ ${verified.length} link(s) price-verified across surfaces; ${unprovable.length} referenced without a parseable price (not a failure).`);
    process.exit(0);
  }
  console.log(`\n✓ all ${verified.length} buy.stripe.com link(s) show a consistent price across every surface.`);
  process.exit(0);
}
