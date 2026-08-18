# APEX OS — Decision Log

Format per directive §6: decision, alternatives, selected approach, operational
rationale, technical consequences, unresolved risk.

---

## DEC-001 — Preserve the existing stack; do not rewrite

**Decision.** Keep React 18 + Vite + TypeScript + Supabase. Treat the system as a
modular monolith with a serverless tier.

**Alternatives.** (a) Rewrite to Next.js App Router for RSC/server actions.
(b) Split into services. (c) Keep stack.

**Selected.** (c).

**Rationale.** Directive §9 says preserve healthy architecture and requires
documented evidence before replacement. The evidence points the other way: 334 of
335 tables carry RLS, 317 policies route through a `has_role()` security-definer
helper, and a mature guard/ratchet system already blocks regressions at commit
time. A rewrite discards working authorization infrastructure to gain rendering
ergonomics the product does not need.

**Consequences.** No server components; tenant isolation must be enforced in
Postgres (RLS) and in edge functions rather than in a server-action layer. That is
the stronger place for it anyway — the database is the last line, not the first.

**Unresolved risk.** 233 client-side routes mean authorization must never be
presentational. Every route guard needs a server-side counterpart.

---

## DEC-002 — Multi-tenancy is a re-foundation, sequenced behind a test harness

**Decision.** Do not add `tenant_id` broadly yet. Land the tenant entity and an
isolation-test harness first; scope tables in graded waves afterward.

**Alternatives.** (a) Add `tenant_id` to all 335 tables now and backfill to a
default tenant. (b) Schema-per-tenant. (c) Database-per-tenant. (d) Staged.

**Selected.** (d), with (a) as the eventual mechanism per table.

**Rationale.** Measured state: zero tenant columns across 335 tables. Doing (a) in
one pass means rewriting ~334 RLS policies simultaneously. A single wrong policy
is a cross-tenant data leak — the worst failure this product can produce. (b) and
(c) multiply the 551-migration drift problem by the tenant count.

**Consequences.** Multi-tenancy arrives incrementally. Until a table is scoped and
proven, it stays explicitly single-tenant in the traceability matrix rather than
being described as "in progress."

**Unresolved risk.** A partially-scoped schema is a genuinely dangerous
intermediate state. Mitigation: a table is not marked scoped until an automated
test proves Tenant B cannot read Tenant A's rows, and that test is proven to fail
against the unscoped version first.

---

## DEC-003 — Branding centralization is the first vertical slice

**Decision.** Build the tenant-aware brand/config module before any schema work.

**Alternatives.** (a) Tenant table first. (b) Role split first. (c) Branding first.

**Selected.** (c).

**Rationale.** Measured 760 hardcoded `Apex`/`APEX` literals across 195 files with
no central config — the exact anti-pattern §11 prohibits. It is additive, carries
no schema risk, is independently testable, and is a hard prerequisite for every
white-label mode in §11. It also delivers visible value with zero chance of a data
incident.

**Consequences.** Introduces one config module that later reads from the tenant
record instead of constants. The call sites do not change again when tenancy lands.

**Unresolved risk.** Mechanical replacement across 195 files could regress
user-facing copy. Mitigation: the module ships first and adoption is incremental,
not a single sweeping find-replace.

---

## DEC-004 — Do not silently redefine the public "active agents" number

**Decision.** Leave the public landing figure (42) as-is; surface the divergence
to the owner rather than choosing for them.

**Alternatives.** (a) Skool-gated (8). (b) Deal-activity 30d (12). (c) Contracted
and not deactivated (42). (d) Escalate.

**Selected.** (d), pending owner input; internal dashboards already use (b).

**Rationale.** All three numbers are defensible under different definitions of
"active." This is a revenue-facing marketing claim, not a defect. Directive §21
requires every KPI to carry an explicit formula and owner — the fix is a KPI
definition, not a silent value swap.

**Consequences.** One public number remains broader than the internal one until
decided. Documented in the KPI registry work rather than hidden.

**Unresolved risk.** If the intended meaning is "actively producing," 42 overstates
it and should change.
