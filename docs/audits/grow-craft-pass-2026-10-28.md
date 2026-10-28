# Grow craft pass, 2026-10-28 (PR #47)

Baseline is 61cc1a56, the head after PR #46 (merge cade2fc). Every number below came from a command run on 2026-10-28: the fixture harness in `.grow-harness/` (production `vite build` + `vite preview`, never the dev server) and the main `npm run build`. Raw logs stay in the ignored harness folder.

## What changed

| Commit | Change |
| --- | --- |
| GROW-CRAFT-1 | Motion review against Emil Kowalski's skills. Detail per finding in `grow-motion-review-2026-10-28.md`. |
| GROW-CRAFT-2 | Contrast and touch on the Grow shell: the sidebar Account label is no longer under 13px, contrast tokens, touch targets. |
| GROW-CRAFT-3 | Hostile data: Unicode-safe initials; a failed team lookup reports an error instead of passing as an empty team. |
| GROW-CRAFT-4 | One toaster: the 22 `useToast` callers moved to Sonner, the Radix toaster and its four files removed, Sonner set up for phones (above the bottom bar and safe area, swipe to dismiss, three visible, close button). |
| GROW-CRAFT-5 | Final-pass fixes found while verifying: the Worklist list height uses the dynamic viewport so the last rows are not hidden behind the iPhone toolbar; the unreachable save burst in `celebrate.ts` is deleted. |

## Before and after

| Check | Before | After |
| --- | --- | --- |
| Error crawl: 6 Grow routes x 6 data sets x 2 themes x 4 widths x 2 roles | 216 of 576 failing | 0 of 576 failing |
| of which text under 13px | 144 | 0 |
| of which console errors (failing-request data set) | 96 | 0 |
| Overflow, more than one gold button, error screens | 0 | 0 |
| TypeScript errors (`typecheck:count`) | 75 | 75 |
| Tests (`vitest run`) | 2,586 pass, 0 fail, 6 todo | 2,591 pass, 0 fail, 6 todo |
| JavaScript shipped, raw | 7,494,109 B in 410 chunks | 7,476,085 B in 408 chunks (-18,024) |
| vendor-radix chunk, raw | 162,621 B | 151,963 B |
| CSS shipped, raw (measured before the one-rule dvh fix) | 277,816 B | 275,466 B |
| Frame time p95, 4x CPU throttle, 3 runs | 10.1 to 10.2 ms | 9.1 to 9.2 ms |
| Frames over 16.7 ms per run | 1, 2, 1 | 1, 1, 1 |

Lighthouse, median of 3 runs, before and after:

| Route | Mobile perf | Mobile LCP | Desktop perf | Desktop LCP |
| --- | --- | --- | --- | --- |
| /dashboard/recruiting | 0.84, 0.84 | 3649, 3649 ms | 0.99, 0.99 | 776, 777 ms |
| /dashboard/recruiting/pipeline | 0.94, 0.94 | 2599, 2606 ms | 1.00, 1.00 | 577, 583 ms |
| /dashboard/recruits | 0.90, 0.90 | 3049, 3056 ms | 1.00, 1.00 | 656, 656 ms |
| /admin/invite-links | 0.93, 0.93 | 2747, 2748 ms | 1.00, 1.00 | 576, 578 ms |
| /dashboard/referrals/new | 0.93, 0.93 | 2745, 2748 ms | 1.00, 1.00 | 616, 619 ms |
| /va-team | 0.94, 0.94 | 2597, 2602 ms | 1.00, 1.00 | 576, 579 ms |

Accessibility (0.95 to 0.96) and best practices (0.96) are identical on every pair. TBT is 0 to 1 ms and CLS is 0 everywhere. The LCP differences sit inside the measured run-to-run spread of 12 ms.

## Claims re-measured

- **"A failed lookup is not an empty team."** True for the hook: it now throws, so React Query reports `isError` and retries instead of caching an empty list as success. A test pins it. Six screens outside Grow still default the result to an empty list: ManagerCommandView, AgentManagement, SubmitDealDialog, PreLicensing, AgencyOwnerHome and Dashboard. That is a follow-up, not part of this PR.
- **"Zero console errors."** Part of the 96-to-0 drop is that the hook stopped logging. The failure is still reported through React Query and the app-wide query error handler; it is not swallowed.
- **Toast migration.** The codemod left one expression that called a string as a function (AgentQuickEditDialog). It was fixed by hand into a warning toast, because the save itself succeeded.
- **Bundle saving.** The first comparison counted CSS and an image in the baseline total and overstated the saving as 61 KB. The corrected figure is 18 KB of raw JavaScript.
- **Mobile baseline.** viewport-fit=cover, safe-area insets, tap highlight, 16px inputs on touch and hover gating were already in place from PR #46. The one gap found was `100vh` in the Worklist list.

## Guards

All pass on the committed state: icon-button-labels, control-labels, forbidden-language, inline-timeago, recruiting-contact-actions, sidebar-routes, page-header-compact, hex-in-jsx-style, bg-gradient-cards, shadow-areas, motion-areas, metric-truth, reduced-motion-config, cold-landing-sonner, landing-css-size, theme-literals, orphan-pages, unresolved-imports.

## Not done

- No contact-sheet screenshots. Sam asked to go live, so the live site is the record.
- No physical-device pass (iPhone GPU, keyboard, safe areas). Desktop CPU throttling is not evidence for those.
- `@radix-ui/react-toast` is still listed in `package.json`. Nothing imports it, so it no longer ships; removing it touches three lockfiles and belongs in its own change.
