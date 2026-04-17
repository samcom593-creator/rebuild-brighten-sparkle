# APEX Ultra — Phased Execution Plan

## ✅ Phase 0–1 — Foundation (THIS SESSION)

**Database:**
- `audit_log`, `function_errors`, `analytics_events`, `rate_limits`, `idempotency_keys` tables w/ RLS
- `check_rate_limit()` and `cleanup_expired_idempotency_keys()` RPCs

**Edge function `_shared/`:**
- `cors.ts` — universal CORS + JSON helpers
- `auth.ts` — `requireAuth()` + `requireRole()` w/ getClaims
- `rateLimit.ts` — Postgres-backed limiter
- `audit.ts` — `writeAudit()` + `logFunctionError()`
- `handler.ts` — `createHandler()` wraps every fn w/ auth + rate-limit + audit + error capture
- `validate.ts` — lightweight zod alternative

**Client `src/shared/`:**
- `api/safeInvoke.ts` — typed edge invoker w/ request IDs + idempotency
- `api/queryKeys.ts` — centralized React Query key factory
- `lib/logger.ts` — structured client logger → `error_logs`
- `lib/webVitals.ts` — LCP/CLS/INP → `analytics_events`
- `store/uiStore.ts` — Zustand UI store (command palette, sidebar)

**CI:**
- `scripts/verify.mjs` — typecheck + build gate

---

## 🔜 Phase 2 — Hardening Existing Functions (Next session)

Refactor top 10 most-called edge functions to use `createHandler()`:
1. `submit-application`
2. `send-notification`
3. `notify-stage-change`
4. `notify-lead-purchase`
5. `import-production-data`
6. `generate-award-graphics`
7. `send-agent-portal-login`
8. `create-checkout-session`
9. `analyze-content-image`
10. `process-aged-leads`

Each gets: auth check, rate limit, audit entry, error capture.

---

## 🔜 Phase 3 — UX Layer (Next session)

- Command Palette ⌘K (cmdk) with route + entity search
- Notification center polish using `useFilteredChannel` realtime hook
- Design tokens v2 in `index.css` (spacing, motion, elevation scales)
- Skeleton loaders standardized across all data views

---

## 🔜 Phase 4 — Data Lifecycle (Next session)

- Soft-delete pattern on `applications`, `agents`, `content_library` (already partial)
- Activity feed widget reading from `audit_log`
- Admin "System Health" page reading `function_errors` + `analytics_events`

---

## 🔜 Phase 5+ — Per the mega-prompt

Pages, AI features, advanced realtime, partitioning. Each phase = 1 session = ~10–15 files.

---

## Out of scope (require user setup)

- Upstash Redis → using Postgres rate limits instead
- Mux video → using existing Supabase Storage
- OpenTelemetry collector → using `analytics_events` table
- Sentry → using `error_logs` + `function_errors` tables
- Mapbox → only if/when geo features are explicitly requested
