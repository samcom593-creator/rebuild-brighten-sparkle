/**
 * productionBook (F09, 2026-10-15): the paging contract behind the Book of
 * Business page, plus the source pins that keep src/pages/MyDeals.tsx on it.
 *
 * Review fix (2026-10-15): the first cut continued the list only after a page
 * of 3,000 rows, but PostgREST here answers at most 1,000 rows per request, so
 * "Load more" never appeared and 373 of 1,373 deals could not be reached. The
 * continuation tests below are written against that real cap.
 *
 * OVERHAUL-book (2026-10-29): the page leads with who is on the books (Active,
 * Pending, Lapsing, Gone) from v_book_of_business and book_of_business_counts();
 * the production totals, the ten status tiles and Production by Agency are gone,
 * and their pins went with them. The pins below say what replaced them.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEALS_PAGE_SIZE,
  dealsCursorAfter,
  dealsPageCursorFilter,
  dealsPageMayContinue,
  quoteFilterValue,
} from "@/lib/productionBook";

const page = fs.readFileSync(path.resolve(__dirname, "../../pages/MyDeals.tsx"), "utf8");
const count = (needle: string) => page.split(needle).length - 1;

describe("PostgREST filter quoting", () => {
  it("wraps values in double quotes and escapes quotes and backslashes", () => {
    expect(quoteFilterValue("in review")).toBe('"in review"');
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(quoteFilterValue("agentcloud:2026-09-01:29e2bf30:1")).toBe('"agentcloud:2026-09-01:29e2bf30:1"');
  });
});

describe("keyset cursor for the book (posted_date desc nulls last, row_key asc)", () => {
  it("after a dated row: earlier dates, same date with a later key, then the undated tail", () => {
    const cursor = dealsCursorAfter({ posted_date: "2026-10-01", row_key: "agentcloud:2026-10-01:abc:1" });
    expect(dealsPageCursorFilter(cursor)).toBe(
      'posted_date.lt."2026-10-01",and(posted_date.eq."2026-10-01",row_key.gt."agentcloud:2026-10-01:abc:1"),posted_date.is.null',
    );
  });

  it("after an undated row: only undated rows with a later key", () => {
    expect(dealsPageCursorFilter({ posted_date: null, row_key: "ffe532f2" })).toBe('and(posted_date.is.null,row_key.gt."ffe532f2")');
  });

  // The server caps a response at 1,000 rows whatever .limit() asks for, so a
  // page's length alone cannot say whether more rows exist. The page carries
  // the server's exact count of rows matching from its cursor on.
  it("a page the server cut short continues (the F09 failure: 1,000 of 1,373)", () => {
    expect(dealsPageMayContinue(1000, 1373)).toBe(true);
    // The old rule asked for a page of DEALS_PAGE_SIZE rows, which never arrives.
    expect(1000).toBeLessThan(DEALS_PAGE_SIZE);
  });

  it("the page holding the last matching rows ends the list, with no extra request", () => {
    expect(dealsPageMayContinue(373, 373)).toBe(false);
    expect(dealsPageMayContinue(1000, 1000)).toBe(false);
    expect(dealsPageMayContinue(999, 999)).toBe(false);
  });

  it("an empty page always ends the list, whatever the count says", () => {
    expect(dealsPageMayContinue(0, 0)).toBe(false);
    expect(dealsPageMayContinue(0, 12)).toBe(false);
    expect(dealsPageMayContinue(0, null)).toBe(false);
  });

  it("without a count, a non-empty page continues so the list can over-ask once but never stop early", () => {
    expect(dealsPageMayContinue(1000, null)).toBe(true);
    expect(dealsPageMayContinue(1, null)).toBe(true);
  });

  it("a count lower than the page (rows removed meanwhile) ends the list", () => {
    expect(dealsPageMayContinue(1000, 990)).toBe(false);
  });
});

describe("src/pages/MyDeals.tsx keeps the contracts", () => {
  it("reads the book in server pages of DEALS_PAGE_SIZE with a deterministic order and a keyset cursor (F09)", () => {
    expect(page).toContain(`.limit(${DEALS_PAGE_SIZE})`);
    expect(page).toContain('.order("posted_date", { ascending: false, nullsFirst: false })');
    expect(page).toContain('.order("row_key", { ascending: true })');
    expect(page).toContain("dealsPageCursorFilter(");
    expect(page).toContain("fetchNextPage");
    // The old control said "Show all" while only widening the DOM window over
    // the loaded array. The honest labels are "Show all loaded" and "Load more".
    expect(page).not.toMatch(/>\s*Show all\s*<\/Button>/);
    expect(page).toContain("Show all loaded");
    expect(page).toContain('"Load more"');
  });

  it("continues on the server's count, not on the page length, and never ends a short list silently (F09)", () => {
    expect(page).toContain('.select("*", { count: "exact" })');
    expect(page).toContain("dealsPageMayContinue(lastPage.rows.length, lastPage.matching)");
    expect(page).not.toMatch(/dealsPageMayContinue\(lastPage\.length\)/);
    // Fewer rows loaded than the exact count, with no next page known: say so, offer a reload.
    expect(page).toContain("deals.length < countQuery.data");
    expect(page).toContain("shortLoaded) && (");
    expect(page).toContain('"Reload list"');
  });

  it("looks a deep-linked deal up by row_key inside the same scope instead of blaming permissions (F09)", () => {
    expect(page).toContain('.eq("row_key", key)');
    expect(page).not.toContain("outside your downline");
  });

  it("never defaults an unread book to an empty list or a zero count (F10)", () => {
    expect(page).not.toContain("data: deals = []");
    expect(page).not.toContain("data: totalDeals = 0");
    expect(page).toContain("describeQuery(");
    expect(page).toContain("<QueryState");
    expect(page).toContain("isEmpty: deals.length === 0");
  });

  it("resolves the agent row through the shared identity hook, never an earliest-row read (F17)", () => {
    expect(page).toContain("useAgentIdentity()");
    expect(page).not.toContain('.from("agents")');
    expect(page).not.toContain('.eq("user_id"');
  });

  it("reads a manager's team under the resolved row and shows a failed team read as an error (F10 / F17)", () => {
    expect(page).toContain("useResolvedDownline(me.identity, isTeamManager)");
    // useMyDownline logged a failed RPC and returned [], which listed the manager's own deals as the team's.
    expect(page).not.toContain("useMyDownline");
    expect(page).toContain('label="your team list"');
    expect(page).toContain("downline.ids !== undefined");
  });

  it("reads every list, count and lookup from v_book_of_business, the book with the policies that left it (OVERHAUL-book)", () => {
    // Rows, the exact count, the ?deal= lookup and the ?flip= lookup: one source.
    expect(count('.from("v_book_of_business")')).toBe(4);
    // The only other relation the page reads is the MP-310 dialer summary.
    expect(page.match(/\.from\("[a-z_]+"\)/g)?.filter((m) => m !== '.from("v_book_of_business")')).toEqual(['.from("v_book_row_call_summary")']);
    // v_production_unified drops every dead policy, so the people who left could never be listed.
    expect(page).not.toContain('"v_production_unified"');
  });

  it("filters the list and its count with the same standing and status filters, so a tile equals its list (OVERHAUL-book)", () => {
    expect(count('query = query.eq("standing", standing)')).toBe(2);
    expect(count('query = query.not("standing", "in", KNOWN_STANDINGS_IN_LIST)')).toBe(2);
    expect(count('query = query.eq("status_key", statusKey)')).toBe(2);
    expect(count('if (!fullBook) query = query.in("agent_id", scopedAgentIds)')).toBe(4);
    // The tiles: counted by the database in the same scope, the team list passed for a manager or agent.
    expect(page).toContain('supabase.rpc("book_of_business_counts", fullBook ? {} : { p_agent_ids: scopedAgentIds })');
    expect(page).toContain("summarizeStanding(");
    expect(page).toContain('"book-standing", productionScopeKey');
  });

  it("no longer carries the money sections Sam asked to remove (OVERHAUL-book)", () => {
    for (const gone of [
      "v_agentlink_book_truth", "v_imo_by_agency", "production_attribution_exceptions", "v_book_status_tiles",
      "Production by Agency", "Agency-wide totals", "Avg per deal", "Last 30 days", "Total book",
    ]) {
      expect({ gone, present: page.includes(gone) }).toEqual({ gone, present: false });
    }
  });

  it("keeps one Post a Deal entry on the page (the header action); the promotional card is gone (F37)", () => {
    expect(page.match(/<SubmitDealDialog/g) ?? []).toHaveLength(1);
    expect(page).not.toContain("Every deal, straight from the book.");
  });

  it("shows the page's Post a Deal below lg only, where the shell keeps its own copy in the Actions sheet (F37)", () => {
    // From lg up GlobalSidebar's rail always renders Post a Deal; a second one in the header duplicated it.
    expect(page).toContain("primaryAction={");
    expect(page).toContain('<Button className="h-11 gap-2 sm:h-10 lg:hidden">');
    expect(page).not.toContain("actions={<SubmitDealDialog />}");
  });

  it("keeps the MP-304 sold-call packet on the deal row itself, outside the expand (Sam 2026-10-15: nothing hidden)", () => {
    expect(page).toContain('import { SoldCallPanel } from "@/components/clients/SoldCallPanel";');
    // Rendered on the row, gated on a sold call being on file, and NOT inside the expanded-row branch.
    expect(page).toMatch(/\{soldCall && \(\s*<div[^>]*>\s*<SoldCallPanel\s/);
    const expanded = page.match(/\{isOpen && \(\s*<>([\s\S]*?)<\/>\s*\)\}/);
    expect(expanded?.[1] ?? "").not.toMatch(/<SoldCallPanel\s/);
    expect(page).toContain("const { firstName, lastName } = splitClientName(d.client_name);");
    // DealRowItem draws both the list rows and the pinned deep-link row, and both get the client details.
    expect(page.match(/<DealRowItem/g) ?? []).toHaveLength(2);
    expect(page.match(/client=\{clientDetails\.byKey\.get\(/g) ?? []).toHaveLength(2);
  });

  it("does not say it is still looking for a deep-linked deal after the list failed", () => {
    expect(page).toContain("That deal cannot be looked up until the list loads.");
  });
});
