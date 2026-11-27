/**
 * My Team profile facts (src/lib/teamProfile.ts, MP-TEAM-PROFILE-FACTS 2026-11-27): the parser refuses a read it
 * cannot trust, every fact prints with honest words ("No Ethos on file", never "No Ethos"), a sign-in is never a
 * negative count, and the state and Instagram helpers read what people actually typed.
 */
import { describe, expect, it } from "vitest";
import {
  activeCarrierNames, carriersWords, ethosWords, instagramUrl, parseStateCode, parseTeamProfiles, shortDay, signInWords, soldWords,
  stateName, stateWords,
} from "@/lib/teamProfile";
import { teamProfile } from "../helpers/teamProfileFixtures";

const NOW = Date.UTC(2026, 10, 27, 18, 0, 0);

describe("parseTeamProfiles: a read that cannot be trusted is refused", () => {
  it("throws on anything but a list of rows with an agent id, so a bad read never renders as nobody having anything", () => {
    expect(() => parseTeamProfiles(null)).toThrow(/list/);
    expect(() => parseTeamProfiles({ agent_id: "a1" })).toThrow(/list/);
    expect(() => parseTeamProfiles([{ home_state: "WI" }])).toThrow(/agent id/);
    expect(() => parseTeamProfiles([null])).toThrow(/object/);
    expect(parseTeamProfiles([])).toEqual({});
  });

  it("normalises what the database sends: numbers as strings, codes in any case, unknown sources dropped, malformed carriers skipped", () => {
    const out = parseTeamProfiles([{
      agent_id: "a1", home_state: "wi", home_state_source: "profile", license_states: ["il", "WI"], instagram: "bo.sells", instagram_source: "profile",
      has_login: true, last_sign_in_at: "2026-11-20T00:00:00Z", discord_joined: true, slack_joined: false, npn: "123",
      ethos_back: true, ethos_source: "ethos_hierarchy", ethos_since: "2026-11-19", ethos_issued: "17970.84", ethos_inforce: "15681.84", ethos_chargeback: null,
      carriers: [{ carrier: "Aflac", status: "confirmed", source: "review", as_of: "2026-10-09", active: true }, { status: "active" }, null],
      carriers_active: "1", sold_carriers: [{ carrier: "Foresters", deals: "41", alp: "50457", last_posted: "2026-09-22" }],
    }, { agent_id: "a2", ethos_source: "guess" }]);
    expect(out.a1).toMatchObject({
      home_state: "WI", license_states: ["IL", "WI"], ethos_issued: 17970.84, ethos_inforce: 15681.84, ethos_chargeback: 0, carriers_active: 1,
      carriers: [{ carrier: "Aflac", status: "confirmed", source: "review", as_of: "2026-10-09", active: true }],
      sold_carriers: [{ carrier: "Foresters", deals: 41, alp: 50457, last_posted: "2026-09-22" }],
    });
    expect(out.a2).toMatchObject({ ethos_back: false, ethos_source: null, has_login: false, carriers: [], sold_carriers: [], license_states: [] });
  });
});

describe("the words on a row", () => {
  it("Ethos: back is the good word; requested but not back is its own amber state; a licensed person with nothing on file says 'on file'; someone unlicensed says nothing", () => {
    expect(ethosWords(teamProfile({ ethos_back: true }), "licensed")).toEqual({ text: "Ethos back", tone: "good" });
    expect(ethosWords(teamProfile({ ethos_back: true }), "unlicensed")).toEqual({ text: "Ethos back", tone: "good" });
    expect(ethosWords(teamProfile({ ethos_requested: true }), "licensed")).toEqual({ text: "Ethos requested, not back yet", tone: "warn" });
    expect(ethosWords(teamProfile({ ethos_requested: true }), "unlicensed")).toEqual({ text: "Ethos requested, not back yet", tone: "warn" });
    expect(ethosWords(teamProfile(), "licensed")).toEqual({ text: "No Ethos on file", tone: "warn" });
    expect(ethosWords(teamProfile(), "unlicensed")).toBeNull();
    expect(ethosWords(null, "licensed")).toBeNull();
  });

  it("the parser keeps every Ethos source the database can name, and a person who is back always counts as requested", () => {
    const out = parseTeamProfiles([
      { agent_id: "a", ethos_back: true, ethos_source: "mgn_partner_id", ethos_partner_id: "337551" },
      { agent_id: "b", ethos_back: true, ethos_source: "sold_ethos" },
      { agent_id: "c", ethos_back: false, ethos_requested: true, ethos_requested_on: "2026-10-12" },
    ]);
    expect(out.a).toMatchObject({ ethos_source: "mgn_partner_id", ethos_partner_id: "337551", ethos_requested: true });
    expect(out.b).toMatchObject({ ethos_source: "sold_ethos", ethos_requested: true });
    expect(out.c).toMatchObject({ ethos_back: false, ethos_requested: true, ethos_requested_on: "2026-10-12" });
  });

  it("carriers: active names with Ethos first, pending names when none is active, 'none on file' only for the licensed", () => {
    const p = teamProfile({ carriers: [
      { carrier: "Transamerica", status: "active", source: "agentlink", as_of: null, active: true },
      { carrier: "Ethos", status: "active", source: "ethos_hierarchy", as_of: "2026-11-19", active: true },
      { carrier: "Aflac", status: "confirmed", source: "review", as_of: null, active: true },
      { carrier: "Prudential", status: "submitted", source: "agentlink", as_of: null, active: false },
    ], carriers_active: 3 });
    expect(activeCarrierNames(p)).toEqual(["Ethos", "Aflac", "Transamerica"]);
    expect(carriersWords(p, "licensed")).toBe("Contracts: Ethos, Aflac, Transamerica");
    const many = teamProfile({ carriers: ["A", "B", "C", "D", "E", "F"].map((c) => ({ carrier: c, status: "active", source: "agentlink", as_of: null, active: true })) });
    expect(carriersWords(many, "licensed")).toBe("Contracts: A, B, C, D +2");
    expect(carriersWords(teamProfile({ carriers: [{ carrier: "Aflac", status: "submitted", source: "agentlink", as_of: null, active: false }] }), "licensed")).toBe("Contracts pending: Aflac");
    expect(carriersWords(teamProfile(), "licensed")).toBe("No carrier contracts on file");
    expect(carriersWords(teamProfile(), "unlicensed")).toBeNull();
    expect(carriersWords(undefined, "licensed")).toBeNull();
  });

  it("sold: the lifetime figure and the carrier they sold most with; nothing sold is null", () => {
    const p = teamProfile({ sold_carriers: [
      { carrier: "Foresters", deals: 41, alp: 50457, last_posted: "2026-09-22" },
      { carrier: "Ethos", deals: 16, alp: 22709.4, last_posted: "2026-11-24" },
    ] });
    expect(soldWords(p, 136633)).toBe("Sold $136.6K lifetime, mostly Foresters");
    expect(soldWords(teamProfile({ sold_carriers: [{ carrier: "Ethos", deals: 2, alp: 1500, last_posted: null }] }), null)).toBe("Sold $1.5K lifetime with Ethos");
    expect(soldWords(teamProfile(), 0)).toBeNull();
    expect(soldWords(null, 5000)).toBeNull();
  });

  it("sign-in: no login and never signed in are amber; a sign-in counts in whole days and a clock ahead of ours reads as today", () => {
    expect(signInWords(teamProfile({ has_login: false, last_sign_in_at: null }), NOW)).toEqual({ text: "No login", tone: "warn" });
    expect(signInWords(teamProfile({ last_sign_in_at: null }), NOW)).toEqual({ text: "Never signed in", tone: "warn" });
    expect(signInWords(teamProfile({ last_sign_in_at: "2026-11-27T16:00:00Z" }), NOW)).toEqual({ text: "Signed in today", tone: null });
    expect(signInWords(teamProfile({ last_sign_in_at: "2026-11-26T12:00:00Z" }), NOW)).toEqual({ text: "Signed in yesterday", tone: null });
    expect(signInWords(teamProfile({ last_sign_in_at: "2026-11-20T12:00:00Z" }), NOW)).toEqual({ text: "Signed in 7 days ago", tone: null });
    expect(signInWords(teamProfile({ last_sign_in_at: "2026-10-01T12:00:00Z" }), NOW)).toEqual({ text: "Signed in 57 days ago", tone: "warn" });
    expect(signInWords(teamProfile({ last_sign_in_at: "2026-12-05T12:00:00Z" }), NOW)).toEqual({ text: "Signed in today", tone: null });
    expect(signInWords(teamProfile({ last_sign_in_at: "not a date" }), NOW)).toEqual({ text: "Last sign-in unknown", tone: null });
    expect(signInWords(null, NOW)).toBeNull();
  });

  it("Instagram: a handle, with or without the @, becomes the public page; anything else is no link", () => {
    expect(instagramUrl("bo.sells")).toBe("https://www.instagram.com/bo.sells/");
    expect(instagramUrl("@bo.sells")).toBe("https://www.instagram.com/bo.sells/");
    expect(instagramUrl("not a handle")).toBeNull();
    expect(instagramUrl(null)).toBeNull();
  });

  it("states: codes are read in any case, named in full, and the card says where else they are licensed", () => {
    expect(parseStateCode("wi")).toBe("WI");
    expect(parseStateCode("Wisconsin")).toBeNull();
    expect(parseStateCode("")).toBeNull();
    expect(stateName("WI")).toBe("Wisconsin");
    expect(stateName("ZZ")).toBe("ZZ");
    expect(stateWords(teamProfile({ home_state: "WI" }))).toBe("WI");
    expect(stateWords(teamProfile({ home_state: "WI", license_states: ["WI", "IL", "MI"] }))).toBe("WI, licensed in IL, MI");
    expect(stateWords(teamProfile({ home_state: null, license_states: ["TX"] }))).toBe("Licensed in TX");
    expect(stateWords(teamProfile())).toBeNull();
    expect(shortDay("2026-11-19", "2026-11-27")).toBe("Nov 19");
    expect(shortDay("2025-11-19", "2026-11-27")).toBe("Nov 19, 2025");
    expect(shortDay(null)).toBe("");
  });
});
