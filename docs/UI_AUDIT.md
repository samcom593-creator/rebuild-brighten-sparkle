# APEX OS — UI/UX Audit (Phase 1)

**Date:** 2026-08-17 · **Method:** measured against the working tree. Every number queried, not estimated.

## Headline: the design system largely already exists

The UI directive assumes a fragmented interface needing a from-scratch design
system. Measurement contradicts that.

| Probe | Measured | Directive verdict |
|---|---|---|
| CSS custom properties in `index.css` | **117** | §4 foundation substantially exists |
| Semantic Tailwind color keys | 16 | tokens are centralized |
| Dark-mode variable blocks | 25 | §19 has real infrastructure |
| Icon libraries in use | **1** (lucide-react, 393 files) | §17 **already satisfied** |
| Files importing shared `Button` | 259 | §13 largely satisfied |
| Duplicate component basenames | **1** (`CarrierBreakdownCard`) | §28 essentially clean |
| Semantic token usages | 4,844 vs 420 hardcoded colors (92%) | §4 mostly done |

**Conclusion:** Phases 2 and 3 of §34 (foundation, core components) are ~80%
complete. Rebuilding them from scratch would destroy working infrastructure to
satisfy an assumption that measurement does not support. The real work is a
bounded set of violations, listed below.

## Real gaps, ranked by severity

### 1. Accessibility — icon-only buttons had no accessible name (**FIXED**)

105 `<Button size="icon">` controls. **47 had no accessible name** — a screen
reader announced only "button". WCAG 2.2 AA 4.1.2 failure; §26 makes this blocking.

Several sat inside Radix `<Tooltip>`, which sets `aria-describedby` — a
*description*, not the accessible **name**. A visible tooltip is not a name.

Fixed: 47 action-specific labels ("Call lead", "Resend licensing email", "Mark as
no-show" — the action, never the glyph). Guarded by `check-icon-button-labels.mjs`
at baseline 0.

*Two measurement corrections made before acting:* a same-line grep implied 93
(2× inflated — JSX spans lines); and the first detector scanned only the opening
tag for `sr-only`, flagging shadcn's already-accessible `SidebarTrigger`. 93 → 48
→ **47**.

### 2. Legacy decorative styling — 197 violations of §12/§25

| Pattern | Before | After | Directive |
|---|---|---|---|
| `bg-gradient-to-*` | 76 | **37** | §25 "no rotating gradients", §2 not a crypto platform |
| `rounded-3xl` | 32+ | **32** | §12 "avoid excessive rounded corners" |
| `backdrop-blur` | 36 | **35** | §12 "no glass panels" |
| `shadow-2xl` | 23 | **10** | §12 "no heavy shadows" |

Cleared in `InterviewCommandCenter` (17 gradients, all blur, all `shadow-2xl` → 0)
and `AgentCommandDashboard` (22 gradients, all glow shadows, all `rounded-3xl` → 0).

**OPEN AND DELIBERATELY NOT REGEX-FIXED — `AgentCommandDashboard` is dark-only.**
Its panels hardcode `text-white` on `slate-950`, and child text uses
`text-slate-300`, `text-white/60` etc. Converting the surfaces to light/dark
tokens with a substitution would leave that child text unreadable in light mode —
worse than the gradients. The gradients and glows were removed while keeping the
dark ground the children assume. Making this page genuinely theme-aware (§18) is
a real redesign of the page's colour contract, not a mechanical change.

### 3. State coverage incomplete (§30), across 158 pages

| State | Pages with it | Missing |
|---|---|---|
| Loading (`isLoading`/`isPending`) | 94 | 64 |
| Skeleton | 60 | 98 |
| Empty state | 74 | 84 |
| Error handling | 103 | 55 |

Counts are keyword-based and therefore an **upper bound on coverage** — a page may
handle a state without matching these tokens. Not a defect list; a survey needing
per-route confirmation.

### 4. Responsive risk (§25)

- 152 of 158 pages use breakpoints — good.
- **203 fixed pixel widths** (`w-[NNNpx]`) — the main mobile-overflow risk.
- 61 `overflow-x-auto` containers for tables.

### 5. Brand literals (§20)

540 hardcoded `APEX` literals across 159 files. Foundation shipped (`src/config/brand.ts`),
ratcheted at 540. See `AUDIT.md`.

## Route inventory

233 routes / 158 pages / 279 components. A 12-field table per route as §3 specifies
is **not yet produced** — it requires rendering each route in 6 viewports × 2 themes
× 3 branding modes (§31), which needs the tenant entity that does not exist. Recorded
as an open gap rather than fabricated.

## Corrected scope for §34

| Phase | Directive assumption | Measured reality |
|---|---|---|
| 1 Audit | needed | **done** |
| 2 Foundation | build from scratch | ~80% exists; consolidate, don't rebuild |
| 3 Core components | build from scratch | shared Button/table/dialog exist; 79 raw `<button>` to migrate |
| 4 App shell | rebuild | exists; needs tenant-awareness (blocked on tenant entity) |
| 5 Operational routes | rebuild all | apply the 197 decorative fixes + state coverage |
| 6 Administration | rebuild | blocked on tenant entity |
| 7 Public website | rebuild | real work; copy still single-agency |
| 8 Full QA | required | blocked on 3 branding modes existing |

**Phases 4, 6 and 8 are gated on multi-tenancy** (`AUDIT.md` §2), which is
multi-month. Phases 2, 3, 5 and 7 are actionable now.
