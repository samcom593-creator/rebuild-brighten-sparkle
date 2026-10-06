# §8 Invitations, comp selection and link cleanup — implementation note

Branch `apex-os/invitations`, 2026-10-06. Builds on `07-invitations-comp-links.md` (re-verified against live `xrzweoneiieddzxogewk` before writing: `invite_tokens` columns/CHECKs/FKs/policy/grants, `generate_invite_token` + `get_invite_token_prefill` live bodies, `agent_contract_levels` sources, `agents_comp_percentage_range`, `fn_enrich_contracting_intake`, `fn_hierarchy_first_hops`, `fn_agent_subagency`, `carriers`).

## What changed

| Area | File | Change |
|---|---|---|
| Schema + RPCs | `supabase/migrations/20261006140000_invitation_lifecycle.sql` | Additive. `invite_tokens` gains recipient, offered comp, carrier exceptions, server-derived agency, supersession, share receipts, accept lease, accepted-terms snapshot. New RPCs below. Legacy `generate_invite_token` keeps its signature and return shape but now runs the same authority gate. RLS narrowed to admin + creator SELECT; INSERT/UPDATE/DELETE/TRUNCATE revoked from anon/authenticated; anon SELECT revoked. |
| Acceptance | `supabase/functions/consume-invite-token/index.ts` | Token row read replaced by `invitation_claim` (row lock + 3-min lease). Every non-200 releases the lease. Offered terms applied from the ROW via `invitation_apply_terms` **before** `submit_contracting_intake` (so the intake snapshots the offer); single-use stamp via `invitation_complete`. A lost stamp is now a 409, never `ok:true`. |
| Duplicate-person bypass | `supabase/functions/add-agent/index.ts` | Refuses (409 `identity_conflict`) when the NPN already belongs to a canonical agent, and when an existing auth login already owns an `agents` row (the latent path the audit named). Both checks precede `createUser`. |
| Account factory | `supabase/functions/create-new-agent-account/index.ts` | Now requires a bearer of an admin/manager; fixed password `123456` replaced with an unguessable random one; an existing person is a 409 instead of `{existed:true}` 200. |
| Invite UI | `src/components/invitations/InviteAgentForm.tsx`, `InvitationsTable.tsx`, `invitationApi.ts` (new) | One form (recipient, role, license path, agency → upline, approved comp, carrier exceptions, expiry, internal note) and one table (Active / History + search, counts over the full scoped set, Copy / Email draft / Regenerate / Revoke). |
| Invite admin page | `src/pages/admin/InviteLinks.tsx` | Rebuilt on the form + table; no raw table reads or client UPDATEs. |
| Command Center | `src/components/dashboard/InviteTeamModal.tsx` | Was account creation + unconditional client `agents.insert` (duplicate writer, no manager_id). Now a dialog around `InviteAgentForm`. Dead `contracting_links` UI removed. |
| Command Center | `src/components/dashboard/AdminManagerInvites.tsx` | Was `Math.random` `manager_signup_tokens` + client insert/delete. Now admin-only manager invitations (`target_role = hired_manager`) through `create_invitation`, listed via the same table. Legacy rows untouched; `/signup?token=` still validates them. |
| Recipient pages | `src/pages/HireLink.tsx`, `src/pages/JoinLink.tsx` | Offer card (comp, carrier exceptions, upline, agency) from `get_invite_token_prefill`; email field locked when the invitation is recipient-restricted; new refusal codes (`invite_superseded`, `recipient_mismatch`, `invite_in_progress`); `PageSkeleton` loading. JoinLink also had HireLink's old stream-body bug (every refusal read as "non-2xx") — fixed the same way. |
| Comp editor | `src/components/dashboard/CompLevelEditor.tsx` | Read-only "Offered X%" line (from `agent_invitation_terms`) beside the resolved level it edits, so offered and carrier-confirmed comp are never read as one number. |
| Pure logic | `src/lib/invitationState.ts` (new) | Status derivation (mirror of `fn_invitation_status`), per-state actions, offer-terms validation (mirror of `fn_invite_authorize`), recipient copy, masking, mailto draft. |
| Tests | `src/tests/lib/invitationState.test.ts`, `src/tests/lib/invitationLifecycleContract.test.ts` (new); `src/tests/lib/onboardingEmailPolicy.test.ts` (updated: it asserted the old account-creation path) | 46 new cases. |

## Data model

- **Personal invitation** = `public.invite_tokens` (G4), extended in place. No new table.
- **Status is derived, never stored**: `fn_invitation_status(used_at, superseded_by, is_active, revoked_at, expires_at)` → `accepted` > `superseded` > `revoked` > `expired` > `pending`. Unknown/missing expiry → `expired`. No sweeper, so nothing can drift; the 23 expired-but-`is_active` legacy rows read as `expired` without being rewritten.
- **Offered comp** (`invite_tokens.offered_comp_pct`, 50–200 CHECK = `agents_comp_percentage_range`) → at acceptance written to `agents.comp_percentage` + `comp_approval_status='approved'`, `comp_approved_by = inviter`. That is the value `fn_enrich_contracting_intake` snapshots into `contracting_intakes.comp_percentage`, which is what the Ethos/carrier request carries. `invitation_complete` also stamps the intake this acceptance produced (covers a replayed intake).
- **Carrier-confirmed comp** (`agent_contract_levels`, `agent_carrier_comp`) is never written by an invitation (proven: 0 rows created).
- **Approved comp values** = `fn_invite_comp_levels()`: distinct `agent_contract_levels` rows a human decided (`admin_ui`, `manager_ui`, `sam_directive%`) ∪ approved `agents.comp_percentage`. Live today: 60, 75, 80, 85, 105, 125. `agentlink_carrier_max_*` is carrier-confirmed, not an approval, and is excluded. No new ladder was invented.
- **Carrier exceptions** `[{carrier_id, carrier_name, pct, note}]` — names resolved server-side from `public.carriers`; a client-supplied name is ignored (proof row 09).
- **Agency** = `agency_key` (`primary` | `vantage`), derived from the validated upline via `fn_agent_subagency`, never taken from the client. In the UI, choosing an agency narrows the upline list.
- **Accepted terms** snapshot (`accepted_terms`) records offered comp, prior comp, exceptions, agency, role, upline, approver, intake id.

### Authority (`fn_invite_authorize`, used by `create_invitation`, legacy `generate_invite_token`, `regenerate_invitation`)

| Caller | Roles | Upline | Comp / exceptions |
|---|---|---|---|
| admin (`apex_is_admin()`) | any role in the CHECK list | any active agent | 50–200 |
| manager (`has_role(…,'manager')`) | agent-shaped only | self or downline (`fn_hierarchy_first_hops`, same walk as `set_agent_contract_pct`) | must be an approved level, ≤ own resolved level, ≤ 100 (above needs an admin, same rule as Add Agent) |
| other active agent | agent-shaped only | self or downline | none |
| no active agent row, not admin | refused | | |

### RPCs

`create_invitation`, `invitation_mint_options`, `list_invitations`, `invitation_link`, `record_invitation_share`, `revoke_invitation`, `regenerate_invitation`, `agent_invitation_terms` (authenticated); `invitation_claim`, `invitation_release`, `invitation_apply_terms`, `invitation_complete` (service_role only); helpers `fn_invitation_status`, `fn_invite_comp_levels`, `fn_invite_caller`, `fn_invite_authorize`, `fn_invite_can_manage`, `fn_invite_insert`. All SECURITY DEFINER with `search_path = public` except the immutable status function. `get_invite_token_prefill` replaced in place (same signature).

## Workflow trace (hire)

1. **Action**: Invite Agent form (admin page, Command Center dialog, Manager Invites card) → `create_invitation`.
2. **Authorization**: `fn_invite_authorize` (table above); rate limit 20/h per user; expiry clamped 1–720 h.
3. **Record**: `invite_tokens` row with opaque 32-char base64url token, recipient email, offered terms, agency, upline.
4. **Share**: Copy or Email draft → `invitation_link` / `record_invitation_share` (recorded as a share, `delivered:false`; nothing sends email).
5. **Recipient**: `/hire/:token` → `get_invite_token_prefill` shows only their own offer; email locked to the invited address.
6. **Accept**: `consume-invite-token` → `invitation_claim` (state, recipient, lease) → identity dedupe (unchanged; existing 409s kept) → agent insert/upgrade → `invitation_apply_terms` → contracting intake (licensed) → `invitation_complete` → `trg_apply_invite_target_role` grants the role.
7. **UI**: invitation leaves Active, appears in History as Accepted with the agent's name; Comp editor shows "Offered X%".
8. **Audit**: `accepted_terms`, `accepted_email`, `used_by_agent_id`, `share_count/last_shared_at`, `revoked_by`, `superseded_by/at`.

## Evidence

- **Migration + RPC proof**: `begin; <migration>; <impl-invitations-proof.sql>; rollback;` through bot-sql — 43 assertions, all as expected; output in `impl-invitations-proof-output.txt` (upline names redacted). Includes tampered/fabricated → `invite_invalid`, expired → `invite_expired`, revoked → `invite_revoked`, reused → `invite_already_used`, superseded → `invite_superseded`, wrong recipient → `recipient_mismatch`, concurrent → `invite_in_progress`, offered 80% persisted to the agent and the accepted-terms snapshot, 0 carrier-confirmed rows written, double accept → exactly 1 agent, manager scope/RLS, grants. Post-run check: 0 new columns, 0 new functions, 0 synthetic agents in prod.
- `deno check` clean for the three edge functions.
- `npx vitest run` — full suite 117 files / 1204 passed (46 new).
- `npx tsc -b --noEmit --force` — 82 errors (baseline 82, none in touched files).
- Guards: all listed guards pass except the three expected catalog-dependent ones below.

## What remains (for the command center)

1. **Catalog regeneration**: `check:rpc-args` and `check:rpc-status-literals` fail only because the new RPCs are not in `scripts/data/rpc-catalog.json` / `rpc-column-vocabulary.json` yet (all return jsonb). Regenerate after applying the migration.
2. **`check:maybesingle-nonunique`** fails on a PAY-DOWN: `InviteTeamModal.tsx::agents(user_id)` 3 → 0. Run `node scripts/check-maybesingle-nonunique.mjs --write-baseline` (scripts/data is off-limits to this implementer).
3. **Deploy order**: apply the migration first, then deploy `consume-invite-token` (it calls the new RPCs), `add-agent`, `create-new-agent-account`. Deploying the edge function before the migration would 500 every acceptance.
4. **`/agent-login` "create account" branch** (`src/pages/AgentNumbersLogin.tsx`, not owned here) calls `create-new-agent-account` unauthenticated; it now gets 401. That branch was already broken (the function ignored the typed password and set `123456`, so the following sign-in failed) and was a confirmed-account factory for any address. It should route to the invitation or reset flow.
5. **AddAgentModal one-link path** still mints through legacy `generate_invite_token` (no comp/recipient). It is now authority-checked; passing offered comp + recipient there is a small follow-up (file not owned here). Its direct `add-agent` path still writes `agents.comp_percentage` as before.
6. **`rp_update_agent_comp`** (unscoped manager comp write, D-10) and `/dashboard/comp-tiers` (D-11) are outside this section's file ownership and untouched.
7. `manager_invite_links` (G1, dead) public SELECT policy (D-13) and the `ManagerInviteLinks` widget are untouched (widget file not owned here).
8. Resend is a mailto draft + share receipt by design: there is no invitation email sender, and building one would be a new outbound path. If one is wanted, put it behind a `system_settings` flag defaulting off.
