import { describe, it, expect, vi } from "vitest";

// The SAME functions the dispatcher runs, driven against stubbed providers.
import {
  escapeDiscord,
  buildDiscordPayload,
  deliverContractingEmail,
  deliverContractingDiscord,
  deliverContractingWorkbook,
  deliverEthosSheet,
  deliverContractingDestination,
  runContractingDelivery,
  DESTINATION_RETRY_SAFETY,
  FAILURE_OVERWRITABLE_STATES,
  readSettingFromResult,
  type DeliveryDeps,
  type IntakeRow,
} from "../../../supabase/functions/_shared/contracting-delivery.ts";

const INTAKE: IntakeRow = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone_e164: "+16025550143",
  npn: "21346999",
  status: "accepted",
};

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/fixture-not-a-real-webhook";

// Explicit mock signatures. vi.fn infers an empty argument tuple from a
// zero-parameter implementation, which makes calls[i][n] a type error even
// though the call is real at runtime.
type SendEmailFn = (payload: Record<string, unknown>, idempotencyKey: string) => Promise<string>;
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function deps(overrides: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    readSetting: async () => null,
    loadIntake: async () => INTAKE,
    sendEmail: async () => "msg_default",
    fetchImpl: (async () => new Response("{}", { status: 200 })) as never,
    googleCredential: null,
    now: () => 1_760_000_000_000,
    ...overrides,
  };
}

describe("contracting delivery · email/AgentLink is disabled", () => {
  it("never sends and directs the workflow to sheet + private Discord", async () => {
    const sendEmail = vi.fn<SendEmailFn>(async () => "should-not-send");
    const outcome = await deliverContractingEmail(INTAKE.id, deps({ sendEmail }));
    expect(outcome.state).toBe("not_configured");
    expect(outcome.note).toMatch(/Ethos sheet.*private contracting Discord/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("contracting delivery · Discord", () => {
  it("is not_configured without a dedicated contracting webhook", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverContractingDiscord(INTAKE.id, deps({ fetchImpl: fetchImpl as never }));
    expect(outcome.state).toBe("not_configured");
    // Not a failure and not a success — and above all, no post.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.receipt).toBeNull();
  });

  it("never falls back to the deals or recruiting webhook", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverContractingDiscord(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      // Both of these exist in production and point at unrelated channels.
      readSetting: async (k) =>
        k === "discord_webhook_url" || k === "discord_webhook_url_recruiting"
          ? "https://discord.com/api/webhooks/fixture-unrelated-channel"
          : null,
    }));
    expect(outcome.state).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a setting that is not a Discord webhook URL", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverContractingDiscord(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async () => "https://evil.example.com/hook",
    }));
    expect(outcome.state).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts exactly once and persists the HTTP status and message id", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => new Response(JSON.stringify({ id: "msg_777" }), { status: 200 }));
    const outcome = await deliverContractingDiscord(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async (k) => (k === "discord_webhook_url_contracting" ? DISCORD_WEBHOOK : null),
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // A Discord 200 means the message exists in the channel, so this leg can
    // honestly claim delivered — unlike email.
    expect(outcome.state).toBe("delivered");
    expect(outcome.receipt).toMatchObject({ provider: "discord", http_status: 200, message_id: "msg_777" });
  });

  it("waits for the message object rather than trusting a bare enqueue", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => new Response(JSON.stringify({ id: "m" }), { status: 200 }));
    await deliverContractingDiscord(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async () => DISCORD_WEBHOOK,
    }));
    expect(String(fetchImpl.mock.calls[0][0])).toContain("wait=true");
  });

  it("throws on a non-2xx so the outbox retries instead of recording success", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => new Response("rate limited", { status: 429 }));
    await expect(deliverContractingDiscord(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async () => DISCORD_WEBHOOK,
    }))).rejects.toThrow(/429/);
  });

  it("carries the five intake fields the support desk needs", async () => {
    const payload = buildDiscordPayload(INTAKE);
    const fields = (payload.embeds as Array<{ fields: Array<{ name: string; value: string }> }>)[0].fields;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
    expect(byName["First name"]).toBe("Jane");
    expect(byName["Last name"]).toBe("Doe");
    expect(byName["NPN"]).toBe("21346999");
    expect(byName["Email"]).toContain("jane.doe");
    expect(byName["Phone"]).toBe("+16025550143");
  });

  it("suppresses every mention, twice over", async () => {
    const hostile: IntakeRow = { ...INTAKE, first_name: "@everyone", last_name: "@here" };
    const payload = buildDiscordPayload(hostile);
    // Belt: allowed_mentions is empty, so Discord itself will not resolve any.
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    // Braces: the raw text no longer contains a resolvable mention either.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("@everyone");
    expect(serialized).not.toContain("@here");
  });

  it("allows only the configured numeric John member id to be mentioned", () => {
    const payload = buildDiscordPayload(INTAKE, "123456789012345678");
    expect(payload.content).toBe("<@123456789012345678>");
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: ["123456789012345678"],
    });
    const unsafe = buildDiscordPayload(INTAKE, "John");
    expect(unsafe.content).toBeUndefined();
    expect(unsafe.allowed_mentions).toEqual({ parse: [] });
  });

  it("escapes markdown so a crafted name cannot reshape the post", () => {
    expect(escapeDiscord("**bold**")).toBe("\\*\\*bold\\*\\*");
    expect(escapeDiscord("under_score")).toBe("under\\_score");
    expect(escapeDiscord("`code`")).toBe("\\`code\\`");
    expect(escapeDiscord("> quote")).toBe("\\> quote");
  });

  it("truncates an absurdly long field rather than failing the post", () => {
    expect(escapeDiscord("a".repeat(5000))).toHaveLength(256);
  });
});

describe("contracting delivery · honest not_configured", () => {
  it("reports the workbook unconfigured and points at the admin export", async () => {
    const outcome = await deliverContractingWorkbook(INTAKE.id, deps());
    expect(outcome.state).toBe("not_configured");
    expect(outcome.note).toContain("admin export");
  });

  it("ships with the production write flag OFF: no sheet call even with a credential", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverEthosSheet(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async (k) => (k === "ethos_agents_sheet" ? '{"sheet_id":"s","tab":"Agents"}' : null),
      googleCredential: '{"client_email":"x","private_key":"y"}',
    }));
    expect(outcome.state).toBe("not_configured");
    expect(outcome.note).toContain("ethos_sheet_writes_enabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports Ethos unconfigured without a Google credential, and touches nothing", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverEthosSheet(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async (k) => (k === "ethos_agents_sheet" ? '{"sheet_id":"s","tab":"Agents"}' : k === "ethos_sheet_writes_enabled" ? "true" : null),
      googleCredential: null,
    }));
    expect(outcome.state).toBe("not_configured");
    expect(outcome.note).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("holds a review row out of the shared sheet even with a credential", async () => {
    const fetchImpl = vi.fn();
    const outcome = await deliverEthosSheet(INTAKE.id, deps({
      fetchImpl: fetchImpl as never,
      readSetting: async (k) => (k === "ethos_agents_sheet" ? '{"sheet_id":"s","tab":"Agents"}' : k === "ethos_sheet_writes_enabled" ? "true" : null),
      googleCredential: '{"client_email":"x","private_key":"y"}',
      loadIntake: async () => ({ ...INTAKE, status: "needs_review" }),
    }));
    expect(outcome.state).toBe("manual_review");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("contracting delivery · routing", () => {
  it("refuses an unknown destination rather than silently doing nothing", async () => {
    await expect(deliverContractingDestination("carrier_pigeon", INTAKE.id, deps()))
      .rejects.toThrow(/Unsupported contracting destination/);
  });

  it("routes each known destination to its own handler", async () => {
    const sendEmail = vi.fn<SendEmailFn>(async () => "re_1");
    const email = await deliverContractingDestination("contracting_email", INTAKE.id, deps({ sendEmail }));
    expect(email.state).toBe("not_configured");

    const workbook = await deliverContractingDestination("contracting_workbook", INTAKE.id, deps());
    expect(workbook.state).toBe("not_configured");
  });
});

describe("contracting delivery · exactly-once across the settlement gap", () => {
  const DISCORD_OK = () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });

  function settlementDeps(overrides: Record<string, unknown> = {}) {
    const state = { current: "queued" };
    const calls = { markAttempting: 0, clearAttempting: 0, markUnknown: 0, settle: 0 };
    return {
      state,
      calls,
      deps: {
        ...deps({
          readSetting: async (k: string) =>
            k === "discord_webhook_url_contracting" ? DISCORD_WEBHOOK : null,
          fetchImpl: (async () => DISCORD_OK()) as never,
        }),
        currentState: async () => state.current,
        markAttempting: async () => { calls.markAttempting++; state.current = "attempting"; },
        clearAttempting: async () => { calls.clearAttempting++; state.current = "queued"; },
        markUnknownOutcome: async () => { calls.markUnknown++; state.current = "unknown_outcome"; },
        settle: async () => { calls.settle++; state.current = "delivered"; },
        ...overrides,
      } as never,
    };
  }

  it("classifies each destination's retry safety honestly", () => {
    expect(DESTINATION_RETRY_SAFETY.contracting_email).toBe("provider_idempotent");
    expect(DESTINATION_RETRY_SAFETY.contracting_discord).toBe("not_idempotent");
    expect(DESTINATION_RETRY_SAFETY.ethos_sheet).toBe("naturally_idempotent");
  });

  it("writes the intent marker BEFORE a non-idempotent provider call", async () => {
    const order: string[] = [];
    const h = settlementDeps({
      markAttempting: async () => { order.push("mark"); },
      fetchImpl: (async () => { order.push("post"); return DISCORD_OK(); }) as never,
      settle: async () => { order.push("settle"); },
    });
    await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(order).toEqual(["mark", "post", "settle"]);
  });

  it("does NOT repost when the provider succeeded but settlement failed", async () => {
    // The window this whole mechanism exists for.
    let posts = 0;
    const h = settlementDeps({
      fetchImpl: (async () => { posts++; return DISCORD_OK(); }) as never,
      settle: async () => { throw new Error("database unreachable"); },
    });

    const result = await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);

    // Crucially it RESOLVES rather than throwing. Throwing would return the
    // event to the outbox and the next cron tick would post a second time.
    expect(result.verdict).toBe("manual_action_required");
    expect(result.state).toBe("unknown_outcome");
    expect(posts).toBe(1);
    expect(h.calls.markUnknown).toBe(1);
  });

  it("refuses to auto-retry a Discord row left mid-flight", async () => {
    let posts = 0;
    const h = settlementDeps({
      fetchImpl: (async () => { posts++; return DISCORD_OK(); }) as never,
    });
    h.state.current = "attempting";

    const result = await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(result.state).toBe("unknown_outcome");
    // We cannot tell whether the earlier attempt landed, so we do not guess.
    expect(posts).toBe(0);
    expect(h.calls.markUnknown).toBe(1);
  });

  it("clears the marker after a definite rejection so normal retry resumes", async () => {
    const h = settlementDeps({
      fetchImpl: (async () => new Response("nope", { status: 400 })) as never,
    });
    await expect(runContractingDelivery("contracting_discord", INTAKE.id, h.deps)).rejects.toThrow(/400/);
    // Discord answered and refused, so no message exists and a clean retry is
    // correct — leaving the marker would create a false manual review.
    expect(h.calls.clearAttempting).toBe(1);
    expect(h.state.current).toBe("queued");
  });

  it("settles an ambiguous transport failure in the same run rather than throwing", async () => {
    const h = settlementDeps({
      fetchImpl: (async () => { throw new Error("socket hang up"); }) as never,
    });

    // Throwing would hand the event to the dispatcher's failure path, which
    // marks the row 'failed'. The next tick would then read 'failed' rather
    // than 'attempting', treat it as a clean retry, and post a second time —
    // the marker would have bought nothing.
    const result = await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(result.verdict).toBe("manual_action_required");
    expect(result.state).toBe("unknown_outcome");
    expect(h.calls.clearAttempting).toBe(0);
    expect(h.state.current).toBe("unknown_outcome");
  });

  it("does not repost after an ambiguous failure, on the very next run", async () => {
    let posts = 0;
    const h = settlementDeps({
      fetchImpl: (async () => { posts++; throw new Error("socket hang up"); }) as never,
    });
    await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(posts).toBe(1);

    // Simulate the cron picking the event up again.
    const second = await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(posts).toBe(1);
    expect(second.verdict).toBe("manual_action_required");
  });

  it("never re-runs an already settled destination", async () => {
    let posts = 0;
    const h = settlementDeps({ fetchImpl: (async () => { posts++; return DISCORD_OK(); }) as never });
    h.state.current = "delivered";
    const result = await runContractingDelivery("contracting_discord", INTAKE.id, h.deps);
    expect(result.verdict).toBe("delivered");
    expect(posts).toBe(0);
  });

  it("lets an idempotent destination retry on settlement failure", async () => {
    // Email is safe: Resend collapses the repeat on the idempotency key, so the
    // right answer is to throw and let the outbox try again.
    const h = settlementDeps({
      readSetting: async () => null,
      settle: async () => { throw new Error("database unreachable"); },
    });
    await expect(runContractingDelivery("contracting_email", INTAKE.id, h.deps))
      .rejects.toThrow(/database unreachable/);
    expect(h.calls.markAttempting).toBe(0);
    expect(h.calls.markUnknown).toBe(0);
  });

  it("does not mark intent for a destination that converges on retry", async () => {
    const h = settlementDeps({ readSetting: async () => null });
    await runContractingDelivery("contracting_workbook", INTAKE.id, h.deps);
    expect(h.calls.markAttempting).toBe(0);
  });

  it("an Ethos retry after a settlement failure converges instead of writing twice", async () => {
    // First run: the gate passes, A:L lands on the first empty row (PUT, never :append), the
    // read-back verifies, then the settlement write fails so the outbox retries. Second run:
    // the NPN is now on the sheet, so the leg converges with no second write.
    const HEADER = ["Agent First Name", "Agent Last Name", "Agent NPN", "Direct Upline NPN", "Agent Mobile Number",
      "Agent Email", "Comp Level", "Advance Pay Tier", "Sub-Agency Name", "Sub-Agent Head?", "Life Licensed?",
      "$1M in E&O coverage?", "Portal Created (Completed by Ethos)", "Date Portal Created / Date Reparenting Completed",
      "Ethos Partner ID", "Ethos Partner Code", "https://agents.ethoslife.com/invite/", "Ethos Partnership Ops Notes", "Comments"];
    const sheet: string[][] = [HEADER, ["Other", "Agent", "21000077", "21346366", "(555) 010-0077", "other@example.com"]];
    const puts: string[] = [];
    const appends: string[] = [];
    const rowOf = (u: string) => Number(/A(\d+)%3A|A(\d+):/.exec(decodeURIComponent(u))?.slice(1).find(Boolean) ?? 0);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = decodeURIComponent(String(url));
      if (u.includes(":append")) { appends.push(u); return new Response("{}", { status: 200 }); }
      if (init?.method === "PUT") {
        const values = JSON.parse(String(init.body)).values[0];
        const n = rowOf(u);
        while (sheet.length < n) sheet.push([]);
        sheet[n - 1] = values.map((v: unknown) => (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v)));
        puts.push(u);
        return new Response(JSON.stringify({ updatedRange: `Agents!A${n}:L${n}` }), { status: 200 });
      }
      if (u.includes("!A:S")) return new Response(JSON.stringify({ values: sheet }), { status: 200 });
      const n = rowOf(u);
      return new Response(JSON.stringify({ values: n && sheet[n - 1] ? [sheet[n - 1]] : [] }), { status: 200 });
    }) as never;

    const approval = {
      npn_verified_at: "2026-10-01T00:00:00Z", license_verified_at: "2026-10-01T00:00:00Z",
      eo_verified_at: "2026-10-01T00:00:00Z", eo_expires_at: "2027-12-31",
      approved_comp_level: "Level 12", approved_advance_tier: "6 Month Advance", approved_upline_npn: "21346366",
      approved_sub_agency: "Apex Financial Empire", approved_sub_agent_head: false,
      approved_by: "admin-1", approved_at: "2026-10-02T00:00:00Z",
    };
    const base = {
      ...deps({
        fetchImpl,
        googleCredential: '{"client_email":"a@b.c","private_key":"k"}',
        getToken: async () => "stub-token",
        loadEthosApproval: async () => approval,
        readSetting: async (k: string) =>
          k === "ethos_agents_sheet" ? '{"sheet_id":"s","tab":"Agents","principal_npn":"21346366"}'
          : k === "ethos_sheet_writes_enabled" ? "true" : null,
      }),
      currentState: async () => "queued",
      markAttempting: async () => {},
      clearAttempting: async () => {},
      markUnknownOutcome: async () => {},
    };

    await expect(runContractingDelivery("ethos_sheet", INTAKE.id, {
      ...base, settle: async () => { throw new Error("db down"); },
    } as never)).rejects.toThrow(/db down/);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain("Agents!A3:L3");
    expect(sheet[2].slice(0, 12)).toEqual(["Jane", "Doe", "21346999", "21346366", "(602) 555-0143", "jane.doe@example.com",
      "Level 12", "6 Month Advance", "Apex Financial Empire", "FALSE", "TRUE", "TRUE"]);

    let settled: unknown = null;
    await runContractingDelivery("ethos_sheet", INTAKE.id, { ...base, settle: async (o: unknown) => { settled = o; } } as never);
    expect(puts).toHaveLength(1);
    expect(appends).toHaveLength(0);
    expect(sheet.filter((r) => r[2] === INTAKE.npn)).toHaveLength(1);
    expect((settled as { receipt: { action: string } }).receipt.action).toBe("already_present");
  });

  it("holds an unapproved producer at the gate and writes nothing", async () => {
    const puts: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") { puts.push(String(url)); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ values: [["Agent First Name", "Agent Last Name", "Agent NPN", "Direct Upline NPN", "Agent Mobile Number", "Agent Email", "Comp Level", "Advance Pay Tier", "Sub-Agency Name", "Sub-Agent Head?", "Life Licensed?", "$1M in E&O coverage?", "Portal Created (Completed by Ethos)", "Date Portal Created / Date Reparenting Completed", "Ethos Partner ID", "Ethos Partner Code", "https://agents.ethoslife.com/invite/", "Ethos Partnership Ops Notes", "Comments"]] }), { status: 200 });
    }) as never;
    const outcome = await deliverEthosSheet(INTAKE.id, deps({
      fetchImpl,
      googleCredential: '{"client_email":"a@b.c","private_key":"k"}',
      getToken: async () => "stub-token",
      loadEthosApproval: async () => null,
      readSetting: async (k) => (k === "ethos_agents_sheet" ? '{"sheet_id":"s","tab":"Agents"}' : k === "ethos_sheet_writes_enabled" ? "true" : null),
    }));
    expect(outcome.state).toBe("manual_review");
    expect(outcome.note).toContain("approval_comp_level_missing");
    expect(outcome.note).toContain("license_not_verified");
    expect(puts).toHaveLength(0);
  });
});

describe("contracting delivery · the failure path cannot erase the marker", () => {
  it("permits overwriting only the two un-settled states", () => {
    expect([...FAILURE_OVERWRITABLE_STATES]).toEqual(["queued", "failed"]);
  });

  it("never overwrites a settled or marker state", () => {
    // Each of these is load-bearing. The dispatcher writes the delivery row
    // BEFORE the outbox row, so a failure in that second write must not be able
    // to rewrite a settled 'delivered' back to 'failed' — the next claim would
    // POST again.
    for (const terminal of [
      "attempting", "unknown_outcome", "delivered", "accepted",
      "manual_review", "not_configured", "dead_letter",
    ]) {
      expect(FAILURE_OVERWRITABLE_STATES).not.toContain(terminal);
    }
  });

  it("a state-scoped update leaves a mid-flight row untouched", () => {
    // Models the dispatcher's `.in("state", FAILURE_OVERWRITABLE_STATES)`
    // filter against every state a row can be in when the catch fires.
    const overwrite = (current: string) =>
      (FAILURE_OVERWRITABLE_STATES as readonly string[]).includes(current) ? "failed" : current;

    expect(overwrite("attempting")).toBe("attempting");
    expect(overwrite("unknown_outcome")).toBe("unknown_outcome");
    expect(overwrite("queued")).toBe("failed");
    expect(overwrite("failed")).toBe("failed");
  });
});

describe("contracting delivery · settings reads never fake not_configured", () => {
  it("throws on a query error instead of returning null", () => {
    // Returning null would make a database outage indistinguishable from "no
    // webhook configured", and not_configured is terminal — one blip would
    // permanently mark the destination unconfigured with nothing to retry it.
    expect(() => readSettingFromResult({ error: { message: "connection reset" } }, "discord_webhook_url_contracting"))
      .toThrow(/connection reset/);
  });

  it("returns null only for a genuinely absent or blank value", () => {
    expect(readSettingFromResult({ data: null, error: null }, "k")).toBeNull();
    expect(readSettingFromResult({ data: { value: "   " }, error: null }, "k")).toBeNull();
    expect(readSettingFromResult({ data: { value: 42 }, error: null }, "k")).toBeNull();
  });

  it("returns a trimmed value when one is set", () => {
    expect(readSettingFromResult({ data: { value: "  https://x  " }, error: null }, "k")).toBe("https://x");
  });

  it("a settings outage surfaces as an error, not as not_configured", async () => {
    await expect(deliverContractingDiscord(INTAKE.id, deps({
      readSetting: async () => { throw new Error("connection reset"); },
    }))).rejects.toThrow(/connection reset/);
  });
});

describe("contracting delivery · Discord 4xx is definite, 5xx is ambiguous", () => {
  function h(status: number, body = "x") {
    const calls = { clear: 0, unknown: 0, posts: 0 };
    const state = { current: "queued" };
    return {
      calls,
      state,
      deps: {
        ...deps({
          readSetting: async (k: string) =>
            k === "discord_webhook_url_contracting" ? "https://discord.com/api/webhooks/fixture-not-a-real-webhook" : null,
          fetchImpl: (async () => { calls.posts++; return new Response(body, { status }); }) as never,
        }),
        currentState: async () => state.current,
        markAttempting: async () => { state.current = "attempting"; },
        clearAttempting: async () => { calls.clear++; state.current = "queued"; },
        markUnknownOutcome: async () => { calls.unknown++; state.current = "unknown_outcome"; },
        settle: async () => { state.current = "delivered"; },
      } as never,
    };
  }

  it("treats 400 as a definite rejection and allows a clean retry", async () => {
    const t = h(400);
    await expect(runContractingDelivery("contracting_discord", INTAKE.id, t.deps)).rejects.toThrow(/400/);
    // Discord parsed and refused; no message exists.
    expect(t.calls.clear).toBe(1);
    expect(t.state.current).toBe("queued");
  });

  it("treats 429 as definite too — rate limiting creates nothing", async () => {
    const t = h(429);
    await expect(runContractingDelivery("contracting_discord", INTAKE.id, t.deps)).rejects.toThrow(/429/);
    expect(t.calls.clear).toBe(1);
    expect(t.state.current).toBe("queued");
  });

  it("parks a 500 as unknown rather than retrying it", async () => {
    // The request was transmitted and accepted for processing. A gateway or
    // internal fault can occur after the message was created, so we do not know
    // whether it exists and must not post again to find out.
    const t = h(500);
    const result = await runContractingDelivery("contracting_discord", INTAKE.id, t.deps);
    expect(result.state).toBe("unknown_outcome");
    expect(t.calls.unknown).toBe(1);
    expect(t.calls.clear).toBe(0);
  });

  it("performs zero further POSTs after a 500", async () => {
    const t = h(500);
    await runContractingDelivery("contracting_discord", INTAKE.id, t.deps);
    expect(t.calls.posts).toBe(1);
    await runContractingDelivery("contracting_discord", INTAKE.id, t.deps);
    expect(t.calls.posts).toBe(1);
  });

  it("treats 503 as ambiguous as well", async () => {
    const t = h(503);
    expect((await runContractingDelivery("contracting_discord", INTAKE.id, t.deps)).state)
      .toBe("unknown_outcome");
  });
});

describe("contracting delivery · outbox persistence failure cannot reopen a repost", () => {
  /**
   * Models the dispatcher: delivery row is written first, the outbox row second.
   * When that second write throws, the outer catch runs a generic failure update
   * scoped to FAILURE_OVERWRITABLE_STATES.
   */
  function dispatcherRun(state: { current: string }, opts: { posts: { n: number }; outboxFails: boolean }) {
    const outerCatchOverwrite = () => {
      if ((FAILURE_OVERWRITABLE_STATES as readonly string[]).includes(state.current)) {
        state.current = "failed";
      }
    };
    return async () => {
      const t = {
        ...deps({
          readSetting: async (k: string) =>
            k === "discord_webhook_url_contracting" ? "https://discord.com/api/webhooks/fixture-not-a-real-webhook" : null,
          fetchImpl: (async () => {
            opts.posts.n++;
            return new Response(JSON.stringify({ id: "m" }), { status: 200 });
          }) as never,
        }),
        currentState: async () => state.current,
        markAttempting: async () => { state.current = "attempting"; },
        clearAttempting: async () => { state.current = "queued"; },
        markUnknownOutcome: async () => { state.current = "unknown_outcome"; },
        settle: async () => { state.current = "delivered"; },
      } as never;

      try {
        await runContractingDelivery("contracting_discord", INTAKE.id, t);
        if (opts.outboxFails) throw new Error("outbox update failed");
      } catch {
        outerCatchOverwrite();
      }
    };
  }

  it("keeps a delivered row delivered when the outbox write fails", async () => {
    const state = { current: "queued" };
    const posts = { n: 0 };

    await dispatcherRun(state, { posts, outboxFails: true })();
    expect(posts.n).toBe(1);
    // The provider acted and we recorded it. The later failure must not undo that.
    expect(state.current).toBe("delivered");

    // Next claim: the outbox row is retryable, but the delivery row is settled.
    await dispatcherRun(state, { posts, outboxFails: false })();
    expect(posts.n).toBe(1);
    expect(state.current).toBe("delivered");
  });

  it("keeps unknown_outcome terminal when the outbox write then fails", async () => {
    const state = { current: "unknown_outcome" };
    const posts = { n: 0 };

    await dispatcherRun(state, { posts, outboxFails: true })();
    expect(state.current).toBe("unknown_outcome");
    expect(posts.n).toBe(0);

    await dispatcherRun(state, { posts, outboxFails: false })();
    expect(posts.n).toBe(0);
  });

  it("still lets a genuinely queued row be marked failed", async () => {
    const state = { current: "queued" };
    if ((FAILURE_OVERWRITABLE_STATES as readonly string[]).includes(state.current)) state.current = "failed";
    expect(state.current).toBe("failed");
  });
});
