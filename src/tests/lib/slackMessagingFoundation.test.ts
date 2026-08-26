import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  renderSlackEventText,
  SLACK_EDGE_EMITTERS,
  SLACK_TEMPLATED_EVENT_TYPES,
} from "../../../supabase/functions/apex-outbox-dispatcher/slack-event-templates.ts";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("Slack messaging foundation", () => {
  it("stores semantic routes and idempotent provider receipts without raw tokens", () => {
    const migration = source("supabase/migrations/20260826001000_slack_messaging_foundation.sql");
    for (const table of [
      "messaging_workspace_installations",
      "messaging_identity_links",
      "messaging_destinations",
      "messaging_route_rules",
      "messaging_delivery_receipts",
    ]) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("unique (installation_id, idempotency_key)");
    expect(migration).toContain("bot_token_secret_ref");
    expect(migration).not.toContain("bot_token text");
  });

  it("keeps contracting on the immediate onboarding result", () => {
    const page = source("src/pages/StartContracting.tsx");
    const result = source("src/components/contracting/ContractingSuccessModal.tsx");
    expect(page).toContain("<ContractingSuccessModal accepted={accepted}");
    expect(result).toContain("Contracting Initiated — Fast Track Active");
    expect(result).toContain("Book instant onboarding");
    expect(`${page}\n${result}`.toLowerCase()).not.toContain("in a queue");
    expect(`${page}\n${result}`.toLowerCase()).not.toContain("pending review");
  });

  it("provides an admin-only live Slack and destination health probe", () => {
    const health = source("supabase/functions/slack-integration-health/index.ts");
    expect(health).toContain('callSlack<SlackAuthResult>("auth.test"');
    expect(health).toContain('callSlack<SlackConversationResult>("conversations.info"');
    expect(health).toContain('from("messaging_destinations")');
    expect(health).toContain('rpc("apex_is_admin")');
    expect(health).not.toContain("SLACK_BOT_TOKEN:");
  });

  it("routes licensing milestones through the durable Slack receipt ledger", () => {
    const migration = source("supabase/migrations/20260826005000_candidate_workflow_and_slack_milestones.sql");
    const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");
    expect(migration).toContain("public.candidate_smart_goals");
    expect(migration).toContain("public.candidate_notes");
    expect(migration).toContain("public.licensing_milestone_events");
    expect(migration).toContain("candidate.licensing_milestone");
    expect(migration).toContain("on conflict (idempotency_key) do nothing");
    expect(migration).not.toContain("create table if not exists public.policies");
    expect(dispatcher).toContain('event.destination === "slack"');
    expect(dispatcher).toContain('from("messaging_delivery_receipts")');
    expect(dispatcher).toContain('https://slack.com/api/chat.postMessage');
    expect(dispatcher).not.toContain("C01LICENSING");
  });

  it("binds the production workspace to verified semantic channels and core event routes", () => {
    const routes = source("supabase/migrations/20260826013000_apex_slack_live_routes.sql");
    const templates = source("supabase/functions/apex-outbox-dispatcher/slack-event-templates.ts");

    expect(routes).toContain("T0BSN03M2AJ");
    expect(routes).toContain("C0BTJLBKC2C");
    expect(routes).toContain("C0BSTVB98DA");
    expect(routes).toContain("C0BSNBA5NES");
    for (const eventType of [
      "candidate.application_submitted",
      "candidate.licensing_milestone",
      "contracting.intake_submitted",
      "deal.posted",
    ]) {
      expect(routes).toContain(eventType);
      expect(templates).toContain(`"${eventType}"`);
    }
    expect(routes).toContain("SLACK_BOT_TOKEN");
    expect(routes).not.toContain("xoxb-");
    expect(routes).not.toContain("'email'");
    expect(routes).not.toContain("'phone'");
    expect(routes).not.toContain("clientName");
  });
});

describe("Slack delivery lease + interview no-show (20260826053000)", () => {
  const migration = source("supabase/migrations/20260826053000_slack_noshow_and_delivery_lease.sql");
  const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");
  const health = source("supabase/functions/slack-integration-health/index.ts");

  it("leases one receipt per (event, destination) atomically, service role only", () => {
    expect(migration).toContain("create or replace function public.claim_messaging_delivery_receipt(");
    expect(migration).toContain("returns setof public.messaging_delivery_receipts");
    expect(migration).toContain("on conflict (outbox_event_id, destination_id) do nothing");
    expect(migration).toContain("for update;");
    expect(migration).toContain("if auth.role() <> 'service_role' then");
    expect(migration).toContain("if v_row.status = 'delivered' then");
    // stale-lease threshold is single-sourced; the stats RPC reads the same function
    expect(migration.match(/public\.messaging_receipt_lease_interval\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(migration).toMatch(/grant execute on function public\.claim_messaging_delivery_receipt[^;]*\bto service_role/);
    expect(migration).toMatch(/revoke all on function public\.claim_messaging_delivery_receipt[^;]*from public, anon, authenticated/);
  });

  it("dispatcher takes the lease BEFORE chat.postMessage and never inserts receipts directly", () => {
    const leaseAt = dispatcher.indexOf('rpc("claim_messaging_delivery_receipt"');
    const postAt = dispatcher.indexOf("https://slack.com/api/chat.postMessage");
    expect(leaseAt).toBeGreaterThan(-1);
    expect(postAt).toBeGreaterThan(leaseAt);
    expect(dispatcher).not.toMatch(/from\("messaging_delivery_receipts"\)\s*\.insert\(/);
    // no-row = another worker's lease; delivered row = skip the post
    expect(dispatcher).toContain("leasedElsewhere += 1");
    expect(dispatcher).toContain('if (receipt.status === "delivered") {');
    // success writes the provider receipt; failure backs off inside the vocabulary the CHECK allows
    expect(dispatcher).toContain("provider_response_hash: await sha256Hex(rawBody)");
    expect(dispatcher).toContain('status: exhausted ? "dead_letter" : "retrying"');
    expect(dispatcher).not.toMatch(/status: "failed"[\s\S]{0,200}messaging_delivery_receipts/);
    // a failed destination no longer aborts the fan-out
    expect(dispatcher).toContain("failures.push(note);");
    expect(dispatcher).toContain("Slack delivery failed for ${failures.length} of ${routes.length} route(s)");
    expect(dispatcher).toContain("renderSlackEventText(");
  });

  it("queues one PII-free no-show event per interview row and routes it urgently", () => {
    expect(migration).toContain("create trigger trg_queue_interview_noshow_slack");
    expect(migration).toContain("after insert or update of outcome on public.interview_events");
    expect(migration).toContain("'candidate.interview_noshow'");
    expect(migration).toContain("old.outcome is not distinct from 'no_show'");
    const fnStart = migration.indexOf("create or replace function public.fn_queue_interview_noshow_slack()");
    const fnEnd = migration.indexOf("drop trigger if exists trg_queue_interview_noshow_slack");
    expect(fnStart).toBeGreaterThan(-1);
    const noshowFn = migration.slice(fnStart, fnEnd);
    expect(noshowFn).not.toContain("invitee_email");
    expect(noshowFn).not.toContain("invitee_phone");
    expect(noshowFn).toContain("'urgentFollowup', true");
    expect(noshowFn).toContain("'candidate.interview_noshow:' || new.id::text || ':slack'");
    expect(noshowFn).toContain("on conflict (idempotency_key) do nothing");
    expect(migration).toMatch(/'candidate\.interview_noshow',\s*'recruiting_growth',\s*0::smallint/);
    expect(migration).toMatch(/'candidate\.licensing_milestone',\s*'licensing_support',\s*2::smallint/);
  });

  it("renders the no-show template without phone or email and links interview recovery", () => {
    const text = renderSlackEventText("candidate.interview_noshow", {
      candidateName: "ZZ E2E TESTUSER DELETE",
      urgentFollowup: true,
      openUrl: "https://apex-financial.org/dashboard/recruiting/follow-ups",
      // a payload that smuggles contact data must still render clean
      inviteePhone: "6015551234",
      inviteeEmail: "zz@example.com",
    });
    expect(text).toBe(
      ":rotating_light: No-show — *ZZ E2E TESTUSER DELETE* missed their interview. Urgent follow-up: <https://apex-financial.org/dashboard/recruiting/follow-ups|Open interview recovery>",
    );
    expect(text).not.toContain("6015551234");
    expect(text).not.toContain("zz@example.com");
    // off-domain URLs are replaced with the canonical recovery route
    const hostile = renderSlackEventText("candidate.interview_noshow", { openUrl: "https://evil.example/x" });
    expect(hostile).toContain("https://apex-financial.org/dashboard/recruiting/follow-ups");
    expect(hostile).not.toContain("evil.example");
    // the SPA really serves that route (the /dashboard/interview-recovery URL is a legacy redirect to it)
    expect(source("src/App.tsx")).toContain('path="/dashboard/recruiting/follow-ups"');
  });

  it("deal.posted names the producer, premium, carrier and product and never the client", () => {
    const text = renderSlackEventText("deal.posted", {
      agentName: "KJ Vaughn",
      annualPremium: 2124,
      carrierName: "Mutual of Omaha",
      productCategory: "IUL",
      clientName: "Jane Policyholder",
      clientFirstName: "Jane",
      clientPhone: "6015550000",
      clientDob: "1970-01-01",
    });
    expect(text).toContain("*KJ Vaughn*");
    expect(text).toContain("$2,124");
    expect(text).toContain("Mutual of Omaha");
    expect(text).toContain("IUL");
    for (const leak of ["Jane", "Policyholder", "6015550000", "1970"]) expect(text).not.toContain(leak);

    const fnStart = migration.indexOf("create or replace function public.fn_queue_deal_slack()");
    const fnEnd = migration.indexOf("-- ── 5. Routes");
    expect(fnStart).toBeGreaterThan(-1);
    const dealFn = migration.slice(fnStart, fnEnd);
    expect(dealFn).toContain("'carrierName', v_carrier_name");
    expect(dealFn).toContain("'agentName', coalesce(v_agent_name, 'APEX producer')");
    for (const forbidden of [
      "client_first_name", "client_last_name", "client_name", "client_phone",
      "client_email", "client_dob", "date_of_birth", "clientName",
    ]) {
      expect(dealFn).not.toContain(forbidden);
    }
  });

  it("refuses to guess a template for an unknown event type", () => {
    expect(renderSlackEventText("recruiting.application_submitted", { candidateName: "x" })).toBeNull();
    expect(renderSlackEventText("", {})).toBeNull();
    expect(dispatcher).toContain("No Slack template exists for event type");
  });

  it("templates cover every live route and every emitter", () => {
    for (const eventType of [
      "candidate.application_submitted",
      "candidate.licensing_milestone",
      "candidate.interview_noshow",
      "contracting.intake_submitted",
      "deal.posted",
      "free_leads.weekly_summary",
      "production.personal_record",
      "recruiting.bounty_qualified",
      "recruiting.bounty_reversed",
    ]) {
      expect(SLACK_TEMPLATED_EVENT_TYPES).toContain(eventType);
      expect(renderSlackEventText(eventType, {})).not.toBeNull();
    }
    expect(SLACK_EDGE_EMITTERS["free_leads.weekly_summary"]).toBe("edge:free-leads-weekly-alerts");
    expect(SLACK_EDGE_EMITTERS["production.personal_record"]).toBe("cron:apex-personal-records-15min");
    expect(SLACK_EDGE_EMITTERS["recruiting.bounty_qualified"]).toBe("cron:apex-recruiter-bounties-15min");
    expect(renderSlackEventText("production.personal_record", { agentName: "Jontay Taylor", recordType: "daily_alp", value: 2651.64, previousBest: 1200, clientName: "LEAK" })).not.toContain("LEAK");
    expect(renderSlackEventText("recruiting.bounty_qualified", { recruiterName: "Wendell Funderburg", recruitName: "New Agent", amountCents: 50000, policies: 2 })).toContain("$500");
    expect(source("supabase/functions/free-leads-weekly-alerts/index.ts"))
      .toContain('event_type: "free_leads.weekly_summary"');
  });

  it("health probe reports route coverage and receipt stats and never launders unknown into ok", () => {
    expect(health).toContain('rpc("slack_outbox_emitters")');
    expect(health).toContain('rpc("slack_delivery_receipt_stats"');
    expect(health).toContain("route_coverage");
    expect(health).toContain("emitters_without_route");
    expect(health).toContain("routes_without_template");
    expect(health).toContain("claimed_stale");
    expect(health).toContain('"no_traffic"');
    expect(health).toContain('&& coverageStatus === "ok"');
    expect(health).toContain('(deliveryStatus === "ok" || deliveryStatus === "no_traffic")');
    expect(health).toContain("bearer === serviceRoleKey");
    expect(migration).toContain("create or replace function public.slack_outbox_emitters()");
    expect(migration).toContain("create or replace function public.slack_delivery_receipt_stats(");
    expect(migration).toContain("from pg_proc p");
  });
});
