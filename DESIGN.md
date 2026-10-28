---
name: APEX OS (Galaxy OS)
description: Token record of the signed-in interface, warm parchment and charcoal neutrals, one brand gold, seven meaning-carrying tones, hairline depth, motion that happens once.
colors:
  # Light theme. Source: src/index.css ":root" and ".light" (stored there as bare HSL triplets, e.g. "44 24% 87%").
  background: "hsl(44 24% 87%)"
  foreground: "hsl(43 14% 11%)"
  card: "hsl(44 30% 95%)"
  popover: "hsl(44 30% 95%)"
  secondary: "hsl(44 26% 90%)"
  muted: "hsl(44 26% 90%)"
  muted-foreground: "hsl(45 8% 39%)"
  accent: "hsl(43 24% 87%)"
  border: "hsl(45 24% 86%)"
  input: "hsl(45 24% 86%)"
  primary: "hsl(41 52% 45%)"
  primary-foreground: "hsl(47 100% 5%)"
  ring: "hsl(41 52% 45%)"
  destructive: "hsl(1 65% 54%)"
  success: "hsl(133 54% 40%)"
  warning: "hsl(37 78% 42%)"
  info: "hsl(210 53% 50%)"
  sidebar-background: "hsl(44 28% 93%)"
  sidebar-border: "hsl(45 24% 86%)"
  # The seven tones, light. Source: src/styles/delight.css ":root, :root.light".
  tone-good: "hsl(152 62% 34%)"
  tone-warm: "hsl(33 92% 33%)"
  tone-hot: "hsl(4 70% 44%)"
  tone-cool: "hsl(211 78% 42%)"
  tone-royal: "hsl(262 58% 50%)"
  tone-gold: "hsl(42 70% 30%)"
  tone-slate: "hsl(220 10% 44%)"
  # Dark theme (the shipped default). Source: src/index.css ".dark" and src/styles/delight.css ":root.dark".
  background-dark: "hsl(30 6% 11%)"
  foreground-dark: "hsl(40 18% 90%)"
  card-dark: "hsl(30 6% 14%)"
  popover-dark: "hsl(30 6% 15%)"
  secondary-dark: "hsl(30 6% 17%)"
  muted-dark: "hsl(30 6% 17%)"
  muted-foreground-dark: "hsl(35 8% 72%)"
  accent-dark: "hsl(30 6% 19%)"
  border-dark: "hsl(30 6% 24%)"
  input-dark: "hsl(30 6% 20%)"
  primary-dark: "hsl(46 68% 47%)"
  primary-foreground-dark: "hsl(47 100% 6%)"
  ring-dark: "hsl(46 68% 47%)"
  destructive-dark: "hsl(1 60% 52%)"
  success-dark: "hsl(137 50% 46%)"
  warning-dark: "hsl(39 72% 52%)"
  info-dark: "hsl(211 62% 58%)"
  sidebar-background-dark: "hsl(30 6% 9%)"
  sidebar-border-dark: "hsl(30 6% 18%)"
  tone-good-dark: "hsl(150 62% 54%)"
  tone-warm-dark: "hsl(40 94% 60%)"
  tone-hot-dark: "hsl(6 86% 66%)"
  tone-cool-dark: "hsl(206 90% 68%)"
  tone-royal-dark: "hsl(262 82% 74%)"
  tone-gold-dark: "hsl(45 86% 58%)"
  tone-slate-dark: "hsl(220 10% 64%)"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "32px"
    letterSpacing: "0"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  control:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  nav:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "20px"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  "2xl": "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-page:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "8px 32px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.card}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-icon-shell:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    width: "44px"
    height: "44px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "16px"
  tone-pill-good:
    backgroundColor: "hsl(152 62% 34% / 0.12)"
    textColor: "{colors.tone-good}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  tone-bubble-md:
    backgroundColor: "hsl(42 70% 30% / 0.12)"
    textColor: "{colors.tone-gold}"
    rounded: "{rounded.full}"
    width: "40px"
    height: "40px"
  scoreboard:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
    padding: "12px"
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.nav}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  sidebar-item-active:
    backgroundColor: "hsl(42 70% 30% / 0.12)"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.control}"
    rounded: "0"
    padding: "8px 12px"
    height: "44px"
---

# Design System: APEX OS (Galaxy OS)

Captured 2026-10-28 from the code as it ships (scan mode, no interview). The house rulebook is
[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md); its section "Colour, motion and sound" (2026-10-28) governs
meaning: which tone means what, the word beside the colour, when to celebrate, what gets sound. This file
records the tokens and components that implement it and must never contradict it. For motion mechanics
(easing, duration, properties, interruptibility, reduced motion, hover gating) the project follows
`.claude/skills/emil-design-eng/SKILL.md`. Where a value here and the rulebook disagree, the rulebook wins on
meaning and the code is the bug.

## Overview

**Creative North Star: "The Warm Ledger"** (proposed, unconfirmed; alternatives: "The Friendly Counter",
"The Gold-Pencil Notebook")

Two modes live in one repository. **Operate** is the signed-in app rendered inside `AuthenticatedShell`
(`src/components/layout/`), and it is what this document describes: a tool a recruiter uses sixty times a day
and a 70-year-old can read once. **Persuade** is the public landing (`src/components/landing/*`); it is built
from the same theme by `tailwind.config.landing.cjs` into `public/landing.css` under a size ceiling
(`scripts/check-landing-css-size.mjs`) and is not documented here beyond that pointer.

The incumbent Operate system (proposed reading, unconfirmed): warm paper in the light theme and warm charcoal
in the dark one, never pure white or pure black because both hurt the owner's eyes (comments at
`src/index.css` lines 41 and 214); one gold, which is the brand and the primary button; seven quiet tones
that say what state a thing is in, always next to the word that says it; depth drawn with 1px hairlines and
two surface steps rather than shadows; large, calm type in a single grotesk with tabular figures; motion that
happens once, on arrival or on a change, and a celebration only after the person finishes something; sound
that is short, synthesised and off in one tap. Density is high (lists, tiles, panels) but every screen keeps
one job and one gold button. Rejected on operating surfaces, per the rulebook and the guards: gradients on
cards, glass, neon, glowing borders, looping decoration, sound on load.

`src/index.css` still carries older strata (glass, glow, gradient text, aurora, "game-feel" classes). They are
legacy, not vocabulary: the rulebook prohibits them on operating surfaces and the guards ratchet them down
(backlog measured 2026-08-17 in DESIGN_SYSTEM.md: 76 gradients, 62 `rounded-2xl/3xl`, 36 `backdrop-blur`,
23 `shadow-xl/2xl`). New work uses only what is named below.

**Key Characteristics:**
- Warm neutrals: hue 44 (light) and hue 30 (dark), low saturation, with the page one step darker than the card.
- One accent: brand gold is the primary button, the focus ring, the active rail and the "gold" tone.
- Seven tones with fixed meanings; the same state is the same tone on every page; the word is always beside it.
- Hairline depth: 1px `border-border`, no card shadows; shadows only on overlays.
- Type floor 13px, body 15–16px, titles 22–26px, scoreboard numbers 32–40px, tabular figures everywhere.
- Motion once: one entrance (320ms), one pop (280ms), one bump (360ms), one lift (160ms); loops only for the
  ambient background and a live dot; everything stops under reduced motion.
- Controls 44px tall on phones, 40px on desktop, 48px for the page's gold button.

## Colors

A warm, low-chroma ground with a single gold accent and a small set of saturated tones reserved for meaning
(proposed phrasing, unconfirmed). Every value lives as a bare HSL triplet in a CSS custom property and reaches
Tailwind as `hsl(var(--token))` (`tailwind.config.ts`). The frontmatter above is normative; the names in
parentheses are proposals for the owner to confirm.

### Primary
- **Brand Gold** (`--primary`: `41 52% 45%` light, `46 68% 47%` dark; `src/index.css`): the one colour of the
  primary button, the focus ring (`--ring` is the same value), the active sidebar rail and the brand mark.
  Its ink is **Gold Ink** (`--primary-foreground`: `47 100% 5%` / `47 100% 6%`), near-black on gold in both
  themes. `--gold` and `--sidebar-primary` repeat the same value in both themes; the older `--apex-gold`
  (`41 52% 45%`) does not change with the theme; `--gold-bright` and `--gold-dim` (`41 56% 31%` /
  `42 30% 47%` light, `46 72% 56%` / `44 45% 44%` dark) are rarely used.
- **The gold tone is not the button.** `--tone-gold` (`42 70% 30%` light, `45 86% 58%` dark;
  `src/styles/delight.css`) is gold as text, tint and hairline for pills and bubbles; it is darker than the
  button in the light theme so it reads on a card.

### Secondary: the seven tones
The semantic layer of the operating surfaces (`src/lib/tones.ts`; values in `src/styles/delight.css`; Tailwind
`tone-*`). A tone is used three ways only: text (`text-tone-*`), a tint at 12% behind a pill or bubble
(`bg-tone-*/12`) or 8% behind a selected tile (`bg-tone-*/8`), and a hairline at 35% (`border-tone-*/35`).
Tailwind's opacity scale was extended with the 8 and 12 steps for this (`tailwind.config.ts`).

| Tone | Means | Light | Dark | Proposed name (unconfirmed) |
|---|---|---|---|---|
| good | going well: Showed, Producing, lane alive | `152 62% 34%` | `150 62% 54%` | Field Green |
| warm | needs a nudge: Warm lead, Waiting on us | `33 92% 33%` | `40 94% 60%` | Amber Nudge |
| hot | act now: Hot lead, No show, dead lane | `4 70% 44%` | `6 86% 66%` | Signal Red |
| cool | new or scheduled: New lead, Cold lead, Booked | `211 78% 42%` | `206 90% 68%` | Sky Blue |
| royal | paperwork: Contracting, Onboarding | `262 58% 50%` | `262 82% 74%` | Violet Paperwork |
| gold | the brand moment: Expected Monday, Hired | `42 70% 30%` | `45 86% 58%` | Brand Gold Ink |
| slate | quiet: Inactive, Answered, Not set | `220 10% 44%` | `220 10% 64%` | Quiet Slate |

Tones are never picked by hand: `pipelineStageTone`, `intentTone`, `mondayTone`, `hireRungTone`,
`teamStageTone`, `laneTone`, `inboxBucketTone` and `platformTone` map a state to its tone, and
`NAV_SECTION_TONE` (`src/components/layout/agentCloudNavigation.ts`) gives each sidebar section one tone.
DESIGN_SYSTEM.md states every tone measures at least 4.5:1 on a card in both themes; the 2026-10-28 craft pass
reported the hot tone's contrast as a detector finding on at least one surface (not re-measured here), so
measure hot before relying on it.

### Tertiary: the older status set
`--success` (`133 54% 40%` / `137 50% 46%`), `--warning` (`37 78% 42%` / `39 72% 52%`), `--info`
(`210 53% 50%` / `211 62% 58%`) and `--destructive` (`1 65% 54%` / `1 60% 52%`) predate the tones. They remain
for the destructive Button variant, the destructive Badge, toasts and older components. New state colour on an
operating surface uses a tone, not these. A second, older token family (`--apex-bg`, `--apex-card`,
`--apex-text`, `--apex-accent` and friends in `src/styles/apex-tokens.css`, Tailwind `apex.*`) is still wired
up for legacy call sites; new work does not reach for it.

### Neutral
- **Warm Parchment** (`--background`: `44 24% 87%`) and **Warm Charcoal** (`30 6% 11%`): the page.
- **Cream Card** (`--card`: `44 30% 95%`) and **Charcoal Card** (`30 6% 14%`): every card, tile, row surface and
  the top bar's ground; `--popover` matches it (dark: `30 6% 15%`).
- **Ink** (`--foreground`: `43 14% 11%`) and **Off-white Ink** (`40 18% 90%`): all body text.
- **Quiet Ink** (`--muted-foreground`: `45 8% 39%` / `35 8% 72%`): labels, hints, subtitles, inactive nav.
- **Hairline** (`--border` and `--input`: `45 24% 86%` light; dark `30 6% 24%` border, `30 6% 20%` input).
- **Soft fills** (`--secondary` and `--muted`: `44 26% 90%` / `30 6% 17%`; `--accent`: `43 24% 87%` /
  `30 6% 19%`): hover grounds, secondary buttons, skeletons, notice rows (`bg-muted/30`).
- **Rail** (`--sidebar-background`: `44 28% 93%` / `30 6% 9%`, `--sidebar-border`: `45 24% 86%` / `30 6% 18%`).
- Under the dark shell the document is `hsl(40 12% 3.5%)` with two warm radial washes on `body`
  (`src/index.css` ~1437); the shell paints `--background` over it.
- **Ambient fields**: five radial colour fields (gold, cool, good, royal, hot at 30% to 16% alpha) drift behind
  the canvas at `--ambient-opacity` 0.42 light / 0.55 dark (`.apex-ambient`, `delight.css`); phones draw three.

### Named Rules
**The Word Beside the Colour Rule.** Status is never colour alone: every tone sits next to the word that names
the state, and the bubble or dot that carries the tone is `aria-hidden`.

**The One Gold Button Rule.** Brand gold is the fill of exactly one button per screen, the page's primary
action. Everything else is outline, ghost or text.

**The Tint, Never Fill Rule.** A tone is text, a 12% (or 8%) tint, or a 35% hairline. It is never a solid fill
behind body text.

**The Same State, Same Tone Rule.** A state gets its tone from a mapping function once; green means "going
well" on the Call list, the Pipeline, New hires and Social Command alike.

## Typography

**Display Font:** Hanken Grotesk (with system-ui, sans-serif)
**Body Font:** Hanken Grotesk (same family, one file)
**Label/Mono Font:** none; numbers use tabular figures of the same face

One self-hosted variable file, `/fonts/hanken-grotesk.woff2`, weights 400–800, `font-display: swap`, Latin
`unicode-range`, preloaded and declared inline in `index.html`. `tailwind.config.ts` still maps `font-display`
to Syne, but no `@font-face` loads Syne or DM Sans (their files sit unused in `public/fonts/`), so wherever
`font-display` is used it resolves to the system sans. The operating app is one family on purpose: the
comment at `src/index.css` line 26 records why a display face was taken off every control. Features: `rlig`
and `calt` on `body`; `tnum` and `ss01` on every element (`src/styles/apex-tokens.css`), so every number in
the app is tabular; `.tabular-nums` adds `lnum`. Text is antialiased; `-webkit-text-size-adjust: 100%`.

**Character** (proposed, unconfirmed): plain, open and unfussy; a face that disappears behind the words, with
weight doing the work that size and colour would otherwise do.

### Hierarchy
- **Display** (700, `2rem` on phones and `2.5rem` from 640px, line-height 1, tracking `-0.02em`): the
  scoreboard number in `GrowScoreboard`; `KPIStat` uses `text-3xl` (30px) bold for the same job.
- **Headline** (700, `clamp(1.375rem, 6vw, 1.625rem)` on phones, about 23px at 390px; 26px / 32px from 640px):
  the page title in `PageHeader`. The component asks for `-0.02em` tracking, but `src/index.css` (~line 2027)
  sets `letter-spacing: 0 !important` on every `h1`, so titles render untracked.
- **Title** (600, 16px): a person's name on a row; `CardTitle` is 15px / 700; the empty-state title is 18px.
- **Body** (400, 16px base; `text-sm` renders 15px / 22px inside `.apex-page-slot`): sentences, subtitles,
  row facts. Measure is set by the layout (lists and panels), not by a prose column.
- **Label** (600, 13px / 18px; `text-xs` renders 13px inside the slot): tile labels, pill text, hints, card
  descriptions, bottom-nav labels. Sentence case; the only uppercase is `.nav-section-label` (12px, 600,
  `0.08em`, muted) in the sidebar, which sits outside the slot's 13px floor.
- **Eyebrow** (500, `text-sm`, which the slot renders at 15px; muted; hidden under 640px): `PageHeader`'s
  inline section name, e.g. "· Grow".

### Named Rules
**The 13px Floor Rule.** Nothing on a signed-in page is under 13px: `delight.css` raises `text-xs`,
`text-[10px]`, `text-[11px]`, `text-[12px]`, `text-11` and `text-12` to 13px/18px and `text-sm` to 15px/22px
inside `.apex-page-slot`, except elements that set their own breakpoint size.

**The Weight, Not Shouting Rule.** Emphasis is 600–700 weight and a size step (1.125–1.2); no uppercase, no
tracking, no display face on controls.

## Layout

The shell (`src/components/layout/SidebarLayout.tsx`) is a fixed left rail plus a sticky 60px top bar from
1024px up (`lg`), and a 60px header plus a fixed 64px bottom nav below it; both respect
`env(safe-area-inset-top/bottom)` (the canvas pads `calc(3.75rem + inset-top)` above and
`calc(5rem + inset-bottom)` below on phones). The content frame `.apex-content-frame` is capped at 1760px and
centred; full-bleed pages opt out with `.apex-fullbleed-page`. Page padding is 12px on phones, 16px from
640px, 20px from 1024px; pages stack their blocks with `space-y-5` (20px). The spacing scale is an 8px grid
(`tailwind.config.ts`: 4, 8, 12, 16, 20, 24, 32 …), with `--space-1…16` as CSS variables for the rare CSS
rule. Cards pad 16px (18px from 640px); scoreboard tiles 12px (20px from 640px); controls sit 8px apart.

Breakpoints are Tailwind's (640, 768, 1024, 1280) and the graded viewports are 390x844 and 1440x900 first,
then 768 and 1024. Responsive behaviour is structural, not fluid: the rail becomes the bottom nav and a
sheet; secondary header actions fold behind "More (n)" under 640px; the scoreboard stays four across at
every width (labels and hints get fixed two-line boxes so the numbers line up); detail panels become a
full-height Sheet with a sticky save bar on phones (`docs/prompt-pack/GROW_REDESIGN.md`); tables keep
identity and action columns (`docs/information-architecture.md`). The screen contract sets list rows at
64px minimum (`00-MASTER.md` §3). No horizontal page scroll at 390px: only `html` clips sideways overflow so `position:
sticky` keeps working inside the shell (`src/index.css` ~735).

## Elevation & Depth

Flat by default, tonal layering, hairlines. Depth on the operating surfaces comes from two steps of
lightness (page 87% → card 95% in light; 11% → 14% in dark; rail 93% / 9%) and a 1px `border-border` on every
card, tile and row group. `Card` carries no shadow and lifts its border, not its box, on hover
(`src/components/ui/card.tsx`). Shadow utilities are banned on pages and components by
`scripts/check-shadow-areas.mjs` (a baseline ratchet with an explicit allow marker), and `shadow-[` is allowed
only for the focus ring token. The ambient colour fields under the canvas are atmosphere, not elevation.

### Shadow Vocabulary
- **Focus ring** (`--apex-focus-ring: 0 0 0 1px hsl(var(--background)), 0 0 0 4px hsl(var(--primary) / 0.85)`;
  `src/styles/apex-tokens.css`): the only `box-shadow` a page may add, via
  `focus-visible:shadow-[var(--apex-focus-ring)]`. Everything else gets the global
  `*:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px }` (3px on buttons and links).
- **Primary button sheen** (`inset 0 1px 0 hsl(0 0% 100% / 0.18), 0 1px 2px hsl(0 0% 0% / 0.22)`;
  `button.tsx` default variant): the one lit primitive.
- **Overlays**: Dialog `shadow-lg`, Popover `shadow-md`, Dropdown `shadow-lg`/`shadow-md` (Tailwind defaults),
  on `--popover` or `--background` with a 1px border.
- **Token scales that exist but are seldom used**: `--elev-1…4` (`src/index.css`, one use) and
  `--apex-shadow-1…3` (`apex-tokens.css`, six uses). Do not add uses.

### Named Rules
**The Hairline Rule.** Surfaces separate with a 1px border and a lightness step, never with a shadow or a
glow. Hover changes border or background colour and may lift 1px; it never adds a halo.

## Shapes

Softly rounded, never bubbly, except the bubbles. `--radius` is `0.75rem`: Tailwind `rounded-lg` and
`rounded-xl` are both 12px, `rounded-md` 10px, `rounded-sm` 8px. Buttons, inputs, selects, badges and
dropdown panels are 10px; `Card` is 10px (`rounded-[10px]`); sidebar items are 12px and bottom-nav items 10px;
the scoreboard strip is 16px (`rounded-2xl`, the maximum the rulebook allows, and only for a
scoreboard); dialogs are square on phones and 12px from 640px. Three things are round: `ToneBubble`
(32 / 40 / 48px circles holding 16 / 20 / 24px icons), `TonePill` and `StatusPill` (full pills, 13px
text, a 6–8px dot), and the `Switch` track (24 x 44px). Borders are 1px everywhere; the active sidebar item
draws a 3px x 20px rounded rail at its left edge in the section tone, the active tab a 2px gold underline,
the selected scoreboard tile a 3px bottom rail in its tone. Icons are `lucide-react` only, 16px inside
buttons (`[&_svg]:size-4`), 20px in the top bar.

## Components

Character (proposed, unconfirmed): calm and sturdy, "a well-made counter": big targets, plain labels, one
warm accent, feedback you can feel but never wait for.

### Buttons
- **Shape:** 10px radius (`rounded-md`); 40px tall by default, 36px `sm`, 44px `lg`, 40 x 40 `icon` (the shell
  overrides icon buttons to 44 x 44); the page's primary action is `size="lg" className="h-12"`, 48px. On
  phones every `button`, `a`, `input`, `select` and `textarea` is at least 44px tall (`src/index.css`, max-width
  640px).
- **Primary:** gold fill, gold-ink text, 600 weight 15px, 8px x 16px padding, the inset sheen above; hover
  `brightness(1.06)`, active `brightness(0.95)`; `transition-[background,box-shadow,filter] 140ms`. The global
  rule `button:active { transform: scale(0.96) }` (`src/index.css` ~1646) presses every button. A legacy
  `transition: all 0.2s` on `a, button, [role="button"]` (~997) still applies underneath.
- **Hover / Focus:** outline and ghost hover to `--accent`; focus is `focus-visible:shadow-[var(--apex-focus-ring)]`
  after `focus-visible:outline-none`; disabled is 50% opacity with pointer events off.
- **Secondary / Ghost / Outline / Destructive / Link:** `secondary` on `--secondary`; `ghost` transparent;
  `outline` 1px `border-input`, transparent, and a gold-tinted border on hover from the global rule for
  interactive bordered elements; `destructive` on `--destructive`; `link` gold text, underline on hover.
  Icon-only buttons always carry `aria-label` (guarded).

### Chips and pills
- **TonePill** (`src/components/ui/delight/ToneBubble.tsx`): full pill, 13px / 600 / 20px, `px-2.5 py-0.5`,
  12% tone tint, tone text, 35% tone hairline, optional 8px dot (`aria-hidden`). The words are the content.
- **StatusPill** (`src/components/recruiting/StatusPill.tsx`): the worklist's status vocabulary in the same
  shape with a 6px dot; danger → hot, warning → warm, primary → cool, neutral → slate.
- **Badge** (`src/components/ui/badge.tsx`, legacy): 10px radius, 12px tabular text (13px inside the slot),
  variants default (gold tint), secondary, destructive, outline. Prefer `TonePill` for a state.
- **Filter chips**: a removable chip per active filter ("Licensed only ×"), gold for the selected list.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** `--card`; notice rows `bg-muted/30`; hover grounds `bg-muted/40`.
- **Shadow Strategy:** none (see Elevation). Hover: `border-border/80`, 150ms colour transition.
- **Border:** 1px `--border`.
- **Internal Padding:** 16px, 18px from 640px; `CardTitle` 15px / 700, `CardDescription` 13px muted.
- Rule from the rulebook: no card inside a card, no card around one line of text.

### Scoreboard (signature)
`GrowScoreboard` (`src/components/recruiting/GrowScoreboard.tsx`): a 16px-radius strip of four tiles at every
width, hairlines between tiles, each with a small `ToneBubble` and a 13px (15px from 640px) semibold label, a
display-size `CountUp` number, and a 13–14px hint. A tile with a list behind it is a `<button>` with
`aria-pressed`; the selected tile gets the tone's 8% tint and a 3px bottom rail; tiles rise in one after the
other (`apex-rise-list`) and lift 1px on hover (`apex-lift`). A withheld number renders "—" and a notice row
says why. `KPIStat` (`src/components/ui/kpi-stat.tsx`) is the single-metric version with hairline dividers.

### Page header (signature)
`PageHeader` (`src/components/ui/page-header.tsx`): a 48px tone bubble that pops in beside a 22–26px title,
an optional 14px eyebrow after a middle dot (hidden on phones), a 15px (16px from 640px) subtitle, then one
`primaryAction` on the right, `secondaryActions` inline from 640px and behind "More (n)" below it, and
`viewControls` always visible. The band has no background, no bar, no sheen; `mb-4`.

### Inputs / Fields
- **Style:** 1px `border-input` on `--background`, 10px radius, 40px tall (44px on phones), 12px side padding,
  16px text on phones and 14px from 768px; `Textarea` min 80px; `SelectTrigger` matches the input;
  `Switch` 24 x 44 with a 20px thumb; `Checkbox` 16px.
- **Focus:** the primitives still carry shadcn's `focus-visible:ring-2 ring-ring ring-offset-2` (baselined; new
  code uses the focus-ring token), and `src/index.css` adds a gold border plus
  `0 0 0 3px primary/0.25, 0 0 30px primary/0.18` on `input:focus` (~1707), a legacy glow the rulebook would
  not add today.
- **Labels:** visible, above the field, never placeholder-only; every `SelectTrigger` and `Switch` has an
  accessible name (guarded, baseline ratchet).
- **Error / Disabled:** `role="alert"` text that names the problem and keeps what was typed; disabled is 50%
  opacity and `cursor-not-allowed`.

### Navigation
- **Sidebar** (`GlobalSidebar.tsx`): 15px items, 44px tall (40px when nested on desktop), 12px radius, muted
  weight-500 text at rest, `hover:bg-accent`; the active item is weight 600 foreground on the section tone's
  12% tint with a 3px left rail and `aria-current="page"`; each item's icon sits in a small `ToneBubble` in
  its section's tone (Grow, Sell, My Business, Learn, Team, Owner each have one). Section labels use
  `.nav-section-label`. The brand mark is a 32px gold square; the organisation name is 15px / 600.
- **Top bar** (`TopBar.tsx`): sticky, 60px, `bg-background` with a bottom hairline, 44px ghost icon buttons
  (toggle navigation, home, notifications, support desk, theme, sound), a 36px avatar.
- **Phone**: a 60px header with safe-area padding; a fixed 64px bottom nav (`MobileBottomNav.tsx`) with
  56px-tall items at least 52px wide, 13px labels and `aria-current`; the rest of the nav opens in a sheet.
- **Tabs** (`tabs.tsx`): a hairline underline list that scrolls sideways; triggers 44px tall on phones, 600
  weight, muted, with a 2px gold underline and foreground text when active. No filled pills.

### States
- **Loading:** `PageSkeleton` (a 2px gold progress line at the top plus a layout-shaped skeleton, hidden for
  180ms so fast loads never flash); `Skeleton` shimmers on `--muted` over 1.6s (`--motion-shimmer`), pulse
  under reduced motion; `QueryState` wraps loading, empty, error and stale with an "as of" time and Retry.
- **Empty:** `EmptyState` with a popping tone bubble, 18px title, 15px description, variants default (gold),
  success (good), warning (warm).
- **Stale / failed refresh:** keep the last good numbers, label them stale with their time, offer Retry.
- **Toasts:** Sonner, themed from the `dark` class on `<html>`; `src/index.css` adds a gold-tinted border and
  14px radius (legacy rules).
- **Dialog / Sheet:** `max-w-lg`, 16px padding (24px from 640px), 12px radius from 640px; the components ask
  for a 200ms fade and zoom from 95% (dialog) and a slide (sheet), but `src/index.css` (~2205) forces every
  open `[role="dialog"]` to 320ms with `cubic-bezier(0.32, 0.72, 0, 1)`; close buttons are 44 x 44.

### Motion and sound (signature behaviour; the rulebook's "Colour, motion and sound", recorded)
Classes live in `src/styles/delight.css`, loaded by the signed-in shell only. Easing tokens:
`--ease-standard: cubic-bezier(0.2, 0, 0, 1)`, `--ease-emphasized: cubic-bezier(0.3, 0, 0.1, 1)`; duration
tokens `--motion-fast 120ms`, `--motion-base 200ms`, `--motion-slow 320ms` (`src/index.css`). Tailwind
`duration-*` utilities stay at or under 200ms (`scripts/check-motion-areas.mjs`); choreography lives in
these classes, never in utilities.

| Name | What | Values |
|---|---|---|
| `apex-rise` / `apex-rise-list` | the one entrance for tiles, rows and sections | 320ms `--ease-standard`, from `translateY(8px)` and opacity 0; siblings 40ms apart (`--rise-i`, or by position up to the 10th, then 400ms) |
| `apex-pop` | a bubble or number arriving | 280ms `--ease-emphasized`, from scale 0.92 / opacity 0.4 through 1.05 to 1 |
| `apex-bump` | a number that just changed | 360ms `--ease-emphasized`, scale 1 → 1.14 → 1 |
| `apex-lift` | hover on a row or tile that opens something | 160ms `--ease-standard` on transform, background and border; `translateY(-1px)` only under `@media (hover: hover)`; no glow |
| `apex-breathe` | a live indicator only | 1.8s ease-out loop, a 7px soft ring in `--tone-good`; the one loop allowed on content |
| `apex-drift` | the shell's five ambient fields | 36–52s ease-in-out alternate, `translate3d(6vmax, 4vmax, 0) scale(1.08)`, staggered by negative delays; three fields under 640px |
| `CountUp` | a number tweens to its new value | 520ms cubic ease-out, never from zero on first paint, then one `apex-bump`; `null` renders "—" |
| `Reveal` / `RevealList` | the React wrappers for the rise classes | `index` sets `--rise-i`; the list staggers its children |
| legacy entrances | `page-enter`, `ops-fade-in`, `animate-stagger-in`, `reveal` in `src/index.css` | older layers; do not add uses |

**Celebrations** (`src/lib/celebrate.ts`): round canvas-confetti "bubbles" from the control the person pressed
(normalised to viewport coordinates), plus a sound. `save` = 16 bubbles and a pop (an outcome saved, a note
kept); `booked` = 48 and a chime (an interview booked, an invitation created); `hire` and `win` = 120 from the
control plus two 48-bubble side bursts 180ms later and a fanfare (a new agent, a Monday start, a first deal).
Confetti colours are the dark-theme tones in hex (`#f0c330`, `#41d38a`, `#64b4f7`, `#f3715e`, `#b088f3`,
`#faefc4`) because the library reads hex. Only after an action the server confirmed; never on load, never on
an error; the chunk loads on first use and a failed load never breaks the action.

**Sound** (`src/hooks/useSoundEffects.ts`): synthesised with the Web Audio API, sine and triangle notes with
peak gains 0.03–0.13 and lengths 35–460ms: `pop`, `tick` (a step moved), `click`, `chime`, `success`,
`fanfare`, `whoosh` (sent or dismissed), `error` (two soft falling notes). One preference,
`apex_sound_enabled` (`src/lib/soundPreference.ts`), toggled by `SoundToggle` in the top bar (44px,
`aria-pressed`, "Turn sounds off / on") and in Profile settings; a change in one reaches the other at once.
Nothing plays on page load.

**Reduced motion:** `delight.css` sets `animation: none` on every class above and removes the lift;
`src/index.css` clamps all animations and transitions to 0.01ms; `MotionConfig reducedMotion="user"` covers
framer-motion; confetti passes `disableForReducedMotion` and `celebrate()` returns before drawing. Colour and
layout do not change; the sound still plays if sounds are on, because that is a separate choice.

### Named Rules
**The Once Rule.** Motion marks an arrival, a change, a press or a win, and then it is over. The only loops are
the ambient fields under the canvas and `apex-breathe` on a live dot.

**The From-Somewhere Rule.** Nothing enters from scale 0 or from off-screen: entrances start at 8px below and
92% size, already visible, and ease out.

**The Server Says So Rule.** A celebration follows a success the server returned, from the control the person
pressed; a failed save gets a `role="alert"` and keeps the typed text, never a burst.

## Do's and Don'ts

### Do:
- **Do** use tokens only: `bg-card`, `bg-background`, `border-border`, `text-foreground`, `text-muted-foreground`,
  `bg-primary` / `text-primary-foreground`, and the seven `tone-*` colours through `TONE_CLASS` and the mapping
  functions. Hex in a class or a style prop fails `check-hex-color-areas` / `check-hex-in-jsx-style`.
- **Do** put the state in words next to its tone, keep bubbles and dots `aria-hidden`, and give every
  icon-only control, `SelectTrigger` and `Switch` an accessible name.
- **Do** keep type at or above 13px, body at 15–16px, titles 22–26px, scoreboard numbers 32–40px, all tabular.
- **Do** make every control at least 44px tall on phones and the page's one gold button 48px.
- **Do** animate transform and opacity with `--ease-standard` or `--ease-emphasized`, under 360ms, once; gate
  hover motion behind `(hover: hover)`; stop everything under `prefers-reduced-motion`.
- **Do** show "—" with a reason when a number is unknown, keep the last good value when a refresh fails, and
  render loading, empty, error and stale through `QueryState`.
- **Do** check both themes at 390x844 and 1440x900 before calling a screen done; no horizontal scroll at 390.

### Don't:
- **Don't** use `bg-gradient-to-*`, glass or `backdrop-blur`, `shadow-xl`, inset or glow shadows, neon, or a
  colored border thicker than 1px on a card; the guards block the commit (`check-bg-gradient-areas`,
  `check-shadow-areas`).
- **Don't** write `duration-300` or longer, or any `duration-[Xms]` above 200ms, in a className; put
  choreography in a `delight.css` class.
- **Don't** add `ring-[`, `focus:ring-2` or `focus-visible:ring-2`; focus is `focus-visible:shadow-[var(--apex-focus-ring)]`.
- **Don't** use `text-white`, `bg-white`, `bg-black`, `border-white`, `text-slate-100…400` or
  `text-zinc-100…300` without a `dark:` pair; the theme-literal count is a ratchet (`check-theme-literals`).
- **Don't** pick a tone by hand, fill a surface solid with a tone, or put a second gold button on a screen.
- **Don't** loop any motion on content other than `apex-breathe` on a live state, celebrate on page load or on
  an error, or play a sound that the person did not cause.
- **Don't** nest a card in a card, wrap one line of text in a card, or round anything past 16px.
- **Don't** add a display face to controls or labels, uppercase a label, or add tracking to a title.
- **Don't** hardcode a brand name, a phone format or a relative time; use `resolveBrand()`,
  `formatPhoneDisplay` and `formatTimeAgo`.
