# APEX OS — Design System

**Status:** foundation exists and is documented here. This describes what IS in
the codebase (measured 2026-08-17), plus the rules now enforced by guards.

## Principles

1. **Clear first, then warm.** Data-dense screens optimize scan speed; colour, motion and
   sound are added where they carry meaning or mark a win ("Colour, motion and sound" below,
   2026-10-28).
2. **Tokens, never literals.** 117 CSS custom properties are the source of truth.
3. **One of each thing.** One icon library, one Button, one table system.
4. **Status is never colour alone.** Colour + label, always (§16).
5. **Every control has an accessible name.** Enforced, not aspirational.

## Tokens

Defined in `src/index.css` (117 custom properties) and surfaced through
`tailwind.config.ts` (16 semantic color keys). Dark mode is a separate
declaration set (25 blocks), not an inversion — per §19.

**Rule:** never hardcode a hex value in a component. 420 remain; they are legacy.

## Typography

One interface family plus `font-display` for marketing headlines. §5's cap of one
primary + one optional display face is met.

## Icons

`lucide-react` only, across 393 files. Adding a second icon library is a
regression (§17). Icon-only controls **must** carry an accessible name.

## Components

`src/components/ui/` holds the shared primitives (shadcn). 259 files import the
shared `Button`; **79 raw `<button>` elements remain** and should migrate.

## Colour, motion and sound (2026-10-28)

Sam, looking at the live Grow pages: "Lack of color. The text is small and ugly. No
animation. It looks like a terminal at a checkout. Make it animated. Add the bubbles and
effects, and sound effects. Make the entire website pleasant, cute and easy to use, and very
functional." This section is the answer. It sits on top of the rules above and does not
replace them: the same words, the same truth, the same accessibility, with colour and life.

**Tones.** Seven meaning-carrying colours. Names and mappings in `src/lib/tones.ts`, values per
theme in `src/styles/delight.css`, Tailwind `tone-*` (`text-tone-good`, `bg-tone-hot/12`,
`border-tone-cool/35`).

| Tone | Means | Examples |
|---|---|---|
| good | going well | Showed, Producing, lane alive |
| warm | needs a nudge | Warm lead, Waiting on us, Field training |
| hot | act now | Hot lead, No show, dead lane |
| cool | new or scheduled | New lead, Cold lead, Booked |
| royal | paperwork | Contracting, Onboarding |
| gold | the brand moment | Expected Monday, Hired, Sam's own threads |
| slate | quiet | Inactive, Answered, Not set |

Rules: the same state is the same tone on every page, so use the mapping functions
(`pipelineStageTone`, `intentTone`, `mondayTone`, `hireRungTone`, `teamStageTone`, `laneTone`,
`inboxBucketTone`, `platformTone`) and never pick a tone by hand; the word is always beside the
colour; a tone is a tint, a text colour or a hairline, never a solid fill behind body text; the
brand gold stays the one colour of the primary button. Every tone measures at least 4.5:1 on a
card in both themes.

**Bubbles.** `ToneBubble` (`src/components/ui/delight/ToneBubble.tsx`): an icon in a tinted
circle beside a page title, a tile label or a row. `TonePill`: a state in words with its tone.
`AmbientBubbles` (`src/components/layout/AmbientBubbles.tsx`): five soft colour fields drifting
behind the canvas of every signed-in page, under every card, three on phones, still under
reduced motion. Pages do not add their own backgrounds.

**Motion.** Classes in `src/styles/delight.css`, loaded by the signed-in shell only:
`apex-rise` and `apex-rise-list` (one entrance, 320ms, siblings 40ms apart), `apex-pop` (a
bubble or number arriving, 280ms), `apex-bump` (a number that changed, 360ms), `apex-lift`
(hover, 160ms, no glow), `apex-breathe` (a live indicator; with the ambient layer, the only
loops allowed). `CountUp` (`src/components/ui/delight/CountUp.tsx`) tweens a number to its new
value and never counts from zero on first paint. Tailwind hover and focus transitions stay
inside the 200ms budget `check-motion-areas.mjs` enforces; choreography lives in these classes,
not in `duration-*` utilities.

**Celebrations.** `celebrate(kind, origin)` in `src/lib/celebrate.ts`: round confetti from the
control the person pressed, plus a sound. `save` is a pop (an outcome saved, a note kept),
`booked` a chime (an interview booked, an invitation created), `hire` and `win` a fanfare (a new
agent, a Monday start, a first deal). Only after an action the person just completed. Never on
load, never on an error.

**Sound.** `playSoundEffect` in `src/hooks/useSoundEffects.ts`: synthesised, short, quiet. One
preference, `src/lib/soundPreference.ts`, toggled from the header (`SoundToggle`) and from
Profile settings; a change in one reaches the other at once. Nothing plays on page load.

**Type.** On signed-in pages `text-xs` renders at 13px and `text-sm` at 15px (delight.css);
page titles are 22px on phones and 26px on desktop; scoreboard numbers 32px to 40px. Nothing
under 13px.

**Accessibility, unchanged.** Status is never colour alone. `prefers-reduced-motion` stops every
entrance, loop and burst (CSS, `MotionConfig reducedMotion="user"`, and
`disableForReducedMotion` on confetti). Every icon-only control has a name. The bubbles are
`aria-hidden`; the words carry the meaning.

## Prohibited patterns (§12, §25)

Still prohibited on operating surfaces after the 2026-10-28 colour layer: gradients on cards
(the ambient layer's radial fields live in CSS under the surfaces, not on them), glass, neon,
glowing borders, looping motion other than `apex-breathe` on a live state, sound on page load.

Currently violated — counts are the live backlog:

| Prohibited | Occurrences |
|---|---|
| `bg-gradient-to-*` on operational surfaces | 76 |
| `rounded-2xl` / `rounded-3xl` | 62 |
| `backdrop-blur` (glass panels) | 36 |
| `shadow-xl` / `shadow-2xl` | 23 |

Also prohibited: neon accents, glowing borders, looping decorative motion, cards
nested in cards, a card wrapping one line of text, icon-only controls with no name.

## Accessibility rules (enforced)

- Every `<Button size="icon">` needs `aria-label`, `aria-labelledby`, `title`, or
  an `sr-only` child. **Guarded** by `check-icon-button-labels.mjs` at baseline 0.
- A tooltip is **not** an accessible name — Radix sets `aria-describedby`.
- Labels describe the **action**, not the glyph: "Call lead", not "Phone".
- Images need `alt`. All 35 currently have it.

## Guards

| Guard | Enforces | Baseline |
|---|---|---|
| `check-icon-button-labels.mjs` | every icon-only button has a name | **0** |
| `check-brand-literals.mjs` | hardcoded APEX literals may only fall | **540** |
| `check-empty-catch.mjs` | no new silent catches | 0 src / 55 fns |
| `check-metric-truth.mjs` | KPI source integrity | — |

All wired into `verify:core` and `.husky/pre-commit`.

## Not yet built

Tenant-aware theming (§20) — tenant accent colour, per-tenant logo/favicon, and the
three branding modes need the tenant entity (`AUDIT.md` §2). `src/config/brand.ts`
provides the seam; the visual half is blocked.
