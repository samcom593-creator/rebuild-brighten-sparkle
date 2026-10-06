import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPECTED_START_STATUSES,
  REQUIREMENT_PREREQUISITES,
  REQUIREMENT_TRACK,
  START_OUTCOMES,
  buildExceptionQueue,
  currentStartOutcome,
  daysWaiting,
  deriveExceptions,
  laterOf,
  phoenixToday,
  trackCounts,
  type OnboardingFacts,
  type RequirementKey,
} from "@/lib/onboardingExceptions";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

// Synthetic records only — no real agent data.
const NOW = new Date("2026-10-06T18:00:00Z");

function facts(over: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    agent_id: "00000000-0000-4000-8000-000000000001",
    agent_name: "Test Hire",
    owner_agent_id: "00000000-0000-4000-8000-0000000000aa",
    owner_name: "Test Manager",
    agent_status: "active",
    license_status: "licensed",
    onboarding_stage: "onboarding",
    hired_at: "2026-09-20T15:00:00Z",
    start_date: null,
    licensed_at: "2026-09-25T15:00:00Z",
    has_account: true,
    last_sign_in_at: "2026-09-21T15:00:00Z",
    login_link_sent_at: "2026-09-20T16:00:00Z",
    login_link_used_at: "2026-09-21T15:00:00Z",
    has_profile: true,
    licensing_ready: true,
    intake_status: "accepted",
    intake_at: "2026-09-26T15:00:00Z",
    contracting_started: true,
    eo_on_file: true,
    eft_on_file: true,
    carrier_active_count: 1,
    carrier_pending_count: 0,
    carrier_first_active_at: "2026-10-01T15:00:00Z",
    training_required_total: 6,
    training_required_passed: 6,
    training_started: true,
    training_last_activity_at: "2026-09-30T15:00:00Z",
    has_dialer_login: true,
    onboarding_call_event_id: "00000000-0000-4000-8000-0000000000ee",
    onboarding_call_at: "2026-09-28T17:00:00Z",
    onboarding_call_outcome: "completed",
    first_deal_at: "2026-10-03T15:00:00Z",
    expected_start_on: "2026-09-28",
    expected_start_status: "confirmed",
    expected_start_set_at: "2026-09-22T15:00:00Z",
    start_outcome: "attended",
    start_outcome_on: "2026-09-28",
    start_outcome_at: "2026-09-28T20:00:00Z",
    last_outreach_at: "2026-10-02T15:00:00Z",
    last_outreach_kind: "Next-step email sent",
    ...over,
  };
}

const keys = (f: OnboardingFacts) => deriveExceptions(f, NOW).map((e) => e.key);
const CONTRACTING_KEYS = (Object.keys(REQUIREMENT_TRACK) as RequirementKey[]).filter((k) => REQUIREMENT_TRACK[k] === "contracting");

describe("onboarding exception derivation", () => {
  it("a fully launched producer has no open requirement", () => {
    expect(deriveExceptions(facts(), NOW)).toEqual([]);
    expect(buildExceptionQueue([facts()], NOW)).toEqual([]);
  });

  it("D1 regression: a licensed hire with no Slack, no training and no call still shows the contracting block", () => {
    const f = facts({
      first_deal_at: null, carrier_active_count: 0, contracting_started: false, intake_status: null, intake_at: null,
      training_started: false, training_required_passed: 0, onboarding_call_event_id: null, onboarding_call_at: null,
      onboarding_call_outcome: null, expected_start_status: null, expected_start_on: null, start_outcome: null, start_outcome_on: null,
    });
    const list = deriveExceptions(f, NOW);
    expect(list.map((e) => e.key)).toContain("intake_missing");
    // Contracting leads the row; Slack never appears anywhere.
    expect(list[0].track).toBe("contracting");
    expect(list.some((e) => /slack|discord/i.test(`${e.label} ${e.why} ${e.nextAction}`))).toBe(false);
  });

  it("D2 regression: an unlicensed hire is 'not licensed', never 'NPN missing', and has no contracting items yet", () => {
    const k = keys(facts({ license_status: "unlicensed", licensing_ready: false, contracting_started: false, first_deal_at: null, carrier_active_count: 0 }));
    expect(k).toContain("license_pending");
    expect(k).not.toContain("npn_comp_missing");
    for (const c of CONTRACTING_KEYS) expect(k).not.toContain(c);
  });

  it("contracting is parallel: its items do not change with training, the onboarding call or the expected start", () => {
    const base = { first_deal_at: null, carrier_active_count: 0, carrier_pending_count: 0, contracting_started: false, intake_status: null, eo_on_file: false } as const;
    const contractingOf = (f: OnboardingFacts) => deriveExceptions(f, NOW).filter((e) => e.track === "contracting").map((e) => e.key).sort();
    const reference = contractingOf(facts(base));
    expect(reference.length).toBeGreaterThan(0);
    for (const trainingStarted of [true, false]) {
      for (const booked of [true, false]) {
        for (const status of [null, ...EXPECTED_START_STATUSES]) {
          const f = facts({
            ...base,
            training_started: trainingStarted,
            training_required_passed: trainingStarted ? 2 : 0,
            onboarding_call_event_id: booked ? "00000000-0000-4000-8000-0000000000ee" : null,
            onboarding_call_outcome: null,
            expected_start_status: status,
            start_outcome: null,
          });
          expect(contractingOf(f)).toEqual(reference);
        }
      }
    }
  });

  it("no contracting requirement declares a dependency on training, the call, the start or an account", () => {
    for (const k of CONTRACTING_KEYS) {
      for (const p of REQUIREMENT_PREREQUISITES[k]) {
        expect(["licensed", "intake_accepted", "not_producing"]).toContain(p);
      }
    }
  });

  it("training completion never satisfies carrier authorization; an accepted intake is not an appointment", () => {
    const k = keys(facts({ first_deal_at: null, carrier_active_count: 0, carrier_pending_count: 0 }));
    expect(k).toContain("carrier_none");
    const pending = deriveExceptions(facts({ first_deal_at: null, carrier_active_count: 0, carrier_pending_count: 2 }), NOW);
    expect(pending.find((e) => e.key === "carrier_pending")?.label).toBe("Carrier contracts pending (2)");
  });

  it("a login is one requirement, not onboarding complete", () => {
    const signedIn = facts({ first_deal_at: null, carrier_active_count: 0, has_dialer_login: false });
    const k = keys(signedIn);
    expect(k).not.toContain("never_signed_in");
    expect(k).toContain("dialer_missing");
    expect(k).toContain("carrier_none");
    expect(keys(facts({ last_sign_in_at: null, login_link_used_at: null }))).toContain("never_signed_in");
    expect(keys(facts({ has_account: false }))).toContain("account_missing");
  });

  it("documents name exactly what is missing", () => {
    const e = deriveExceptions(facts({ first_deal_at: null, eo_on_file: false, eft_on_file: true }), NOW).find((x) => x.key === "documents_missing");
    expect(e?.label).toBe("E&O certificate not on file");
    const both = deriveExceptions(facts({ first_deal_at: null, eo_on_file: false, eft_on_file: false }), NOW).find((x) => x.key === "documents_missing");
    expect(both?.label).toBe("E&O certificate and EFT (direct deposit) not on file");
    // A producer already wrote business through a carrier: not queued as a block.
    expect(keys(facts({ eo_on_file: false, eft_on_file: false, contracting_started: false, intake_status: null }))
      .filter((k) => REQUIREMENT_TRACK[k] === "contracting")).toEqual([]);
  });

  it("unknown is never zero", () => {
    const f = facts({ hired_at: null, licensed_at: null, has_account: false });
    const acct = deriveExceptions(f, NOW).find((e) => e.key === "account_missing")!;
    expect(acct.waitingSince).toBeNull();
    expect(daysWaiting(acct.waitingSince, NOW)).toBeNull();
    // No required-training catalog -> no training verdict at all.
    const k = keys(facts({ training_required_total: null, training_started: false, training_required_passed: null }));
    expect(k).not.toContain("training_not_started");
    expect(k).not.toContain("training_incomplete");
    expect(laterOf(null, null)).toBeNull();
    expect(laterOf("2026-01-01T00:00:00Z", null)).toBe("2026-01-01T00:00:00Z");
  });

  it("waits from the gap's own receipt: contracting from the later of hire and license", () => {
    const e = deriveExceptions(facts({ contracting_started: false, intake_status: null, first_deal_at: null, carrier_active_count: 0, licensed_at: "2025-01-01T00:00:00Z" }), NOW)
      .find((x) => x.key === "intake_missing")!;
    expect(e.waitingSince).toBe("2026-09-20T15:00:00Z");
    expect(e.waitingBasis).toBe("since licensed");
  });

  it("a no-show is a start outcome, never a departure", () => {
    const f = facts({ first_deal_at: null, carrier_active_count: 1, expected_start_on: "2026-10-01", start_outcome: "no_show", start_outcome_on: "2026-10-01" });
    const list = deriveExceptions(f, NOW);
    const ns = list.find((e) => e.key === "start_no_show")!;
    expect(ns.resolution.kind).toBe("set_start");
    expect(list.every((e) => !/inactive|depart|no longer/i.test(`${e.resolution.kind} ${e.nextAction}`))).toBe(true);
  });

  it("an outcome recorded against an earlier date is history, not the current outcome", () => {
    const f = facts({ expected_start_on: "2026-10-11", expected_start_status: "likely", start_outcome: "rescheduled", start_outcome_on: "2026-10-05", first_deal_at: null });
    expect(currentStartOutcome(f)).toBeNull();
    expect(keys(f)).toContain("start_unconfirmed");
  });

  it("a confirmed start whose date passed with no outcome asks for the outcome", () => {
    const f = facts({ first_deal_at: null, expected_start_on: "2026-10-01", expected_start_status: "confirmed", start_outcome: null, start_outcome_on: null });
    const e = deriveExceptions(f, NOW).find((x) => x.key === "start_outcome_missing")!;
    expect(e.resolution.kind).toBe("start_outcome");
    // A confirmed FUTURE start is satisfied.
    expect(keys(facts({ first_deal_at: null, expected_start_on: "2026-10-20", expected_start_status: "confirmed", start_outcome: null }))).not.toContain("start_outcome_missing");
  });

  it("only recent hires are asked for a start date they never had", () => {
    expect(keys(facts({ first_deal_at: null, expected_start_status: null, expected_start_on: null, start_outcome: null }))).toContain("start_not_set");
    expect(keys(facts({ first_deal_at: null, hired_at: "2026-01-01T00:00:00Z", expected_start_status: null, expected_start_on: null, start_outcome: null }))).not.toContain("start_not_set");
  });

  it("a producer is never asked about starts or carriers", () => {
    const k = keys(facts({ carrier_active_count: 0, expected_start_status: null, start_outcome: null, onboarding_call_event_id: null }));
    expect(k.filter((x) => REQUIREMENT_TRACK[x] === "start" || x.startsWith("carrier_"))).toEqual([]);
  });

  it("an onboarding call in the past with no outcome offers Attended / No-show / Rescheduled on that event", () => {
    const e = deriveExceptions(facts({ first_deal_at: null, onboarding_call_outcome: null }), NOW).find((x) => x.key === "onboarding_call_outcome")!;
    expect(e.resolution).toEqual({ kind: "call_outcome", eventId: "00000000-0000-4000-8000-0000000000ee" });
  });

  it("an owner is never invented", () => {
    const e = deriveExceptions(facts({ owner_name: null, has_account: false }), NOW).find((x) => x.key === "account_missing")!;
    expect(e.owner).toBe("Unassigned");
    const c = deriveExceptions(facts({ owner_name: null, contracting_started: false, intake_status: "needs_review", first_deal_at: null, carrier_active_count: 0 }), NOW)
      .find((x) => x.key === "intake_review")!;
    expect(c.owner).toBe("Contracting team");
  });

  it("the queue dedupes hires, drops cleared ones and puts blocked contracting first", () => {
    const training = facts({ agent_id: "a-training", first_deal_at: "2026-10-03T00:00:00Z", training_required_passed: 3 });
    const contracting = facts({ agent_id: "a-contract", contracting_started: false, intake_status: null, first_deal_at: null, carrier_active_count: 0 });
    const clear = facts({ agent_id: "a-clear" });
    const q = buildExceptionQueue([training, contracting, contracting, clear], NOW);
    expect(q.map((r) => r.facts.agent_id)).toEqual(["a-contract", "a-training"]);
    expect(q[0].primary?.track).toBe("contracting");
    expect(trackCounts(q).contracting).toBe(1);
    expect(trackCounts(q).training).toBe(1);
  });

  it("phoenixToday uses the Phoenix business day", () => {
    expect(phoenixToday(new Date("2026-10-07T05:30:00Z"))).toBe("2026-10-06");
  });
});

describe("expected start migration contract", () => {
  const sql = source("supabase/migrations/20261006110000_expected_start_tracking.sql");
  const fnBody = (name: string) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf("$$;", start);
    return sql.slice(start, end);
  };

  it("keeps the status vocabularies inside CHECK constraints, matching the client", () => {
    expect(sql).toContain("array['confirmed', 'likely', 'awaiting_response', 'not_attending']");
    expect(sql).toContain("array['attended', 'no_show', 'rescheduled']");
    expect([...EXPECTED_START_STATUSES]).toEqual(["confirmed", "likely", "awaiting_response", "not_attending"]);
    expect([...START_OUTCOMES]).toEqual(["attended", "no_show", "rescheduled"]);
  });

  it("is additive", () => {
    const code = sql.replace(/--.*$/gm, "").toLowerCase();
    expect(code).not.toMatch(/drop\s+table/);
    expect(code).not.toMatch(/\btruncate\b/);
    expect(code).not.toMatch(/delete\s+from/);
    expect(code).not.toMatch(/^\s*(begin|commit)\s*;/m);
  });

  it("widens the audit vocabulary without dropping the existing values", () => {
    expect(sql).toContain("array['onboarding_stage', 'license_status', 'expected_start', 'start_outcome']");
  });

  it("every new RPC is SECURITY DEFINER with a pinned search_path, an auth check, and no anon grant", () => {
    for (const fn of ["set_expected_start", "record_start_outcome", "record_onboarding_call_outcome", "request_onboarding_call_booking", "onboarding_exception_facts"]) {
      const body = fnBody(fn);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path to 'public'");
      expect(body).toMatch(/auth\.uid\(\) is null|v_uid uuid := auth\.uid\(\);[\s\S]*if v_uid is null then/);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    }
    expect(fnBody("set_expected_start")).toContain("fn_recruit_scope_ok");
    expect(fnBody("record_start_outcome")).toContain("fn_recruit_scope_ok");
    expect(fnBody("onboarding_exception_facts")).toMatch(/apex_is_admin\(\).*va_manager.*'va'/s);
  });

  it("a start outcome or a call outcome never touches employment status", () => {
    for (const fn of ["set_expected_start", "record_start_outcome", "record_onboarding_call_outcome"]) {
      const body = fnBody(fn).toLowerCase();
      expect(body).not.toMatch(/update\s+public\.agents/);
      expect(body).not.toContain("is_deactivated");
      expect(body).not.toContain("is_inactive");
    }
  });

  it("stores Attended on an onboarding call as the existing 'completed' outcome", () => {
    expect(fnBody("record_onboarding_call_outcome")).toContain("when 'attended' then 'completed'");
    expect(fnBody("record_onboarding_call_outcome")).toContain("call_track is distinct from 'onboarding'");
  });

  it("the facts RPC returns every field the client derivation reads", () => {
    const body = fnBody("onboarding_exception_facts");
    const sample = Object.keys(facts());
    for (const col of sample) expect(body).toMatch(new RegExp(`\\b${col}\\b`));
  });
});
