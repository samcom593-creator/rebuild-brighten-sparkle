import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard #2 — fake-success marketing-claim detector.
//
// Companion to check-landing-truth-floor.mjs. That guard catches `??` fallback
// patterns clamping landing_live_stats truth upward. This guard catches the
// older, simpler disease: hardcoded "$150M+ Premium Generated" / "166K+ Lead
// Volume" placeholders that came from a 2026-01-10 gpt-engineer seed
// (commit 114cfd56) and shipped to the public landing for 5 months with zero
// source. Brand-truth violation per Operating Contract non-negotiable #10
// (no fake success).
//
// Any `$NNNM+` / `$NNNK+` / `NNNK+` / `NNN,NNN+` numeric claim inside a
// landing surface must either:
//   (a) appear in ALLOW_LIST below with a one-line justification, or
//   (b) be sourced from a server RPC (landing_live_stats() et al).
// String literals matching the patterns get flagged otherwise.

const repoRoot = path.resolve(import.meta.dirname, "..");

// Numeric SUSPECT_PATTERNS scope — landing surfaces only. Admin dashboards
// legitimately render `$NNNK+` / `$NNNM+` style numbers from RPCs (deal
// totals, override comp, override $/mo etc) so flagging them broadly would
// false-positive on truth. Confine the numeric check to public landing.
const NUMERIC_TRACKED_GLOBS = [
  "src/components/landing",
  "src/pages/Landing.tsx",
  "src/pages/Index.tsx",
  // Wave-4 (2026-06-22): /leads, /get-leads, /dialer landing page shipped
  // "Join 100+ Successful Agents" for 5 months. Now scoped for numeric
  // marketing-claim patterns too.
  "src/pages/LeadsLanding.tsx",
  // Wave-5 (2026-06-22): /careers/:state SEO landing page shipped a
  // fabricated "team average is $60K-$90K" inside the Google for Jobs
  // JobPosting JSON-LD (indexed by Google), plus "22+ carriers" (truth:
  // 18 in carriers table, 6 with policies), "Sam reviews every one
  // personally" (impossible at scale), and "6 days a week" training
  // cadence. Indexed-schema brand-truth is a higher liability surface
  // than visible copy — Google can de-index the JobPosting if the
  // structured claims are off, plus mis-stated compensation in a job
  // ad is regulator-visible.
  "src/pages/StateCareerLanding.tsx",
];

// Superlative SUPERLATIVE_PATTERNS scope — public landing + every other
// surface where puff copy (Unlimited / Highest / 7-figure / world-class)
// reads as fake-success marketing. Extended 2026-06-20 wave-3 after finding
// PurchaseLeads.tsx shipped the same "Unlimited leads" + "Highest conversion
// rates" disease that wave-2 killed on ApexLeadsSection.
const SUPERLATIVE_TRACKED_GLOBS = [
  ...NUMERIC_TRACKED_GLOBS,
  // Agent-facing lead purchase + dialer call-to-action surfaces.
  "src/pages/PurchaseLeads.tsx",
  // Applicant-facing post-application + status screens (delegated to
  // ApplicationConfirmationV2 today, but listed explicitly so future page
  // bodies can't sneak puff back in).
  "src/components/landing/ApplicationConfirmationV2.tsx",
  "src/pages/ApplicationStatus.tsx",
  "src/pages/Apply.tsx",
  "src/pages/ApplySuccess.tsx",
  "src/pages/ApplySuccessLicensed.tsx",
  "src/pages/ApplySuccessUnlicensed.tsx",
  // Get-licensed funnel — visible to every unlicensed applicant.
  "src/pages/GetLicensed.tsx",
  // /leads, /get-leads, /dialer agent-facing landing page (3 routes,
  // single component). Wave-4 (2026-06-22) found it shipped 5 months of
  // fabricated testimonials (Marcus T./Jessica M./David L. with $18K/$22K
  // monthly + 40% conversion quotes) + "Join 100+ Successful Agents"
  // (truth: ~41 active) + "Limited spots available this month" fake
  // scarcity. Adding the file to both NUMERIC + SUPERLATIVE scope.
  "src/pages/LeadsLanding.tsx",
];

// Files exempt from the guard. Add new entries here with a one-line
// justification — every exclusion is a hole.
const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner.tsx is an internal admin banner that quotes
  // commit messages — when we kill a puff phrase, the banner naturally
  // mentions the phrase in past tense ("'Unlimited leads' → 'No per-lead
  // cap'"). Excluding it lets the persistence record stay readable.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

// Numbers Sam has explicitly authorized on the public landing.
// Add new entries here with a one-line justification when truth grows.
const ALLOW_LIST = new Set([
  "$1M+",     // "writing $1M+ a year" — historical doc'd top producer comp
  "$300K+",   // Override income claim — historical doc'd manager comp
  "$100K+",  // "To reach $100K+ pace" — defensible 6-figures-by-year-1 claim
  // Wave-4 (2026-06-22): /leads, /get-leads, /dialer hero stat — monthly
  // pace target Sam canonicalizes throughout the page ("$10,000 months",
  // "first $10K month", FAQ "real shot at $10,000 months"). Bounded
  // aspirational claim, not aggregate metric.
  "$10K+",
  // Wave-5 (2026-06-22): /careers/:state hero + JSON-LD claim. Top-producer
  // historical comp, contextualized in copy as "top first-year producers
  // have written $120K+ in commissions" (not as average/typical). Defensible
  // per existing $100K+ ALLOW_LIST precedent + Sam's known top-producer
  // record. Bare "$120K+" without that bounded context still gets flagged.
  "$120K+",
]);

// Marketing-claim patterns that look like fabricated lifetime/aggregate metrics.
// Conservatively scoped to formats that read as "BIG NUMBER + SUFFIX/PLUS".
// Negative lookbehind on bare patterns so $1M+ doesn't also match 1M+.
const SUSPECT_PATTERNS = [
  /\$\d+M\+/g,             // $150M+
  /\$\d+B\+/g,             // $1B+
  /\$\d{2,}K\+/g,          // $250K+ (allow $5K, $10K-$99K without +)
  /(?<![$\d])\d+M\+/g,      // 150M+ but not the M+ inside $150M+
  /(?<![$\d])\d{2,}K\+/g,  // 166K+ but not the K+ inside $250K+
  /(?<![$\d])\d{1,3},\d{3}\+/g, // 166,000+
  // Wave-4 (2026-06-22): roster-count puff like "Join 100+ Successful
  // Agents" / "200+ Top Producers" — same disease as wave-2/wave-3 but
  // with bare "NNN+" instead of K/M suffix. Word-paired to avoid
  // catching innocuous numeric-plus uses ("3+ years", "2+ kids").
  /(?<![$\d])\d{2,4}\+\s+(Successful|Top|Elite|Active|Licensed|Producing|Closing|Verified|Qualified)\s+(Agents?|Producers?|Closers?|Recruits?|Hires?)\b/gi,
];

// Wave-2 (2026-06-20): superlative + puff-word patterns. Same brand-truth
// disease, different surface — "Highest conversion rates", "Unlimited leads",
// "7-figure income potential" shipped on ApexLeadsSection + CTASection for
// months with zero data backing. AI-tell + non-negotiable #10 violation.
// These are word-boundary scoped + paired with a topical noun so we don't
// flag innocuous uses ("highest priority", "best practices" in comments).
const SUPERLATIVE_PATTERNS = [
  /\bHighest\s+(conversion|conversions|payout|payouts|rate|rates|earning|earnings|income|incomes|commission|commissions|production|producer|producers|close|closes|closing|premium|premiums)\b/gi,
  /\bBest[\-\s]in[\-\s]class\b/gi,
  /\b#\s*1\s+(agency|recruiter|recruiters|carrier|carriers|producer|producers|team|teams|imo|trainer|trainers|closer|closers)\b/gi,
  /\bNumber\s+(?:one|1)\s+(agency|recruiter|recruiters|carrier|carriers|producer|producers|team|teams|imo|closer|closers)\b/gi,
  /\bUnlimited\s+(leads|earning|earnings|income|incomes|commission|commissions|payouts|policies|callbacks|appointments)\b/gi,
  /\b7[-\s]?figure(?:s)?\s+(income|earning|earnings|potential|year|month|months|salary|deal|deals|producer|producers)\b/gi,
  /\b6[-\s]?figure(?:s)?\s+(income|earning|earnings|potential|year|month|months|salary|deal|deals|producer|producers)\b/gi,
  // `guaranteed` only as a positive-claim noun pairing — skips disclaimers
  // ("not guaranteed", "no guarantee", "income examples are not guaranteed").
  /\bguaranteed\s+(income|earnings|payout|payouts|commission|commissions|leads|lead|placement|placements|sale|sales|hire|hires|win|wins|results|success|return|returns|appointment|appointments)\b/gi,
  /\b(world[-\s]class|industry[-\s]leading|cutting[-\s]edge|game[-\s]changing|next[-\s]level|second[-\s]to[-\s]none)\b/gi,
  // Wave-4 (2026-06-22): fake-scarcity tactics. "Limited spots available
  // this month" shipped on /leads/get-leads/dialer for 5 months. AI-tell
  // + corporate-larp pattern Sam explicitly bans (Brand Bible Ch 6).
  /\bLimited\s+(spots?|seats?|slots?|openings?|availability|time)\b/gi,
  // Wave-4 (2026-06-22): "Pre-qualified prospects/leads/lead flow" puff
  // — wave-3 killed it on PurchaseLeads.tsx but didn't add a guard
  // pattern, so the same disease shipped on LeadsLanding.tsx.
  /\bPre[-\s]?qualified\s+(prospects?|leads?|lead\s+flow|applicants?|recruits?|pipeline)\b/gi,
  // Wave-5 (2026-06-22): fabricated team-average / typical-earnings claim.
  // StateCareerLanding shipped "the team average is $60K-$90K" inside the
  // Google for Jobs JobPosting JSON-LD with zero data backing
  // (agentlink_book_of_business table is empty, commission_cents column
  // is all zero). Aggregate compensation claims in employment advertising
  // are regulator-visible and the recurring legal liability surface — block
  // them at the guard layer.
  /\b(team|squad|crew|roster|typical|average|median|standard)\s+(average|earnings?|earning|income|comp|compensation|production|writing|writes)\b/gi,
  // Wave-5 (2026-06-22): "Sam/owner/founder reviews every application
  // personally" personal-attention puff that scales with traffic — at
  // ~50+ applications/day this becomes impossible-to-deliver. Catches
  // "reviews every one personally", "reads every applicant himself",
  // "approves each signup herself". Allows legit narrow uses by requiring
  // the application/applicant/signup noun within the same line.
  /\b(reviews?|approves?|reads?|signs?\s+off\s+on)\s+(every|each)\s+(one|application|applicant|signup|submission|lead|recruit|hire)\b[^.\n]*\b(personally|himself|herself|themselves)\b/gi,
];

const violations = [];

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    const sub = path.join(rel, entry);
    out.push(...walk(sub));
  }
  return out;
}

function fileList(globs) {
  return globs
    .flatMap(walk)
    .filter((p) => /\.(tsx?|jsx?|mdx?)$/.test(p))
    .filter((p) => !EXCLUDE_FILES.has(p));
}

const NUMERIC_FILES = fileList(NUMERIC_TRACKED_GLOBS);
const SUPERLATIVE_FILES = fileList(SUPERLATIVE_TRACKED_GLOBS);
const TOTAL_FILES = new Set([...NUMERIC_FILES, ...SUPERLATIVE_FILES]).size;

function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

for (const rel of NUMERIC_FILES) {
  const abs = path.join(repoRoot, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pat of SUSPECT_PATTERNS) {
      pat.lastIndex = 0;
      const matches = line.match(pat);
      if (!matches) continue;
      for (const m of matches) {
        if (ALLOW_LIST.has(m)) continue;
        violations.push(
          `${rel}:${i + 1}: hardcoded marketing-claim "${m}" — source it from an RPC, or add to ALLOW_LIST in scripts/check-landing-marketing-claims.mjs with a one-line justification.`,
        );
      }
    }
  }
}

for (const rel of SUPERLATIVE_FILES) {
  const abs = path.join(repoRoot, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pat of SUPERLATIVE_PATTERNS) {
      pat.lastIndex = 0;
      const matches = line.match(pat);
      if (!matches) continue;
      for (const m of matches) {
        violations.push(
          `${rel}:${i + 1}: unsourced superlative "${m}" — replace with a bounded claim (e.g. "$25K/mo bonuses", "fresh weekly", "no per-lead cap") or cite data.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check:landing-marketing-claims — landing surfaces ship unsourced marketing numbers:");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Why this exists: 2026-06-20 found '$150M+ Premium Generated' and '166K+ Lead");
  console.error("Volume' running on the public CareerPathwaySection for 5 months with zero source");
  console.error("(seeded 2026-01-10 by gpt-engineer placeholder, never replaced). Brand-truth");
  console.error("violation per non-negotiable #10 (no fake success). This guard locks future");
  console.error("placeholders out of landing/* surfaces.");
  process.exit(1);
}

console.log(
  `check:landing-marketing-claims OK — ${TOTAL_FILES} surfaces scanned (${NUMERIC_FILES.length} numeric · ${SUPERLATIVE_FILES.length} superlative), 0 unsourced marketing claims.`,
);
