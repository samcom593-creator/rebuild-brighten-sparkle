#!/usr/bin/env node
// check-llms-txt.mjs — keep the public /llms.txt a real, live, on-brand file.
// Owned by Website Integrity Bot (Check #9/#10 — trust + AI discoverability / GEO).
//
// Why this guard exists (MP-WIB-LLMS-TXT, 2026-11-21):
//   A 2026-11-21 fetch of galaxyfinancial.org/llms.txt (and /ai.txt and
//   /.well-known/ai-plugin.json) returned HTTP 200 with text/html — the 16KB
//   SPA index.html shell, not a real file. The vercel.json rewrite
//   `/((?!api/|assets/|fonts/|img/).*)` sends every unknown path to index.html,
//   but Vercel serves EXISTING static files from public/ first (proven live:
//   /robots.txt and /sitemap.xml return their true content). So a real
//   public/llms.txt is served as a real file; absent it, crawlers that look for
//   an llms.txt get a soft-200 HTML page, which is worse than a 404.
//
//   llms.txt (llmstxt.org) is the markdown map that LLM crawlers / GEO pipelines
//   read to summarise a site — the natural complement to the static
//   Organization + VideoObject + FAQPage JSON-LD already in index.html. The two
//   sibling steer targets were deliberately NOT shipped and are not guarded:
//   /.well-known/ai-plugin.json targets the dead OpenAI plugin-manifest spec, and
//   /ai.txt is an AI-training OPT-OUT, redundant with an already-permissive
//   robots.txt on a funnel that WANTS AI crawlers.
//
//   A stale llms.txt is worse than none, so this guard makes drift impossible:
//     1. public/llms.txt exists, is non-trivial, and has EXACTLY ONE H1.
//     2. Its H1 carries the SAME brand token as index.html's served <title>
//        (the SEO truth check-index-brand already protects) — so a rebrand that
//        updates the title but not llms.txt fails the build.
//     3. Every absolute link is on galaxyfinancial.org AND appears as a <loc> in
//        public/sitemap.xml — so a page removed from the sitemap can't linger as
//        a dead link here (the SPA canonical/sitemap-drift + dead-link class).
//     4. No unqualified $-magnitude income claim (reuses the decimal/aggregate
//        earnings-claim compliance discipline on this public recruiting surface;
//        commission % and the $50,000 production threshold are not income claims).
//
// Usage:
//   node scripts/check-llms-txt.mjs            # guard the real tree
//   node scripts/check-llms-txt.mjs --selftest # hermetic proof (no network, no real files)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LLMS_REL = "public/llms.txt";
const INDEX_REL = "index.html";
const SITEMAP_REL = "public/sitemap.xml";
const DOMAIN = "galaxyfinancial.org";
const MIN_BYTES = 300;

// $-magnitude income shapes: "$1.2M", "$150M", "$5MM", "$2B", "$5 million".
// Deliberately NOT matched: "$50,000" (threshold, comma form, no M/B suffix),
// "70%–145%" (commission percentage).
const EARNINGS_MAGNITUDE = /\$\s?\d+(?:\.\d+)?\s?(?:MM|M|B)\b|\$\s?\d+(?:\.\d+)?\s?(?:million|billion)\b/gi;

/** Pull the brand token from a served <title>: text before the first dash/pipe. */
function brandFromTitle(titleHtml) {
  const m = titleHtml.match(/<title>([^<]*)<\/title>/i);
  if (!m) return null;
  const inner = m[1].trim();
  // Split on " — ", " – ", " - ", or " | " (first separator wins).
  const brand = inner.split(/\s[—–|]\s|\s-\s/)[0].trim();
  return brand || null;
}

/** Collect <loc> values from a sitemap.xml string. */
function sitemapLocs(sitemapXml) {
  const locs = new Set();
  for (const m of sitemapXml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    locs.add(normalizeUrl(m[1]));
  }
  return locs;
}

/** Normalise a URL for comparison: drop a single trailing slash (keep bare root as "/"). */
function normalizeUrl(u) {
  const t = u.trim();
  const noTrail = t.replace(/\/+$/, "");
  return noTrail === `https://${DOMAIN}` ? `https://${DOMAIN}/` : noTrail;
}

/** Pure validator so the real check and the selftest share one code path. */
function validate({ llmsText, titleHtml, sitemapXml }) {
  const errors = [];

  // 1. Non-trivial + exactly one H1.
  if (!llmsText || llmsText.trim().length < MIN_BYTES) {
    errors.push(`llms.txt missing or trivial (<${MIN_BYTES} bytes of content)`);
    return errors; // nothing else is meaningful without a body
  }
  const h1s = llmsText.split(/\r?\n/).filter((l) => /^#\s+\S/.test(l));
  if (h1s.length !== 1) {
    errors.push(`llms.txt must have exactly one H1 ("# ..."), found ${h1s.length}`);
  }

  // 2. Brand parity with served <title>.
  const brand = brandFromTitle(titleHtml);
  if (!brand) {
    errors.push("could not read brand from index.html <title>");
  } else if (h1s.length === 1 && !h1s[0].includes(brand)) {
    errors.push(
      `llms.txt H1 "${h1s[0].trim()}" does not carry the served brand "${brand}" ` +
        `(index.html <title>). Rebrand drift — update public/llms.txt.`,
    );
  }

  // 3. Every absolute link on-domain AND present in sitemap.
  const locs = sitemapLocs(sitemapXml);
  const urls = new Set();
  // markdown link targets
  for (const m of llmsText.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
  // bare absolute urls in prose
  for (const m of llmsText.matchAll(/https?:\/\/[^\s)]+/g)) urls.add(m[0]);

  for (const raw of urls) {
    let host;
    try {
      host = new URL(raw).host;
    } catch {
      errors.push(`unparseable URL in llms.txt: ${raw}`);
      continue;
    }
    if (host !== DOMAIN) {
      errors.push(`off-domain URL in llms.txt (expected ${DOMAIN}): ${raw}`);
      continue;
    }
    const norm = normalizeUrl(raw);
    if (!locs.has(norm)) {
      errors.push(
        `llms.txt links ${raw} but it is not a <loc> in sitemap.xml ` +
          `(dead-link / sitemap-drift). Add it to the sitemap or drop it here.`,
      );
    }
  }

  // 4. No unqualified $-magnitude income claim.
  const earnings = [...llmsText.matchAll(EARNINGS_MAGNITUDE)].map((m) => m[0]);
  if (earnings.length) {
    errors.push(
      `unqualified $-magnitude income claim(s) in llms.txt: ${earnings.join(", ")} ` +
        `(FTC/state-insurance-visible recruiting surface — remove or qualify).`,
    );
  }

  return errors;
}

function runReal() {
  let llmsText, titleHtml, sitemapXml;
  try {
    llmsText = readFileSync(join(ROOT, LLMS_REL), "utf8");
  } catch {
    console.error(`❌ check-llms-txt: ${LLMS_REL} does not exist (soft-200 HTML would be served instead).`);
    process.exit(1);
  }
  titleHtml = readFileSync(join(ROOT, INDEX_REL), "utf8");
  sitemapXml = readFileSync(join(ROOT, SITEMAP_REL), "utf8");

  const errors = validate({ llmsText, titleHtml, sitemapXml });
  if (errors.length) {
    console.error("❌ check-llms-txt FAILED:");
    for (const e of errors) console.error("   - " + e);
    process.exit(1);
  }
  const linkCount = (llmsText.match(/\]\(https?:\/\//g) || []).length;
  console.log(`✅ check-llms-txt: ${LLMS_REL} live, on-brand, ${linkCount} sitemap-verified links, no income claims.`);
}

function runSelftest() {
  const GOOD_TITLE = "<title>Galaxy Financial — Start Your Career in Insurance Sales</title>";
  const GOOD_SITEMAP = `<?xml version="1.0"?><urlset>
    <url><loc>https://galaxyfinancial.org/</loc></url>
    <url><loc>https://galaxyfinancial.org/apply</loc></url>
    <url><loc>https://galaxyfinancial.org/vsl</loc></url>
  </urlset>`;
  const GOOD_LLMS = `# Galaxy Financial

> Galaxy Financial recruits life-insurance sales agents with warm leads and weekly pay. This blockquote is padding to clear the minimum content length so the real failure modes are what get exercised in this hermetic selftest harness run.

## Apply
- [Apply](https://galaxyfinancial.org/apply): start here.
- [Watch the overview](https://galaxyfinancial.org/vsl): how it works.
`;

  const cases = [
    { name: "good file passes", input: { llmsText: GOOD_LLMS, titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP }, expectFail: false },
    { name: "missing/empty fails", input: { llmsText: "", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP }, expectFail: true },
    { name: "trivial body fails", input: { llmsText: "# Galaxy Financial\n\ntoo short", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP }, expectFail: true },
    {
      name: "two H1s fail",
      input: { llmsText: GOOD_LLMS + "\n# Second Heading That Should Not Exist Here Padding Padding Padding\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "brand drift fails (title Galaxy, llms Apex)",
      input: { llmsText: GOOD_LLMS.replace("# Galaxy Financial", "# Apex Financial"), titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "dead link fails (not in sitemap)",
      input: { llmsText: GOOD_LLMS + "- [Ghost](https://galaxyfinancial.org/ghost-page): nope.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "off-domain link fails",
      input: { llmsText: GOOD_LLMS + "- [Elsewhere](https://evil.example.com/x): nope.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "earnings magnitude fails ($2.5M)",
      input: { llmsText: GOOD_LLMS + "Earn $2.5M your first year.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "earnings spelled fails ($5 million)",
      input: { llmsText: GOOD_LLMS + "Make $5 million fast.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: true,
    },
    {
      name: "$50,000 threshold does NOT fail",
      input: { llmsText: GOOD_LLMS + "Reserved for $50,000+ monthly production.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: false,
    },
    {
      name: "70%–145% commission does NOT fail",
      input: { llmsText: GOOD_LLMS + "Commissions run 70%–145% paid weekly.\n", titleHtml: GOOD_TITLE, sitemapXml: GOOD_SITEMAP },
      expectFail: false,
    },
  ];

  let pass = 0;
  for (const c of cases) {
    const errs = validate(c.input);
    const failed = errs.length > 0;
    const ok = failed === c.expectFail;
    if (ok) {
      pass++;
      console.log(`  ✓ ${c.name}${failed ? " (fired: " + errs[0] + ")" : ""}`);
    } else {
      console.error(`  ✗ ${c.name}: expected ${c.expectFail ? "FAIL" : "PASS"}, got ${failed ? "FAIL" : "PASS"} :: ${errs.join("; ")}`);
    }
  }
  if (pass !== cases.length) {
    console.error(`❌ check-llms-txt selftest: ${pass}/${cases.length}`);
    process.exit(1);
  }
  console.log(`✅ check-llms-txt selftest: ${pass}/${cases.length}`);
}

if (process.argv.includes("--selftest")) runSelftest();
else runReal();
