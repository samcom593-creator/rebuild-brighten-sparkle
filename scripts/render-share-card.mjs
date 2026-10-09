#!/usr/bin/env node
// render-share-card.mjs: public/galaxy-recruit-og.svg -> public/galaxy-recruit-og.jpg
//
// The image is what iMessage, Instagram DMs, Discord, Facebook and X show when a recruiting
// link is shared. It is a raster, so the 2026-10-08 Galaxy rename (996492ce), which swept
// ~1,000 strings with a lexer, could not see it: the page title said "Galaxy Financial"
// while the preview card under it still said "APEX FINANCIAL".
//
// Two things this script measures instead of trusting:
//  1. The fonts actually loaded. The previous card named Inter, which this site never
//     ships, so it rendered in a fallback face and "START YOUR APPLICATION" ran past both
//     ends of its pill. Rendering refuses to write the image unless Syne and Hanken Grotesk
//     (the site's own self-hosted faces, public/fonts) report loaded.
//  2. Every line fits. Each <text> must sit inside the card with 40px to spare, and the
//     CTA text inside its pill with 24px each side. Fails rather than writing a clipped card.
//
// Writes scripts/data/share-card.json with the SVG's sha256 so check:share-card can tell
// when the SVG was edited without re-rendering.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const SVG = "public/galaxy-recruit-og.svg";
const OUT = "public/galaxy-recruit-og.jpg";
const MANIFEST = "scripts/data/share-card.json";

const svg = readFileSync(resolve(ROOT, SVG), "utf8");
const font = (file) => `data:font/woff2;base64,${readFileSync(resolve(ROOT, "public/fonts", file)).toString("base64")}`;
const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Syne'; font-weight: 400 800; src: url(${font("syne.woff2")}) format('woff2'); }
@font-face { font-family: 'Hanken Grotesk'; font-weight: 400 800; src: url(${font("hanken-grotesk.woff2")}) format('woff2'); }
html, body { margin: 0; padding: 0; background: #0b1220; }
svg { display: block; }
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  const report = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load("800 124px Syne", "GALAXY"),
      document.fonts.load("800 30px 'Hanken Grotesk'", "START"),
      document.fonts.load("400 28px 'Hanken Grotesk'", "Uncapped"),
    ]);
    await document.fonts.ready;
    const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/['"]/g, ""), status: f.status }));
    const texts = [...document.querySelectorAll("svg text")].map((t) => {
      const b = t.getBBox();
      return { id: t.id || null, text: t.textContent, x0: b.x, x1: b.x + b.width };
    });
    const p = document.getElementById("cta-pill").getBBox();
    return { faces, texts, pill: { x0: p.x, x1: p.x + p.width } };
  });

  const problems = [];
  for (const fam of ["Syne", "Hanken Grotesk"]) {
    if (!report.faces.some((f) => f.family === fam && f.status === "loaded")) problems.push(`font ${fam} did not load: ${JSON.stringify(report.faces)}`);
  }
  for (const t of report.texts) {
    if (t.x0 < 40 || t.x1 > 1160) problems.push(`"${t.text}" spans ${t.x0.toFixed(0)}..${t.x1.toFixed(0)}, outside 40..1160`);
  }
  const cta = report.texts.find((t) => t.id === "cta-text");
  if (!cta) problems.push("no #cta-text");
  else if (cta.x0 < report.pill.x0 + 24 || cta.x1 > report.pill.x1 - 24) {
    problems.push(`CTA text ${cta.x0.toFixed(0)}..${cta.x1.toFixed(0)} does not fit pill ${report.pill.x0}..${report.pill.x1} with 24px padding`);
  }
  if (problems.length) {
    console.error("render-share-card: refusing to write the image\n  " + problems.join("\n  "));
    process.exit(1);
  }

  // JPEG, not PNG: the gradient made a 454 KB PNG, over the ~300 KB some chat apps
  // (WhatsApp) accept for a preview image. Quality 90 keeps the text edges clean.
  await page.locator("svg").screenshot({ path: resolve(ROOT, OUT), type: "jpeg", quality: 90 });
  const sha = createHash("sha256").update(svg).digest("hex");
  writeFileSync(resolve(ROOT, MANIFEST), JSON.stringify({ svg: SVG, image: OUT, svg_sha256: sha }, null, 2) + "\n");
  for (const t of report.texts) console.log(`  ${t.x0.toFixed(0).padStart(4)}..${t.x1.toFixed(0).padEnd(4)} ${t.text}`);
  console.log(`render-share-card: wrote ${OUT} (svg sha256 ${sha.slice(0, 12)})`);
} finally {
  await browser.close();
}
