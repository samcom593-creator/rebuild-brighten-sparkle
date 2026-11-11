import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { flagBadges } from "@/lib/leadBundles";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

// MP-LEAD-PHONE-READYMODE (2026-11-10): Sam — "use the lead's number straight from
// ReadyMode" to fix pickup. Floyd Harris and Terry Lonsway were already marked
// no_answer on the book's number; ReadyMode's number is the one they bought on.
describe("ReadyMode number on dropped leads", () => {
  it("badges a lead whose dial number came from ReadyMode", () => {
    const labels = flagBadges({ readymode_number: true }, false).map((b) => b.label);
    expect(labels).toContain("ReadyMode number");
  });

  it("never badges the replaced number itself (text values are not flags)", () => {
    const labels = flagBadges({ readymode_number: false, replaced_phone10: "5551234567" }, false);
    expect(labels).toHaveLength(0);
  });

  it("My Leads tells the agent which book number was replaced", () => {
    const page = read("src/pages/MyLeads.tsx");
    expect(page).toContain('data-testid="replaced-number-note"');
    expect(page).toContain("cur.attrs.replaced_phone10");
  });

  const sql = read("supabase/migrations/20261110230000_lead_phone_readymode.sql");

  it("re-write dials the linked ReadyMode call's number first, not the typed packet phone", () => {
    expect(sql).toMatch(/COALESCE\(dc\.lead_phone10, NULLIF\("right"\(regexp_replace\(COALESCE\(p\.client_phone/);
  });

  it("a name match alone never swaps: ReadyMode must have REACHED them and the pool number never answered", () => {
    expect(sql).toContain("where ev.reached and not exists (select 1 from dnc_p d where d.p = ev.p)");
    expect(sql).toContain("and not exists (select 1 from reached_p r where r.p = s.from_p)");
    for (const reason of ["'typo'", "'sale_matches_deal'", "'unique_name_same_area'", "'pool_number_missing'"]) {
      expect(sql).toContain(reason);
    }
    expect(sql).toContain("where reason is not null");
  });

  it("the admin sample strips the replaced number and the client file follows it back to the source", () => {
    expect(sql).toContain("flags - 'replaced_phone10' AS flags");
    expect(sql).toContain("coalesce(v.attrs->>'replaced_phone10', v.phone10)");
    expect(sql).toContain("refresh materialized view concurrently public.mat_lead_phone_fix;\n  refresh materialized view concurrently public.mat_lead_pool;");
  });
});

describe("packs already handed out keep up with new ReadyMode evidence (MP-LEAD-PHONE-READYMODE-b)", () => {
  const sql = read("supabase/migrations/20261111020000_pack_phone_autorepair.sql");
  it("every snapshot refresh repairs live pack items after rebuilding the evidence", () => {
    expect(sql).toContain("refresh materialized view concurrently public.mat_lead_pool;\n  -- MP-LEAD-PHONE-READYMODE-b");
    expect(sql).toContain("perform public.fn_repair_pack_phones();");
  });
  it("never overwrites an item another live pack already holds, and requeues no-answers", () => {
    expect(sql).toContain("where i.id = fix.id and not fix.collides");
    expect(sql).toContain("when i.status in ('no_answer', 'wrong_number') then 'new'");
  });
});
