# Grow craft pass, 2026-10-28 (PR #47)

Baseline is 61cc1a56, the head after PR #46 (merge cade2fc). Every number below came from a command run on 2026-10-28 against the final merged code: the fixture harness in `.grow-harness/` (production `vite build` + `vite preview`, never the dev server) and the main `npm run build`. Raw logs stay in the ignored harness folder.

## What changed

| Commit | Change |
| --- | --- |
| bfd21c2e (cloud session) | Motion review of the delight layer against Emil Kowalski's standards, with four new test files. Detail in `2026-10-28-motion-review.md`. |
| GROW-CRAFT-1 | A second, independent motion review (Codex). Detail in `grow-motion-review-2026-10-28.md`. Where it conflicted with the cloud review, the merge kept the cloud review's motion (see below). |
| GROW-CRAFT-2 | Contrast and touch on the Grow shell: darker tone colours, the sidebar Account label at 13px, 16px inputs and 44px targets on touch screens, tap feedback. |
| GROW-CRAFT-3 | Hostile data: Unicode-safe initials; a failed team lookup reports an error instead of passing as an empty team. |
| GROW-CRAFT-4 | One toaster: the 22 `useToast` callers moved to Sonner, the Radix toaster and its four files removed, Sonner set up for phones (above the bottom bar and safe area, swipe to dismiss, three visible, close button). |
| GROW-CRAFT-5 | The Worklist list height uses the dynamic viewport so the last rows are not hidden behind the iPhone toolbar. Its removal of the save burst was superseded by the merge. |
| Merge 34a55049 | The two reviews met in four files. Kept from the cloud review: rise, bump and breathe timing, the list stagger capped at 14 rows, a smaller save burst, the CountUp tween that settles in 280ms, and sound gated on a page the viewer has touched. Sam asked for the motion and the effects, and that review's tests pin the behaviour. Kept from GROW-CRAFT-2: every contrast and touch rule. Added: CountUp treats NaN and Infinity as unknown. |
| GROW-CRAFT-7 | Phones get a 2x2 scoreboard. Four tiles of about 80px wrapped every label onto two or three lines and set the numbers at different heights. |

## Before and after

| Check | Before | After |
| --- | --- | --- |
| Error crawl: 6 Grow routes x 6 data sets x 2 themes x 4 widths x 2 roles | 216 of 576 failing | 0 of 576 failing |
| of which text under 13px | 144 | 0 |
| of which console errors (failing-request data set) | 96 | 0 |
| Touch crawl: same routes and data, 390 and 768 wide, touch emulated so the phone rules apply | not run | 0 of 288 failing |
| TypeScript errors (`typecheck:count`) | 75 | 75 |
| Tests (`vitest run`) | 2,586 pass, 0 fail, 6 todo | 2,613 pass, 0 fail, 6 todo |
| JavaScript shipped, raw | 7,494,109 B in 410 chunks | 7,478,258 B (-15,851) |
| Frame time p95, 4x CPU throttle, 3 runs | 10.1 to 10.2 ms | 9.1 to 9.2 ms |
| Frames over 16.7 ms per run | 1, 2, 1 | 2, 1, 1 |

Lighthouse, median of 3 runs, before and after:

| Route | Mobile perf | Mobile LCP | Desktop perf | Desktop LCP |
| --- | --- | --- | --- | --- |
| /dashboard/recruiting | 0.84, 0.84 | 3649, 3647 ms | 0.99, 0.99 | 776, 775 ms |
| /dashboard/recruiting/pipeline | 0.94, 0.94 | 2599, 2597 ms | 1.00, 1.00 | 577, 577 ms |
| /dashboard/recruits | 0.90, 0.90 | 3049, 3046 ms | 1.00, 1.00 | 656, 655 ms |
| /admin/invite-links | 0.93, 0.93 | 2747, 2747 ms | 1.00, 1.00 | 576, 577 ms |
| /dashboard/referrals/new | 0.93, 0.93 | 2745, 2746 ms | 1.00, 1.00 | 616, 616 ms |
| /va-team | 0.94, 0.94 | 2597, 2598 ms | 1.00, 1.00 | 576, 576 ms |

Accessibility (0.95 to 0.96) is identical on every pair. The worst LCP change is 1 ms.

## Claims re-measured

- **"A failed lookup is not an empty team."** True for the hook: it throws, so React Query reports `isError` and retries instead of caching an empty list as success. A test pins it. Six screens outside Grow still default the result to an empty list: ManagerCommandView, AgentManagement, SubmitDealDialog, PreLicensing, AgencyOwnerHome and Dashboard. Follow-up, not this PR.
- **"Zero console errors."** Part of the 96-to-0 drop is that the hook stopped logging. The failure still reaches React Query and the app-wide query error handler; it is not swallowed.
- **Toast migration.** The codemod left one expression that called a string as a function (AgentQuickEditDialog). It was fixed by hand into a warning toast, because the save itself succeeded.
- **Merge.** Mixing hunks from the two CountUp rewrites produced a component that failed both sides' tests and added five type errors; the cloud file was restored whole. The new NaN rule came from Codex's test, which caught that a tween toward NaN painted "NaN".
- **Bundle saving.** An early comparison counted CSS and an image in the baseline total and overstated the saving as 61 KB. Raw JavaScript is the honest figure.
- **Phone rules.** The desktop crawl never matched `(pointer: coarse)`, so the 16px and 44px touch rules were unexercised until the touch crawl, which ran all 288 combinations with the rule active.

## Guards

All pass on the committed state: icon-button-labels, control-labels, forbidden-language, inline-timeago, recruiting-contact-actions, sidebar-routes, page-header-compact, hex-in-jsx-style, bg-gradient-cards, shadow-areas, motion-areas, metric-truth, reduced-motion-config, cold-landing-sonner, landing-css-size, theme-literals, orphan-pages, unresolved-imports.

## Not done

- No physical-device pass (iPhone GPU, keyboard, safe areas). Touch emulation and CPU throttling are not evidence for those.
- `@radix-ui/react-toast` is still listed in `package.json`. Nothing imports it, so it no longer ships; removing it touches three lockfiles and belongs in its own change.
