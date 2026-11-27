// Run: node scripts/visual-qa/run.mjs [--build-only]
// Browser prerequisite in CI: npx playwright install --with-deps chromium
// Artifacts: artifacts/visual-qa/*.png + metrics.json. No production route is added.
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, "../..");
const output = path.resolve(process.env.VISUAL_QA_DIR || path.join(project, "artifacts/visual-qa"));
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-visual-qa-"));
const buildOnly = process.argv.includes("--build-only");
let server;
let browser;
await fs.mkdir(output, { recursive: true });

try {
  await build({
    absWorkingDir: project,
    entryPoints: [path.join(directory, "fixture.tsx")], outdir: runtime, entryNames: "bundle",
    bundle: true, format: "esm", platform: "browser", jsx: "automatic", target: "es2020",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [{
      name: "synthetic-data-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^@\/hooks\/(useAgentIdentity|useBusinessToday|useProducerWorkspace)$/ }, (args) => ({ path: args.path, namespace: "visual-qa-only" }));
        builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "visual-qa-only" }));
        builder.onLoad({ filter: /.*/, namespace: "visual-qa-only" }, (args) => ({
          contents: args.path === "supabase"
            ? 'export const supabase = new Proxy({}, {get(){throw new Error("Backend access is disabled in visual QA");}});'
            : `export function ${args.path.split("/").pop()}(){throw new Error("Data hooks must not run in visual QA");}`,
          loader: "js",
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = path.join(project, "src", args.path.slice(2));
          const file = [base, `${base}.tsx`, `${base}.ts`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`]
            .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
          if (!file) throw new Error(`Unresolved fixture import: ${args.path}`);
          return { path: file };
        });
      },
    }],
    logLevel: "warning",
  });
  execFileSync(process.execPath, [
    path.join(project, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(project, "tailwind.config.ts"),
    "-i", path.join(project, "src/index.css"), "-o", path.join(runtime, "base.css"),
  ], { cwd: project, stdio: "pipe" });
  const fonts = [
    ["Hanken Grotesk", "hanken-grotesk.woff2", "400 800"],
    ["Syne", "syne.woff2", "400 800"],
    ["DM Sans", "dm-sans.woff2", "400 700"],
  ];
  for (const [, file] of fonts) await fs.access(path.join(project, "public/fonts", file));
  const fontStyles = fonts.map(([family, file, weight]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${file}') format('woff2')}`).join("");
  await fs.writeFile(path.join(runtime, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fontStyles}</style><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`);
  if (buildOnly) {
    await fs.writeFile(path.join(output, "build.json"), JSON.stringify({ built: true, synthetic: true, browserRun: false }, null, 2));
    console.log("Synthetic visual fixture built. Browser checks were not run.");
  } else {
    const files = new Map([
      ["/", [path.join(runtime, "index.html"), "text/html"]],
      ["/bundle.js", [path.join(runtime, "bundle.js"), "text/javascript"]],
      ["/bundle.css", [path.join(runtime, "bundle.css"), "text/css"]],
      ["/base.css", [path.join(runtime, "base.css"), "text/css"]],
      ...fonts.map(([, file]) => [`/fonts/${file}`, [path.join(project, "public/fonts", file), "font/woff2"]]),
    ]);
    server = http.createServer(async (request, response) => {
      const target = files.get(new URL(request.url || "/", "http://localhost").pathname);
      if (request.method !== "GET" || !target) { response.writeHead(404); response.end(); return; }
      try {
        const content = await fs.readFile(target[0]);
        response.writeHead(200, { "Content-Type": target[1], "Cache-Control": "no-store" });
        response.end(content);
      } catch { response.writeHead(500); response.end("Fixture resource unavailable"); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const results = [];
    const failures = [];
    const viewports = [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 320, height: 780 }];
    for (const viewport of viewports) for (const theme of ["light", "dark"]) for (const motion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme,
        reducedMotion: motion, hasTouch: viewport.name === "mobile", isMobile: viewport.name === "mobile", deviceScaleFactor: 1,
      });
      try {
        const external = [];
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
          external.push(`${url.origin}${url.pathname}`);
          return route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const scene of ["overview", "deal", "hire"]) {
          const name = [viewport.name, theme, motion, scene].join("-");
          await page.goto(`${origin}/?scene=${scene}&theme=${theme}`, { waitUntil: "networkidle" });
          await page.locator("#visual-qa-root").waitFor({ timeout: 10000 });
          await page.evaluate(async () => {
            await Promise.all(["Hanken Grotesk", "Syne", "DM Sans"].map((family) => document.fonts.load(`16px "${family}"`)));
            await document.fonts.ready;
          });
          await page.waitForTimeout(motion === "reduce" ? 50 : 1000);
          await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: scene === "overview" });
          const metrics = await page.evaluate(() => {
            const rect = (element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom,
                animation: style.animationName, transform: style.transform, transition: style.transitionDuration };
            };
            return {
              width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
              fontsLoaded: ["Hanken Grotesk", "Syne", "DM Sans"].every((family) => document.fonts.check(`16px "${family}"`)),
              headings: [...document.querySelectorAll("h1,h2,h3")].map((element) => ({ text: element.textContent, ...rect(element) })),
              controls: [...document.querySelectorAll(".apex-page-actions .galaxy-button,.win-action")].filter((element) => element.getBoundingClientRect().width > 0).map((element) => ({ label: element.getAttribute("aria-label") || element.textContent, ...rect(element) })),
              cards: [...document.querySelectorAll(".deal-celebration-card,.hire-celebration-card")].map(rect),
              trophies: [...document.querySelectorAll(".celebration-trophy,.trophy-path__medallion")].map(rect),
              balloonsVisible: [...document.querySelectorAll(".deal-celebration-balloons,.hire-celebration-balloons")].some((element) => getComputedStyle(element).display !== "none"),
            };
          });
          const problems = [];
          if (!metrics.fontsLoaded) problems.push("A local application font did not load");
          if (metrics.documentWidth > metrics.width + 1) problems.push("Horizontal page overflow");
          if (metrics.controls.some((control) => control.height < 43 || control.width < 43)) problems.push("A primary or win action is smaller than 44px");
          if (metrics.cards.some((card) => card.x < 0 || card.y < 0 || card.x + card.width > metrics.width + 1 || card.bottom > metrics.height + 1)) problems.push("A celebration card extends outside the viewport");
          if (motion === "reduce" && (metrics.balloonsVisible || metrics.trophies.some((trophy) => trophy.animation !== "none"))) problems.push("Celebration motion remains enabled under reduced motion");
          if (errors.length) problems.push(...errors);
          if (external.length) problems.push("The synthetic fixture attempted an external request");
          if (problems.length) failures.push({ name, problems });
          results.push({ name, synthetic: true, metrics, errors: [...errors], external: [...external], problems });
          if (scene !== "overview") {
            await page.getByRole("button", { name: `Dismiss ${scene} celebration` }).click();
            if (await page.locator(".deal-celebration-card,.hire-celebration-card").count()) failures.push({ name, problems: ["Dismiss control did not close the celebration"] });
          }
        }
      } finally { await context.close(); }
    }
    await fs.writeFile(path.join(output, "metrics.json"), JSON.stringify({ synthetic: true, screenshots: results.length, failures, results }, null, 2));
    if (failures.length) throw new Error(`Visual QA found ${failures.length} failing scenario(s); see metrics.json.`);
    console.log(`Synthetic visual QA passed ${results.length} scenarios; screenshots and metrics: ${path.relative(project, output)}`);
  }
} catch (error) {
  await fs.writeFile(path.join(output, "failure.txt"), String(error?.stack || error));
  console.error(error?.message || String(error));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(runtime, { recursive: true, force: true });
}
