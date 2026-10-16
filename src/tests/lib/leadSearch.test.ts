/**
 * leadSearch (F30): a failed lookup is an error, never "no match"; typed text
 * is quoted and LIKE-escaped before it enters a PostgREST .or() filter; the
 * duplicate check is an exact match that prefers the row the server calls
 * canonical; and an older response can never replace a newer request's.
 *
 * The stub client has no maybeSingle and no ilike, so a regression to either
 * surfaces as a thrown TypeError, never a silent null.
 */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_LOOKUP_LIMIT,
  LEAD_COLUMNS,
  LEAD_SEARCH_LIMIT,
  createLatestGuard,
  emailMatchValues,
  fetchLeadById,
  findExistingApplicants,
  leadSearchFilter,
  orderCanonicalFirst,
  phoneMatchValues,
  quoteFilterValue,
  searchLeads,
  unresolvedCanonicalIds,
  type LeadResult,
  type LeadSearchClient,
} from "@/lib/leadSearch";

type Result = { data: unknown; error: unknown };

function stubClient(results: Array<Result | Error>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  let i = 0;
  const from = (table: string) => {
    const call = { table, filters: [] as string[] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      call.filters.push(`${name}(${args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a))).join(",")})`);
      return q;
    };
    Object.assign(q, {
      select: chain("select"),
      or: chain("or"),
      is: chain("is"),
      in: chain("in"),
      eq: chain("eq"),
      order: chain("order"),
      limit: chain("limit"),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        const r = results[i++];
        if (r === undefined) return Promise.reject(new Error("stub exhausted: unexpected extra query")).then(resolve, reject);
        if (r instanceof Error) return Promise.reject(r).then(resolve, reject);
        return Promise.resolve(r).then(resolve, reject);
      },
    });
    return q;
  };
  return { client: { from } as unknown as LeadSearchClient, calls, queries: () => i };
}

function lead(patch: Partial<LeadResult> & { id: string }): LeadResult {
  return {
    first_name: "Synthetic",
    last_name: "Person",
    email: "synthetic.person@example.com",
    phone: "6015550100",
    status: "new",
    is_duplicate: null,
    duplicate_of: null,
    ...patch,
  };
}

const ok = (rows: LeadResult[]): Result => ({ data: rows, error: null });
const failed: Result = { data: null, error: { message: "connection reset", code: "57014" } };

describe("leadSearchFilter: typed text is searched for, not interpreted", () => {
  it("is empty below the minimum length, after trimming", () => {
    expect(leadSearchFilter("")).toBe("");
    expect(leadSearchFilter("a")).toBe("");
    expect(leadSearchFilter("  a  ")).toBe("");
  });

  it("builds the same quoted contains-pattern for every searched column", () => {
    expect(leadSearchFilter("jo")).toBe(
      'first_name.ilike."%jo%",last_name.ilike."%jo%",email.ilike."%jo%",phone.ilike."%jo%"',
    );
  });

  it("keeps a comma or parenthesis inside the quotes instead of breaking the filter list", () => {
    const filter = leadSearchFilter("Smith, John (jr)");
    expect(filter.split(",ilike").length).toBe(1);
    expect(filter).toContain('first_name.ilike."%Smith, John (jr)%"');
    expect(filter.split('",').length).toBe(4);
  });

  it("escapes the LIKE metacharacters, including the * PostgREST rewrites to %", () => {
    expect(leadSearchFilter("50%_*")).toContain('.ilike."%50\\\\%\\\\_\\\\*%"');
  });

  it("escapes a backslash and a double quote for the quoted value", () => {
    expect(quoteFilterValue('a\\b"c')).toBe('"a\\\\b\\"c"');
    expect(leadSearchFilter("O\"Neil")).toContain('.ilike."%O\\"Neil%"');
  });
});

describe("searchLeads", () => {
  it("sends one bounded query with the filter and the live-rows guard, and never calls maybeSingle", async () => {
    const { client, calls, queries } = stubClient([ok([lead({ id: "l1" })])]);
    const out = await searchLeads(client, " jo ");
    expect(out).toEqual({ status: "ready", rows: [expect.objectContaining({ id: "l1" })] });
    expect(queries()).toBe(1);
    expect(calls[0].table).toBe("applications");
    expect(calls[0].filters).toEqual([
      `select(${LEAD_COLUMNS})`,
      `or(${leadSearchFilter("jo")})`,
      "is(terminated_at,null)",
      `limit(${LEAD_SEARCH_LIMIT})`,
    ]);
  });

  it("refuses text that is too short instead of reporting an empty match", async () => {
    const { client, queries } = stubClient([]);
    expect(await searchLeads(client, "j")).toEqual({ status: "short" });
    expect(queries()).toBe(0);
  });

  it("a PostgREST error is an error, never an empty result", async () => {
    const { client } = stubClient([failed]);
    const out = await searchLeads(client, "jo");
    expect(out.status).toBe("error");
    expect(out).toEqual({ status: "error", error: failed.error });
  });

  it("a thrown transport error and a non-array body are errors too", async () => {
    expect((await searchLeads(stubClient([new Error("Failed to fetch")]).client, "jo")).status).toBe("error");
    expect((await searchLeads(stubClient([{ data: null, error: null }]).client, "jo")).status).toBe("error");
  });

  it("a completed read with no rows is the only way to get ready with nothing", async () => {
    expect(await searchLeads(stubClient([ok([])]).client, "zz")).toEqual({ status: "ready", rows: [] });
  });
});

describe("createLatestGuard", () => {
  it("only the newest request is latest, so an older response is discarded", () => {
    const guard = createLatestGuard();
    const first = guard.next();
    const second = guard.next();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });

  it("invalidate makes every in-flight request stale", () => {
    const guard = createLatestGuard();
    const seq = guard.next();
    guard.invalidate();
    expect(guard.isLatest(seq)).toBe(false);
  });
});

describe("match values are exact spellings, not patterns", () => {
  it("email: as typed plus lower-cased when that differs", () => {
    expect(emailMatchValues("  Jo.Smith@Example.com ")).toEqual(["Jo.Smith@Example.com", "jo.smith@example.com"]);
    expect(emailMatchValues("jo@example.com")).toEqual(["jo@example.com"]);
    expect(emailMatchValues("   ")).toEqual([]);
  });

  it("phone: the stored spellings of a ten-digit number, plus the text as typed", () => {
    expect(phoneMatchValues("(601) 555-0100")).toEqual(["(601) 555-0100", "6015550100", "16015550100", "+16015550100"]);
    expect(phoneMatchValues("+1 601 555 0100")).toEqual(["+1 601 555 0100", "16015550100", "6015550100", "+16015550100"]);
    expect(phoneMatchValues("6015550100")).toEqual(["6015550100", "16015550100", "+16015550100"]);
  });

  it("phone: a short or non-numeric value is compared only as typed and as its digits", () => {
    expect(phoneMatchValues("555-0100")).toEqual(["555-0100", "5550100"]);
    expect(phoneMatchValues("n/a")).toEqual(["n/a"]);
    expect(phoneMatchValues("")).toEqual([]);
  });

  it("no value ever contains a LIKE wildcard added by the helper", () => {
    for (const v of [...emailMatchValues("A@b.com"), ...phoneMatchValues("(601) 555-0100")]) expect(v).not.toMatch(/[%*]/);
  });
});

describe("canonical ordering", () => {
  it("puts unflagged rows first and keeps the input order inside each group", () => {
    const rows = [
      lead({ id: "dup1", is_duplicate: true, duplicate_of: "c1" }),
      lead({ id: "c1" }),
      lead({ id: "c2", is_duplicate: false }),
      lead({ id: "dup2", is_duplicate: true, duplicate_of: null }),
    ];
    expect(orderCanonicalFirst(rows).map((r) => r.id)).toEqual(["c1", "c2", "dup1", "dup2"]);
  });

  it("lists pointer targets that are not already present, once each", () => {
    const rows = [
      lead({ id: "dup1", is_duplicate: true, duplicate_of: "c9" }),
      lead({ id: "dup2", is_duplicate: true, duplicate_of: "c9" }),
      lead({ id: "dup3", is_duplicate: true, duplicate_of: "c1" }),
      lead({ id: "c1" }),
      lead({ id: "dup4", is_duplicate: true, duplicate_of: null }),
    ];
    expect(unresolvedCanonicalIds(rows)).toEqual(["c9"]);
  });
});

describe("findExistingApplicants", () => {
  it("queries email then phone with exact .in() lists on live rows, oldest first, bounded", async () => {
    const { client, calls, queries } = stubClient([ok([]), ok([])]);
    const out = await findExistingApplicants(client, { email: "Jo@Example.com", phone: "6015550100" });
    expect(out).toEqual({ status: "none" });
    expect(queries()).toBe(2);
    expect(calls[0].filters).toEqual([
      `select(${LEAD_COLUMNS})`,
      "is(terminated_at,null)",
      'in(email,["Jo@Example.com","jo@example.com"])',
      'order(created_at,{"ascending":true})',
      `limit(${DUPLICATE_LOOKUP_LIMIT})`,
    ]);
    expect(calls[1].filters[2]).toBe('in(phone,["6015550100","16015550100","+16015550100"])');
    expect(calls.flatMap((c) => c.filters).join(" ")).not.toMatch(/ilike|maybeSingle/);
  });

  it("skips the phone read when no phone was given", async () => {
    const { client, queries } = stubClient([ok([])]);
    expect(await findExistingApplicants(client, { email: "jo@example.com", phone: "" })).toEqual({ status: "none" });
    expect(queries()).toBe(1);
  });

  it("a failed email read is an error, never none, and stops before the phone read", async () => {
    const { client, queries } = stubClient([failed]);
    const out = await findExistingApplicants(client, { email: "jo@example.com", phone: "6015550100" });
    expect(out.status).toBe("error");
    expect(queries()).toBe(1);
  });

  it("a failed phone read is an error even when the email read matched nothing", async () => {
    const { client } = stubClient([ok([]), new Error("Failed to fetch")]);
    const out = await findExistingApplicants(client, { email: "jo@example.com", phone: "6015550100" });
    expect(out.status).toBe("error");
  });

  it("returns email matches first, canonical before flagged, and says the match was by email", async () => {
    const { client } = stubClient([
      ok([lead({ id: "dup1", is_duplicate: true, duplicate_of: "c1" }), lead({ id: "c1" })]),
      ok([lead({ id: "p1", phone: "6015550100" })]),
    ]);
    const out = await findExistingApplicants(client, { email: "jo@example.com", phone: "6015550100" });
    expect(out.status).toBe("found");
    if (out.status !== "found") return;
    expect(out.byEmail).toBe(true);
    expect(out.matches.map((m) => [m.id, m.matchedOn])).toEqual([["c1", "email"], ["p1", "phone"], ["dup1", "email"]]);
  });

  it("follows a flagged row's pointer one hop and lists the canonical row first", async () => {
    const { client, calls, queries } = stubClient([
      ok([lead({ id: "dup1", is_duplicate: true, duplicate_of: "c9" })]),
      ok([]),
      ok([lead({ id: "c9", email: "jo@example.com" })]),
    ]);
    const out = await findExistingApplicants(client, { email: "jo@example.com", phone: "6015550100" });
    expect(queries()).toBe(3);
    expect(calls[2].filters[1]).toBe('in(id,["c9"])');
    expect(out).toEqual({
      status: "found",
      byEmail: true,
      matches: [expect.objectContaining({ id: "c9", matchedOn: "email" }), expect.objectContaining({ id: "dup1", matchedOn: "email" })],
    });
  });

  it("a failed pointer read is an error, not a found list missing its canonical row", async () => {
    const { client } = stubClient([ok([lead({ id: "dup1", is_duplicate: true, duplicate_of: "c9" })]), ok([]), failed]);
    expect((await findExistingApplicants(client, { email: "jo@example.com", phone: "6015550100" })).status).toBe("error");
  });

  it("a phone-only match is reported as not by email", async () => {
    const { client } = stubClient([ok([]), ok([lead({ id: "p1" })])]);
    const out = await findExistingApplicants(client, { email: "new@example.com", phone: "6015550100" });
    expect(out).toEqual({ status: "found", byEmail: false, matches: [expect.objectContaining({ id: "p1", matchedOn: "phone" })] });
  });
});

describe("fetchLeadById", () => {
  it("reads one row by primary key without maybeSingle", async () => {
    const { client, calls } = stubClient([ok([lead({ id: "c1" })])]);
    expect(await fetchLeadById(client, "c1")).toEqual({ status: "ready", lead: expect.objectContaining({ id: "c1" }) });
    expect(calls[0].filters).toEqual([`select(${LEAD_COLUMNS})`, "eq(id,c1)", "limit(1)"]);
  });

  it("distinguishes a missing row from a failed read", async () => {
    expect(await fetchLeadById(stubClient([ok([])]).client, "c1")).toEqual({ status: "ready", lead: null });
    expect((await fetchLeadById(stubClient([failed]).client, "c1")).status).toBe("error");
  });
});
