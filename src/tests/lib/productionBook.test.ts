/**
 * productionBook (F08 / F09 / F11, 2026-10-15): the contracts behind the
 * Production page, plus the source pins that keep src/pages/MyDeals.tsx on
 * them. The status-bucket mapping is asserted against the CASE read from
 * public.v_book_status_tiles on 2026-10-15, where an ILIKE filter on these
 * literals reproduced all ten tile counts exactly (1,073 / 170 / 119 / 4 / 0 x6).
 *
 * Review fix (2026-10-15): the first cut continued the list only after a page
 * of 3,000 rows, but PostgREST here answers at most 1,000 rows per request, so
 * "Load more" never appeared and 373 of 1,373 deals could not be reached. The
 * continuation tests below are written against that real cap.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENCY_PERIODS,
  DEALS_PAGE_SIZE,
  STATUS_BUCKETS,
  STATUS_BUCKET_LITERALS,
  agencyPeriodMeasure,
  agencyPeriodRange,
  agencyPeriodRangeLabel,
  countStatusBucketsInScope,
  dealsCursorAfter,
  dealsPageCursorFilter,
  dealsPageMayContinue,
  formatDateKey,
  parseStatusBucket,
  quoteFilterValue,
  splitStatusTiles,
  statusBucketFilter,
  summarizeAgencyPeriod,
  type AgencyPeriodRow,
  type ProductionBookClient,
  type StatusBucket,
} from "@/lib/productionBook";

const page = fs.readFileSync(path.resolve(__dirname, "../../pages/MyDeals.tsx"), "utf8");

describe("PostgREST filter quoting", () => {
  it("wraps values in double quotes and escapes quotes and backslashes", () => {
    expect(quoteFilterValue("in review")).toBe('"in review"');
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(quoteFilterValue("agentcloud:2026-09-01:29e2bf30:1")).toBe('"agentcloud:2026-09-01:29e2bf30:1"');
  });
});

describe("keyset cursor for the unified book (posted_date desc nulls last, row_key asc)", () => {
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

describe("status buckets mirror v_book_status_tiles", () => {
  it("claims exactly the literals the view's CASE claims (read 2026-10-15)", () => {
    expect(STATUS_BUCKET_LITERALS).toEqual({
      active: ["active"],
      issued_not_paid: ["issued", "approved"],
      in_review: ["in review", "pending", "submitted"],
      lapse_pending: ["lapse pending"],
      lapsed: ["lapsed"],
      cancelled: ["cancelled"],
      withdrawn: ["withdrawn"],
      not_taken: ["not taken", "declined"],
      postponed: ["postponed"],
    });
    expect(Object.values(STATUS_BUCKET_LITERALS).flat()).toHaveLength(13);
    expect(STATUS_BUCKETS).toHaveLength(10);
    expect(STATUS_BUCKETS[STATUS_BUCKETS.length - 1]).toBe("carrier_na");
  });

  it("a named bucket is a case-insensitive equality on each of its literals", () => {
    expect(statusBucketFilter("active")).toBe('status.ilike."active"');
    expect(statusBucketFilter("in_review")).toBe('status.ilike."in review",status.ilike."pending",status.ilike."submitted"');
    expect(statusBucketFilter("issued_not_paid")).toBe('status.ilike."issued",status.ilike."approved"');
  });

  it("carrier_na is the ELSE branch: null status, or none of the thirteen claimed literals", () => {
    const filter = statusBucketFilter("carrier_na");
    expect(filter.startsWith("status.is.null,and(")).toBe(true);
    expect(filter.endsWith(")")).toBe(true);
    const terms = filter.match(/status\.not\.ilike\."[^"]+"/g) ?? [];
    expect(terms).toHaveLength(13);
    for (const literal of Object.values(STATUS_BUCKET_LITERALS).flat()) {
      expect(filter).toContain(`status.not.ilike."${literal}"`);
    }
  });

  it("no filter literal carries a LIKE wildcard, so ILIKE is an equality", () => {
    for (const literal of Object.values(STATUS_BUCKET_LITERALS).flat()) {
      expect(literal).not.toMatch(/[%_*]/);
    }
  });

  it("only known buckets come back from an untrusted value", () => {
    expect(parseStatusBucket("in_review")).toBe("in_review");
    expect(parseStatusBucket("carrier_na")).toBe("carrier_na");
    expect(parseStatusBucket("ACTIVE")).toBeNull();
    expect(parseStatusBucket("status.ilike.%")).toBeNull();
    expect(parseStatusBucket("")).toBeNull();
    expect(parseStatusBucket(null)).toBeNull();
    expect(parseStatusBucket(undefined)).toBeNull();
  });
});

describe("folding empty status tiles", () => {
  const tiles = STATUS_BUCKETS.map((key) => ({ key }));
  const live: Partial<Record<StatusBucket, number>> = { carrier_na: 1073, in_review: 170, active: 119, issued_not_paid: 4 };
  const countOf = (key: StatusBucket) => live[key] ?? 0;

  it("shows buckets with rows and folds the rest, in the canonical order", () => {
    const { shown, folded } = splitStatusTiles(tiles, countOf, null);
    expect(shown.map((t) => t.key)).toEqual(["active", "issued_not_paid", "in_review", "carrier_na"]);
    expect(folded.map((t) => t.key)).toEqual(["lapse_pending", "lapsed", "cancelled", "withdrawn", "not_taken", "postponed"]);
  });

  it("keeps the active filter visible even when its bucket is empty", () => {
    const { shown, folded } = splitStatusTiles(tiles, countOf, "lapsed");
    expect(shown.map((t) => t.key)).toContain("lapsed");
    expect(folded.map((t) => t.key)).not.toContain("lapsed");
  });

  it("never folds everything: an all-empty book shows every tile", () => {
    const { shown, folded } = splitStatusTiles(tiles, () => 0, null);
    expect(shown).toHaveLength(10);
    expect(folded).toHaveLength(0);
  });
});

describe("Production by Agency: one period drives amount, bar, sort and total", () => {
  // Live rows on 2026-10-15 (v_imo_by_agency).
  const apex: AgencyPeriodRow = { agency: "APEX Financial", is_primary: true, policies: 1319, alp: 1850750, alp_mtd: 74184, policies_mtd: 43, policies_30d: 131, alp_30d: 220083 };
  const vantage: AgencyPeriodRow = { agency: "Vantage Financial", is_primary: false, policies: 41, alp: 63892, alp_mtd: 0, policies_mtd: 0, policies_30d: 14, alp_30d: 16156 };

  it("reads the matching columns per period", () => {
    expect(agencyPeriodMeasure(apex, "mtd")).toEqual({ alp: 74184, policies: 43 });
    expect(agencyPeriodMeasure(apex, "30d")).toEqual({ alp: 220083, policies: 131 });
    expect(agencyPeriodMeasure(apex, "all")).toEqual({ alp: 1850750, policies: 1319 });
  });

  it("this month: rows sum to the total and the bar follows the same number", () => {
    const s = summarizeAgencyPeriod([vantage, apex], "mtd");
    expect(s.total).toBe(74184);
    expect(s.policies).toBe(43);
    expect(s.rows.map((r) => r.agency)).toEqual(["APEX Financial", "Vantage Financial"]);
    expect(s.rows[0].alp).toBe(74184);
    expect(s.rows[0].share).toBe(1);
    expect(s.rows[1].alp).toBe(0);
    expect(s.rows[1].share).toBe(0);
    expect(s.rows.reduce((sum, r) => sum + (r.alp ?? 0), 0)).toBe(s.total);
  });

  it("all time: the same rows carry the all-time numbers and sort by them", () => {
    const s = summarizeAgencyPeriod([vantage, apex], "all");
    expect(s.total).toBe(1914642);
    expect(s.max).toBe(1850750);
    expect(s.rows[1].share).toBeCloseTo(63892 / 1850750, 6);
  });

  it("last 30 days: total is the 30-day sum, never the all-time or monthly one", () => {
    const s = summarizeAgencyPeriod([apex, vantage], "30d");
    expect(s.total).toBe(236239);
    expect(s.policies).toBe(145);
  });

  it("a null amount is not fabricated as zero: it sorts last, adds nothing and draws no bar", () => {
    const unknown: AgencyPeriodRow = { ...vantage, agency: "Unknown Agency", alp_mtd: null, policies_mtd: null };
    const s = summarizeAgencyPeriod([unknown, apex], "mtd");
    expect(s.total).toBe(74184);
    expect(s.rows[1].agency).toBe("Unknown Agency");
    expect(s.rows[1].alp).toBeNull();
    expect(s.rows[1].share).toBe(0);
  });

  it("covers the three periods the section offers", () => {
    expect(AGENCY_PERIODS.map((p) => p.key)).toEqual(["mtd", "30d", "all"]);
  });
});

describe("Production by Agency: explicit range labels from the Phoenix day key", () => {
  it("matches the view's inclusive bounds", () => {
    expect(agencyPeriodRange("mtd", "2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(agencyPeriodRange("30d", "2026-10-15")).toEqual({ start: "2026-09-15", end: "2026-10-15" });
    expect(agencyPeriodRange("all", "2026-10-15")).toBeNull();
  });

  it("formats keys without touching Date or a zone", () => {
    expect(formatDateKey("2026-10-01")).toBe("Oct 1");
    expect(formatDateKey("2026-10-01", true)).toBe("Oct 1, 2026");
    expect(formatDateKey("not-a-key")).toBe("not-a-key");
    expect(formatDateKey("2026-13-01")).toBe("2026-13-01");
  });

  it("labels each period, adding years only when the range crosses one", () => {
    expect(agencyPeriodRangeLabel("mtd", "2026-10-15")).toBe("Oct 1 to Oct 15");
    expect(agencyPeriodRangeLabel("30d", "2026-10-15")).toBe("Sep 15 to Oct 15");
    expect(agencyPeriodRangeLabel("30d", "2026-01-10")).toBe("Dec 11, 2025 to Jan 10, 2026");
    // All time has no bounds; the heading shows the period name once, not "All time · All time".
    expect(agencyPeriodRangeLabel("all", "2026-10-15")).toBeNull();
  });
});

type Call = { table: string; select?: [string, unknown]; in?: [string, unknown]; or?: string };

/** A stand-in for the Supabase client: records every chain and answers it from `answer`. */
function stubClient(answer: (call: Call) => { count: number | null; error: unknown }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table };
      calls.push(call);
      const q = {
        select(columns: string, options: unknown) {
          call.select = [columns, options];
          return q;
        },
        in(column: string, values: unknown) {
          call.in = [column, values];
          return q;
        },
        or(filter: string) {
          call.or = filter;
          return q;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(answer(call)).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as ProductionBookClient, calls };
}

describe("team-scoped status tile counts (F11 for managers)", () => {
  const team = ["agent-a", "agent-b"];
  const live: Partial<Record<StatusBucket, number>> = { carrier_na: 61, in_review: 9, active: 7, issued_not_paid: 1 };
  const bucketOf = (filter: string | undefined) => STATUS_BUCKETS.find((b) => statusBucketFilter(b) === filter);

  it("counts every bucket in the team's scope with the exact filter the list applies", async () => {
    const { client, calls } = stubClient((call) => ({ count: live[bucketOf(call.or) as StatusBucket] ?? 0, error: null }));
    const counts = await countStatusBucketsInScope(client, team);
    expect(counts).toEqual(STATUS_BUCKETS.map((bucket) => ({ bucket, n: live[bucket] ?? 0 })));
    expect(calls).toHaveLength(STATUS_BUCKETS.length);
    for (const call of calls) {
      expect(call.table).toBe("v_production_unified");
      expect(call.select).toEqual(["row_key", { count: "exact", head: true }]);
      expect(call.in).toEqual(["agent_id", team]);
    }
    expect(calls.map((call) => bucketOf(call.or))).toEqual([...STATUS_BUCKETS]);
  });

  it("a failed count rejects instead of showing that bucket as zero", async () => {
    const failure = { message: "permission denied", code: "42501" };
    const { client } = stubClient((call) => (bucketOf(call.or) === "lapsed" ? { count: null, error: failure } : { count: 3, error: null }));
    await expect(countStatusBucketsInScope(client, team)).rejects.toBe(failure);
  });

  it("a response without a count rejects", async () => {
    const { client } = stubClient(() => ({ count: null, error: null }));
    await expect(countStatusBucketsInScope(client, team)).rejects.toThrow("did not return a count");
  });

  it("an empty scope has no rows: zeros, and no read", async () => {
    const { client, calls } = stubClient(() => ({ count: 99, error: null }));
    const counts = await countStatusBucketsInScope(client, []);
    expect(counts.every((c) => c.n === 0)).toBe(true);
    expect(counts).toHaveLength(STATUS_BUCKETS.length);
    expect(calls).toHaveLength(0);
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

  it("renders status tiles as pressed-state filters built from the shared bucket map (F11)", () => {
    expect(page).toContain("aria-pressed={isActive}");
    expect(page).toContain("statusBucketFilter(");
    expect(page).toContain("parseStatusBucket(");
    expect(page).toContain("splitStatusTiles(");
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

  it("counts a manager's status tiles in the list's scope, keeping the agency view for admins (F11)", () => {
    expect(page).toContain("countStatusBucketsInScope(supabase, scopedAgentIds)");
    expect(page).toContain('supabase.from("v_book_status_tiles")');
    expect(page).toContain('"Counts for your team."');
  });

  it("labels the agency-wide totals as agency-wide and never invents an average (F10)", () => {
    expect(page).toContain("Agency-wide totals");
    expect(page).not.toContain("RLS gives admins the agency and managers only their team");
    expect(page).not.toContain("Math.round(book.premium_30d / book.deals_30d) : 0");
  });

  it("dates the attribution read from the Phoenix day key, not the browser's UTC date", () => {
    expect(page).toContain("shiftDateKey(todayKey, 2)");
    expect(page).not.toContain("new Date(Date.now()");
  });

  it("drives Production by Agency from one period with an explicit range (F08)", () => {
    expect(page).toContain("summarizeAgencyPeriod(");
    expect(page).toContain("agencyPeriodRangeLabel(");
    expect(page).not.toContain("imoMtdTotal");
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

  it("keeps the MP-304 sold-call packet in every expanded deal row (lost in the first rewrite)", () => {
    expect(page).toContain('import { SoldCallPanel } from "@/components/clients/SoldCallPanel";');
    // Rendered as a component inside the expanded-row branch, not merely mentioned.
    const expanded = page.match(/\{isOpen && \(\s*<>([\s\S]*?)<\/>\s*\)\}/);
    expect(expanded?.[1]).toMatch(/<SoldCallPanel\s/);
    expect(page).toContain('firstName={(d.client_name || "").trim().split(/\\s+/)[0]}');
    expect(page).toContain('lastName={(d.client_name || "").trim().split(/\\s+/).slice(1).join(" ")}');
    // DealRowItem draws both the list rows and the pinned deep-link row, so both carry the panel.
    expect(page.match(/<DealRowItem/g) ?? []).toHaveLength(2);
  });

  it("does not say it is still looking for a deep-linked deal after the list failed", () => {
    expect(page).toContain("That deal cannot be looked up until the list loads.");
  });
});
