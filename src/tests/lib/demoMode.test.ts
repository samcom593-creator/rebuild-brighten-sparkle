/**
 * Demo mode's contract, pinned.
 *
 * The failure that matters here is not "a number wasn't faked" — it is masking
 * something the app runs on. If an id, foreign key, timestamp, status or enum
 * gets rewritten, filters stop matching, routes 404, joins break and the demo
 * falls apart in front of whoever Sam is showing it to. Those assertions are
 * the point of this file; the "did it fake the money" ones are the easy half.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  maskPayload,
  maskIfDemo,
  setDemoMode,
  primeNames,
  getDemoPrimeState,
  subscribeDemoPrime,
} from "@/lib/demoMode";

const row = () => ({
  id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  agent_id: "11111111-2222-3333-4444-555555555555",
  policy_number: "AMH6327973",
  status: "active",
  license_status: "licensed",
  onboarding_stage: "in_field_training",
  is_manager: false,
  passed: true,
  created_at: "2026-08-01T12:00:00.000Z",
  effective_date: "2026-08-01",
  order_index: 3,
  video_watched_percent: 80,
  annual_premium: 2400.5,
  monthly_premium: 200,
  deals_closed: 7,
  first_name: "Xaviar",
  last_name: "Watts",
  display_name: "Xaviar Watts",
  email: "xaviar.watts@realdomain.com",
  phone: "(602) 555-1234",
});

describe("demo mode masking", () => {
  const masked = maskPayload(row()) as Record<string, unknown>;

  it("never rewrites identifiers — joins and routing depend on them", () => {
    expect(masked.id).toBe(row().id);
    expect(masked.agent_id).toBe(row().agent_id);
    expect(masked.policy_number).toBe(row().policy_number);
  });

  /**
   * The assertion that actually earns its place.
   *
   * The three above cannot fail: masking is opt-in by key pattern, so a uuid
   * string is untouched whether or not PROTECTED_KEY exists — deleting the
   * whole protected list left them green, which means they were pinning
   * nothing. The real collision is a NUMERIC foreign key whose name also
   * matches the money/count list: `deal_id` contains "deal",
   * `application_id` contains "application". Those WOULD be rewritten if
   * PROTECTED_KEY stopped winning, and a rewritten foreign key silently breaks
   * every join in the demo.
   */
  it("protects numeric foreign keys whose names collide with the money list", () => {
    const out = maskPayload({
      deal_id: 918273,
      application_id: 44556,
      lead_id: 7788,
      policy_count: 12,
    }) as Record<string, unknown>;

    expect(out.deal_id).toBe(918273);
    expect(out.application_id).toBe(44556);
    expect(out.lead_id).toBe(7788);
    // ...while a genuine count beside them is still masked.
    expect(out.policy_count).not.toBe(12);
  });

  it("never rewrites status, enums or booleans — filters depend on them", () => {
    expect(masked.status).toBe("active");
    expect(masked.license_status).toBe("licensed");
    expect(masked.onboarding_stage).toBe("in_field_training");
    expect(masked.is_manager).toBe(false);
    expect(masked.passed).toBe(true);
  });

  it("never rewrites dates or ordering/percent fields", () => {
    expect(masked.created_at).toBe(row().created_at);
    expect(masked.effective_date).toBe(row().effective_date);
    expect(masked.order_index).toBe(3);
    // A masked percent could render a 140%-complete progress bar.
    expect(masked.video_watched_percent).toBe(80);
  });

  it("replaces money with a different but same-magnitude number", () => {
    const p = masked.annual_premium as number;
    expect(p).not.toBe(2400.5);
    expect(p).toBeGreaterThan(240);      // still four figures, not $0 and not $2M
    expect(p).toBeLessThan(24000);
  });

  it("keeps integer counts integral", () => {
    const d = masked.deals_closed as number;
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it("replaces person identifiers and never leaks the real one", () => {
    expect(masked.first_name).not.toBe("Xaviar");
    expect(masked.last_name).not.toBe("Watts");
    expect(masked.display_name).not.toContain("Xaviar");
    expect(masked.email).not.toContain("realdomain.com");
    expect(String(masked.email)).toContain("@example.com");
    // 555-01xx is the reserved fictional range — it cannot dial a real person.
    expect(String(masked.phone)).toContain("555");
    expect(masked.phone).not.toBe("(602) 555-1234");
  });

  it("is deterministic — a demo that reshuffles on every refetch is useless", () => {
    const a = maskPayload(row()) as Record<string, unknown>;
    const b = maskPayload(row()) as Record<string, unknown>;
    expect(a.annual_premium).toBe(b.annual_premium);
    expect(a.display_name).toBe(b.display_name);
  });

  it("maps the same real person to the same fake person across screens", () => {
    const fromDeals = maskPayload({ agent_name: "Xaviar Watts" }) as Record<string, unknown>;
    const fromBoard = maskPayload({ display_name: "Xaviar Watts" }) as Record<string, unknown>;
    expect(fromDeals.agent_name).toBe(fromBoard.display_name);
  });

  it("handles arrays and nested rows, which is how PostgREST actually answers", () => {
    const out = maskPayload([{ ...row(), agents: { display_name: "Xaviar Watts" } }]) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(out)).toBe(true);
    expect((out[0].agents as Record<string, unknown>).display_name).not.toBe("Xaviar Watts");
  });

  it("leaves zero alone, so an empty state stays an empty state", () => {
    const out = maskPayload({ annual_premium: 0, deals_closed: 0 }) as Record<string, unknown>;
    expect(out.annual_premium).toBe(0);
    expect(out.deals_closed).toBe(0);
  });

  it("masks numeric strings, which is how PostgREST returns numeric/bigint", () => {
    const out = maskPayload({ annual_premium: "2400.50" }) as Record<string, unknown>;
    expect(typeof out.annual_premium).toBe("string");
    expect(out.annual_premium).not.toBe("2400.50");
  });
});

/**
 * Regression: a mask that returns its input is not a mask.
 *
 * round(n * jitter) lands back on n for a wide band of small integers, and small
 * integers — deals today, hires this week, agents on a leg — are most of what a
 * demo screen shows. Found by a failing assertion, not by reading the code.
 */
describe("demo mode never returns the real number", () => {
  it("changes every small integer count from 1 to 200", () => {
    const leaked: number[] = [];
    for (let n = 1; n <= 200; n++) {
      const out = maskPayload({ policy_count: n }) as Record<string, unknown>;
      if (out.policy_count === n) leaked.push(n);
    }
    expect(leaked).toEqual([]);
  });

  it("changes money amounts across several magnitudes", () => {
    const leaked: number[] = [];
    for (const amount of [1, 9, 99, 250.5, 2400.5, 18000, 113259, 2376706.08]) {
      const out = maskPayload({ annual_premium: amount }) as Record<string, unknown>;
      if (out.annual_premium === amount) leaked.push(amount);
    }
    expect(leaked).toEqual([]);
  });

  it("still leaves zero alone — an empty state must stay empty", () => {
    const out = maskPayload({ policy_count: 0 }) as Record<string, unknown>;
    expect(out.policy_count).toBe(0);
  });
});

/**
 * The sites that skip the SDK, and therefore skip the seam.
 *
 * MP-530 fixed demoFetch's gate and the landing ticker still showed real
 * producers, because DealsTicker fetches Supabase by hand to keep 170 kB off
 * the landing bundle — so it never reaches demoFetch at all. A seam only covers
 * what goes through it, and "one seam, not 250 pages" stops being true the
 * moment a page has a reason to route around it.
 */
describe("maskIfDemo — the hand-called mask for seam-bypassing fetches", () => {
  afterEach(() => setDemoMode(false));

  it("masks the landing ticker's real producer and real ALP when demo is on", () => {
    setDemoMode(true);
    const out = maskIfDemo([{ agent: "OBIAJULU", amount: 20695 }]) as Array<Record<string, unknown>>;
    expect(out[0].agent).not.toBe("OBIAJULU");
    expect(out[0].amount).not.toBe(20695);
  });

  it("is a no-op with demo off, so the public page keeps showing the real book", () => {
    setDemoMode(false);
    const out = maskIfDemo([{ agent: "OBIAJULU", amount: 20695 }]) as Array<Record<string, unknown>>;
    expect(out[0].agent).toBe("OBIAJULU");
    expect(out[0].amount).toBe(20695);
  });

  it("passes null through, which is what the ticker sends on a failed fetch", () => {
    setDemoMode(true);
    expect(maskIfDemo(null)).toBeNull();
  });
});

// ─── MP-531: the admin surface ───────────────────────────────────────────────
// Measured on live prod under the "every number and name on screen is fake"
// banner: 62 numeric keys and 4 person-name keys arrived unmasked, and two
// prose keys spoke a real agent's name beside a real dollar figure. Each test
// here is one of those measured shapes, not a hypothetical.
describe("MP-531 admin surface", () => {
  it("masks a money column the old allowlist never named", () => {
    // `owed_this_cycle` matched no spelling in the old NUMERIC_KEY.
    const out = maskPayload([{ owed_this_cycle: 4820 }]) as Array<Record<string, number>>;
    expect(out[0].owed_this_cycle).not.toBe(4820);
    expect(out[0].owed_this_cycle).toBeGreaterThan(0);
  });

  it("keeps structural numbers real so the screen does not render broken", () => {
    const out = maskPayload([
      { owner_override_pct: 15, year: 2026, page_size: 50, id: 8812 },
    ]) as Array<Record<string, number>>;
    expect(out[0].owner_override_pct).toBe(15);
    expect(out[0].year).toBe(2026);
    expect(out[0].page_size).toBe(50);
    expect(out[0].id).toBe(8812);
  });

  it("masks the four person-name keys measured on the wire", () => {
    const out = maskPayload([{
      leg: "Obiajulu Ifediora",
      first_hop_name: "Chudi Ifediora",
      agency_head_name: "KJ Vaughn",
      recruit_name: "Jorge Oyervidez",
    }]) as Array<Record<string, string>>;
    expect(out[0].leg).not.toContain("Ifediora");
    expect(out[0].first_hop_name).not.toContain("Ifediora");
    expect(out[0].agency_head_name).not.toContain("Vaughn");
    expect(out[0].recruit_name).not.toContain("Oyervidez");
  });

  it("does NOT turn a company into a person — agency/carrier stay themselves", () => {
    const out = maskPayload([
      { agency_name: "APEX Financial", carrier_name: "Mutual of Omaha" },
    ]) as Array<Record<string, string>>;
    expect(out[0].agency_name).toBe("APEX Financial");
    expect(out[0].carrier_name).toBe("Mutual of Omaha");
  });

  it("rewrites a name and a dollar figure spoken INSIDE a sentence", () => {
    const out = maskPayload([{
      agent_name: "Aisha Kebbeh",
      title: "Aisha Kebbeh · $1,284 Deal Win",
      hook: "Aisha just locked in a $1,284 deal",
    }]) as Array<Record<string, string>>;
    expect(out[0].title).not.toContain("Aisha");
    expect(out[0].title).not.toContain("$1,284");
    expect(out[0].hook).not.toContain("Aisha");
    expect(out[0].hook).not.toContain("$1,284");
    // the sentence must SURVIVE, not be replaced by a bare name
    expect(out[0].title).toContain("Deal Win");
    expect(out[0].hook).toContain("locked in");
    expect(out[0].title).toMatch(/\$[\d,]+/);
  });

  it("gives prose the SAME fake identity as the row's own name column", () => {
    const out = maskPayload([{
      agent_name: "Aisha Kebbeh",
      title: "Aisha Kebbeh closed it",
    }]) as Array<Record<string, string>>;
    // a demo that contradicts itself on the same row is worse than no mask
    expect(out[0].title).toContain(out[0].agent_name.split(" ")[0]);
  });

  it("consumes the full name before the bare first name can half-replace it", () => {
    const out = maskPayload([{
      agent_name: "Obiajulu Ifediora",
      title: "Obiajulu Ifediora and Obiajulu",
    }]) as Array<Record<string, string>>;
    expect(out[0].title).not.toContain("Ifediora");
    expect(out[0].title).not.toContain("Obiajulu");
  });
});

// ─── MP-532: the name map's scope ────────────────────────────────────────────
// Measured on live prod AFTER MP-531 shipped: /dashboard/admin/sam still spoke
// "Obiajulu Ifediora - $1,165 Deal Win" under the banner. The prose pass fired
// there — the money inside those same sentences WAS masked — so the branch was
// reached and working. What failed was the name map: it was built per-PAYLOAD
// and thrown away in a `finally`, and that payload carries no name column of
// its own. The same person's name arrives under display_name in one response
// and inside prose in another, so the map that could have rewritten the
// sentence was built and discarded by a different fetch.
//
// Scope is the demo SESSION, not the response. This REDUCES the hole, it does
// not close it by construction: a prose string can still render before any
// response has spelled that person's name in a name column. Ordering, not
// logic, decides — so these tests assert the direction that is fixable.
describe("MP-532 name map scope", () => {
  afterEach(() => setDemoMode(false));

  it("rewrites prose using a name learned from an EARLIER response", () => {
    // Response 1: the roster. Carries the name in a name column, no prose.
    maskPayload([{ display_name: "Obiajulu Ifediora" }]);
    // Response 2: the feed. Carries the name only inside a sentence.
    const out = maskPayload([{
      title: "Obiajulu Ifediora - $1,165 Deal Win",
      hook: "Obiajulu Ifediora just locked in a $1,165 Life deal.",
    }]) as Array<Record<string, string>>;
    expect(out[0].title).not.toContain("Obiajulu");
    expect(out[0].title).not.toContain("Ifediora");
    expect(out[0].hook).not.toContain("Obiajulu");
    expect(out[0].hook).not.toContain("Ifediora");
    // the sentence must still be a sentence
    expect(out[0].title).toContain("Deal Win");
    expect(out[0].hook).toContain("just locked in");
  });

  it("gives the cross-response sentence the SAME fake identity as the roster", () => {
    const roster = maskPayload([{ display_name: "Obiajulu Ifediora" }]) as Array<
      Record<string, string>
    >;
    const feed = maskPayload([{ title: "Obiajulu Ifediora - $1,165 Deal Win" }]) as Array<
      Record<string, string>
    >;
    // Two panels naming one person must not disagree about who that person is.
    expect(feed[0].title).toContain(roster[0].display_name);
  });

  it("keeps learning after the first payload — a frozen map is the same leak", () => {
    // The naive persistence (keep the map, only collect on the "outermost"
    // call) freezes it after response 1 and never learns anyone again.
    maskPayload([{ display_name: "Obiajulu Ifediora" }]);
    maskPayload([{ display_name: "Xaviar Watts" }]);
    const out = maskPayload([{ title: "Xaviar Watts closed it" }]) as Array<
      Record<string, string>
    >;
    expect(out[0].title).not.toContain("Xaviar");
    expect(out[0].title).not.toContain("Watts");
  });

  it("rewrites prose after a SINGLE-token name is learned late", () => {
    // The landing ticker really does send `agent: "OBIAJULU"` — one word. A
    // one-token name never reaches the part-mapping loop (the token IS the
    // name it just stored), so it invalidates the prose-rule cache from ONE
    // site only. Every other test here uses a two-word name and would pass
    // with that site deleted: found because a mutation proof came back inert.
    maskPayload([{ title: "warm the rule cache with no names known" }]);
    maskPayload([{ agent: "OBIAJULU" }]);
    const out = maskPayload([{ title: "OBIAJULU closed it" }]) as Array<
      Record<string, string>
    >;
    expect(out[0].title).not.toContain("OBIAJULU");
    expect(out[0].title).toContain("closed it");
  });

  it("forgets every identity when demo mode is turned off", () => {
    setDemoMode(true);
    maskPayload([{ display_name: "Obiajulu Ifediora" }]);
    setDemoMode(false);
    // A stale identity outliving its session would let a later demo rewrite a
    // sentence using a map the viewer never saw built — and worse, would keep
    // real names resident after the session that justified holding them.
    const out = maskPayload([{ title: "Obiajulu Ifediora - $1,165 Deal Win" }]) as Array<
      Record<string, string>
    >;
    expect(out[0].title).toContain("Obiajulu Ifediora");
  });

  it("forgets the previous session's identities when demo mode is turned ON", () => {
    setDemoMode(true);
    maskPayload([{ display_name: "Obiajulu Ifediora" }]);
    setDemoMode(true); // re-entering demo mode starts a fresh session
    const out = maskPayload([{ title: "Obiajulu Ifediora - $1,165 Deal Win" }]) as Array<
      Record<string, string>
    >;
    expect(out[0].title).toContain("Obiajulu Ifediora");
  });
});

// ─── MP-533: the names no payload on the page ever spells ────────────────────
// MP-532 closed the cross-RESPONSE case and said in its own header that it was
// a reduction, not a closure. Measured on live prod, the remainder is not a
// tail: social_bot_drafts holds 811 rows, all with a title, and 742 read
// "<real agent> · $<real ALP> Deal Win" across 37 distinct people.
// /dashboard/admin/sam selects `title, hook` from that table — and the table
// has NO name column, so no widening of scope lets the row teach its own name.
// The page's only name source, v_recent_hires, is a different population.
//
// So the map is seeded from the roster before any masking happens. These tests
// grade the three things that decide whether that is a fix or a story: that it
// is AWAITED (a background prefetch is the same race relocated), that an empty
// or failed load is recorded as such instead of dressed as success, and that a
// primed name and a payload-learned name resolve to the SAME fake person.
describe("MP-533 roster priming", () => {
  afterEach(() => setDemoMode(false));

  const feed = () =>
    maskPayload([{ title: "Aisha Kebbeh · $1,284 Deal Win" }]) as Array<Record<string, string>>;

  it("REPRODUCES the bug: prose-only names survive with an unprimed map", () => {
    // This is the live SamHQ payload. No name column exists to teach the map.
    expect(feed()[0].title).toContain("Aisha Kebbeh");
    expect(getDemoPrimeState()).toBe("unprimed");
  });

  it("rewrites that same prose once the roster has been primed", async () => {
    await primeNames(async () => ["Aisha Kebbeh", "Obiajulu Ifediora"]);
    const out = feed();
    expect(out[0].title).not.toContain("Aisha");
    expect(out[0].title).not.toContain("Kebbeh");
    expect(out[0].title).toContain("Deal Win"); // still a sentence
    expect(getDemoPrimeState()).toBe("primed");
  });

  it("covers the case variants the roster spells differently from the prose", async () => {
    // Measured live: the roster holds "Dudley Bowman" and "Matias Touchstone";
    // the drafts speak "dudley bowman" and "matias touchstone". An exact-match
    // rule learns the name and walks straight past the sentence carrying it.
    await primeNames(async () => ["Dudley Bowman", "Matias Touchstone"]);
    const out = maskPayload([
      { title: "dudley bowman · $900 Deal Win" },
      { hook: "matias touchstone just locked in a $700 Life deal." },
    ]) as Array<Record<string, string>>;
    expect(out[0].title.toLowerCase()).not.toContain("dudley");
    expect(out[0].title.toLowerCase()).not.toContain("bowman");
    expect(out[1].hook.toLowerCase()).not.toContain("matias");
    expect(out[1].hook.toLowerCase()).not.toContain("touchstone");
  });

  it("gives a primed name the SAME fake identity a payload column would", async () => {
    await primeNames(async () => ["Aisha Kebbeh"]);
    const column = maskPayload([{ display_name: "Aisha Kebbeh" }]) as Array<
      Record<string, string>
    >;
    // Two panels naming one person must not disagree about who that person is,
    // whichever route taught the map.
    expect(feed()[0].title).toContain(column[0].display_name);
  });

  it("loads once per session however many requests race it", async () => {
    let calls = 0;
    const loader = async () => { calls++; return ["Aisha Kebbeh"]; };
    await Promise.all([primeNames(loader), primeNames(loader), primeNames(loader)]);
    await primeNames(loader);
    expect(calls).toBe(1);
  });

  it("records an EMPTY roster as empty, not as primed", async () => {
    // What an unauthenticated session actually gets back from the RLS gate —
    // `[]`, with a 200. Measured against live prod, not imagined.
    await primeNames(async () => []);
    expect(getDemoPrimeState()).toBe("empty");
    expect(feed()[0].title).toContain("Aisha Kebbeh"); // and it does not pretend otherwise
  });

  it("records a FAILED roster read as failed, and still masks the page", async () => {
    await primeNames(async () => { throw new Error("403"); });
    expect(getDemoPrimeState()).toBe("failed");
    // Availability is the safe direction: the rest of the mask keeps working.
    const out = maskPayload([{ annual_premium: 2400, title: "Aisha Kebbeh · $1,284 Deal Win" }]) as
      Array<Record<string, unknown>>;
    expect(out[0].annual_premium).not.toBe(2400);
    expect(String(out[0].title)).not.toContain("$1,284");
  });

  it("re-primes on a new demo session instead of carrying the last one's names", async () => {
    await primeNames(async () => ["Aisha Kebbeh"]);
    expect(getDemoPrimeState()).toBe("primed");
    setDemoMode(true);
    // A stale identity resident across sessions is its own leak; so is a map
    // that believes it is primed when the new session has loaded nothing.
    expect(getDemoPrimeState()).toBe("unprimed");
    expect(feed()[0].title).toContain("Aisha Kebbeh");
  });

  it("notifies subscribers so the banner can stop claiming what it cannot", async () => {
    const seen: string[] = [];
    const off = subscribeDemoPrime(() => seen.push(getDemoPrimeState()));
    await primeNames(async () => ["Aisha Kebbeh"]);
    off();
    expect(seen).toContain("priming");
    expect(seen).toContain("primed");
  });
});
