/**
 * OVERHAUL-states (2026-10-30): pins supabase/migrations/20261030120000_book_lead_states.sql to itself and to
 * the page, so the pieces that must agree cannot drift:
 *   - v_book_of_business and lead_state_yield() read a book row's client phone with the very same lookup
 *     (the two "book-row-phone" / "book-row-joins" blocks are identical text);
 *   - the view keeps every column it had, in order, and only adds the two state columns at the end;
 *   - the area code table is every US geographic code once, with a state the page knows, and never
 *     contradicts the client-side table Book Flips and the call screen already use (inferStateFromPhone);
 *   - us_state_code() accepts exactly the 50 states and DC the page knows.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATE_CODES } from "@/lib/leadStates";
import { inferStateFromPhone } from "@/lib/inboundLeads";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20261030120000_book_lead_states.sql"),
  "utf8",
);

function blocks(name: string): string[] {
  const re = new RegExp(`-- ${name}: begin\\n([\\s\\S]*?)\\n\\s*-- ${name}: end`, "g");
  return [...migration.matchAll(re)].map((m) => m[1]);
}

describe("one way to read a book row's phone", () => {
  it("the view and lead_state_yield() use the same phone expression and the same joins", () => {
    const phone = blocks("book-row-phone");
    const joins = blocks("book-row-joins");
    expect(phone).toHaveLength(2);
    expect(joins).toHaveLength(2);
    expect(phone[0]).toBe(phone[1]);
    expect(joins[0]).toBe(joins[1]);
    // The client must match as well as the policy number (72 numbers are shared by more than one client).
    expect(joins[0]).toContain("dp.client_key = public.book_flip_client_key(book.client_name, null::integer, null::text)");
  });

  it("never exposes the phone: the view's columns are the old fifteen, then the client's state and its source", () => {
    const m = migration.match(/create or replace view public\.v_book_of_business\s+with \(security_barrier = true\) as\s+select ([\s\S]*?)\nfrom \(/);
    expect(m).not.toBeNull();
    const cols = (m?.[1] ?? "").split(",").map((c) => c.trim().replace(/^q\./, ""));
    expect(cols).toEqual([
      "row_key", "origin", "agent_id", "agent_name", "client_name", "carrier", "product", "policy_number",
      "annual_premium", "posted_date", "effective_date", "status", "synced_at", "status_key", "standing",
      "client_state", "client_state_source",
    ]);
  });

  it("keeps the scope rule the book already had", () => {
    expect(migration.replace(/\s+/g, " ")).toContain(
      "where current_user <> all (array['anon'::name, 'authenticated'::name]) or (select public.api_is_full_reader()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[]);",
    );
  });

  it("only full-book readers can read the lead lists, and nobody signed out can call anything", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.lead_state_yield()"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/if not coalesce\(public\.api_is_full_reader\(\), false\) then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(migration).toContain("revoke all on function public.lead_state_yield() from public, anon;");
    expect(migration).toContain("revoke all on function public.book_state_summary(uuid[]) from public, anon;");
    expect(migration).toContain("revoke all on table public.us_area_codes from public, anon, authenticated;");
    expect(migration.slice(migration.indexOf("create or replace function public.book_state_summary"))).toMatch(/^[\s\S]*?security invoker/);
  });
});

describe("the area code table", () => {
  const values = migration.slice(migration.indexOf("insert into public.us_area_codes"), migration.indexOf("on conflict (area_code)"));
  const pairs = [...values.matchAll(/\('(\d{3})', '([A-Z]{2})'\)/g)].map((m) => [m[1], m[2]] as const);

  it("lists every geographic US area code once, each with a state the page knows", () => {
    expect(pairs.length).toBe(349);
    expect(new Set(pairs.map(([code]) => code)).size).toBe(pairs.length);
    for (const [code, state] of pairs) {
      expect(code).toMatch(/^[2-9][0-9]{2}$/);
      expect(STATE_CODES.has(state)).toBe(true);
    }
    expect(new Set(pairs.map(([, state]) => state))).toEqual(STATE_CODES);
  });

  it("leaves out toll-free, Canadian and territory codes, so they read as not known", () => {
    const codes = new Set(pairs.map(([code]) => code));
    for (const code of ["800", "888", "877", "866", "855", "844", "833", "787", "939", "416", "604", "671", "340"]) {
      expect(codes.has(code)).toBe(false);
    }
  });

  it("never contradicts the client-side table Book Flips and the call screen use", () => {
    const disagreements = pairs.filter(([code, state]) => {
      const theirs = inferStateFromPhone(`${code}5550100`);
      return theirs !== null && theirs !== state;
    });
    expect(disagreements).toEqual([]);
  });
});

describe("us_state_code()", () => {
  it("accepts exactly the 50 states and DC", () => {
    const list = migration.match(/pg_catalog\.upper\(pg_catalog\.btrim\(p_value\)\) in \(([\s\S]*?)\)\s+then/);
    const codes = new Set([...(list?.[1] ?? "").matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]));
    expect(codes).toEqual(STATE_CODES);
  });
});
