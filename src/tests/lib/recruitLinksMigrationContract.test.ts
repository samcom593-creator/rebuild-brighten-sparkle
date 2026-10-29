/**
 * OVERHAUL-1 (2026-10-29): supabase/migrations/20261029050000_recruit_links_permanent_and_kind.sql.
 *
 * Proven before merge in a rolled-back transaction against project xrzweoneiieddzxogewk (27 of 27
 * checks): as Sam a permanent and a temporary hire link, the list by kind with counts equal to its
 * rows, regenerate keeping a permanent link permanent; as an ordinary agent a permanent join link
 * under themself, comp refused (42501), a manager role refused (42501), a bad kind refused (22023),
 * only their own links listed; as anon create and list refused (42501) while the recipient's
 * prefill reads permanent with the license locked; as the service role the whole join accept path
 * (claim, application insert through every trigger, complete, second use refused) with all three
 * credit columns on the link's maker. This file pins the shape that made those true.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { deriveInvitationStatus } from "@/lib/invitationState";

const MIGRATION = "supabase/migrations/20261029050000_recruit_links_permanent_and_kind.sql";
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");
const sql = read(MIGRATION);
const code = sql.replace(/--[^\n]*/g, "");

/** Body of one CREATE OR REPLACE FUNCTION, up to its closing $$; */
function fnBody(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} missing`).toBeGreaterThanOrEqual(0);
  const open = code.indexOf("as $$", start);
  return code.slice(start, code.indexOf("$$;", open + 5));
}

describe("permanent links", () => {
  it("are stored as expires_at 'infinity', so the one status definition stays untouched", () => {
    const create = fnBody("create_invitation");
    expect(create).toContain("p_permanent boolean default false");
    expect(create).toContain("set expires_at = 'infinity'::timestamptz");
    expect(code).not.toContain("function public.fn_invitation_status");
    expect(code).not.toMatch(/alter table public\.invite_tokens/i);
  });

  it("never send 'infinity' to a client: expires_at is null and permanent is true instead", () => {
    for (const name of ["create_invitation", "regenerate_invitation", "list_invitations", "get_invite_token_prefill"]) {
      const body = fnBody(name);
      expect(body, name).toMatch(/'expires_at', case when isfinite\(\w+\.expires_at\) then \w+\.expires_at end/);
      expect(body, name).toMatch(/'permanent', not isfinite\(\w+\.expires_at\)/);
    }
  });

  it("stay permanent when replaced, and the interval maths never meets infinity", () => {
    const regen = fnBody("regenerate_invitation");
    expect(regen).toContain("v_permanent := p_expires_hours is null and not isfinite(old.expires_at);");
    expect(regen).toMatch(/when isfinite\(old\.expires_at\) then greatest\(1, least\(720, ceil\(extract\(epoch from \(old\.expires_at - old\.created_at\)\)/);
    // The manager re-authorization that stops laundering an admin-only offer is still there.
    expect(regen).toContain("public.fn_invite_authorize(old.kind, old.target_role, old.target_manager_id,");
  });

  it("read the same in the client mirror: only the permanent flag makes a missing date usable", () => {
    const now = new Date("2026-10-29T05:00:00Z");
    expect(deriveInvitationStatus({ is_active: true, expires_at: null, permanent: true }, now)).toBe("pending");
    // A missing date with no flag is still an unknown, and unknown never becomes usable.
    expect(deriveInvitationStatus({ is_active: true, expires_at: null }, now)).toBe("expired");
    expect(deriveInvitationStatus({ is_active: true, expires_at: null, permanent: false }, now)).toBe("expired");
    // Permanent never outranks the states that end a link, in the server's order.
    expect(deriveInvitationStatus({ used_at: "x", is_active: true, permanent: true }, now)).toBe("accepted");
    expect(deriveInvitationStatus({ superseded_by: "y", is_active: false, permanent: true }, now)).toBe("superseded");
    expect(deriveInvitationStatus({ is_active: false, permanent: true }, now)).toBe("revoked");
  });

  it("keep single use and the same authority: create still goes through fn_invite_authorize and fn_invite_insert", () => {
    const create = fnBody("create_invitation");
    expect(create).toContain("v_auth := public.fn_invite_authorize(p_kind, p_target_role, p_target_manager_id,");
    expect(create).toContain("v_row := public.fn_invite_insert(p_kind, v_auth, p_expires_hours, v_email, p_recipient_name, v_prefill, p_notes);");
    expect(code).not.toMatch(/used_at\s*=\s*null/i);
  });
});

describe("one list per kind", () => {
  it("filters and counts by kind, refusing a kind it does not know", () => {
    const list = fnBody("list_invitations");
    expect(list).toContain("p_kind text default null");
    expect(list).toContain("if v_kind is not null and v_kind not in ('hire', 'join') then");
    expect(list).toContain("and (v_kind is null or t.kind = v_kind)");
    // The counts read the same scope the rows do, so a tab's number is its rows.
    expect(list.indexOf("and (v_kind is null or t.kind = v_kind)")).toBeLessThan(list.indexOf("counts as ("));
    expect(list).toContain("'license_status', case when t.prefill_json->>'license_status' in ('licensed', 'unlicensed')");
  });
});

describe("grants", () => {
  it("drop the old signatures so PostgREST has exactly one candidate, and grant the new ones as before", () => {
    expect(code).toContain("drop function if exists public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text);");
    expect(code).toContain("drop function if exists public.list_invitations(boolean, text, integer);");
    expect(code).toContain("revoke all on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text, boolean) from public, anon;");
    expect(code).toContain("grant execute on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text, boolean) to authenticated, service_role;");
    expect(code).toContain("revoke all on function public.list_invitations(boolean, text, integer, text) from public, anon;");
    expect(code).toContain("grant execute on function public.list_invitations(boolean, text, integer, text) to authenticated, service_role;");
  });

  it("keep the recipient's prefill public by replacing it in place (same signature, same grants)", () => {
    expect(code).not.toMatch(/drop function[^;]*get_invite_token_prefill/);
    expect(code).not.toMatch(/(revoke|grant)[^;]*get_invite_token_prefill/);
    expect(fnBody("get_invite_token_prefill")).not.toMatch(/'token',/);
  });

  it("is additive: no table drops, truncates or row deletes, and /r/<slug> links are untouched", () => {
    expect(code).not.toMatch(/\bdrop\s+table\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toContain("ref_slug");
  });
});
