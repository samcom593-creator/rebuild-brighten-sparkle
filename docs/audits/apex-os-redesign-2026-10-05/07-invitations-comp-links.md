# 07 — Invitations, Comp Selection, and Links (domain map)

APEX OS redesign program, 2026-10-05. Read-only mapping against repo `rebuild-brighten-sparkle` @ `4ea291c8` (main) and live Supabase project `xrzweoneiieddzxogewk`. Every number below was measured with read-only SQL on 2026-10-05 unless marked **unmeasured**. Counts are rows unless the sentence says people.

Brief section mapped: §8 FIX INVITATIONS, COMP SELECTION, AND LINK CLEANUP; acceptance gate E ("Approved comp survives acceptance. Tampered, expired, revoked, reused, and unauthorized invitations are rejected. Duplicate clicks create no duplicate agent.").

---

## 0. Executive summary

There is no single invitation system. There are **four generations of invitation plumbing plus two link systems**, all live at once:

| Generation | Table | Minted by | Accepted by | Status |
|---|---|---|---|---|
| G1 (Jan 2026) manager codes | `manager_invite_links` (`invite_code`) | `ManagerInviteLinks.tsx` (Command Center widget) | `/apply?ref=<code>` → `resolve-ref-slug` | **Dead**: 0 of 8 active codes resolve (resolver matches `agents.ref_slug` / `agent_code` only) |
| G2 (Jan 2026) manager signup tokens | `manager_signup_tokens` | `AdminManagerInvites.tsx` (client `Math.random`) | `/signup?token=` → `validate-signup-token` + `manager-signup` | 1 token ever, used 2026-07-15; redundant with G4 `target_role` |
| G3 (Jan 2026) direct account creation | none (no record) | `InviteTeamModal.tsx` → `create-new-agent-account` | n/a (account is created for them, password `123456`) | **Unauthenticated edge fn + duplicate-agent writer** |
| G4 (Jul 2026, MP-234) opaque tokens | `invite_tokens` (kind `hire`/`join`) | `generate_invite_token()` RPC from `AddAgentModal`, `/admin/invite-links`, `AgentProfileDrawer` | `/hire/:token`, `/join/:token` → `consume-invite-token` | **The real system.** 64 tokens, 33 used, 23 expired-but-`is_active`, 2 pending |
| Public recruiting links | `agents.ref_slug` (+ legacy `agent_code`) | implicit (every agent has one; 228/228) | `/r/<slug>` → `/apply?ref=` → `resolve-ref-slug` → `submit-application` | Working; correctly separate from personal invitations |
| "Contracting links" | `contracting_links` | `InviteTeamModal` saved-link UI | emailed by `welcome-new-agent` | **0 rows ever** |

What an invitation carries today (G4): `kind`, `target_role`, `target_manager_id` (upline), `expires_at` (1–720h, default 168), optional `prefill_json` (name/phone/email/state, and a `license_status` + `license_status_locked` flag). **It carries no comp, no agency, no recipient restriction that is enforced, and no carrier exceptions.** 0 of 64 tokens have any comp key in `prefill_json`.

Comp is written on a different path entirely: `add-agent` writes `agents.comp_percentage` (all 228 rows = 60, all `comp_approval_status='approved'`), and the number the scoreboard and contracting audit actually read comes from `agent_contract_levels` via `fn_agent_contract_pct()` — which **never reads `agents.comp_percentage`**. 109 agents hold a level row that disagrees with their `comp_percentage`. So "approved comp survives acceptance" is false today by construction: the offered number is parked in a column nothing reads.

The two highest-severity findings are not about tokens: `create-new-agent-account` (`verify_jwt=false`, zero auth check) creates confirmed login accounts with a hardcoded password for anyone who POSTs to it, and its caller `InviteTeamModal` inserts a brand-new `agents` row even when the function reports the person already exists.

---

## 1. What exists

### 1.1 Routes (`src/App.tsx`)

| Route | Line | Component | Guard | Purpose |
|---|---|---|---|---|
| `/hire/:token` | 435 | `pages/HireLink.tsx` | public | G4 hire acceptance (creates/upgrades `agents` row + login) |
| `/join/:token` | 440 | `pages/JoinLink.tsx` | public | G4 join acceptance (creates `applications` row only) |
| `/join` | 433 | `pages/Join.tsx` | public | Bare email+password sign-in/sign-up; **no token, no attribution** |
| `/signup` | 432 | `pages/Signup.tsx` | public | G2 manager signup via `?token=` |
| `/agent-signup` | 444 | `AgentSignup.tsx` | public | (not token-gated; outside this domain's writers) |
| `/r/:code` | 597 | `components/RecruitingShortLink.tsx` | public | Redirect to `/apply?ref=<code>` |
| `/apply` | 409 | `pages/Apply.tsx` | public | Consumes `?ref=` via `resolve-ref-slug` (`Apply.tsx:161,537`) |
| `/admin/invite-links` | 571 | `pages/admin/InviteLinks.tsx` | `requireAdmin allowManagers` | G4 mint/list/revoke |
| `/dashboard/recruiting-links` | 524 | `pages/RecruitingLinks.tsx` | `requireAdmin` | Roster of `/r/<slug>` links (MP-342) |
| `/dashboard/comp-tiers` | 775 | `pages/admin/CompTiersSettings.tsx` | `requireAdmin` | Edits `agents.contract_percentage` directly. **No inbound link found anywhere in `src/` outside App.tsx** (grep `comp-tiers`) |

Inbound links to `/admin/invite-links`: `agentCloudNavigation.ts:150` ("Invite an agent"), `ContractsBoard.tsx:200`, `RecruiterHome.tsx:291`, `CarrierContracts.tsx:295`, `AgencyOwnerHome.tsx:299`.

### 1.2 Components / modals

| File | Lines | Mounted at | What it does |
|---|---|---|---|
| `components/dashboard/AddAgentModal.tsx` | 821 | `DashboardCRM.tsx:2123`, `DashboardCommandCenter.tsx:631`, `onboarding/QuickAddAgentDialog.tsx:23` | Two paths: (a) "one-link" → `generate_invite_token(p_kind:'hire', p_expires_hours:168, p_target_role, p_target_manager_id, p_prefill:{license_status, license_status_locked:true})` (171–181); (b) direct create → `functions.invoke("add-agent")` with `managerId, licenseStatus, npn, compPercentage (50–200, default 60), samApprovalRequested` (296–317). Comp validated client-side 50–200 (285), >100 needs checkbox (289). |
| `components/dashboard/InviteTeamModal.tsx` | 512 | `DashboardCommandCenter.tsx:1254` ("Invite Team" button at 638) | G3: `create-new-agent-account` (165–176) → **client-side `agents.insert`** (191–205) → `generate-magic-link` (212–220) → `welcome-new-agent` (232–243). Also CRUD on `contracting_links` (107–144). No invitation record, no comp, no expiry, no token. |
| `components/dashboard/AdminManagerInvites.tsx` | 260 | `DashboardCommandCenter.tsx:1147` (HideableCard "Manager Invites") | G2: client `Math.random` token (67–69), `manager_signup_tokens.insert` (81), copies `/signup?token=` (104), delete (114). |
| `components/dashboard/ManagerInviteLinks.tsx` | 351 | `DashboardCommandCenter.tsx:1168` (Collapsible "Invite Links") | G1: inserts `manager_invite_links` (168), copies `/apply?ref=<invite_code>` (141, 312, 330). |
| `components/dashboard/CompLevelEditor.tsx` | 132 | `AgentProfileDrawer.tsx:875`, `ProducerDetailsDrawer.tsx:354`, `ScopedProductionScoreboard.tsx:809` | Calls `set_agent_contract_pct(p_agent_id, p_pct, p_note)` (44). Admin or manager (MP-335). |
| `components/dashboard/AgentProfileDrawer.tsx` | — | — | Two one-tap mint buttons: hire link (1006–1035, `p_target_manager_id: agent.manager_id`) and join link (1073–1100, `p_target_role:'referral_prospect'`). **0 tokens in the DB carry their `p_notes` signature** — never used in production. |
| `components/dashboard/JoinYourTeam.tsx` | 83 | agent home | Shows Discord + Slack community invites from `system_settings` (35–37). Discord-facing UI Sam wants gone. |
| `components/RecruitingShortLink.tsx` | 41 | route `/r/:code` | `Navigate` to `/apply?ref=` (41). |
| `lib/refSlug.ts` | 106 | `Apply.tsx:47` | 24h localStorage relay of `?ref=` (22, 45–56). URL remains primary. |
| `pages/RecruitingLinks.tsx` | 214 | route | `supabase.rpc("admin_recruiting_links")` (122); builds `/r/<ref_slug>` (52). |
| `pages/admin/InviteLinks.tsx` | 499 | route | Loads `invite_tokens` rows (139–142), mints (202–210, `p_notes: linkName`), revokes with **client UPDATE** `{is_active:false, revoked_at}` (252–255), derives status client-side `rowStatus()` (103–107: used → revoked → expired → active). Counter folds expired into "revoked" (176–178). |
| `pages/admin/CompTiersSettings.tsx` | 142 | route | Reads `v_agents_full.contract_percentage` (35–36), writes `agents.contract_percentage` (58–60). |
| `components/dashboard/AgentHealthPanel.tsx` | — | — | Calls `rp_update_agent_comp` (81) — see defect D-10. |

### 1.3 Edge functions (`supabase/functions/`, `supabase/config.toml`)

| Function | verify_jwt | Auth inside | Role in this domain |
|---|---|---|---|
| `consume-invite-token` (680 lines) | false (config:3–4) | token-gated by design | Validates `invite_tokens` row (114–141: missing → 409 `invite_invalid`; `!is_active` → `invite_revoked`; `used_at` → `invite_already_used`; expired → `invite_expired`), resolves upline `target_manager_id ?? created_by` (151), **join** kind inserts `applications` (181–195) and marks token used with `.is("used_at", null)` (210–217); **hire** kind resolves identity by auth user / profile email / NPN (273–366, `identity_conflict` 409, `email_mismatch` 409 at 391), upgrades existing agent in place (487–507) or inserts (520–535), calls `submit_contracting_intake` for licensed (563–584), enqueues Slack invite outbox (601–611), marks token used conditionally (620–635; race → soft warn), mints magic login token (642+). |
| `add-agent` (731) | false (15–16) | **Yes**: bearer required (55–69), roles `admin`/`manager` (77–87), manager may only add under self (179–189) or an application they own (225–242), builder tracks admin-only (166). | Direct create. 409 when profile email exists (284–299). Writes `agents.comp_percentage`, `comp_approval_status`, `comp_approved_*`, `builder_track`, `manager_id = invited_by_manager_id = managerId` (396–416). Promotes `sourceAgent` in place when application exists (438–447). Sends Sam comp-approval email when >100 (287–297). Calls `submit_contracting_intake` (325). |
| `create-new-agent-account` (194) | false (127–128) | **None** | Creates confirmed auth user with `password: "123456"` (line `const randomPassword = "123456"`), inserts `profiles`, grants `user_roles.agent`. Returns `{existed:true}` when profile email already exists instead of refusing. |
| `generate-magic-link` | false (133–134) | **Yes** since MP-450: bearer + admin role (58–85) | Used by `InviteTeamModal` (212). Note: a *manager* calling InviteTeamModal gets 403 here after the agent row was already inserted. |
| `welcome-new-agent` | false (82–83) | **None** (reads body at 42, sends via Resend 189) | Open email sender; takes arbitrary `agentEmail`, `portalLink`, `contractingLink`. |
| `manager-signup` | enabled (18–19) | token-gated | Checks `is_used` (84), `expires_at` (91), creates user, marks `is_used/used_at/used_by` (168–171). |
| `validate-signup-token` | false (55–56) | token-gated | Read-only check (32–44). |
| `resolve-ref-slug` (125) | false (302–303) | public, per-IP rate limit (20) | `agents.ref_slug` eq (75–78) then `agent_code` ilike-escaped fallback (97). Does **not** consult `manager_invite_links`. |
| `submit-application` (1836) | false (22–23) | public | Accepts `selectedReferralAgentId` / `recruiterId` (uuid, 270–272) from the client, filters them to active agents (53–83, 1162–1166), defaults everything to `SAM_DEFAULT_AGENT_ID` (1189–1198). |

### 1.4 Tables (live `information_schema`, 2026-10-05)

- `invite_tokens` — `id, kind, token, created_by, created_by_user_id, created_at, expires_at, used_at, used_by_agent_id, used_by_application_id, target_role, target_manager_id, prefill_json, is_active, revoked_at, revoked_by, notes`. CHECKs: `kind in ('hire','join')`; `target_role in ('agent','hired_unlicensed','hired_licensed','manager_candidate','referral_prospect','hired_manager','manager','agency_owner','staff')`; `UNIQUE(token)`. Trigger `trg_apply_invite_target_role AFTER UPDATE OF used_by_agent_id` → `fn_apply_invite_target_role()` grants `user_roles` (manager for `hired_manager|manager|agency_owner`, `va` for `staff`, else `agent`) and sets `agents.is_manager` (`20260823151000_apex_contracts_board.sql:254–305`). No `status` column; no `superseded_by`; no `recipient_email` column (email lives loosely in `prefill_json`).
- `agent_contract_levels` — `agent_id (PK), contract_pct (0–200), source, note, set_by, effective_from, updated_at`. Sources live: `agentlink_carrier_max_2026-08-26` ×104, `admin_ui` ×2, `sam_directive_2026-09-16` ×2, `sam_directive_2026-08-25` ×1 (109 rows). The contracting audit (`20260925014920_contracting_fixes.sql:80–81`) counts only `sam_directive%`/`admin_ui` as approved comp; the 104 carrier-max rows are explicitly *not* approved comp.
- `manager_invite_links` — `id, manager_agent_id, invite_code, created_at, is_active, referrer_role`. 8 rows, 8 active, last 2026-08-20. RLS: `SELECT` to **public** where `is_active` (anon can enumerate).
- `manager_signup_tokens` — `id, token, manager_name, manager_email, created_by, created_at, expires_at, used_by, used_at, is_used, target_role`. 1 row (used).
- `contracting_links` — `id, manager_id, name, url, created_at`. **0 rows.**
- `agents` columns relevant: `comp_percentage` (228/228 = 60), `comp_approval_status` (228 approved, 0 pending), `comp_approved_at/by`, `builder_track`, `contract_percentage` (120 ×182, 60 ×44, 125 ×2 — placeholder per table comment), `ref_slug` (228/228 populated, 0 duplicate groups), `agent_code`, `manager_id`, `invited_by_manager_id`, `is_manager`, `account_mode`.
- `applications.referral_manager_id / referral_recruiter_id / hiring_manager_user_id / referral_source` — where public-link attribution lands.

### 1.5 RPCs / functions (live `pg_proc`)

| Function | secdef | EXECUTE | Notes |
|---|---|---|---|
| `generate_invite_token(text,int,text,uuid,jsonb,text)` | yes | authenticated, **anon**, service_role | Gate = "caller has an active `agents` row" (`20260820180000:18–25`), i.e. **any active agent can mint**, including `target_role='agency_owner'` or `'manager'` tokens. Rate limit 20/h. anon fails on `auth.uid()` null. |
| `get_invite_token_prefill(text)` | yes | anon, authenticated | Returns safe subset only for active, unused, unexpired rows (`20260826041000:4–54`). |
| `fn_apply_invite_target_role()` | yes | service_role | Trigger, EXCEPTION-wrapped. |
| `set_agent_contract_pct(uuid,numeric,text)` | yes | authenticated | Admin any; manager only downline, not self, capped at own resolved pct, source `manager_ui` (`20260831150000:56–123`). Writes `agent_contract_levels` with `on conflict (agent_id)` upsert — **overwrites, no history row**. |
| `fn_agent_contract_pct(uuid)` | yes | authenticated | Reads `mv_agent_truth.contract_pct` first, else `fn_agent_contract_pct_live` (explicit level → non-placeholder `agents.contract_percentage` as 'account' → `agent_comp_levels` name-match 'carrier_avg' → 'unknown'). **Never reads `agents.comp_percentage`.** `mv_agent_truth` provenance: carrier_max 112, unknown 93, carrier_avg 16, admin_ui 3, sam_directive 4. |
| `rp_update_agent_comp(uuid,numeric,numeric)` | yes | authenticated | `20260927041000`: admin **or manager** may set `comp_percentage`/`contract_percentage` on **any** agent; no downline check, no cap. Called from `AgentHealthPanel.tsx:81`. Bypasses MP-335. |
| `admin_recruiting_links()` | yes | authenticated | In-body `apex_is_admin()` gate (`20260830100000:24`). |
| `submit_contracting_intake(...)` | yes | service_role | Called by both `add-agent` and `consume-invite-token`. Intake columns include `agent_id, source, status, npn` — **no comp / upline / agency / invite_token_id column** (measured). |
| No `revoke_invite_token`, `regenerate_*`, `resend_*`, `supersede_*` function exists (grep of migrations: 0). |

### 1.6 Jobs
- `cron.job` has no job referencing `invite` except `apex-onboarding-call-invites-5min` (unrelated: onboarding call scheduling). **No expiry sweeper**: nothing flips expired tokens; expiry is enforced only at read time.

### 1.7 Tests
- `src/tests/lib/inviteAccountLifecycle.test.ts` (7 cases: upline ownership, licensed start stage, in-place upgrade, admin comp visibility, no success for role-only login, auth-lookup fail-closed).
- `src/tests/lib/contractingOneLinkLifecycle.test.ts` (1 case).
- `src/tests/pages/recruitingLinksContract.test.ts` (3 cases: admin gate, builds from `ref_slug`, route stays admin-gated).
- No test covers: expired/revoked/reused rejection in `consume-invite-token`, email-mismatch, comp survival, G1/G2/G3 paths, `create-new-agent-account`.

### 1.8 CI guards touching this domain
`check:maybesingle-nonunique` (baseline json lists `InviteTeamModal` / `AddAgentModal` / `consume-invite-token` sites), `check:function-contracts`, `check:orphan-pages` (will fire if `/dashboard/comp-tiers` is removed without a redirect, or if a new page is added without nav), `check:sidebar-routes`, `check:dead-internal-links` (5 inbound links to `/admin/invite-links`), `check:empty-catch` (InviteLinks.tsx:38 carries an `empty-catch-allow` marker), `check:blocking-modal`, `check:tsc-error-count` baseline.

---

## 2. Authoritative records

| Concept | Authoritative today | Should be |
|---|---|---|
| Personal invitation | `public.invite_tokens` (G4) | same table, extended (see §7) |
| Invitation acceptance → person | `agents` row (hire) / `applications` row (join), linked back via `invite_tokens.used_by_agent_id` / `used_by_application_id` | same |
| Upline / hierarchy | `agents.manager_id` (and legacy twin `invited_by_manager_id`; 11 rows disagree) | `agents.manager_id`, written once at accept from the token |
| Approved (offered) comp | **none** — `agents.comp_percentage` is written but never read | new `invite_tokens.offered_comp_pct` → `agent_contract_levels` row with source `invite_<token_id>` at accept |
| Carrier-confirmed comp | `agent_contract_levels` rows with source `agentlink_carrier_max_*` / `carrier_avg` provenance; contracting audit `ethos_level` | keep; never overwrite an approved-source row with a carrier-derived one |
| Public recruiting link | `agents.ref_slug` (fallback `agent_code`) | same; `manager_invite_links` retired |
| Manager invitation | G4 token with `target_role in ('manager','agency_owner','hired_manager')` | same; `manager_signup_tokens` retired |
| Community links (Slack/Discord) | `system_settings.slack_community_invite_url`, `discord_invite_url` | Slack only; Discord-facing UI removed per Sam |

---

## 3. Workflow traces

### 3.1 Admin/manager mints a hire link (G4) and the recruit accepts
1. **User action**: `AddAgentModal` "Create one-link" (`AddAgentModal.tsx:164–195`) or `/admin/invite-links` "Create Link" (`InviteLinks.tsx:202–210`) or `AgentProfileDrawer` button (1006).
2. **Authorization**: `generate_invite_token` requires only an active `agents` row for `auth.uid()` (`20260820180000:18–25`). RLS on `invite_tokens` for the later list/revoke: any `admin`/`manager` role sees and can UPDATE **all** rows (`invite_tokens_admin_all`, measured qual: role in admin/manager OR `created_by_user_id = auth.uid()`).
3. **Backend operation**: insert row with `token = base64url(gen_random_bytes(24))`, `expires_at = now()+hours`, `target_role`, `target_manager_id`, `prefill_json`, `notes`.
4. **Saved record**: `invite_tokens` row. 64 rows total; 47 from Add Agent (26 used, 5 minters), ~10 from the admin page (notes = link name), 6 audit probes.
5. **Automation**: none at mint. URL built client-side from `window.location.origin` (`InviteLinks.tsx:83`, `AddAgentModal`).
6. **Updated interface**: toast + clipboard; list refetch on the admin page.
7. **Audit history**: the row itself (`created_by`, `created_at`, `notes`). No event log.

Recipient opens `/hire/:token`:
1. `HireLink.tsx:82` → `get_invite_token_prefill` (anon). Returns `target_role`, `expires_at`, safe prefill, `license_status_locked`. Expired/used/revoked → null → "invalid" screen.
2. Submit → `consume-invite-token` (`HireLink.tsx:141–151`) with `token, full_name, phone, email, nipr_number, licensed`.
3. **Server validation** (consume 114–141): all five rejection branches exist and return 409. Licensed requires NPN `^\d{5,10}$` (255). `licensed` from the body **is trusted unless `license_status_locked`** (244–254) — by design for admin-page links ("every recruit confirms licensed or unlicensed").
4. **Identity dedupe** (273–400): lookups by auth email, profile email, NPN; >1 distinct candidate → `identity_conflict`; linked auth email ≠ submitted → `email_mismatch` with masked hint. Existing agent is **upgraded in place** (487–515), never duplicated. Measured: 6 agents consumed 2 tokens each; **0 of them have sibling `agents` rows** on the same `user_id`/`profile_id`.
5. **Saved records**: `auth.users` (createUser, `email_confirm:true`, no password — magic login), `profiles` upsert, `agents` insert/update with `manager_id = invited_by_manager_id = target_manager_id ?? created_by`, `onboarding_stage` (`onboarding` licensed / `pre_licensed` unlicensed).
6. **Automation**: licensed → `submit_contracting_intake(p_source:'magic_hire_link')` (563–584; 0 licensed hires lack an intake, measured); Slack invite `outbox_events` (601–611); token stamped `used_at/used_by_agent_id` with `.is("used_at", null)` (620–635) → trigger grants role; magic login token minted (642+); ntfy to Sam.
7. **Interface**: redirect to `/agent-hub?welcome=1` or contracting path.
8. **Audit**: token row + `agents` row + `contracting_intakes` row. **Comp: nothing.** Hierarchy drift: 5 used tokens whose agent's `manager_id` no longer equals `target_manager_id` (post-accept moves or placement overrides; cause unmeasured).

**Broken links in this trace**: comp/agency never enter the token; `email` in `prefill_json` is never compared to the submitted email, so a forwarded link is acceptable by anyone; revoke is a client UPDATE under a role-wide RLS, not an RPC; expired rows stay `is_active=true` forever (23 now); any active agent can mint a `manager`/`agency_owner` token.

### 3.2 Manager "Invite Team" (G3)
1. **User action**: Command Center "Invite Team" button (`DashboardCommandCenter.tsx:638`) → `InviteTeamModal.handleInvite` (147).
2. **Authorization**: none on `create-new-agent-account` (no header read, `verify_jwt=false`). `agents.insert` from the client passes RLS `Managers can insert team agents` (`invited_by_manager_id = current_agent_id()`) or admin.
3. **Backend**: `create-new-agent-account` → if `profiles.email` matches: returns `{existed:true}` (no 409). Else creates auth user with **password `"123456"`**, confirmed, role `agent`.
4. **Saved record**: client inserts **a new `agents` row unconditionally** (191–205) with `display_name, status:'active', license_status, invited_by_manager_id, onboarding_stage`. **No `manager_id`**, no comp, no token.
5. **Automation**: `generate-magic-link` (admin-only since MP-450 → a manager gets 403 here, after the agent row already exists); `welcome-new-agent` (unauthenticated) emails the magic link + first saved `contracting_links` URL (always undefined: 0 rows).
6. **Interface**: toast "Invite sent".
7. **Audit**: none beyond the `agents` row.

**Broken links**: duplicate-agent writer on `existed:true`; unauthenticated account factory with a known password; manager path half-fails after the write; `manager_id` left null (4 agents have null `manager_id` live — cause unmeasured).

### 3.3 Admin adds an agent directly (`add-agent`)
Authorization is correct (bearer, role, downline/ownership checks). Dedupe: 409 on existing profile email (284–299); if auth user exists but no profile, proceeds and inserts an `agents` row keyed on that `user_id` **without checking for an existing `agents` row on that `user_id`** (310–316 → 448–453) — latent duplicate path (1 live `user_id` dupe group exists; attribution to this path unmeasured). Comp: validated 50–200, written to `agents.comp_percentage` + `comp_approval_status` (396–416); `>100` → `pending_sam` + email to Sam. **Measured: 228/228 rows `comp_percentage=60`, 0 `pending_sam`, 228 `approved`** — i.e. the comp selector has either always been left at the default or the writes were later flattened; either way the value is unread by `fn_agent_contract_pct` (109 disagree with their level row).

### 3.4 Public recruiting link (`/r/<slug>`)
`/r/:code` → `/apply?ref=code` (`RecruitingShortLink.tsx:41`) → `Apply.tsx:537` `resolve-ref-slug` → agent id → `submit-application` body `selectedReferralAgentId` (client-supplied uuid, filtered to active agents at 53–83) → `applications.referral_manager_id / referral_recruiter_id / assigned_agent_id`, default Sam. Measured: 235 applications since 2026-07-01, 235 carry a `referral_manager_id`, **152 (64.7%) defaulted to Sam's id**; 0 have `attribution_json.ref_slug` (the slug itself is not persisted, only the resolved id — so misattribution is not auditable after the fact). Correctly **not** subject to invitation expiry. `ref_slug` is unique (0 dupe groups).

**Editable URL params trusted**: `?ref=` is resolved server-side to an active agent (fine). `selectedReferralAgentId`/`recruiterId` are client uuids filtered only for "active agent" — any visitor can credit any active agent by editing the request; no HMAC/no slug→id binding. Low financial impact (recruiting credit, not comp), but it is a trusted editable parameter.

### 3.5 Manager invite code (G1) — dead
`ManagerInviteLinks` copies `/apply?ref=<invite_code>` (141). `resolve-ref-slug` matches only `agents.ref_slug`/`agent_code`. Measured: **0 of 8 active codes equal any `ref_slug` or `agent_code`** → every click lands as an unattributed application defaulted to Sam. The widget still renders in the Command Center (1168) with "Active" badges (`ManagerInviteLinks.tsx:303–308`) — fake success on the operator surface.

### 3.6 Manager signup token (G2)
Token generated client-side with `Math.random` (`AdminManagerInvites.tsx:67–69`; not cryptographic), `/signup?token=` → `validate-signup-token` → `manager-signup` (marks used). 1 token ever. Works but duplicates G4's `target_role='manager'`.

### 3.7 Comp level edit
`CompLevelEditor` → `set_agent_contract_pct` → `agent_contract_levels` upsert (`admin_ui` / `manager_ui`) → `mv_agent_truth` (materialized; refresh cadence outside this domain) → scoreboard `seller_pct` + `ProvenanceChip`. Audit: overwritten in place (no history). Separately `CompTiersSettings` writes `agents.contract_percentage` (placeholder) and `AgentHealthPanel` calls `rp_update_agent_comp` (unscoped) — three writers, two of which bypass the MP-335 authority rules.

---

## 4. Defects (evidence → severity)

| ID | Sev | Where | What | Evidence |
|---|---|---|---|---|
| D-01 | **P0** | `supabase/functions/create-new-agent-account/index.ts` (whole handler), `supabase/config.toml:127–128` | Unauthenticated account factory: no `Authorization` read, `verify_jwt=false`, creates **confirmed** auth user with hardcoded `password: "123456"` and grants `user_roles.agent`. Anyone holding the public anon key (in the bundle) can mint logins. | Quoted: `const randomPassword = "123456";` and `email_confirm: true, // Skip email confirmation`; no `getUser`/`user_roles` lookup in file (grep). |
| D-02 | **P0** | `src/components/dashboard/InviteTeamModal.tsx:165–205` | Duplicate-person writer: when the function returns `existed:true` the modal still inserts a new `agents` row (no `existed` branch). `manager_id` never set. Comp/expiry/token absent. | Lines 191–205 `supabase.from("agents").insert({...})` unconditional after `accountData.userId`. Live: 5 `profile_id` dupe groups (10 rows, 1 with an active row), 1 `user_id` dupe group — attribution to this writer unmeasured. |
| D-03 | **P1** | `supabase/functions/add-agent/index.ts:396–416`; `fn_agent_contract_pct_live` (live def) | Offered comp does not survive: written to `agents.comp_percentage`, which no resolver reads. Scoreboard/contracting read `agent_contract_levels` → carrier max → unknown. | 228/228 `comp_percentage=60`; 109 agents have a level row ≠ `comp_percentage`; `fn_agent_contract_pct_live` body contains no `comp_percentage` reference; 0 `comp_approval_status='pending_sam'`. |
| D-04 | **P1** | `invite_tokens` schema; `generate_invite_token` signature; `consume-invite-token` | Invitation carries no comp, no agency, no carrier exceptions; recipient email in `prefill_json` is never enforced at consume. | 0/64 tokens have a comp key; consume has no `prefill_json.email` comparison (grep); brief §8 requires all of these. |
| D-05 | **P1** | `20260820180000_fix_generate_invite_token_pgcrypto_path.sql:18–25` | Any active agent can mint any `target_role` including `manager`, `agency_owner`, `hired_manager`, `staff`; trigger then grants `manager`/`va` roles. Authority check is "has an agents row", not "may grant this role / this upline". | Function body; CHECK constraint list (live). `p_target_manager_id` is not validated against the caller's downline. |
| D-06 | **P1** | `invite_tokens_admin_all` RLS (live qual) + `InviteLinks.tsx:252–255` | Revocation is a client UPDATE under a role-wide ALL policy: every manager can read every raw `token` string (impersonate any pending invite) and revoke/alter anyone's invitation. No `revoke_invite_token` RPC exists. | pg_policies qual: role in (admin,manager) OR created_by_user_id = auth.uid(); `select_roles` on `invite_tokens` includes `authenticated`. |
| D-07 | **P1** | `invite_tokens` (no status/expiry sweep); `InviteLinks.tsx:103–107,176–178` | No Expired/Superseded state; 23 rows expired but `is_active=true`; UI folds expired into "revoked" count; nothing hides terminal rows except client filter; no resend/regenerate. | SQL: `expired_but_active=23`, `pending_active=2`, `used=33`, `revoked=6`. cron.job: no sweeper. |
| D-08 | **P1** | `ManagerInviteLinks.tsx:141,312,330`; `resolve-ref-slug/index.ts:75–98` | G1 codes produce `/apply?ref=<invite_code>` that never resolves; widget shows "Active". Applications land on Sam. | 0/8 codes match `ref_slug`/`agent_code`; 152/235 apps since 07-01 defaulted to Sam (share caused by G1 unmeasured). |
| D-09 | **P1** | `supabase/functions/welcome-new-agent/index.ts:42,189`; config:82–83 | Unauthenticated open email sender with caller-controlled recipient and links (phishing relay). | No auth read in file; Resend send at 189. |
| D-10 | **P2** | `20260927041000_agent_comp_update_rpc.sql:2–22`; `AgentHealthPanel.tsx:81` | `rp_update_agent_comp` lets any manager set any agent's comp with no downline/cap/provenance; bypasses MP-335 and writes to columns the resolver ignores (`comp_percentage`) or treats as placeholder (`contract_percentage`). | Function body lines 6–13; grant to `authenticated`. |
| D-11 | **P2** | `src/pages/admin/CompTiersSettings.tsx:58–60`; route `App.tsx:775` | Orphan page writing `agents.contract_percentage` (placeholder; resolver treats 120/default as placeholder, else as 'account' level) — a third comp writer with no provenance. | No inbound link (grep `comp-tiers` outside App.tsx = 0); table comment says column is a placeholder. |
| D-12 | **P2** | `AdminManagerInvites.tsx:67–69` | Manager signup tokens generated with `Math.random` (non-CSPRNG), stored by client insert; redundant with G4 `target_role='manager'`. | Code; 1 row ever (2026-07-15). |
| D-13 | **P2** | `manager_invite_links` RLS (live) | `SELECT` granted to `public`/anon with `is_active=true` → anonymous enumeration of codes and `manager_agent_id`. | pg_policies "Anyone can view active invite links", roles `{public}`. |
| D-14 | **P2** | `contracting_links` + `InviteTeamModal.tsx:70–144` | Dead feature: 0 rows ever; UI and `welcome-new-agent` `contractingLink` plumbing around it. | SQL `contracting_links_total=0`. |
| D-15 | **P2** | `supabase/functions/submit-application/index.ts:270–272,1189–1198` | `selectedReferralAgentId`/`recruiterId` are editable client uuids, filtered only to "active agent"; slug not persisted, so credit misattribution is unauditable. | Code; `apps_since_0701_with_ref_attribution=0`. |
| D-16 | **P2** | `InviteTeamModal.tsx:212–220` vs `generate-magic-link:77–85` | Manager-initiated Invite Team fails at step 3 with 403 (admin-only) after steps 1–2 already created account + agent row — partial write, no rollback. | Code. Live occurrence unmeasured. |
| D-17 | **P2** | `agents.manager_id` vs `invited_by_manager_id` | Hierarchy twins disagree on 11 rows; 5 used tokens' agents no longer sit under `target_manager_id`. | SQL. |
| D-18 | **P2** | `set_agent_contract_pct` upsert (`20260831150000:115–125`) | Comp changes overwrite in place; no history → "searchable audit history" for offered terms impossible. | Function body `on conflict (agent_id) do update`. |
| D-19 | **P2** | `JoinYourTeam.tsx:35–42,74` | Discord invite rendered to agents; Sam asked for Discord-facing UI removed from the agent journey. | Code. |

Not defects (verified working): consume rejects missing/revoked/used/expired tokens server-side (409s); single-use is enforced with a conditional UPDATE and a race is logged not laundered; identity dedupe in consume prevented duplicates on all 6 double-accept cases; 0 licensed hires lack a contracting intake; `admin_recruiting_links` is gated in-body; `ref_slug` has 0 duplicates; `resolve-ref-slug` escapes LIKE patterns.

---

## 5. Measurements (all live SQL, 2026-10-05)

| Metric | Value |
|---|---|
| `invite_tokens` total / kind | 64, all `hire` (0 `join` rows ever) |
| By state | used 33 · expired-but-active 23 · revoked 6 · pending-active 2 |
| used and also past expiry (natural) | 29 |
| used and also revoked (row-level contradiction) | 1 |
| used_by_agent rows / distinct agents | 32 / 26 → 6 agents consumed 2 tokens each; 0 of those 6 have sibling `agents` rows |
| used_by_application rows | 0 (join flow never used in prod) |
| tokens with comp in prefill | 0 |
| tokens with null target_manager (falls back to minter) | 10 |
| minted last 30d / used last 30d | 33 / 16 |
| mint source by notes | Add Agent 47 (26 used, 5 minters) · admin page ~10 · probes 6 · AgentProfileDrawer 0 |
| used tokens whose agent's `manager_id` ≠ `target_manager_id` | 5 |
| `hired_licensed` tokens whose agent is not licensed | 0 |
| licensed hires without contracting intake | 0 |
| `manager_signup_tokens` | 1 total, 1 used, last 2026-07-15 |
| `manager_invite_links` | 8 total, 8 active, 0 resolvable, last 2026-08-20 |
| `contracting_links` | 0 rows |
| `agent_contract_levels` by source | carrier_max_2026-08-26 104 · admin_ui 2 · sam_directive 3 |
| `mv_agent_truth` provenance | carrier_max 112 · unknown 93 · carrier_avg 16 · admin_ui 3 · sam_directive 4 (228 rows) |
| `agents` rows / active / merged aliases | 228 / 84 / 19 |
| agents created since 2026-07-01 | 54; 26 via token, 30 without (16 have `invited_by_manager_id`, 10 have no login, 0 GHOST placeholders) |
| agents with `comp_percentage` / distinct values / pending_sam | 228 / 1 (=60) / 0 |
| agents whose `comp_percentage` ≠ their level row | 109 |
| `contract_percentage` distribution | 120 ×182 · 60 ×44 · 125 ×2 |
| duplicate identity groups | profiles.email 2 · agents.user_id 1 · agents.profile_id 5 (10 rows; 1 group has an active row) · applications.email 20 |
| applications since 07-01 / with referral manager / defaulted to Sam / with ref_slug persisted | 235 / 235 / 152 / 0 |
| `ref_slug` populated / dupes | 228/228 / 0 |

**Unmeasured**: how many of the 30 token-less agents came from `InviteTeamModal` vs `add-agent` vs imports (no writer stamp); how many Sam-defaulted applications originated from a dead G1 code; whether any `create-new-agent-account` call came from outside the app; comp-selector usage history (all rows flattened to 60).

---

## 6. KEEP / REPAIR / MERGE / REMOVE

| Surface | File | Verdict | Reason / target |
|---|---|---|---|
| `/admin/invite-links` page | `pages/admin/InviteLinks.tsx` | **REPAIR** | Becomes the single "Invite Agent" surface: add comp/agency/recipient/exceptions fields, server-derived status, hide terminal rows by default, copy/resend/revoke/regenerate via RPCs. |
| `AddAgentModal` one-link path | `components/dashboard/AddAgentModal.tsx` | **REPAIR** | Keep as the CRM-embedded entry; pass offered comp + agency into the token instead of parking it in `agents.comp_percentage`; keep `license_status_locked`. |
| `AddAgentModal` direct `add-agent` path | same + `functions/add-agent` | **REPAIR** | Keep for admin "create now"; write offered comp to `agent_contract_levels` (source `admin_ui`) via `set_agent_contract_pct` semantics; check for existing `agents` row on `user_id` before insert. |
| `InviteTeamModal` | `components/dashboard/InviteTeamModal.tsx` | **REMOVE** | → open `AddAgentModal` (one-link) from the "Invite Team" button. Kills D-02, D-16, dead `contracting_links` UI. |
| `create-new-agent-account` edge fn | `functions/create-new-agent-account` | **REMOVE** (disable; keep file until callers are gone) | Only caller is InviteTeamModal. If it must survive one release: bearer + admin/manager check, random password or no password, 409 on existing. |
| `welcome-new-agent` edge fn | `functions/welcome-new-agent` | **REPAIR** | Add bearer+role check or restrict to service-role internal calls; or fold into the outbox dispatcher used by consume. |
| `AdminManagerInvites` widget + `/signup?token=` + `manager-signup` + `validate-signup-token` | `components/dashboard/AdminManagerInvites.tsx`, `pages/Signup.tsx`, 2 edge fns | **MERGE** → G4 token with `target_role='manager'` | One mint path; `/signup?token=` redirects to `/hire/:token` when token is found in `invite_tokens`, else shows the existing invalid screen. Keep table read-only for history. |
| `ManagerInviteLinks` widget | `components/dashboard/ManagerInviteLinks.tsx` | **REMOVE** | Dead (0/8 resolve). Replace with a link to `/dashboard/recruiting-links`. Leave `manager_invite_links` table (history), drop the public SELECT policy. |
| `/dashboard/recruiting-links` | `pages/RecruitingLinks.tsx` | **KEEP** | Correct separation of public funnels from personal invites. Add "copy under manager" is already there. |
| `/r/:code` + `RecruitingShortLink` | `components/RecruitingShortLink.tsx` | **KEEP** | |
| `resolve-ref-slug` | `functions/resolve-ref-slug` | **KEEP** | |
| `refSlug.ts` relay | `lib/refSlug.ts` | **KEEP** | |
| `/join` bare page | `pages/Join.tsx` | **REMOVE** → redirect to `/login` | Un-attributed self-signup contradicts "no agent created without invitation". (Confirm no outbound comms still point at `/join` — grep of `src` shows only the route and its own header comment.) |
| `/join/:token` | `pages/JoinLink.tsx` | **KEEP** (never used in prod: 0 join tokens) — or **REMOVE** if the prospect lane is folded into `/r/<slug>`. Recommend KEEP for now, revisit after 30 days of the new mint UI. |
| `/hire/:token` | `pages/HireLink.tsx` | **REPAIR** | Show offered terms (comp %, agency, upline name, expiry) read from the server; enforce recipient email match when the token names one. |
| `consume-invite-token` | `functions/consume-invite-token` | **REPAIR** | Enforce `recipient_email`; carry `offered_comp_pct` + `agency_id` into `agent_contract_levels` and `contracting_intakes`; stamp `invite_token_id` on the agent/intake; return `superseded` for tokens replaced by regenerate. |
| `generate_invite_token` RPC | migrations | **REPAIR** | Authority: admin any; manager only `target_role in (hired_*, agent)` and `target_manager_id` within own downline (or self); comp ≤ caller's own resolved pct unless admin; agency must be one the caller owns/belongs to. |
| `invite_tokens` RLS | migrations | **REPAIR** | SELECT: admin all; manager own `created_by_user_id` or downline uplines; hide `token` column from managers via a view or column revoke (keep raw token only in the mint response). UPDATE/DELETE: none for authenticated — go through RPCs. |
| `CompLevelEditor` | `components/dashboard/CompLevelEditor.tsx` | **KEEP** | Already routes through `set_agent_contract_pct`. |
| `set_agent_contract_pct` | migration 20260831 | **REPAIR** | Add history (append to a `agent_contract_level_history` table or `agent_notes`) instead of silent upsert; accept a `source` enum extension for `invite_*`. |
| `rp_update_agent_comp` | migration 20260927, `AgentHealthPanel.tsx:81` | **REMOVE** (revoke EXECUTE; point caller at `set_agent_contract_pct`) | Unscoped manager write; writes unread columns. |
| `/dashboard/comp-tiers` | `pages/admin/CompTiersSettings.tsx` | **REMOVE** → redirect to `/dashboard/crm` (comp editor lives in drawers) | Orphan; writes a placeholder column. Satisfy `check:orphan-pages`/`dead-internal-links` with a `LegacyWorkspaceRedirect`. |
| `contracting_links` table + UI | `InviteTeamModal` | **REMOVE** UI; leave empty table | 0 rows ever. |
| `JoinYourTeam` Discord link | `components/dashboard/JoinYourTeam.tsx` | **REPAIR** | Drop the Discord card; keep Slack. |
| `AgentProfileDrawer` mint buttons | `AgentProfileDrawer.tsx:1006,1073` | **MERGE** into one "Resend invite / Regenerate link" action that calls the new RPCs | Never used (0 rows). |
| `fn_apply_invite_target_role` trigger | migration 20260823 | **KEEP** | Correct and EXCEPTION-wrapped; constrain which roles a non-admin may mint upstream (D-05). |
| `admin_recruiting_links` RPC | migration 20260830 | **KEEP** | |

---

## 7. Recommended implementation plan (minimal, additive)

### 7.1 Migration `2026100X_invitations_v2.sql` (additive only)
```sql
alter table public.invite_tokens
  add column if not exists recipient_email text,
  add column if not exists offered_comp_pct numeric check (offered_comp_pct between 0 and 200),
  add column if not exists agency_id uuid references public.agencies(id),          -- verify table name in domain 04
  add column if not exists carrier_exceptions jsonb not null default '[]'::jsonb,  -- [{carrier, pct, note}]
  add column if not exists superseded_by uuid references public.invite_tokens(id),
  add column if not exists resent_count int not null default 0,
  add column if not exists last_sent_at timestamptz;

-- Derived, never stored: one view the UI reads instead of recomputing status in TS.
create or replace view public.v_invite_tokens_admin with (security_invoker = on) as
select t.id, t.kind, t.created_by, t.created_by_user_id, t.created_at, t.expires_at, t.used_at,
       t.used_by_agent_id, t.used_by_application_id, t.target_role, t.target_manager_id,
       t.recipient_email, t.offered_comp_pct, t.agency_id, t.carrier_exceptions, t.notes,
       t.revoked_at, t.superseded_by, t.resent_count, t.last_sent_at,
       case when t.used_at is not null then 'accepted'
            when t.superseded_by is not null then 'superseded'
            when not t.is_active or t.revoked_at is not null then 'revoked'
            when t.expires_at < now() then 'expired'
            else 'pending' end as status
       -- deliberately NO t.token column
from public.invite_tokens t;
```
Status literals (`pending|accepted|expired|revoked|superseded`) live in the view, not in a stored column, so no CHECK constraint is needed and no sweeper can drift.

RPCs (all `security definer`, `set search_path = public`, EXECUTE to `authenticated` only):
- `generate_invite_token` — **replace in place** (same signature plus `p_recipient_email text default null, p_offered_comp_pct numeric default null, p_agency_id uuid default null, p_carrier_exceptions jsonb default '[]'`). Authority: `apex_is_admin()` → anything; manager → `p_target_role in ('agent','hired_unlicensed','hired_licensed')`, `p_target_manager_id` = self or in own downline (reuse the downline test from `set_agent_contract_pct` lines 90–96), `p_offered_comp_pct <= fn_agent_contract_pct(self)`, agency must be caller's; others → `42501`. Keep the 20/h rate limit and the 1–720h clamp.
- `revoke_invite_token(p_id uuid)` — owner or admin; sets `is_active=false, revoked_at, revoked_by`; refuses if `used_at` is set (`invite_already_accepted`).
- `regenerate_invite_token(p_id uuid)` — revokes the old row, mints a new one copying every offered term, sets `old.superseded_by = new.id`; returns the new URL payload.
- `resend_invite_token(p_id uuid)` — increments `resent_count`, stamps `last_sent_at`, enqueues one `outbox_events` row (email to `recipient_email`; refuse when null). No direct send from the RPC.
- `get_invite_token_prefill` — extend the returned json with `offered_terms: {comp_pct, agency_name, upline_name, expires_at, carrier_exceptions}` (names only, never ids of other agents' comp). Return null unchanged for non-pending rows.

RLS: replace `invite_tokens_admin_all` with `select` for admin (all) / manager (`created_by_user_id = auth.uid()` or `target_manager_id` in downline); **no** `update`/`delete` policies for `authenticated`; keep service-role path for the edge fn. Revoke `SELECT` on the raw `token` column from `authenticated` (column-level revoke, same pattern as MP-329) so the UI reads `v_invite_tokens_admin`.

Comp carry-over: inside `consume-invite-token`, after the agent row is settled, call a new `fn_apply_invite_terms(p_token_id, p_agent_id)` (service-role only) that upserts `agent_contract_levels` with `source = 'invite_' || p_token_id::text` **only when no `sam_directive%`/`admin_ui` row exists** (never overwrite an approved number with an offer), appends an `agent_notes` row ("Offered X% via invite <id> by <minter>"), sets `agents.manager_id`/`agency_id` from the token, and stamps `contracting_intakes.invite_token_id` (new nullable column) on the intake created in the same request. Carrier-confirmed comp stays in `agentlink_carrier_max_*`/Ethos rows; the audit view already prefers approved sources (`20260925014920:80–81`), so offered vs confirmed stays separated by `source`.

Enforce recipient: in consume, if `recipient_email is not null and lower(recipient_email) <> lower(body.email)` → 409 `recipient_mismatch` (masked hint, same pattern as `email_mismatch`). Add `invite_tokens.recipient_email` to the auth-email identity lookup so the dedupe sees it.

### 7.2 Frontend
- `pages/admin/InviteLinks.tsx`: read `v_invite_tokens_admin`; default filter `pending`, with "Show history" toggle for accepted/expired/revoked/superseded; fields: recipient email (validated), agency, upline (downline-scoped for managers), comp % (default from `my_agents_missing_comp_level().my_cap` for managers), carrier exceptions (optional rows), expiry preset (3d/7d/14d/30d). Actions: Copy, Open, Resend, Revoke, Regenerate → the four RPCs. Remove `supabase.from("invite_tokens").update(...)`.
- `AddAgentModal.tsx`: one-link path passes comp/agency/recipient to the RPC; direct path keeps `add-agent` but `add-agent` writes comp through `agent_contract_levels` (service-role insert with source `admin_ui`, approval flag in note) and stops writing `comp_percentage`.
- `HireLink.tsx`: render `offered_terms` card above the form; lock the email field when `recipient_email` is present.
- `DashboardCommandCenter.tsx`: "Invite Team" opens `AddAgentModal`; delete `InviteTeamModal`, `AdminManagerInvites`, `ManagerInviteLinks` imports and cards (keep the `HideableCard` keys out of localStorage defaults).
- `App.tsx`: `/dashboard/comp-tiers` → `LegacyWorkspaceRedirect to="/dashboard/crm"`; `/join` → redirect `/login`; `/signup` keeps working for 30 days by looking up `invite_tokens` first (then `manager_signup_tokens`), then redirect-only.
- `AgentHealthPanel.tsx:81`: call `set_agent_contract_pct`.
- `JoinYourTeam.tsx`: Slack only.

### 7.3 Edge functions
- Disable `create-new-agent-account` (delete from `config.toml`, delete directory once InviteTeamModal is gone). If a grace release is needed: add bearer + admin/manager gate and return 409 on `existed`.
- `welcome-new-agent`: require bearer + admin/manager, or move to outbox-only invocation; reject arbitrary `portalLink` hosts (allowlist `apex-financial.org`).
- `consume-invite-token`: recipient enforcement; call `fn_apply_invite_terms`; include `offered_terms` in the success payload so the UI can show "You're set up at X% under Y".
- `add-agent`: before insert, `select id from agents where user_id = userId limit 2` → if one exists, upgrade in place (same as consume) instead of inserting.

### 7.4 Tests to write (vitest, synthetic data)
- `invitationLifecycle.test.ts`: status derivation for each of the five states from `v_invite_tokens_admin` SQL (string-asserts on the migration, same style as `recruitingLinksContract.test.ts`); `generate_invite_token` authority matrix (admin/manager/agent × role × upline × comp); `regenerate` sets `superseded_by` and revokes old; `revoke` refuses accepted.
- `consumeInviteToken.test.ts` (deno, importing the real handler helpers): rejects `invite_expired`, `invite_revoked`, `invite_already_used`, `recipient_mismatch`; double POST with the same token yields exactly one agent and one 409; offered comp lands as `agent_contract_levels.source = 'invite_<id>'` and never overwrites `sam_directive%`.
- `compWriters.test.ts`: source scan asserting `agents.comp_percentage`/`contract_percentage` have **no** writer in `src/` or `supabase/functions/` except migrations (ratchet to 0).
- Extend `inviteAccountLifecycle.test.ts` with "InviteTeamModal is gone" and "create-new-agent-account not in config.toml".

### 7.5 Guards affected
`check:sidebar-routes`, `check:orphan-pages`, `check:dead-internal-links` (redirects for `/dashboard/comp-tiers`, `/join`; 5 inbound links to `/admin/invite-links` stay valid), `check:maybesingle-nonunique` baseline (sites removed with InviteTeamModal → baseline must move **down**, never up), `check:function-contracts` (new RPC signatures), `check:empty-catch` (InviteLinks allow-marker), `check:tsc-error-count`, `check:metric-truth` (if the Command Center cards are removed), plus apex-doctor Check #22/#23 (identity collision / index snapshot) if new unique indexes are added.

### 7.6 Order of work (each step reversible)
1. Disable `create-new-agent-account` + gate `welcome-new-agent` (security first; no UI change needed because InviteTeamModal already fails for managers).
2. Migration: columns + view + four RPCs + RLS swap + column revoke.
3. `consume-invite-token` + `HireLink` terms display + recipient enforcement.
4. `InviteLinks.tsx` rebuilt on the view and RPCs; `AddAgentModal` passes terms.
5. Command Center: swap "Invite Team" to AddAgentModal; remove three legacy widgets; redirects for `/join` and `/dashboard/comp-tiers`; revoke `rp_update_agent_comp`.
6. Backfill nothing. Do **not** flip the 23 expired rows' `is_active` (the view already reports them as expired); do **not** rewrite `comp_percentage` (unread column; leave as evidence).

---

## 8. Risks and open questions

**Risks**
- Disabling `create-new-agent-account` breaks `InviteTeamModal` immediately; ship step 5's button swap in the same release or accept a short window where "Invite Team" errors (it already half-fails for managers).
- `agencies` table/column naming for `agency_id` must be confirmed against domain 04's map before the migration (I did not verify an `agencies` table exists; `agents.agency_id` is not among the live columns I probed).
- Managers minting comp: capping at the caller's own `fn_agent_contract_pct` depends on `mv_agent_truth` freshness; 93/228 rows resolve to `unknown`, so many managers would be refused until their own level is set (same behaviour `set_agent_contract_pct` already has — "your own comp level is not set").
- Column-level revoke of `invite_tokens.token` will break any REST read that selects `*` (InviteLinks currently selects named columns, but `check:function-contracts` / types regeneration may surface others).
- Redirecting `/join` may strand any printed/texted link still pointing there; grep found no in-app references, but external copies are **unmeasured**.
- `check:maybesingle-nonunique` baseline and `check:tsc-error-count` baseline both move when InviteTeamModal is deleted; the commit must update baselines downward and prove the guards still go red.

**Open questions for Sam / the command center**
1. Should managers be allowed to offer comp at all, or is comp strictly admin-set with managers only choosing upline? (Determines whether `offered_comp_pct` is a manager field or admin-only.)
2. Is the "Manager Track / Agency Owner Track" (`builder_track`) a comp-relevant term that belongs on the invitation, or an onboarding label only?
3. Should the `join` kind (prospect → `applications`) survive, or does `/r/<slug>` fully replace it? (0 join tokens ever minted.)
4. The 152 of 235 recent applications attributed to Sam by default: accept as-is, or run a one-time re-attribution from `applications.referral_source`/UTM before the new link UI launches?
5. The 5 used tokens whose agent now sits under a different manager than the token named: deliberate re-placements or drift? Needs a human look (agent ids in the SQL above; not listed here to avoid naming people).
6. Password `123456` accounts created by G3: how many auth users still have that password is **unmeasurable from the DB** (hashes). Recommend forcing a reset for every auth user whose `profiles` row was created by that function (`user_metadata.source` absent) — needs a decision because it emails real agents.
