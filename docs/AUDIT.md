# APEX OS — Phase Zero Repository Audit

**Date:** 2026-08-17
**Repo:** rebuild-brighten-sparkle
**Method:** direct measurement against the working tree and the live Supabase
project (`xrzweoneiieddzxogewk`). Every number below was queried, not estimated.

---

## 1. Current architecture

| Dimension | Measured |
|---|---|
| Frontend | React 18.3.1 + Vite 8 + TypeScript 5.8, react-router 7.18 |
| State/data | TanStack Query 5.83 |
| Styling | Tailwind 3.4 + shadcn/ui |
| Backend | Supabase (Postgres + PostgREST + Deno edge functions) |
| Validation | zod 3.25 |
| src files | **600** (177,942 LOC) |
| Pages | **158** |
| Components | **279** |
| Routes | **233** |
| Edge functions | **241** |
| Migrations | **551** |
| Test files | **47** |
| CI workflows | 6 (verify-core, deploy-supabase, post-deploy-smoke, post-deploy-lighthouse, auto-register-functions, external-cron-backup) |

This is a **modular monolith with a serverless function tier** — the architecture
the directive (§9) says to prefer. It is not a candidate for rewrite. It is
healthy in structure and unhealthy in specific, identifiable places.

---

## 2. THE decisive finding: the system is single-tenant by construction

This is the single fact that governs the cost of everything in the directive.

| Probe | Result |
|---|---|
| Tables named tenant/organization/agency/workspace | **0** (3 name-matches are unrelated: `integration_accounts`, `agencyhub_command_queue`, `agencyhub_ai_conversation`) |
| Columns named `tenant_id`/`org_id`/`agency_id`/`workspace_id` | **1**, and it is a false positive — `agentlink_agents.organization_id` is InsuraCloud's upstream org identifier, not an APEX tenant |
| Base tables in `public` | **335** |
| Tables with RLS enabled | **334** (99.7%) |
| RLS policies calling `has_role()` | **317** |

**Interpretation.** RLS hygiene is genuinely good — 334 of 335 tables are
protected. But every one of those policies scopes by *user* and *role*, never by
tenant, because no tenant dimension exists. The application is not "a
multi-tenant system missing a tenant switcher." It is a correctly-built
**single-tenant** system.

Multi-tenancy (directive §10) is therefore **not a feature to add**. It is a
re-foundation that touches:

- 335 table definitions (add + backfill + constrain a tenant key)
- ~334 RLS policy rewrites
- every server query and edge function that reads tenant-owned data
- the identity model (a user currently belongs to *the* org, not *an* org)
- 551 migrations' worth of accumulated assumptions

Estimated honestly: this is **multi-month engineering**, not a session. Any plan
that claims otherwise is the fake software the directive forbids in §4.

---

## 3. Role model gap

Existing `app_role` enum: `admin`, `manager`, `agent`, `va_manager`, `va` — **5 roles**.

Directive §13 requires ~11 distinct roles across two planes (APEX platform vs
tenant): super admin, ops admin, workforce director, support admin, agency
owner, agency admin, manager, recruiter, trainer, VA manager, VA worker, agent,
executive viewer.

Critically, the existing enum has **no platform/tenant split at all**. `admin`
today means "admin of the one and only organization." Under multi-tenancy that
single value has to become at least two distinct concepts (APEX super admin vs
agency owner) with different blast radii. This is a breaking change to the
authorization model, not an additive one.

---

## 4. White-label readiness

| Probe | Result | Meaning |
|---|---|---|
| Files containing an `Apex`/`APEX` string literal | **195** | branding is scattered |
| Raw matches, unbounded regex | 760 | first pass; inflated — also matched substrings like `ApexLink` and counted comments |
| Word-bounded raw matches | 625 | drops substring false positives |
| **In code, comments stripped** | **551** | the honest, ratcheted figure — every one is a white-label blocker |
| Of those, living in comments | 74 | documentation, not a blocker |
| **Ratchet baseline (excludes test files)** | **540** | test names never reach a screen |
| Central branding/tenant config module | **none** | §11 has no foundation to build on |

Directive §11 explicitly says *"Do not scatter APEX strings through components.
Use centralized tenant-aware configuration."* Today the codebase does exactly
what that line prohibits, in 164 files.

*(The first pass reported 760. That regex had no word boundaries and scanned
comments, so it counted `ApexLink` substrings and documentation. Corrected to 551
before setting the ratchet baseline — a guard anchored to an inflated number
silently absorbs real regressions.)*

**This is the correct first vertical slice** — see §12 below.

---

## 5. Theme readiness — healthier than expected

| Probe | Result |
|---|---|
| Semantic token usages (`bg-background`, `text-foreground`, `bg-card`, …) | **4,844** |
| Hardcoded hex colors in components/pages | **252** |
| Tailwind arbitrary color values `[#rrggbb]` | **168** |

~92% of color usage already flows through semantic tokens. Directive §26
(complete light/dark via design tokens) is **mostly satisfied already**. The 420
hardcoded values are a bounded cleanup, not a rebuild. This is the cheapest win
in the entire directive.

---

## 6. Integration status (classified per directive §8)

Measured from live logs and live tables during this audit.

| Integration | Status | Evidence |
|---|---|---|
| Supabase (DB/auth/edge/storage) | **active, healthy** | 335 tables, 334 RLS, 28,945 successful `bot-sql` calls in 24h |
| Notification pipeline | **repaired 2026-08-17** | was 500 on 903/903 calls; now 10×200, 0×500 (commit `59be24d0`) |
| Web push (VAPID) | **repaired 2026-08-17** | `VAPID_PUBLIC_KEY` was never configured; keypair generated, endpoint 500→200 |
| Metricool (social) | **active** | returns live Instagram analytics |
| AgentLink / InsuraCloud | **active but incomplete** | cookie-sync works; `/business-analytics`, `/book-of-business`, `/team-analytics` all return upstream 404 |
| Stripe | **legacy / dormant** | webhook enabled, 0 events since 2026-06-15; last event was a successful final charge, not a breakage |
| Discord | **partially configured** | 4 webhooks on file, 1 (`wh2`) dead (`Unknown Webhook`), none targets the contracting channel; bot token file is empty |
| Skool | **manual** | no API; membership loaded by export/screenshot |
| ReadyMode | **unknown** | ingest has never populated |
| Monday.com / Systeme.io / GoHighLevel / BotPenguin | **absent** | no code references found; treat as not-integrated, not as broken |

---

## 7. Security posture

**Good:** 334/335 tables RLS-enabled; 317 policies use a `has_role()` security-definer
helper rather than inline role checks; no raw card data; secrets live outside the
repo in `~/.config/apex-creds` and Supabase secrets.

**Concerns:**
1. **No tenant isolation tests exist** (directive §10 requires them). Cannot exist
   yet — there is no tenant boundary to test.
2. Several edge functions run `verify_jwt = false` and perform no in-handler auth,
   relying on obscurity of the URL. A concurrent worker is actively adding
   `requireAuth`/`ctx.auth` guards — that work is in flight and should be allowed
   to land before any sweep.
3. 55 unmarked empty catch blocks in `supabase/functions` (tracked at baseline by
   `check-empty-catch`, so it cannot silently grow).

---

## 8. Test coverage

47 test files against 600 source files. A test runner is configured
(`test`, `test:watch`, `test:coverage`). Coverage is thin relative to the
directive's demand that every vertical slice ship with an automated test.

---

## 9. What is genuinely working and must be preserved

- The guard/ratchet system (`scripts/check-*.mjs` wired into `verify:core` +
  pre-commit). Eight guards ran and passed on this session's commit. This is
  unusually mature infrastructure and is the reason regressions get caught.
- RLS coverage at 99.7%.
- The semantic design-token system (4,844 usages).
- The edge-function tier, now that the dead dependency pin is cleared.

---

## 10. Technical debt worth naming

- **`esm.sh` version pins are not lockfiles.** They pin the top module and
  nothing beneath it. This silently killed 34 functions. Remaining spread:
  98 functions on floating `@2`, 70 on `@2.45.0`, 16 on `@2.90.1`, plus stragglers.
  A single pinned version (or an import map) is the durable fix.
- 551 migrations with hand-applied drift (functions are routinely applied via
  `bot-sql` and never round-tripped into `supabase/migrations`).
- Multiple concurrent automated workers commit to this repo. `git add -A` is
  unsafe here and has caused absorption incidents before.

---

## 11. Migration risks

| Risk | Severity | Note |
|---|---|---|
| Adding `tenant_id` to 335 tables | **High** | backfill + constraint + policy rewrite per table; needs staged rollout behind a default tenant |
| Splitting `admin` into platform vs tenant roles | **High** | breaking authz change; every `has_role(..,'admin')` call site must be re-decided |
| Repointing 760 brand literals | Medium | mechanical but wide; must not regress copy |
| RLS rewrite | **High** | a wrong policy is a cross-tenant data leak, the worst failure this product can have |
| Concurrent workers | Medium | large refactors will collide; needs a dedicated branch |

---

## 12. Recommended sequencing

The directive asks for complete vertical slices (§7). Ordered by value ÷ risk:

1. **Brand/config foundation** (no schema change, zero risk, unblocks all of §11).
   Centralize the 760 literals behind one tenant-aware config module. *Started —
   see BUILD_STATE.md.*
2. **Tenant entity + default tenant** (additive; one row; nothing scoped yet).
3. **Role model split** (platform vs tenant planes) behind a feature flag.
4. **Tenant scoping, table by table**, highest-sensitivity first (applications,
   agents, deals, profiles), each with an isolation test that is proven to fail
   before it passes.
5. Entitlements/packages (§14), then the module work (§16).

Do not begin step 4 before step 2's isolation test harness exists. A tenant
column without an enforced policy is worse than no column — it looks like
isolation and provides none.
