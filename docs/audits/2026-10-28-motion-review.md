# Motion review: the colour, motion and sound layer (2026-10-28)

Scope: the layer that shipped in merge cade2fc (`src/styles/delight.css`, `src/components/ui/delight/*`,
`src/components/layout/AmbientBubbles.tsx`, `src/lib/celebrate.ts`, `src/hooks/useSoundEffects.ts`,
`src/components/ui/button.tsx`, `src/components/ui/page-header.tsx`, `src/components/recruiting/GrowScoreboard.tsx`,
`StatusPill.tsx`, `src/components/ui/kpi-stat.tsx`) and every use of it across the five Grow routes.
Bar: `.claude/skills/review-animations/STANDARDS.md` (Emil Kowalski) for mechanics, `docs/DESIGN_SYSTEM.md`
"Colour, motion and sound" for meaning. Measured in the local harness (`.grow-harness/`, port 5221) with
Playwright and `impeccable detect`, at 390x844 and 1440x900, dark and light. Line numbers "as found" are
commit c7324bf; "as left" are the working tree after this review.

## Inventory, against the ten standards

| Motion | Where (as found) | Purpose / frequency | Easing, duration, properties | Origin, interruptibility, reduced motion, hover gate | Verdict |
| --- | --- | --- | --- | --- | --- |
| Ambient drift (5 fields) | delight.css:57-93, AmbientBubbles.tsx | decoration Sam asked for; on screen all day | ease-in-out 36-52s alternate; transform only; gold stop at 0.30 alpha | fixed, out of layout, pointer-events none; stopped under reduced motion | keep, make quiet (0.16 peak, centres off-screen, no violet) |
| apex-rise / apex-rise-list | delight.css:100-121; WorklistViews.tsx:316, GrowScoreboard.tsx:42, RecruitingPipeline.tsx:469, RecruitPipeline.tsx:538, 699, InvitationsTable.tsx:369, 419, VaManagerPortal.tsx:401, 433, SocialCommandCenter.tsx:172, 188, 302, 474 | preventing a jarring change; every mount, tens/day for a recruiter | 320ms cubic-bezier(0.2,0,0,1) (zero start velocity); opacity + translateY(8px); 40ms stagger, rows 11+ all at 400ms, every row animated; fill `both` | CSS keyframes (fine: not retargeted); reduced motion: none | reduce: 240ms strong ease-out, 6px, 30ms x 14 rows, `backwards` |
| apex-pop | delight.css:124-129; page-header.tsx:281, PersonPanel.tsx:395, InviteAgentForm.tsx:153, 660, ReferralSubmit.tsx:181, VaManagerPortal.tsx:479, empty-state.tsx:47, MobileBottomNav.tsx:174 | a bubble arriving; every route mount | 280ms cubic-bezier(0.3,0,0.1,1), 0.92 -> 1.05 -> 1, opacity from 0.4; fill `both` | reduced motion: none | reduce: 220ms strong ease-out, 0.94 -> 1, no overshoot |
| apex-bump | delight.css:131-136; CountUp.tsx:66 | state indication: a number changed; after a save | 360ms (over budget), scale to 1.14 | reduced motion: none | reduce: 240ms, 1.08; reduced motion keeps an opacity dip |
| apex-breathe | delight.css:139-143; SocialCommandCenter.tsx:163, ToneBubble pulse | state: one live indicator per page | 1.8s ease-out infinite on box-shadow (repaints every frame) | reduced motion: none | move to a transform/opacity ring on ::after |
| apex-lift | delight.css:146-153; GrowScoreboard.tsx:79, WorklistViews.tsx:335, 457 | affordance on tiles and rows; hover tens to hundreds/day | 160ms (0.2,0,0,1) translateY(-1px); background and border colour | hover gate `(hover: hover)` only, no `pointer: fine`; no press | gate to a fine pointer, add scale(0.98) press at 120ms |
| Button | button.tsx:8, 12 | feedback on every press | transition background/box-shadow/filter, `duration-[140ms]` (never compiled: 150ms default), brightness only, no transform | reduced motion handled by index.css global rule | add scale(0.97) press, 120ms strong ease-out, named properties |
| CountUp tween | CountUp.tsx:5, 35-62 | feedback: a number changed | 520ms cubic ease-out via setState per frame on one leaf | retargets from the last target, not the number on screen | 280ms; retarget from the live value |
| celebrate() | celebrate.ts:56-83; 17 call sites in the five routes | delight after a completed action (rare) | canvas-confetti, 16 / 48 / 120+48+48 particles, 80-160 ticks | pointer-events none, z 10000 under Sonner; disableForReducedMotion; no phone scaling; confetti calls outside try | scale 0.6 on phones, shorter, every call guarded |
| playSoundEffect | useSoundEffects.ts:104-113 | feedback after a completed action | 35-460ms synthesised, gain <= 0.13 | relies on callers for "never on load" | gate on navigator.userActivation |
| framer-motion `x`/`y`/`scale` | none of the five Grow routes imports framer-motion (40 other pages do) | | | | nothing to do in scope |

Easing, checked at 4x in the harness (`scratchpad/craft/motion/easing.cjs`, WAAPI, 8px rise over 960ms,
distance covered at 10% / 20% / 30% of the time, first visible pixel):
`cubic-bezier(0.2, 0, 0, 1)` 11% / 43% / 65%, first pixel at 13% of the time;
`cubic-bezier(0.3, 0, 0.1, 1)` 6% / 31% / 59%, first pixel at 16%;
`cubic-bezier(0.23, 1, 0.32, 1)` 35% / 66% / 84%, first pixel at 5%;
easeOutBack 36% / 68% / 90% with a 10% overshoot. The two house curves pause for the first 30-40ms of a
240ms entrance; the strong ease-out moves on its first frame. It is now the layer's curve for everything
that enters, pops or is pressed (`--ease-out-strong`, delight.css).

## Part 1: findings

| Before | After | Why |
| --- | --- | --- |
| delight.css:67 gold field `hsl(var(--tone-gold) / 0.3)` at `left:-14vmax; top:-12vmax` (centre under the page title), layer opacity 0.55 dark / 0.42 light; `impeccable detect` flags `radial-spotlight-glow` on every dark scan (388 and 663px spans) | peaks 0.16 / 0.14 / 0.12 / 0.11 / 0.10, layer 0.7 dark / 0.55 light (strongest tint under any text 11% of a tone), every centre outside the viewport, none under the title, subtitle or tab row | Standard 1 and 10: decoration must never read as a cloud over copy; detector now 0 radial-spotlight-glow on 8 scans |
| delight.css:80-83 violet field (`--tone-royal` radial-gradient); detector flags `ai-color-palette: Purple/violet gradient background` on every 1440 scan | the fourth field is `--tone-warm` (amber); no violet gradient anywhere in the layer | Cohesion: a purple radial haze is the one background the detector names as a generated-page tell; 0 hits on 8 scans |
| delight.css:63 `animation: apex-drift … ease-in-out infinite alternate`, 46vmax, `will-change: transform` | unchanged mechanics (transform only, no filter, no blur, composite-only), documented; drift 5vmax/4vmax, scale 1.06; `animation: none` under reduced motion | Standard 7: ease-in-out is right for an oscillation; 1 style recalc per frame is Blink ticking the composited animation, 0 layouts, 0 long frames at 390 |
| delight.css:105, 109 `apex-rise 320ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)) both`, `translateY(8px)` | `apex-rise 240ms var(--ease-out-strong) backwards`, `translateY(6px)` | Standard 3 and 4: 320ms is over the 300ms budget and the curve starts at zero velocity (11% at 10% of the time); the strong ease-out moves on frame one |
| delight.css:105-121 fill `both` on every rising row and tile | `backwards` | A forwards fill keeps the last keyframe's `transform: none` applied for the element's life and outranks `:hover`/`:active`, so no tile or chip inside a list ever lifted or pressed (measured: tile `:active` transform = identity before, `scale(0.98)` after) |
| delight.css:111-121 stagger 40ms, rows 11+ at 400ms, every row of a 500-row list animated | 30ms steps for rows 1-14, `:nth-child(n + 15) { animation: none }`; Reveal.tsx caps `--rise-i` at 8 (`clampStagger`) | Stagger rule: 30-80ms, decorative, never blocking; a 500-row list no longer promotes 500 layers or hides a row for 400ms |
| delight.css:124-129 `apex-pop 280ms var(--ease-emphasized) both`, `0.92 -> 1.05 -> 1`, opacity from 0.4 | `apex-pop 220ms var(--ease-out-strong) backwards`, `scale(0.94) + opacity 0 -> 1` | Standard 5 and 10: starts from a visible shape, lands without a bounce (the detector's bounce-easing advisory went away with the back curve) |
| delight.css:131-136 `apex-bump 360ms`, scale 1.14 | `apex-bump 240ms var(--ease-out-strong)`, scale 1.08 | Standard 4: 360ms is over budget on a number that changes after every save |
| delight.css:139-143 `apex-breathe` animates `box-shadow` 0 -> 7px, 1.8s infinite | a `::after` ring in `currentColor` scaling 1 -> 1.5 and fading 0.55 -> 0, 1.8s; hidden under reduced motion | Standard 7: box-shadow repaints every frame of a loop; transform and opacity composite |
| delight.css:151 `@media (hover: hover)` | `@media (hover: hover) and (pointer: fine)` | Standard 8: touch fires false hovers on tap |
| delight.css:146-153 lift only, 160ms (0.2,0,0,1) | `.apex-lift:active, .apex-press:active { transform: scale(0.98) }`, `transform 120ms var(--ease-out-strong)`, colour on `ease` 160ms | Standard 9 / press feedback: every pressable scales 0.95-0.98 on `:active`, 100-160ms; hover colour change on `ease` |
| delight.css:173-183 `animation: none !important` on every class, `.apex-lift:hover { transform: none }` | entrances and pops become `apex-fade 200ms ease-out backwards !important` with no delay (the `!important` outranks index.css:284's `0.01ms` on `*`), bump becomes an opacity dip, ring and drift stop, lift and press flat, rows 15+ still instant | Standard 8: gentler, not zero: keep opacity, drop movement |
| button.tsx:8 `transition-[background,box-shadow,filter] duration-[140ms]`, `active:brightness-95` only | `transition-[background-color,box-shadow,filter,transform] [transition-duration:120ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.97]` | Press feedback on every pressable; named properties; `duration-[140ms]` and `ease-[…]` do not compile under this config (tailwindcss-animate; checked with the Tailwind CLI), so the shipped button had run at the 150ms default; arbitrary properties compile under every config, the landing one too |
| GrowScoreboard.tsx:79 `apex-lift transition-colors` | `apex-lift` only | One owner for the tile's transition; `transition-colors` fought `.apex-lift` for `transition-property` |
| CountUp.tsx:5 `TWEEN_MS = 520`; effect retargets from `previous.current` (last target) | `TWEEN_MS = 280`; `live` ref holds the number on screen each frame and a retarget starts from it | Standard 4 and 6: feedback inside the budget; two saves inside 280ms no longer jump |
| celebrate.ts:66-80 16 / 48 / 120+48+48 particles, 80-160 ticks, same on a phone, `confetti()` outside the try | 14 / 40 / 90+36+36, 70-140 ticks; x0.6 counts and x0.8 ticks under 640px (hire on a phone: 54+22+22 = 98); every `confetti()` inside try; returns before the import without a `document` | Performance on a phone (canvas-confetti draws on the main thread) and "never throws into the action it followed"; canvas stays `pointer-events: none`, z 10000 above dialogs (z-50) and below Sonner (999999999) |
| useSoundEffects.ts:104 plays whenever `isSoundEnabled()` | returns while `navigator.userActivation.hasBeenActive` is false | House rule "nothing plays on page load" becomes a property of the module: a note scheduled on a suspended context would otherwise play at the first unrelated tap |

Verified: the 20 guards named for the craft pass plus check-landing-css-size and
check-reduced-motion-config exit 0 (check-empty-catch asked for the `empty-catch-allow` marker on the
two confetti guards and has it); vitest green on the 25 files that import this layer (262 tests) and on
the four files added or extended here (27 tests: reduced-motion CountUp, tween settles and bumps, stagger
cap, Button classes, celebrate on a phone / under reduced motion / without a document / when the chunk
fails, playSoundEffect before and after the first gesture, delight.css budget, gate, cap, alpha and
reduced-motion rules); `tsc --noEmit -p tsconfig.app.json` prints nothing for the owned files.

### Measured

Detector (`impeccable detect`, counted anti-patterns / advisory notes), harness on port 5221:

| Scan | Before | After |
| --- | --- | --- |
| Call list dark 390 | 2 / 2 (radial-spotlight-glow) | 1 / 2 |
| Call list dark 1440 | 5 / 3 (radial-spotlight-glow, ai-color-palette) | 3 / 3 |
| Call list light 390 | 7 / 7 | 6 / 9 |
| Call list light 1440 | 9 / 10 (ai-color-palette) | 8 / 10 |
| Pipeline dark 390 | 1 / 1 (radial-spotlight-glow) | 0 / 1 |
| Pipeline dark 1440 | 2 / 1 (radial-spotlight-glow, ai-color-palette) | 0 / 1 |
| Pipeline light 390 | 5 / 6 | 4 / 7 |
| Pipeline light 1440 | 5 / 7 (ai-color-palette) | 3 / 8 |

Counted 36 before, 25 after; advisory 37 before, 41 after, because five "unread layer" findings that
the gold field under the header had pushed to 3.7-4.1:1 at 390 now measure 4.2-4.3:1 and the detector
files those as advisory. radial-spotlight-glow: 4 of 8 scans before, 0 after. ai-color-palette: 4 of 8
before, 0 after. What remains of "pixel contrast … on unread layer" (tab labels 4.1-4.3:1, subtitle
4.4:1, light theme) is not the bubbles: with the ambient layer set to `display: none` the detector
reports the identical ratios (`scratchpad/craft/motion/detector-exonerate/`). They are the light-theme values of
`--muted-foreground` (#6b675b on #e6e2d6 = 4.4:1) and the tab text, sampled through
`.page-enter::before` (index.css:1086-1094, a primary radial gradient 320px tall under every page
header), and belong to the token and page-enter findings below.

Frame-time sample, call list at 390x844, 3 seconds after the entrances, `requestAnimationFrame` deltas
plus CDP `Performance.getMetrics`:

| | Before | After |
| --- | --- | --- |
| frames / mean / p95 / max | 181 / 16.67ms / 16.7ms / 16.8ms | 181 / 16.67ms / 16.7ms / 16.8ms |
| frames over 17ms / 33ms / 50ms | 0 / 0 / 0 | 0 / 0 / 0 |
| layouts / style recalcs in 3s | 0 / 182 | 0 / 182 |
| style recalc / script / task ms | 13.8 / 8.3 / 66.9 | 20.7 / 11.1 / 166.2 (light theme 18.2 / 7.6 / 75.2) |

The one style recalc per frame is Blink ticking the composited drift animation (three fields on a
phone); it costs about 0.1ms a frame and does not change with the alpha or position of the fields. A
sample taken while the detector's own Chromium was running on the same machine showed 2 frames over
17ms (max 50ms); the clean sample above shows none.
Headless Chromium on this machine is not a mid-range phone: the numbers prove the layer costs no
layout and no long frame here, not that it is free on a 2019 Android.

Visual check (`scratchpad/craft/motion/after/*.png`, both routes, both themes, 390 and 1440): no sideways
scroll (390/390, 1440/1440), smallest text in `<main>` 13px, every link, button and input in `<main>` at
least 44px tall at 390 (25 controls on the call list, 148 on the pipeline), no console errors.

### Deferred (files this cluster does not own)

| Where | Finding | Owner |
| --- | --- | --- |
| index.css:2131-2136 `.page-enter button:not([disabled]), .page-enter a { transition … 180ms cubic-bezier(0.2,0,0,1) }` | Specificity (0,2,1) overrides Button's 120ms press and `.apex-lift`'s transition on every Grow page (all five wrap in `.page-enter`); measured tile transition 180ms (0.2,0,0,1). Delete it; the components own their transitions | mobile cluster |
| index.css:1646 `button:active, [role="button"]:active { transform: scale(0.96) }` | A global press that also runs under reduced motion (measured 0.96 with `reducedMotion: reduce`); wrap in `prefers-reduced-motion: no-preference` or delete now that Button and `.apex-press` carry the press | mobile cluster |
| index.css:1123-1133 `.bg-primary { transition … transform 120ms }` and `button.bg-primary:active { transform: translateY(1px) }` | A second press (translateY) on primary buttons competing with scale(0.96) and scale(0.97): three rules for one press | mobile cluster |
| index.css:1086-1094 `.page-enter::before` radial-gradient(primary / 0.06) 320px tall | A gold haze under every page header, the layer the detector samples the "unread layer" contrast through; the ambient layer already provides the wash, this one should go | mobile cluster |
| index.css:1099-1103 `.page-enter { animation: apex-page-enter 320ms }` | A second entrance (320ms, over budget) under the rows' own rise on every Grow page; one entrance per page | mobile cluster |
| index.css:103-104 `--ease-standard`, `--ease-emphasized` | Both start at zero velocity; `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` belongs in this motion scale (it lives in delight.css until then) | mobile cluster |
| Light tokens: `--muted-foreground` 4.4:1 on the page background, tone text on tints 3.3-4.4:1 (baseline SUMMARY contrast table) | The remaining low-contrast and "unread layer" findings on both routes | mobile cluster |
| RecruitingPipeline.tsx:304 `playSoundEffect("tick")` in the intent Select's `onValueChange` | Fires per arrow key when the select is driven by keyboard: a sound on a keystroke; move it to the commit (close) of the select | pipeline cluster |
| MobileBottomNav.tsx:174 `apex-pop` on the active tab's bubble | Pops on every tab change (tens/day); a 100+/day control should not animate; drop the class | shell cluster |
| WorklistViews.tsx:335, 457 `apex-lift` on list rows | Rows are hovered hundreds of times a day; keep the colour change, consider dropping the 1px lift (Standard 2) | call list cluster |
| RecruitingWorkspaceNav.tsx:49-53 tab text | `text-muted-foreground` tab labels measure 4.1-4.3:1 in the light theme | call list cluster / tokens |

## Part 2: verdict

**As found (cade2fc / c7324bf): Block.** Three feel-breaking regressions: entrances over the 300ms budget
on a zero-start curve (320ms rise, 360ms bump), a forwards fill that silently cancelled every lift and press
on tiles and chips, and a reduced-motion block that removed every transition instead of softening it. One
performance finding with an easy GPU fix (box-shadow loop). One decoration reading as a cloud over copy
(radial-spotlight-glow on 4 of 8 scans) and a violet gradient the detector names as a generated-page tell
(4 of 8).

1. Feel-breaking regressions: fixed. 240/220/240ms on `cubic-bezier(0.23, 1, 0.32, 1)`; `backwards`
   fill; press on every pressable (Button 0.97 at 120ms, tiles 0.98); CountUp 280ms and retargets from
   the live value.
2. Missed simplifications: the list rise on the call list is seen tens of times a day; it was reduced
   (6px, 240ms, 14 rows), not deleted, because the house rule allows one entrance and the owner asked
   for it. The pop on the header bubble and the bottom-nav tab (MobileBottomNav.tsx:174) are the two
   left that a strict read would delete; the second is deferred to its owner.
3. Performance: drift transform-only and quiet; breathe on the compositor; stagger capped at 14 rows;
   confetti scaled for phones; 0 layouts and 0 long frames in the 3s sample.
4. Interruptibility and timing: entrances are keyframes on mount only (not retargeted), transitions for
   hover and press; CountUp retargets from the number on screen.
5. Origin, physicality and cohesion: pop from 0.94, no bounce, no `scale(0)`, no `ease-in`, no
   `transition: all`; one curve across the layer.
6. Accessibility: reduced motion keeps a 200ms fade and an opacity dip, drops every movement and loop;
   hover gated to a fine pointer; no sound before the first gesture; bubbles `aria-hidden`.

**As left: Approve for the owned layer,** with the deferred table above open: the three index.css rules
(`.page-enter button`, global `button:active`, `.bg-primary:active`) still override or double the press
on the Grow pages until the mobile cluster removes them, and the light-theme token ratios are what the
detector still counts.
