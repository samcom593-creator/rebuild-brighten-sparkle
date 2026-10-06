import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { deriveInvitationStatus } from "@/lib/invitationState";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

const MIGRATION = "supabase/migrations/20261006140000_invitation_lifecycle.sql";

// Negative assertions grade CODE, not the comments that explain the old bug.
const stripTs = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSql = (src: string) => src.replace(/--[^\n]*/g, "");

/** Body of one CREATE OR REPLACE FUNCTION in the migration, up to its closing $$; */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} missing`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("$$;", open + 5);
  return sql.slice(start, close);
}

describe("invitation lifecycle migration", () => {
  const sql = read(MIGRATION);

  it("derives status in the same precedence the client mirror uses", () => {
    const body = fnBody(sql, "fn_invitation_status");
    const order = ["'accepted'", "'superseded'", "'revoked'", "'expired'", "'pending'"].map((lit) => body.indexOf(lit));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Same five fixtures through the TS mirror give the same answers in the same precedence.
    const now = new Date("2026-10-06T00:00:00Z");
    expect(deriveInvitationStatus({ used_at: "x", superseded_by: "y", is_active: false, expires_at: "2020-01-01" }, now)).toBe("accepted");
    expect(deriveInvitationStatus({ superseded_by: "y", is_active: false, expires_at: "2020-01-01" }, now)).toBe("superseded");
    expect(deriveInvitationStatus({ is_active: false, expires_at: "2020-01-01" }, now)).toBe("revoked");
  });

  it("enforces state, recipient and single-flight at claim time, from the row", () => {
    const claim = fnBody(sql, "invitation_claim");
    expect(claim).toContain("for update");
    for (const code of ["invite_invalid", "invite_already_used", "invite_superseded", "invite_revoked", "invite_expired", "recipient_mismatch", "invite_in_progress"]) {
      expect(claim).toContain(`'${code}'`);
    }
    expect(claim).toContain("auth.role(), '') <> 'service_role'");
  });

  it("stamps single use only for the claim that holds the row", () => {
    const complete = fnBody(sql, "invitation_complete");
    expect(complete).toContain("if t.used_at is not null then");
    expect(complete).toContain("t.claim_id is distinct from p_claim_id");
    expect(complete).toContain("and used_at is null");
    expect(complete).toContain("accepted_terms = v_terms");
  });

  it("applies OFFERED comp to agents.comp_percentage and never to carrier-confirmed levels", () => {
    const apply = fnBody(sql, "invitation_apply_terms");
    expect(apply).toContain("comp_percentage = t.offered_comp_pct");
    expect(apply).toContain("comp_approval_status = 'approved'");
    expect(apply).not.toMatch(/insert into public\.agent_contract_levels|update public\.agent_contract_levels/);
    expect(apply).not.toContain("agent_carrier_comp");
  });

  it("draws approved comp values from human approvals, not carrier maxima", () => {
    const levels = fnBody(sql, "fn_invite_comp_levels");
    expect(levels).toContain("'admin_ui'");
    expect(levels).toContain("'manager_ui'");
    expect(levels).toContain("'sam_directive%'");
    expect(levels).toContain("comp_approval_status = 'approved'");
    expect(levels).not.toMatch(/source like 'agentlink_carrier_max/);
  });

  it("decides authority on the server: roles, downline upline, cap, approved level, carriers", () => {
    const auth = fnBody(sql, "fn_invite_authorize");
    expect(auth).toContain("only an admin can invite someone as");
    expect(auth).toContain("fn_hierarchy_first_hops(array[c.agent_id])");
    expect(auth).toContain("is not an approved level");
    expect(auth).toContain("comp above 100 percent needs an admin");
    expect(auth).toContain("you cannot offer above your own level");
    expect(auth).toContain("from public.carriers ca");
    // Carrier names on the invitation come from the carriers table, never the client.
    expect(auth).toContain("'carrier_name', v_carrier.name");
    // The legacy mint path goes through the same gate.
    expect(fnBody(sql, "generate_invite_token")).toContain("public.fn_invite_authorize(");
    expect(fnBody(sql, "regenerate_invitation")).toContain("public.fn_invite_authorize(");
  });

  it("keeps acceptance RPCs service-role only and table writes RPC-only", () => {
    for (const sig of [
      "invitation_claim(text, text)",
      "invitation_release(uuid, uuid)",
      "invitation_apply_terms(uuid, uuid, uuid)",
      "invitation_complete(uuid, uuid, text, uuid, uuid, uuid, numeric)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(sql).toContain("drop policy if exists invite_tokens_admin_all on public.invite_tokens;");
    expect(sql).toContain("for select to authenticated");
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)/i);
    expect(sql).toContain("revoke insert, update, delete, truncate on public.invite_tokens from anon, authenticated;");
  });

  it("never returns the raw token in list or recipient payloads", () => {
    const list = fnBody(sql, "list_invitations");
    expect(list).not.toMatch(/'token',\s*t\.token/);
    const prefill = fnBody(sql, "get_invite_token_prefill");
    expect(prefill).not.toMatch(/'token',/);
    expect(prefill).not.toContain("cap_pct");
    expect(prefill).not.toContain("fn_agent_contract_pct");
  });

  it("is additive: no table drops, truncates or row deletes", () => {
    const body = sql.replace(/--[^\n]*/g, "");
    expect(body).not.toMatch(/\bdrop\s+table\b/i);
    expect(body).not.toMatch(/\btruncate\s+(table\s+)?public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("leaves public recruiting links (/r/<slug>) alone", () => {
    expect(stripSql(sql)).not.toContain("ref_slug");
    expect(stripSql(sql)).not.toContain("manager_invite_links");
  });
});

describe("consume-invite-token uses the lifecycle RPCs", () => {
  const edge = read("supabase/functions/consume-invite-token/index.ts");

  it("claims instead of reading the token row directly", () => {
    expect(edge).toContain('admin.rpc("invitation_claim"');
    expect(edge).not.toContain('.from("invite_tokens")');
  });

  it("releases the lease on every non-success response", () => {
    expect(edge).toContain("if (response.status !== 200)");
    expect(edge).toContain('admin.rpc("invitation_release"');
  });

  it("applies offered terms before the contracting intake and completes last", () => {
    const apply = edge.indexOf('admin.rpc("invitation_apply_terms"');
    const intake = edge.indexOf('"submit_contracting_intake"');
    const complete = edge.lastIndexOf('admin.rpc("invitation_complete"');
    expect(apply).toBeGreaterThan(0);
    expect(apply).toBeLessThan(intake);
    expect(intake).toBeLessThan(complete);
  });

  it("never reports success when the single-use stamp did not land", () => {
    expect(edge).toContain('error: (doneData as { error?: string } | null)?.error ?? "invite_already_used"');
  });

  it("surfaces the recipient restriction with a masked hint only", () => {
    expect(edge).toContain('code === "recipient_mismatch"');
    expect(edge).toContain("email_hint: claim.email_hint ?? null");
  });
});

describe("duplicate-person writers are closed", () => {
  it("Invite Team mints an invitation instead of creating rows", () => {
    const modal = stripTs(read("src/components/dashboard/InviteTeamModal.tsx"));
    expect(modal).toContain("<InviteAgentForm");
    expect(modal).not.toContain("functions.invoke(");
    expect(modal).not.toContain(".insert(");
  });

  it("Manager Invites no longer mints Math.random tokens", () => {
    const card = stripTs(read("src/components/dashboard/AdminManagerInvites.tsx"));
    expect(card).not.toContain("Math.random");
    expect(card).not.toContain('from("manager_signup_tokens")');
    expect(card).toContain('defaultInviteAs="hired_manager"');
  });

  it("create-new-agent-account requires an admin/manager caller and never sets a known password", () => {
    const fn = stripTs(read("supabase/functions/create-new-agent-account/index.ts"));
    expect(fn).not.toContain('"123456"');
    expect(fn).toContain('req.headers.get("Authorization")');
    expect(fn).toContain('r.role === "admin" || r.role === "manager"');
    expect(fn.indexOf('req.headers.get("Authorization")')).toBeLessThan(fn.indexOf("auth.admin.createUser"));
    expect(fn).toContain("already exists.`, existed: true }, 409)");
  });

  it("add-agent refuses an existing agent by NPN or by an existing login", () => {
    const fn = read("supabase/functions/add-agent/index.ts");
    expect(fn).toContain('.eq("nipr_number", normalizedNpn)');
    expect(fn).toContain('.eq("user_id", existingAuthUser.id)');
    expect(fn.indexOf('.eq("nipr_number", normalizedNpn)')).toBeLessThan(fn.indexOf("auth.admin.createUser"));
  });
});

describe("invite surfaces never trust URL params for terms", () => {
  it("HireLink reads offered terms from the server prefill, not the query string", () => {
    const page = read("src/pages/HireLink.tsx");
    expect(page).toContain("resp.offered_terms");
    expect(page).not.toContain("useSearchParams");
    expect(page).not.toContain("location.search");
  });

  it("the admin invite page lists through the scoped RPC, never the raw table", () => {
    const page = read("src/pages/admin/InviteLinks.tsx");
    const table = read("src/components/invitations/InvitationsTable.tsx") + read("src/components/invitations/invitationApi.ts");
    expect(page).not.toContain('from("invite_tokens")');
    expect(table).not.toContain('from("invite_tokens")');
    expect(table).toContain('"list_invitations"');
    expect(table).toContain('"revoke_invitation"');
    expect(table).toContain('"regenerate_invitation"');
  });
});
