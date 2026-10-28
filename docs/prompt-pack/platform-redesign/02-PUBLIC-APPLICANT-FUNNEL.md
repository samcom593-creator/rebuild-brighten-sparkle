# 02 · Public funnel: landing, apply, hire link, get licensed, install, applicant home

Paste after `00-MASTER.md`. Branch `redesign/public-funnel`. Worktree `../rbs-public-funnel`.

## Goal

The top of the hiring funnel loses people silently: a landing page that says too much, an application
that asks too much at once, a success page without a next step, a hire link that lands on a form, a
licensing page that reads like a manual. After this area every public screen has one next step, every
exit is recorded, and the funnel from first visit to hire is measured on one strip.

## Read first

- Run analysis **H9 (public funnel leaks)** from `12-ANALYSIS-SESSIONS.md` first and save its answer; it
  ranks the leaks by lost hires per month and measures started → submitted → confirmed → licensed → hired.
- `docs/prompt-pack/RECRUITING_AND_LICENSING.md` (older, still true on guardrails),
  `docs/audits/apex-os-redesign-2026-10-05/07-invitations-comp-links.md` (hire link, `consume-invite-token`,
  the recruiting short link `/r/<slug>`) and `08-scripts-training-onboarding-email.md` (what a new hire
  receives and when).
- Pages: `src/pages/Index.tsx` (`/`, loaded eagerly: it is the cold landing), `LeadsLanding.tsx` (`/leads`),
  `RecruitingShortLink.tsx` (`/r/:code`), `Apply.tsx` (`/apply`, partial save and restore into
  `partial_applications`), `ApplySuccess.tsx`, `ApplySuccessLicensed.tsx`, `ApplySuccessUnlicensed.tsx`,
  `GetLicensed.tsx` (`/get-licensed`), `Login.tsx`, `HireLink.tsx` (`/hire/:token`), `Install.tsx`
  (`/install`), and the applicant branch of `src/pages/Dashboard.tsx` with `APPLICANT_NAV` in
  `agentCloudNavigation.ts` (a role-agent login with no agents row).
- Edge functions this path calls: `supabase/functions/consume-invite-token`, the apply submission function
  (find it from `Apply.tsx`), `instagram-dm-nudge` (recovers abandoned partials by email: do not duplicate it).
- Guards that watch these pages, read each before editing: `check:cold-landing-supabase-queryFn`,
  `check:cold-landing-sonner`, `check:apply-framer-free`, `check:vendor-icons-landing-census`,
  `check:landing-css-size`, `check:landing-truth-floor`, `check:landing-marketing-claims`, `check:vsl-sync`,
  `check:funnel-telemetry-sink`, `check:telemetry-unload-sync`, `check:telemetry-url-emit-time`,
  `check:public-fetch-jwt`, `check:anon-table-writes`, `check:public-allowlist-parity`,
  `check:forbidden-language`. The post-deploy Lighthouse budget (`.github/workflows/post-deploy-lighthouse.yml`)
  grades the landing after every deploy.

## Scope

The pages above, their components under `src/components/landing/**`, `src/components/apply/**` (or wherever
`Apply.tsx` keeps its steps), the applicant home, their tests, `ROUTE_BOARD.md`, the shipped log. No edge
function changes in this area; if a leak needs one, write it up with the H9 evidence for a follow-up.

## Guardrails

- The cold landing stays light: no Supabase query in a `queryFn` above the fold, no toast library, no
  framer on `/apply`, the CSS budget holds. Numbers on public pages come from `landing_live_stats()` or are
  replaced by non-numeric copy; never a hard-coded count.
- `Apply.tsx` keeps its partial save and restore. A person who leaves mid-form and comes back finds their
  answers. The step they left on is recorded (it already is: `partial_applications.step`).
- Unlicensed follow-up never reuses the licensed Calendly link. The success pages branch on licence status
  and each offers exactly one next action.
- The hire link (`HireLink.tsx`) locks to the invited email when one was given; an open link lets the person
  fill their own details. `consume-invite-token` branches licensed and unlicensed; do not change its
  contract.
- No new tables, no new RPCs. Telemetry events keep their names (`check:funnel-telemetry-sink`).
- Public copy is plain and true. `scripts/check-forbidden-language.mjs` lists what may not be said.

## Required work

1. **Landing (`/`, `/leads`, `/r/:code`).** One promise, one gold button ("Apply"), one secondary
   ("I'm already licensed" → the licensed path), proof only from `landing_live_stats()`. Everything else
   (video, FAQ, who we are) below the fold in calm sections, 16px body. A short link `/r/<slug>` carries
   the referrer through to the application and the success page says who referred them.
2. **Apply.** Numbered steps like `InviteAgentForm` (who you are; licence status; where you are; how to
   reach you; done), one question group per screen on a phone, labels above inputs, 48px continue button,
   a visible "Saved" state after each step (the partial save), and a back link that never loses answers.
   Phone and email validation inline with plain messages. The last step shows what happens next in one
   sentence.
3. **Success pages.** Licensed: book the interview (the licensed link) as the one gold action, with the
   time zone shown. Unlicensed: start licensing (`/get-licensed`) as the one gold action. Both: "Install the
   app" as the secondary, and the login state created by the confirmation made clear ("You're signed in as
   …").
4. **Get licensed.** Three steps with a completion state (course, exam, upload or confirm). The step the
   person is on is the only expanded one. One gold button per step. Progress persists (use what exists;
   if nothing persists it, record that as a follow-up, do not invent a table).
5. **Hire link.** Three steps (confirm who you are, choose licensed or unlicensed, accept). What the
   person gets after accepting is one sentence. Expired or used links say so in plain words with one action
   (ask the inviter again, with the inviter's name).
6. **Install.** One button per platform, detected from the device, the other platforms behind "Other
   devices".
7. **Applicant home.** Four links stay (`APPLICANT_NAV`). The home itself becomes one card: where they are
   in the path (applied → interview → licence → hired), the one next action, and who to contact. No
   producer widgets, no production numbers.
8. **Funnel strip.** With the H9 definitions, add a pure helper (unit-tested) that turns the measured
   counts into a six-step strip (Visited is unmeasured unless telemetry proves it: show "—" then) and
   render it on Sam's Home in area 04 and on the Call list in area 03. In this area, write the helper and
   its tests only.
9. **Measure.** Before and after: controls on first screen per page, words above the fold, Lighthouse
   scores (run `node scripts/lighthouse-prod.mjs` against the preview URL if it accepts one; otherwise the
   post-deploy workflow reports it), time to first continue tap on a phone.

## Verification

- Focused tests for every page touched (`src/tests/**` files that import them), then `npm test`;
  `npm run typecheck:count` ≤ baseline; `npm run build`; `npm run verify:core:all` with every landing guard
  above green.
- Harness screenshots at 390 and 1440, dark and light: `/`, `/leads`, `/r/<slug>`, each apply step, each
  success page, `/get-licensed` at each step, `/hire/<token>` valid / expired / used, `/install`, the
  applicant home. Look at every one.
- Council passes all four lenses; the First-timer lens is the heaviest here.

## Done means

- [ ] Every public screen has one gold action and says the next step in one sentence.
- [ ] Apply is stepped, saves as you go, and restores on return (tested).
- [ ] Success pages branch correctly and never reuse the licensed link for an unlicensed person (tested).
- [ ] The funnel helper and its tests exist; the H9 answer is saved under `docs/audits/platform-redesign-2026-10/`.
- [ ] All landing guards green; Lighthouse budget not worse.
- [ ] Before→after table and screenshots in the PR; shipped-log entry; `SHIPPED_TOTAL` matches.

## Acceptance output

1. Leaks found (from H9) and which this PR closes.  2. Files changed.  3. Verification performed.
4. Council verdict table.  5. Screenshot folder.  6. Follow-ups that need an edge function or a table.
