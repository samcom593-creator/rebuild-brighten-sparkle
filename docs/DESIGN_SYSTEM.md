# APEX OS — Design System

**Status:** foundation exists and is documented here. This describes what IS in
the codebase (measured 2026-08-17), plus the rules now enforced by guards.

## Principles

1. **Operational clarity over decoration.** Data-dense screens optimize scan speed.
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

## Prohibited patterns (§12, §25)

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
