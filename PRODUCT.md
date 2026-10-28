# Product

<!-- impeccable:product-schema 1 -->

Provenance: written 2026-10-28 from repository evidence alone (AGENTS.md, README.md, docs/, src/App.tsx,
src/hooks/useAuth.ts, src/config/brand.ts, src/data/shipped-data.ts, supabase/functions/); no owner interview was
possible. A fact read from a file names its source; a conclusion is marked "(inferred)"; open items stay open.

## Platform

web

## Users

- **The owner, Sam James** (Samuel James; sam.com593@gmail.com is the canonical login, info@kingofsales.net the
  business one; AGENTS.md). Sole admin. Runs the business from his phone: mobile Safari is "Sam's daily driver"
  (src/components/layout/AuthenticatedShell.tsx) and the phone is "the device Sam actually runs the business on"
  (src/index.css). Reads numbers, approves content, deploys by saying "deploy".
- **Managers** (`manager`, `agency_owner`): recruit, run their own downline, review their team's production
  (docs/operating-spec.md §1.2). Desktop and phone (inferred; the brief says desktop for managers).
- **Agents / producers** (`agent`): licensed insurance agents who write business, log daily numbers, train and
  watch their own production. Phone first (inferred; the brief and the shell's phone-first comments agree).
- **Recruiting staff** (`recruiter`, `va`, `va_manager`): work the Call list, book and confirm interviews, chase
  licensing (src/App.tsx gates; docs/recruiting-workspace.md "Interview authorization"). A recruiter makes about
  60 calls a day (docs/prompt-pack/platform-redesign/00-MASTER.md, the Operator lens).
- **Applicants / recruits**: public visitors who apply at `/apply` (licensed or unlicensed), then a login with no
  agents row, which gets the applicant rail: Home, Get licensed, Training, Support desk
  (src/components/layout/agentCloudNavigation.ts; src/hooks/useAuth.ts `hasAgentRecord`).
- The design target for every role is "somebody who is old and has no idea about technology" (Sam, quoted in
  docs/prompt-pack/platform-redesign/README.md); the council's First-timer lens is a 70-year-old (00-MASTER.md §6).

## Product Purpose

APEX OS (shown on screen as Galaxy OS, see Brand Commitments) is the operating system and public website of an
insurance agency / FMO (AGENTS.md; README.md). It runs the hiring loop end to end: apply, call, record what
happened, book and hold an interview, hire, license, contract, first deal, active agent (docs/audits/
platform-redesign-2026-10/funnel-and-reengagement-map.md §A); and the daily business around it: production and
commissions, book of business, training, team, and the owner's own tools (sidebar sections Sell, Grow, My
Business, Learn, Team, Owner in agentCloudNavigation.ts). Success, in Sam's words: "a higher rate of actual
hires and fixing the re-engagement funnels", with "zero clutter" and every metric still reachable
(platform-redesign/README.md). The 2026-10-28 addendum adds "pleasant, cute and easy to use, and very
functional" with colour, animation, bubbles and sound (00-MASTER.md §1; docs/DESIGN_SYSTEM.md).

## Positioning

(inferred) One signed-in place where the agency's recruiting loop, its production truth and its training live
together, fed by the agency's own systems (the AgentLink/InsuraCloud production mirror, Calendly, the dialer,
the social inboxes) and held to written truth rules that guards enforce: unknown is never zero, no fallback
metrics, no success receipt the server did not return (00-MASTER.md §4). The landing's own headline, "The
Operating System for Elite Insurance Agencies" (src/components/landing/HeroSection.tsx), is marketing copy, not a
verified claim; nothing in the repository records a competitor comparison.

## Operating Context

- Hosting: Vercel, auto-deploys `main` to apex-financial.org (README.md). Backend: Supabase project
  `xrzweoneiieddzxogewk` (auth, Postgres with RLS, realtime, 160+ edge functions, 30+ cron jobs; AGENTS.md).
- Data truths future work must keep: `deals.posted_at` is the canonical deal date; recruiting "today" is the
  America/Phoenix business day; production windows follow docs/metric-registry.md (Chicago day); hire metrics use
  `applications.closed_at`, application metrics `applications.created_at`; visible copy says ALP, never AOP
  (AGENTS.md; 00-MASTER.md §4; src/lib/recruitingQueues.ts header).
- Systems the product talks to (by edge-function name under supabase/functions/): AgentLink/InsuraCloud sync,
  Calendly and Google Calendar, the ReadyMode dialer and call transcripts, Instagram and ManyChat DMs, TikTok and
  YouTube comments, Metricool, Resend email with suppression, SMS through carrier email gateways, Slack, Discord,
  Telegram, Notion, Todoist, Stripe lead purchases, XCEL pre-licensing imports, NIPR licence checks.
- Rituals the screens name: Monday starts ("Expected Monday"), daily numbers, morning brief and evening report,
  weekly reports, plaques and awards, leaderboards, Call Lab practice calls, "No Hire Left Behind".
- Graded sizes: 390x844 and 1440x900 first, then 768 and 1024, in dark and light (00-MASTER.md §3, §7). Dark is
  the shipped default; light is a toggle (src/hooks/useTheme.ts).
- Departed people: KJ Vaughn (left 2026-08-17; auth `75b17131-…` banned, agent `431dff0d-…` terminated) and John
  Riley. No queue, alert, routing, calendar traffic or message may reach them; historical attribution stays
  (AGENTS.md; src/data/shipped-data.ts "PL-TERMINATION-JR-KJ").

## Capabilities and Constraints

- Scale of the surface: 285 route entries, about 198 screens, 36 aliases, 51 redirects (docs/prompt-pack/
  platform-redesign/ROUTE_BOARD.md, measured 2026-10-28). Route gates live in src/App.tsx (`ProtectedRoute` with
  `requireAdmin`, `allowManagers`, `allowPresenters`, `allowRoles`); nav visibility in agentCloudNavigation.ts
  `modes`. "Hiding a link is not permission" (docs/information-architecture.md).
- The Grow pages and their one job each, from their own headers: Call list "Call people, record what happened,
  set the next step"; Pipeline "Everyone from first call to active agent"; New hires "From hire to first deal,
  one step at a time"; Invite an agent "Fill in what you know, then send the link"; Social Command Center "Who to
  answer first, and which lane is dead"; Refer a recruit "We contact your referral within 24 hours"; Staff
  accounts "Add logins and turn them on or off".
- Vocabulary: Call list, New hires, Never called, No next step, Waiting on them, Worked today, Booked, Expected
  Monday, Showed, No show, Onboarding, Contracting, Producing; the seven tones good / warm / hot / cool / royal /
  gold / slate (src/lib/tones.ts). Plain words over jargon ("Never called", not "Uncontacted").
- Constraints on change: UI-only by default; schema, RPC and cron changes, metric definitions, permission logic
  and re-engagement rules go through a separate read-only analysis session first (00-MASTER.md §9; AGENTS.md).
  117 guard scripts are ratchets (icon-button labels, control labels, theme literals, brand literals, forbidden
  language, motion, shadows, gradients, hex). TypeScript error baseline 75. Edge functions still depend on
  `@lovable.dev/cloud-auth-js` for the AI gateway; do not remove it (AGENTS.md).
- Open, not decided here: the brand name is mid-transition (below); tenant-aware theming is not built
  (docs/DESIGN_SYSTEM.md "Not yet built"); the hiring-funnel definitions (analysis H1) and the re-engagement rule
  table (H2) are not yet written (03-GROW-FUNNEL-AND-REENGAGEMENT.md); the Agent-Cloud verification program's
  verdict is UNPROVEN as of 2026-10-27 (docs/audits/AC-P10-verification-2026-10-27.md).

## Brand Commitments

- Name: `resolveBrand()` in src/config/brand.ts returns platformName "Galaxy", productName "Galaxy OS", the
  on-screen organisation name "Galaxy Financial", title suffix "· Galaxy OS" and support email
  info@kingofsales.net; the registered legal entity stays Apex Financial until a filing completes, and only the
  legal pages keep that name (comment in brand.ts). The repository, AGENTS.md, docs/ and the domain
  apex-financial.org still say APEX / APEX OS. Never hardcode either name; the brand-literals guard counts them.
- Companies: APEX Financial (insurance agency / FMO) and King of Sales, kingofsales.net (AGENTS.md).
- Colour: a black-and-gold brand; gold is the one colour of the primary button (docs/DESIGN_SYSTEM.md). Visual
  detail belongs to DESIGN.md.
- Voice: short, plain English a 70-year-old reads once; controls name their action; automated messages stay in
  Sam's voice (00-MASTER.md "Words"; 03-GROW "Guardrails"). Marketing filler is banned by
  scripts/check-forbidden-language.mjs.
- Identity assets: /pwa-512x512.png and /favicon.ico; the self-hosted Hanken Grotesk font (public/fonts/).
  Social profiles in index.html's Organization JSON-LD: instagram.com/theprincejamez, tiktok.com/@theprincejamez,
  youtube.com/@samueljameshq; AGENTS.md says @theprincejamez everywhere (which YouTube handle is current is open).

## Evidence on Hand

- Public numbers come only from the `landing_live_stats()` RPC (active agents, applications in 30 days, carriers
  partnered; src/components/landing/LiveStatsCounterStrip.tsx). Typed-in statistics are banned by the
  forbidden-language guard. Do not write a number into copy.
- Testimonials: three first-name quotes hardcoded in src/components/landing/Testimonials.tsx (Alex, Moody,
  Chukwudi). Their provenance is not recorded in the repository; do not add, rename or embellish them.
- Video: "Why Producers Build With APEX", 5m46s, uploaded 2026-09-02, served from Supabase storage with its
  poster (JSON-LD in index.html). The Apply page carries its own income claims (src/pages/Apply.tsx); this
  record does not verify them and future work must not extend them.
- The shipped log src/data/shipped-data.ts records what shipped and why, in Sam's words, with `SHIPPED_TOTAL`
  guarded by check:metric-truth. Audits live under docs/audits/.
- Absent, so never to be invented: customer logos, press, case studies, pricing, benchmarks, agent counts.

## Product Principles

1. One job per screen and one gold button; a first-time user says what the page is for in two seconds.
2. Nothing is deleted, only moved: every number, list, filter, field and history entry stays within two taps.
3. Numbers tell the truth: a number opens the list it counts; unknown reads "—", never zero; loading, unavailable,
   no access, true zero and stale are five different states that read differently.
4. Clear first, then warm: colour, motion and sound carry meaning or mark a win the person just made; never on
   load, never on an error.
5. Phone first for every role, in both themes, with the owner's reach intact: Sam still sees every metric.

## Accessibility & Inclusion

- Target reader: someone old who has never used software. Nothing is explained only by hover; the word is always
  beside the colour; status is never colour alone.
- Enforced by guards and CSS: every icon-only control has a name; every Select and Switch has a label; controls
  are at least 44px tall on phones (src/index.css, max-width 640px); nothing under 13px on signed-in pages
  (src/styles/delight.css); visible keyboard focus everywhere; number inputs render at 16px on iOS so the page
  does not zoom.
- `prefers-reduced-motion` stops every entrance, loop and burst (delight.css, the global rule in index.css,
  `MotionConfig reducedMotion="user"`, `disableForReducedMotion` on confetti). Sounds sit behind one preference,
  off in one tap, and nothing plays on page load (src/lib/soundPreference.ts).
