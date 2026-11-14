#!/usr/bin/env node
// careers-jobposting-render.mjs — proves the /careers/* recruiting pages still
// emit their Google-for-Jobs payload AFTER the browser runs the JS.
//
// THE BLIND SPOT THIS CLOSES. The 10 /careers/<state> pages (StateCareerLanding)
// exist to claim the free Google-for-Jobs SERP slot for "life insurance agent
// jobs in <state>" — the highest-intent recruiting query. But their entire SEO
// payload is injected CLIENT-SIDE: the per-state <title>, <meta description>,
// self-referencing <link rel=canonical>, and the JobPosting JSON-LD are all
// written by a useEffect + the <JsonLd> component on mount. The served HTML is
// the identical SPA shell as the homepage (same bytes, same title, zero
// JobPosting). Every other gate in the repo is blind to this:
//   - route-smoke.mjs         — pure fetch of raw HTML, never runs the JS
//   - check-canonical-url.mjs — static analysis of index.html + sitemap parity,
//                               not a live render
//   - mobile-overflow.mjs     — layout width only
//   - lighthouse-prod.mjs     — perf score only
// So if a refactor breaks the JsonLd mount or the head-injection effect, the
// Google-for-Jobs rich result AND the per-route canonical dedup both vanish
// silently and nothing in CI goes red. Google rendered the pages fine the day
// they shipped; the risk is the NEXT deploy quietly undoing it.
//
// THE VERDICT IS DELIBERATELY NARROW. Per route it fails ONLY on a concrete,
// render-visible break:
//   1. <title> is still the homepage shell title (per-route head inject broke)
//   2. <link rel=canonical> href != this route's own prod URL (dedup regressed —
//      the exact bug today's RouteCanonical fix solved, on this page's own path)
//   3. no JobPosting JSON-LD block at all (the <JsonLd> mount broke)
//   4. the JobPosting is missing any of Google's 5 REQUIRED fields
//      (title / description / datePosted / hiringOrganization / jobLocation)
//   5. jobLocationType=TELECOMMUTE without applicantLocationRequirements
//      (Google's documented rule for remote postings — without it the remote
//      job is dropped from the rich result)
//   6. validThrough present but NOT in the future (past/today/garbage). Google
//      treats a JobPosting whose validThrough has lapsed as EXPIRED and removes
//      it from Google for Jobs — silently, no error. That is WORSE than an
//      absent validThrough (an omitted one is evergreen and stays listed), so
//      an ABSENT validThrough is tolerated and only a present-stale one fails.
//      StateCareerLanding computes validThrough = today+60 on every render, so
//      it is always future today; this check fires the day a future edit pins
//      it to a literal date that has since passed — exactly when the whole
//      10-state cluster would vanish from the SERP with nothing going red.
// It does NOT grade the PRESENCE of recommended-only fields (identifier,
// baseSalary, validThrough) — those are legitimately absent by design (100%
// commission, no fabricated salary; an evergreen posting omits validThrough).
// It grades only the FRESHNESS of validThrough when the page chose to emit one.
//
// IT SAMPLES 2 OF 10 BY DESIGN, AND SAYS SO. StateCareerLanding renders all 10
// states from ONE data-driven code path, so a render-MECHANISM break hits every
// state identically — two routes prove the mechanism at 1/5 the render cost. The
// only per-state risk is the static STATES array (name/slug/abbr), and that is
// already guarded by check-canonical-url.mjs's /careers/<slug> <-> STATE_CAREER_SLUGS
// parity check. This probe owns "does the JS still paint the payload", not "is
// every state's data present" — that split is intentional, not a silent cap.
//
// IT ALSO PROBES THE /careers HUB (CareersIndex), explicitly — not sampled. The
// hub is a DIFFERENT component from the state pages: no JobPosting, its payload
// is a national <title> + an ItemList JSON-LD enumerating all 10 state pages,
// plus an app-level (RouteCanonical) self-canonical. The same head-inject /
// <JsonLd> regression that strips a state page's JobPosting strips the hub's
// title + ItemList and collapses it to the SPA shell, so Google dedups the hub
// away. gradeHub owns that contract.
//
// Post-deploy, against the live promoted commit, mirroring mobile-overflow.mjs /
// route-smoke.mjs. Alerts on the GitHub run; NOT a timer-fired paging daemon
// (that class has a long false-page history in this system — a deterministic
// render asserted on the exact shipped commit is the right tool).
//
// Usage:
//   BASE=https://apex-financial.org node scripts/careers-jobposting-render.mjs
//   node scripts/careers-jobposting-render.mjs --selftest   # prove the checks both ways, no network
//   PW_CHANNEL=chrome node scripts/careers-jobposting-render.mjs   # system Chrome (CI, no download)

import { chromium } from "playwright";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const PROD_ORIGIN = "https://apex-financial.org"; // canonical is a FIXED prod origin, never window.location (no preview leak)
const SETTLE_MS = 1200; // let hydration + the head-injection effect + <JsonLd> mount land
const NAV_TIMEOUT = 40000;

// Two representative states. See header: the render MECHANISM is shared across
// all 10, the per-state data is guarded elsewhere. Each entry is the exact
// expected per-route truth so the check is self-contained.
const PROBE_ROUTES = [
  { slug: "florida", name: "Florida" },
  { slug: "texas", name: "Texas" },
];

const GOOGLE_REQUIRED = ["title", "description", "datePosted", "hiringOrganization", "jobLocation"];

// The /careers hub (CareersIndex). Probed explicitly — it is a separate render
// path from the state pages (see header). Its canonical is the fixed prod
// origin + /careers (owned by app-level RouteCanonical, not the component).
const HUB = { path: "/careers", canonical: `${PROD_ORIGIN}/careers` };
const HUB_MIN_STATES = 10; // CareersIndex + the sitemap both enumerate all 10 state pages

// Pull the single JobPosting object from however the page shaped its ld+json
// blocks (a block may be an object, an array, or an @graph).
function extractJobPosting(rawBlocks) {
  for (const raw of rawBlocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.["@graph"])
        ? parsed["@graph"]
        : [parsed];
    for (const c of candidates) {
      if (c && c["@type"] === "JobPosting") return c;
    }
  }
  return null;
}

// Pull the single ItemList object from the page's ld+json blocks (same block
// shapes as extractJobPosting: object, array, or @graph).
function extractItemList(rawBlocks) {
  for (const raw of rawBlocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.["@graph"])
        ? parsed["@graph"]
        : [parsed];
    for (const c of candidates) {
      if (c && c["@type"] === "ItemList") return c;
    }
  }
  return null;
}

// Pure, no-browser verdict over one route's rendered head + ld+json. Returns a
// list of failure strings (empty = pass). Shared by the live probe and the
// selftest so the selftest exercises the REAL predicate, not a copy of it.
// `now` is injected (default = call-time instant) so the live probe grades
// validThrough against the real moment while the selftest pins a FIXED reference
// — otherwise the "clean passes" fixture (a literal future date) would silently
// rot into a past date and the selftest would start failing on its own, the
// exact stale-fixture trap this repo has been bitten by before.
function gradeRoute({ slug, name }, { title, canonical, jobPosting }, now = new Date()) {
  const fails = [];
  const selfUrl = `${PROD_ORIGIN}/careers/${slug}`;

  // 1. per-route title injected (not the homepage shell)
  if (!title || !(title.includes(name) && /galaxy financial/i.test(title))) {
    fails.push(`title not per-route — got ${JSON.stringify(title)} (expected to contain "${name}" + "Galaxy Financial"; homepage shell title means the head-injection effect did not run)`);
  }

  // 2. self-referencing canonical on the fixed prod origin
  if (canonical !== selfUrl) {
    fails.push(`canonical is ${JSON.stringify(canonical)}, expected ${selfUrl} (dedup regressed — this page points Google at a different URL)`);
  }

  // 3. JobPosting present at all
  if (!jobPosting) {
    fails.push("no JobPosting JSON-LD rendered (the <JsonLd> mount broke — no Google-for-Jobs rich result possible)");
    return fails; // the field checks below are meaningless without it
  }

  // 4. Google-required fields
  const missing = GOOGLE_REQUIRED.filter((k) => {
    const v = jobPosting[k];
    return v === undefined || v === null || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
  });
  if (missing.length) {
    fails.push(`JobPosting missing Google-REQUIRED field(s): ${missing.join(", ")}`);
  }

  // 5. remote rule: TELECOMMUTE needs applicantLocationRequirements
  if (jobPosting.jobLocationType === "TELECOMMUTE") {
    const alr = jobPosting.applicantLocationRequirements;
    if (!alr || (typeof alr === "object" && Object.keys(alr).length === 0)) {
      fails.push("jobLocationType=TELECOMMUTE but applicantLocationRequirements is absent (Google drops remote postings without it)");
    }
  }

  // 6. validThrough freshness (see header #6). Absent is tolerated (evergreen);
  //    present-but-not-future is a DEFECT — Google treats a lapsed validThrough
  //    as expired and silently delists the posting. Date-only ISO strings parse
  //    as UTC midnight, so compare instants: validThrough must be strictly after
  //    `now`. A garbage/unparseable value also fails (a malformed expiry can
  //    drop the rich result, and it is never what the dynamic code emits).
  const vtRaw = jobPosting.validThrough;
  if (vtRaw !== undefined && vtRaw !== null && vtRaw !== "") {
    const vt = new Date(vtRaw);
    if (Number.isNaN(vt.getTime())) {
      fails.push(`validThrough is not a parseable date: ${JSON.stringify(vtRaw)} (Google cannot read the expiry; a malformed one can drop the rich result)`);
    } else if (vt.getTime() <= now.getTime()) {
      fails.push(`validThrough ${JSON.stringify(vtRaw)} is not in the future (<= ${now.toISOString().slice(0, 10)}) — Google treats the posting as EXPIRED and delists it from Google for Jobs`);
    }
  }

  return fails;
}

// Pure verdict over the HUB's rendered head + ld+json. Same shape as gradeRoute:
// returns a list of failure strings (empty = pass).
function gradeHub({ title, canonical, itemList }) {
  const fails = [];

  // 1. national title injected (not the homepage shell). "Nationwide" is the
  //    marker that distinguishes the hub title from both the shell and the
  //    per-state titles; "Galaxy Financial" confirms the effect ran at all.
  if (!title || !(/nationwide/i.test(title) && /galaxy financial/i.test(title))) {
    fails.push(`hub title not injected — got ${JSON.stringify(title)} (expected to contain "Nationwide" + "Galaxy Financial"; homepage shell title means the head-injection effect did not run)`);
  }

  // 2. self-referencing canonical (owned by app-level RouteCanonical for /careers)
  if (canonical !== HUB.canonical) {
    fails.push(`hub canonical is ${JSON.stringify(canonical)}, expected ${HUB.canonical} (dedup regressed — the hub points Google at a different URL)`);
  }

  // 3. ItemList present at all
  if (!itemList) {
    fails.push("no ItemList JSON-LD rendered (the <JsonLd> mount broke — the hub no longer tells Google the 10 state pages are one collection)");
    return fails; // the element check below is meaningless without it
  }

  // 4. ItemList enumerates all 10 state pages, each a ListItem pointing at a
  //    /careers/<slug> url
  const els = Array.isArray(itemList.itemListElement) ? itemList.itemListElement : [];
  const stateItems = els.filter(
    (e) => e && e["@type"] === "ListItem" && typeof e.url === "string" && /\/careers\/[a-z-]+$/.test(e.url)
  );
  if (stateItems.length < HUB_MIN_STATES) {
    fails.push(`ItemList has ${stateItems.length} state ListItem(s) with a /careers/<slug> url, expected >= ${HUB_MIN_STATES} (the hub's cluster schema is incomplete)`);
  }

  return fails;
}

async function readRaw(page) {
  const title = await page.title();
  const canonical = await page.getAttribute('link[rel="canonical"]', "href").catch(() => null);
  const rawBlocks = await page
    .$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent || ""))
    .catch(() => []);
  return { title, canonical, rawBlocks };
}

async function readRouteFromPage(page) {
  const { title, canonical, rawBlocks } = await readRaw(page);
  return { title, canonical, jobPosting: extractJobPosting(rawBlocks) };
}

async function readHubFromPage(page) {
  const { title, canonical, rawBlocks } = await readRaw(page);
  return { title, canonical, itemList: extractItemList(rawBlocks) };
}

// ---- selftest: exercise gradeRoute both directions with zero network ----
async function selftest() {
  const route = { slug: "florida", name: "Florida" };
  // Fixed reference instant so the validThrough cases are deterministic forever
  // (the good fixture's 2027-01-10 is future relative to this; a 2026-10-01
  // fixture is past). Never `new Date()` here or the fixtures rot over time.
  const NOW = new Date("2026-12-01T00:00:00Z");
  const good = {
    title: "Life Insurance Agent Jobs in Florida | Remote | Galaxy Financial",
    canonical: `${PROD_ORIGIN}/careers/florida`,
    jobPosting: {
      "@type": "JobPosting",
      title: "Life Insurance Agent — Remote in Florida",
      description: "Galaxy Financial is hiring...",
      datePosted: "2026-11-11",
      validThrough: "2027-01-10",
      hiringOrganization: { "@type": "Organization", name: "Galaxy Financial" },
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressRegion: "FL" } },
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "USA" },
    },
  };

  const stateCases = [
    ["clean page passes", good, true],
    ["homepage shell title fails", { ...good, title: "Galaxy Financial — Start Your Career in Insurance Sales" }, false],
    ["homepage canonical fails", { ...good, canonical: PROD_ORIGIN }, false],
    ["missing JobPosting fails", { ...good, jobPosting: null }, false],
    ["JobPosting missing datePosted fails", { ...good, jobPosting: { ...good.jobPosting, datePosted: "" } }, false],
    ["TELECOMMUTE without applicantLocationRequirements fails", { ...good, jobPosting: { ...good.jobPosting, applicantLocationRequirements: undefined } }, false],
    ["validThrough in the past fails (Google delists expired postings)", { ...good, jobPosting: { ...good.jobPosting, validThrough: "2026-10-01" } }, false],
    ["validThrough unparseable fails", { ...good, jobPosting: { ...good.jobPosting, validThrough: "whenever" } }, false],
    ["validThrough absent passes (evergreen posting, Google keeps it listed)", { ...good, jobPosting: { ...good.jobPosting, validThrough: undefined } }, true],
  ];

  const HUB_SLUGS = ["florida", "texas", "california", "georgia", "arizona", "north-carolina", "ohio", "tennessee", "michigan", "pennsylvania"];
  const goodHub = {
    title: "Life Insurance Agent Jobs — Remote, Nationwide | Galaxy Financial",
    canonical: `${PROD_ORIGIN}/careers`,
    itemList: {
      "@type": "ItemList",
      itemListElement: HUB_SLUGS.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `Life Insurance Agent Jobs in ${s}`,
        url: `https://apex-financial.org/careers/${s}`,
      })),
    },
  };

  const hubCases = [
    ["hub clean passes", goodHub, true],
    ["hub homepage shell title fails", { ...goodHub, title: "Galaxy Financial — Start Your Career in Insurance Sales" }, false],
    ["hub homepage canonical fails", { ...goodHub, canonical: PROD_ORIGIN }, false],
    ["hub missing ItemList fails", { ...goodHub, itemList: null }, false],
    ["hub ItemList with <10 states fails", { ...goodHub, itemList: { "@type": "ItemList", itemListElement: goodHub.itemList.itemListElement.slice(0, 9) } }, false],
  ];

  let ok = 0;
  let total = 0;
  for (const [label, rendered, shouldPass] of stateCases) {
    total++;
    const fails = gradeRoute(route, rendered, NOW);
    const passed = fails.length === 0;
    const correct = passed === shouldPass;
    console.log(`  ${correct ? "✓" : "✗"} ${label} — ${passed ? "PASS" : "FAIL(" + fails.length + ")"}${correct ? "" : "  <<< SELFTEST WRONG"}`);
    if (correct) ok++;
  }
  for (const [label, rendered, shouldPass] of hubCases) {
    total++;
    const fails = gradeHub(rendered);
    const passed = fails.length === 0;
    const correct = passed === shouldPass;
    console.log(`  ${correct ? "✓" : "✗"} ${label} — ${passed ? "PASS" : "FAIL(" + fails.length + ")"}${correct ? "" : "  <<< SELFTEST WRONG"}`);
    if (correct) ok++;
  }
  const allOk = ok === total;
  console.log(`selftest: ${ok}/${total} ${allOk ? "OK" : "BROKEN"}`);
  process.exit(allOk ? 0 : 1);
}

async function main() {
  if (process.argv.includes("--selftest")) {
    await selftest();
    return;
  }

  const launchOpts = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext();
  let anyFail = false;

  try {
    for (const route of PROBE_ROUTES) {
      const url = `${BASE}/careers/${route.slug}`;
      const page = await ctx.newPage();
      let rendered;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        rendered = await readRouteFromPage(page);
      } catch (e) {
        console.log(`✗ /careers/${route.slug} — navigation/read error: ${e.message}`);
        anyFail = true;
        await page.close();
        continue;
      }
      await page.close();

      const fails = gradeRoute(route, rendered);
      if (fails.length === 0) {
        console.log(`✓ /careers/${route.slug} — title+canonical+JobPosting(${GOOGLE_REQUIRED.length} required fields, validThrough fresh) all rendered`);
      } else {
        anyFail = true;
        console.log(`✗ /careers/${route.slug} — ${fails.length} failure(s):`);
        for (const f of fails) console.log(`    - ${f}`);
      }
    }

    // Hub probe — explicit, not sampled (separate render path from the states).
    {
      const page = await ctx.newPage();
      let rendered;
      try {
        await page.goto(`${BASE}${HUB.path}`, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        rendered = await readHubFromPage(page);
      } catch (e) {
        console.log(`✗ ${HUB.path} (hub) — navigation/read error: ${e.message}`);
        anyFail = true;
      }
      await page.close();

      if (rendered) {
        const fails = gradeHub(rendered);
        if (fails.length === 0) {
          console.log(`✓ ${HUB.path} (hub) — title+canonical+ItemList(>=${HUB_MIN_STATES} state pages) all rendered`);
        } else {
          anyFail = true;
          console.log(`✗ ${HUB.path} (hub) — ${fails.length} failure(s):`);
          for (const f of fails) console.log(`    - ${f}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    anyFail
      ? `\nFAIL: a /careers page's SEO payload did not render live on ${BASE}. The recruiting rich result / cluster hub is at risk.`
      : `\nOK: /careers/* Google-for-Jobs payload + /careers hub ItemList render live on ${BASE} (sampled ${PROBE_ROUTES.length} of 10 state pages — shared render path — plus the hub explicitly).`
  );
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error("careers-jobposting-render crashed:", e);
  process.exit(1);
});
