# BUILD SPEC — VA-Manager Portal (Milver) + Operator Command Center
*Generated 2026-07-14 by a 6-agent codebase map of apex-financial.org (rebuild-brighten-sparkle). This is the execution checklist. Ship in order; each increment ends with verification.*

**Reuse path (do NOT invent a parallel auth system):** `manager_signup_tokens` + the `manager-signup` edge fn + `/signup?token=` page — the ONLY existing single-use-link → password → role-elevation flow.

## Auth facts (verified against live DB)
- Supabase Auth. Roles live in `public.user_roles` (enum `app_role = admin|manager|agent`), checked server-side by `has_role(uid, role)` (SECURITY DEFINER) and client-side by `useAuth().hasRole/isAdmin/isManager`.
- New accounts: public `auth.signUp` (trigger `handle_new_user` auto-inserts profile + default `agent` role) OR service-role edge fns (`create-new-agent-account`, `manager-signup`, etc.) that then delete the default role and insert the elevated one.
- Disabling today is SOFT (`agents.status`/`is_inactive`) and does NOT block login. A real disable requires `auth.admin.updateUserById(id, { ban_duration })`.
- RLS: only admin (or service role inside edge fns) can write `user_roles`. Clients never write roles.

## Guardrails (every increment)
- No `window.confirm` (wave-31 ratchet) — use `useConfirm()`.
- No empty `.catch(()=>{})` (wave-21 ratchet) — route edge-fn calls through `src/shared/api/safeInvoke.ts`.
- tsc baseline ratcheted (`scripts/check-tsc-error-count.mjs`); regen `src/integrations/supabase/types.ts` after each migration, commit with it.
- `ALTER TYPE ... ADD VALUE` must be its OWN migration (committed before any statement uses the new value).
- Update `WhatShippedTodayBanner` SHIPPED array every commit.

---

## INCREMENT 1 — Milver one-link + `va_manager` role + VA create/disable UI
Goal: Sam mints ONE link → Milver opens `/signup?token=…` → sets a password → lands as `va_manager` → `/va-team` portal to create, monitor, disable/enable child `va` accounts.

1. **Migration A** (`app_role` enum, own file): `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'va_manager'; ... 'va';`
2. **Migration B**: `profiles.managed_by uuid REFERENCES auth.users(id)`; `manager_signup_tokens.target_role app_role DEFAULT 'manager'`; RLS "VA managers view own VAs" (`managed_by = auth.uid()`); `list_my_vas()` SECURITY DEFINER RPC (roster + `banned_until` disabled flag).
3. **Edit `manager-signup`** edge fn: read `token.target_role`; if `va_manager` → createUser(password) + upsert profile + role `va_manager` + SKIP `agents` insert; else existing manager path.
4. **New edge fn `create-va-account`** (clone `create-new-agent-account`): auth caller from JWT, assert `va_manager`|`admin`, createUser → role `va`, `profiles.managed_by = caller`, no `agents` row, cleanup on failure, return `{user_id,email,password}`.
5. **New edge fn `set-va-account`**: `{va_user_id, action:'disable'|'enable'}`, ownership guard (`managed_by=caller` or admin), `admin.updateUserById(ban_duration)`.
6. **useAuth.ts**: widen role union + add `isVaManager`/`isVa`.
7. **ProtectedRoute.tsx**: add `allowRoles?: string[]`.
8. **VaManagerPortal.tsx** (`/va-team`) + **CreateVaModal.tsx** — roster via `list_my_vas`, create via `create-va-account`, disable via `set-va-account` + `useConfirm`.
9. **AdminManagerInvites.tsx**: role selector (Manager | VA Manager) writing `target_role`. Immediate one-off to get Milver's link today (mint a `va_manager` token, send `https://apex-financial.org/signup?token=…`).

## INCREMENT 2 — Applications feed full-width ✅ SHIPPED (commit e46ed9bc)
Done via `.apex-content-frame:has(.apex-fullbleed-page){max-width:none}` + `apex-fullbleed-page` on the applicants root + taller table box. (Spec's alt route-based approach superseded by the shipped `:has()` opt-in.)

## INCREMENT 3 — VA / Operator Command Center + metrics
`/dashboard/operator` (admin + va_manager). KPI tiles: seminar signups (unlicensed), Xcel course purchases, auto-signups-from-course, seminar attended — each DTD/WTD/MTD/CUSTOM. Server RPCs `rpc_operator_metrics(start,end)` + `rpc_operator_metric_series(start,end,grain)` own the "unlicensed" logic; all date_trunc in America/Chicago. Reads `applications.course_purchased_at` (kept live by I4) + `seminar_registrations`.

## INCREMENT 4 — Xcel daily-email auto-ingest → `xcel_events`
Ingest `support@xcelsolutions.com` "New Enrollment" (1 student) + `clientservices@xcelsolutions.com` daily digest (HTML table) into `xcel_events` (onConflict email,sku). Apply the `agent-email-inbox` skill security patterns (hard sender allowlist, structured extraction only, idempotent by `gmail_message_id`, service-role writes, admin-only audit log). Reuse existing Gmail OAuth path. pg_cron every 30 min. Feeds I3 purchase counts with zero manual paste.

## SECURITY CHECKLIST (public link mints a privileged account)
Single-use + expiring + Sam-revocable token; `target_role` server-controlled at mint (never mints admin); role writes service-role only; `create-va-account` forces role=`va` + `managed_by=caller`; `set-va-account` ownership-guarded; `list_my_vas`/RLS keyed on `managed_by`; caller identity from JWT never body; disable = real auth ban; email ingest treated as untrusted; route gating on router AND page.

---
*Full agent maps (auth / invite / feed / command-center / xcel+seminar) archived in the workflow transcript: `.claude/.../workflows/wf_fdcb0ead-72c/`.*
