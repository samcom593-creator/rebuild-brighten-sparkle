#!/usr/bin/env node
// check-faq-schema-static.mjs — prove the public landing FAQ's structured data
// (FAQPage JSON-LD) is SERVED in static index.html, not injected by the
// client-only React component, AND that the served schema can never drift from
// the visible accordion copy.
// Owned by Website Integrity Bot (Check #9/#10 — trust + AI discoverability).
//
// Why this guard exists (MP-WIB-FAQ-STATIC-SCHEMA, 2026-11-21):
//   RecruitFAQ.tsx is a LAZY (client-side-only) landing component rendered inside
//   Index.tsx's <Suspense>/<LazyQueryRoot>. It USED to inject its own
//   <script type="application/ld+json"> FAQPage block via dangerouslySetInnerHTML.
//   index.html statically ships Organization + VideoObject JSON-LD — its own
//   comment says "for SERP + AI Overview eligibility", and check-index-brand's
//   header says that block is "the answer ChatGPT/[Perplexity] gives". But the
//   FAQPage lived ONLY in the lazy React tree, so the SERVED HTML never carried
//   it: a 2026-11-21 fetch of galaxyfinancial.org/ returned exactly 2 ld+json
//   blocks (Organization + VideoObject), no FAQPage. Non-JS crawlers — GPTBot,
//   ClaudeBot, PerplexityBot, Gemini, and Google's structured-data pass — read
//   the served HTML and never saw the 5 highest-intent recruiting Q&As ("do I
//   pay for leads?", "realistic income month 1/6/12?", "can I keep my job?"),
//   the exact GEO/AI-search content a recruiting funnel wants cited. Same
//   CSR-injected-SEO blind-spot class as the SPA canonical/sitemap leak.
//
//   Fix: the FAQPage is now STATIC in index.html; RecruitFAQ renders the visible
//   accordion ONLY. This guard makes the regression impossible:
//     1. RecruitFAQ.tsx must NOT contain `application/ld+json` (no CSR re-inject
//        — which would also duplicate the block once JS runs).
//     2. index.html must contain EXACTLY ONE FAQPage block.
//     3. That block's mainEntity must byte-match RecruitFAQ.tsx's FAQ array —
//        same questions, same answers, same order — so editing the visible copy
//        without updating the served schema (or vice-versa) fails the build. The
//        component stays the single source of truth for the human-visible copy;
//        index.html is its served mirror and the guard keeps them identical.
//
// Usage:
//   node scripts/check-faq-schema-static.mjs            # guard the real tree
//   node scripts/check-faq-schema-static.mjs --selftest # hermetic proof

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENT_REL = "src/components/landing/RecruitFAQ.tsx";
const INDEX_REL = "index.html";

// Extract the { q, a } pairs from RecruitFAQ.tsx's `const FAQ = [ ... ]` array.
// The regex matches JS string literals including escaped quotes; JSON.parse of
// the quoted capture decodes escapes identically for our cases (literal
// apostrophes and the en-dash pass through unchanged).
export function extractComponentFaq(componentSrc) {
  const start = componentSrc.indexOf("const FAQ = [");
  if (start < 0) {
    return { error: "could not find `const FAQ = [` in RecruitFAQ.tsx" };
  }
  const end = componentSrc.indexOf("];", start);
  if (end < 0) {
    return { error: "FAQ array in RecruitFAQ.tsx is not terminated with `];`" };
  }
  const block = componentSrc.slice(start, end + 2);
  const qs = [...block.matchAll(/\bq:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse('"' + m[1] + '"'),
  );
  const as = [...block.matchAll(/\ba:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse('"' + m[1] + '"'),
  );
  if (qs.length === 0) {
    return { error: "no q/a pairs extracted from the FAQ array in RecruitFAQ.tsx" };
  }
  if (qs.length !== as.length) {
    return {
      error: `FAQ array q/a count mismatch in RecruitFAQ.tsx: ${qs.length} q vs ${as.length} a`,
    };
  }
  return { faq: qs.map((q, i) => ({ q, a: as[i] })) };
}

// Pull every FAQPage JSON-LD block out of index.html (parsed objects).
export function extractIndexFaqPages(indexSrc) {
  const blocks = [
    ...indexSrc.matchAll(
      /<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]);
  const faqPages = [];
  for (const raw of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (parsed && !Array.isArray(parsed) && parsed["@type"] === "FAQPage") {
      faqPages.push(parsed);
    }
  }
  return faqPages;
}

// Core comparison — pure, so the selftest can drive it with fixtures.
export function faqProblems({ componentSrc, indexSrc, homepageSrc }) {
  const problems = [];

  // Rule 1: the component must not re-inject its own JSON-LD (CSR-only is the
  // exact leak this guard closes; a re-inject would also duplicate the block).
  if (/application\/ld\+json/.test(componentSrc)) {
    problems.push(
      `${COMPONENT_REL} contains \`application/ld+json\` — the FAQPage schema must be STATIC in index.html, not injected by this lazy client-only component (non-JS crawlers never see a CSR-injected block).`,
    );
  }

  // A selection-only homepage must not claim to display the retired accordion.
  // If FAQ rendering returns, the complete schema/copy parity checks below apply.
  if (homepageSrc !== undefined) {
    const home = stripComments(homepageSrc);
    const rendersFaq = /<RecruitFAQ(?:\s|\/|>)/.test(home);
    if (!rendersFaq) {
      if (/\bRecruitFAQ\b/.test(home)) {
        problems.push("The homepage references RecruitFAQ but its render shape is unrecognized; update this guard before accepting schema removal.");
      }
      if (extractIndexFaqPages(indexSrc).length > 0) {
        problems.push("index.html publishes FAQPage schema although the homepage does not render RecruitFAQ.");
      }
      return problems;
    }
  }

  const comp = extractComponentFaq(componentSrc);
  if (comp.error) {
    problems.push(comp.error);
    return problems; // can't compare without the source of truth
  }

  // Rule 2: exactly one FAQPage in index.html.
  const pages = extractIndexFaqPages(indexSrc);
  if (pages.length === 0) {
    problems.push(
      `${INDEX_REL} has no FAQPage JSON-LD block — the landing FAQ structured data is not served to non-JS crawlers. Add a <script type="application/ld+json"> FAQPage mirroring RecruitFAQ's FAQ array.`,
    );
    return problems;
  }
  if (pages.length > 1) {
    problems.push(
      `${INDEX_REL} has ${pages.length} FAQPage blocks — expected exactly 1.`,
    );
  }

  // Rule 3: mainEntity byte-matches the component FAQ, in order.
  const page = pages[0];
  const entity = Array.isArray(page.mainEntity) ? page.mainEntity : [];
  if (entity.length !== comp.faq.length) {
    problems.push(
      `FAQPage mainEntity has ${entity.length} questions but RecruitFAQ.tsx has ${comp.faq.length} — the served schema drifted from the visible accordion.`,
    );
  }
  const n = Math.min(entity.length, comp.faq.length);
  for (let i = 0; i < n; i++) {
    const want = comp.faq[i];
    const got = entity[i] || {};
    const gotName = got.name;
    const gotAns =
      got.acceptedAnswer && typeof got.acceptedAnswer === "object"
        ? got.acceptedAnswer.text
        : undefined;
    if (got["@type"] !== "Question") {
      problems.push(`FAQPage mainEntity[${i}] @type is "${got["@type"]}", expected "Question".`);
    }
    if (gotName !== want.q) {
      problems.push(
        `FAQPage question[${i}] drift:\n  index.html: ${JSON.stringify(gotName)}\n  component:  ${JSON.stringify(want.q)}`,
      );
    }
    if (gotAns !== want.a) {
      problems.push(
        `FAQPage answer[${i}] drift:\n  index.html: ${JSON.stringify(gotAns)}\n  component:  ${JSON.stringify(want.a)}`,
      );
    }
  }
  return problems;
}

function runSelftest() {
  const good = `
import { useState } from "react";
const FAQ = [
  { q: "Q one?", a: "Answer one." },
  { q: "Q two \\"quoted\\"?", a: "Answer two — with an en-dash." },
];
export function RecruitFAQ() { return null; }
`.trim();
  const goodIndex = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Galaxy Financial"}</script>
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "Q one?", acceptedAnswer: { "@type": "Answer", text: "Answer one." } },
      { "@type": "Question", name: 'Q two "quoted"?', acceptedAnswer: { "@type": "Answer", text: "Answer two — with an en-dash." } },
    ],
  })}</script>
</head><body></body></html>`;

  const cases = [
    ["real tree passes", { componentSrc: good, indexSrc: goodIndex }, false],
    ["visible FAQ still requires matching static schema", { componentSrc: good, indexSrc: goodIndex, homepageSrc: "<RecruitFAQ />" }, false],
    ["selection-only home has no FAQ schema", { componentSrc: good, indexSrc: "<html></html>", homepageSrc: "<HeroSection />" }, false],
    ["retired FAQ cannot leave ghost schema", { componentSrc: good, indexSrc: goodIndex, homepageSrc: "<HeroSection />" }, true],
    ["unrecognized FAQ render does not waive coverage", { componentSrc: good, indexSrc: "<html></html>", homepageSrc: "const Faq = RecruitFAQ; <Faq />" }, true],
    ["restored FAQ cannot omit schema", { componentSrc: good, indexSrc: "<html></html>", homepageSrc: "<RecruitFAQ />" }, true],
    [
      "CSR re-inject fails",
      {
        componentSrc: good + '\n<script type="application/ld+json">{}</script>',
        indexSrc: goodIndex,
      },
      true,
    ],
    [
      "missing FAQPage in index.html fails",
      { componentSrc: good, indexSrc: "<html><head></head></html>" },
      true,
    ],
    [
      "answer drift fails",
      {
        componentSrc: good,
        indexSrc: goodIndex.replace("Answer one.", "Answer ONE changed."),
      },
      true,
    ],
    [
      "count mismatch fails",
      {
        componentSrc: good.replace('  { q: "Q two \\"quoted\\"?", a: "Answer two — with an en-dash." },\n', ""),
        indexSrc: goodIndex,
      },
      true,
    ],
    [
      "duplicate FAQPage fails",
      {
        componentSrc: good,
        indexSrc: goodIndex.replace("</head>", goodIndex.match(/<script type="application\/ld\+json">\{"@context[\s\S]*?<\/script>/)[0] + "</head>"),
      },
      true,
    ],
  ];

  let pass = 0;
  for (const [name, input, shouldFail] of cases) {
    const problems = faqProblems(input);
    const failed = problems.length > 0;
    const ok = failed === shouldFail;
    if (ok) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      console.error(`  ✗ ${name} — expected ${shouldFail ? "FAIL" : "PASS"}, got ${failed ? "FAIL" : "PASS"}`);
      if (failed) console.error("    problems:\n    " + problems.join("\n    "));
    }
  }
  if (pass !== cases.length) {
    console.error(`\nFAQ-schema selftest: ${pass}/${cases.length} — FAILED`);
    process.exit(1);
  }
  console.log(`\nFAQ-schema selftest: ${pass}/${cases.length} — all green`);
}

function main() {
  if (process.argv.includes("--selftest")) {
    runSelftest();
    return;
  }
  const componentSrc = readFileSync(join(ROOT, COMPONENT_REL), "utf8");
  const indexSrc = readFileSync(join(ROOT, INDEX_REL), "utf8");
  const homepageSrc = ["src/pages/Index.tsx", "src/components/landing/HeroSection.tsx"]
    .map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
  const problems = faqProblems({ componentSrc, indexSrc, homepageSrc });
  if (problems.length > 0) {
    console.error("✗ FAQ structured-data guard FAILED:\n");
    for (const p of problems) console.error("  • " + p);
    console.error(
      "\nFAQPage schema must match a visible homepage FAQ, and must be absent when that FAQ is removed.",
    );
    process.exit(1);
  }
  if (!/<RecruitFAQ(?:\s|\/|>)/.test(stripComments(homepageSrc))) {
    console.log("✓ FAQ structured data: selection-only homepage has no FAQ accordion and no obsolete FAQPage schema.");
    return;
  }
  const comp = extractComponentFaq(componentSrc);
  console.log(
    `✓ FAQ structured data: ${comp.faq.length} Q&As served statically in index.html, byte-matched to RecruitFAQ.tsx; no CSR re-injection.`,
  );
}

main();
