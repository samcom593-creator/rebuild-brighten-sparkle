import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MP-ONBOARD-ANCHOR-PKG2 (2026-11-12): licensed-hire activation contracts.
 *
 * These pin the safety properties that a rolled-back run against production proved once (see the PKG2 report):
 * every automatic sender is forward-only or capped, nobody suspended is reached, every person-facing email carries
 * Reply-To info@kingofsales.net, and the dialer's absence changes the next action. Comments are stripped before
 * matching so prose can neither satisfy nor trip an assertion (the MP-277 footnote lesson).
 */
const ROOT = resolve(__dirname, "../../..");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const sql = (f: string) => stripSql(readFileSync(resolve(ROOT, "supabase/migrations", f), "utf8"));
const ts = (f: string) => stripTs(readFileSync(resolve(ROOT, f), "utf8"));

const FOUNDATION = sql("20261112000200_pkg2_hire_lane_foundation.sql");
const NEXT_ACTION = sql("20261112000220_pkg2_hire_next_action.sql");
const STARTER = sql("20261112000230_pkg2_starter_packs.sql");
const AUDIENCE = sql("20261112000240_pkg2_numbers_reminder_audience.sql");
const CONTRACTING = sql("20261112000250_pkg2_contracting.sql");
const NEW_HIRE_RUNS = sql("20261112000255_pkg2_new_hire_flow_runs.sql");
const RECRUIT_EMAIL = sql("20261112000260_pkg2_recruit_owner_email.sql");
const INVOICES = sql("20261112000280_pkg2_dialer_invoice_guard.sql");

describe("dialer canceled: next action and settings", () => {
  it("creates dialer_status as canceled and the starter-pack switch OFF, never overwriting an existing value", () => {
    expect(FOUNDATION).toContain("('dialer_status', 'canceled_nonpayment')");
    expect(FOUNDATION).toContain("('onboarding_starter_pack_enabled', 'false')");
    expect(FOUNDATION).toMatch(/on conflict \(key\) do nothing;/);
  });

  it("a dialer seat is a next action only while dialer_status is active", () => {
    expect(NEXT_ACTION).toMatch(/when cfg\.dialer_status = 'active' and not coalesce\(ds\.has_open_seat, false\)/);
    expect(NEXT_ACTION).toMatch(/and dialer_status = 'active'\s+and not has_open_seat/);
  });

  it("suspended people are off the activation population and the launch board", () => {
    expect(NEXT_ACTION.match(/agent_access_suspensions s on s\.user_id = g\.user_id and s\.lifted_at is null/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("starter packs", () => {
  it("defaults to a dry run, caps each run, and the daily job runs live only behind the switch", () => {
    expect(STARTER).toContain("fn_grant_starter_packs(p_dry_run boolean default true, p_limit integer default 10)");
    expect(STARTER).toMatch(/onboarding_starter_pack_enabled'\)\)\), 'false'\) <> 'true' then/);
    expect(STARTER).toContain("from public.fn_grant_starter_packs(false, 10) g");
  });

  it("ready = licensed, signed in since hire, hired 45 days or less, not suspended, no live pack, never given one before", () => {
    expect(STARTER).toContain("a.created_at >= now() - interval '45 days'");
    expect(STARTER).toContain("p.last_sign_in_at is null or p.last_sign_in_at < p.created_at then 'not_signed_in_since_hire'");
    expect(STARTER).toContain("public.fn_agent_is_suspended(p.id) then 'suspended'");
    expect(STARTER).toContain("then 'has_live_lead_bundle'");
    expect(STARTER).toContain("then 'starter_pack_already_given'");
    expect(STARTER).toContain("then 'license_state_unknown'");
  });

  it("a pack is tier A then B, in the agent's licensed states, off every do-not-call list, in no other live pack", () => {
    expect(STARTER).toContain("p.tier in ('A', 'B')");
    expect(STARTER).toContain("upper(btrim(p.state)) = any (p_states)");
    expect(STARTER).toContain("lower(coalesce(c.disposition, '')) = 'do not call'");
    expect(STARTER).toContain("i.status = 'do_not_call'");
    expect(STARTER).toContain("public.lead_resale_ledger");
    expect(STARTER).toContain("public.v_leads_suppression_all");
    expect(STARTER).toContain("on conflict (phone10) where (removed_at is null) do nothing");
  });

  it("one email per agent ever, in the agreed words, signed in straight to My Leads", () => {
    expect(STARTER).toContain("'starter_pack:' || c.agent_id::text");
    expect(STARTER).toContain("'Call them from your phone between 8 AM and 7 PM their time, and log each call.'");
    expect(STARTER).toContain("v_subject, v_text, v_html, null, 'leads',");
    expect(STARTER).not.toMatch(/\$\d|income|earn/i);
  });
});

describe("the email outbox", () => {
  it("dispatch defaults to dry run, sends through send-email with Reply-To info@kingofsales.net, 5 per tick", () => {
    expect(FOUNDATION).toContain("fn_hire_lane_email_dispatch(p_limit integer default 5, p_dry_run boolean default true)");
    expect(FOUNDATION).toContain("'/functions/v1/send-email'");
    expect(FOUNDATION).toContain("'reply_to', 'info@kingofsales.net'");
    expect(FOUNDATION).toContain("select cron.schedule('apex-hire-lane-email', '*/5 * * * *', 'select public.fn_hire_lane_email_tick(false)');");
  });

  it("re-checks suspension and opt-out at send time and counts a send only on a provider id", () => {
    const dispatch = FOUNDATION.slice(FOUNDATION.indexOf("create or replace function public.fn_hire_lane_email_dispatch"));
    expect(dispatch).toContain("public.fn_user_is_suspended(r.recipient_user_id)");
    expect(dispatch).toContain("public.email_unsubscribes");
    expect(FOUNDATION).toMatch(/v_code = 200 and coalesce\(v_body ->> 'ok', ''\) = 'true' and nullif\(v_body ->> 'id', ''\) is not null/);
  });

  it("a one-tap token is minted at dispatch, never in a dry run", () => {
    const dispatch = FOUNDATION.slice(FOUNDATION.indexOf("create or replace function public.fn_hire_lane_email_dispatch"),
                                      FOUNDATION.indexOf("create or replace function public.fn_hire_lane_email_settle"));
    expect(dispatch.indexOf("if p_dry_run then")).toBeLessThan(dispatch.indexOf("insert into public.magic_login_tokens"));
  });
});

describe("numbers reminder", () => {
  const fn = ts("supabase/functions/numbers-reminder/index.ts");

  it("reads its audience from the view, never every licensed agent", () => {
    expect(fn).toMatch(/sb\.rpc\("fn_numbers_reminder_audience"\)/);
    expect(AUDIENCE).toContain("select n.agent_id, n.user_id, n.display_name, n.reason from public.v_numbers_reminder_audience n");
    expect(fn).not.toMatch(/\.from\("agents"\)\s*\.select\("id, user_id, display_name"\)/);
  });

  it("the audience is agents who can produce, minus anyone suspended", () => {
    expect(AUDIENCE).toContain("as has_active_pack");
    expect(AUDIENCE).toContain(">= current_date - 60) as has_deal_60d");
    expect(AUDIENCE).toContain("b.created_at >= now() - interval '21 days' as new_hire_21d");
    expect(AUDIENCE).toContain("where not f.suspended");
  });

  it("sets Reply-To on the email", () => {
    expect(fn).toContain("reply_to: BRAND_REPLY_TO,");
  });
});

describe("contracting", () => {
  it("an empty required-carrier list means any one appointment; a first deal also counts", () => {
    expect(CONTRACTING).toMatch(/if cardinality\(v_required\) = 0 then\s+update public\.agents set contracted_at = new\.confirmed_at/);
    expect(CONTRACTING).toContain("create trigger trg_pkg2_contracted_from_deal");
    expect(CONTRACTING).toContain("create trigger trg_pkg2_contracted_from_external_deal");
  });

  it("the one-time backfill defaults to a dry run and stays data-only", () => {
    expect(CONTRACTING).toContain("fn_backfill_contracted_at(p_dry_run boolean default true)");
    expect(CONTRACTING).toContain("alter table public.agents disable trigger trg_next_step_agents_update;");
    expect(CONTRACTING).toContain("alter table public.agents disable trigger trg_agent_activated_discord;");
    expect(CONTRACTING).toContain("alter table public.agents enable trigger trg_next_step_agents_update;");
    expect(CONTRACTING).toContain("not public.fn_discord_paused()");
  });

  it("the request at licensed hire is forward-only, writes no delivery legs, and pages the owner once per hire", () => {
    expect(CONTRACTING).toContain("public.fn_contracting_request_due(public.fn_contracting_request_cutoff())");
    expect(CONTRACTING).toContain("'contracting_request:' || p_agent_id::text");
    expect(CONTRACTING).not.toContain("contracting_intake_deliveries");
    expect(CONTRACTING).not.toMatch(/insert into public\.outbox_events/);
    expect(CONTRACTING).toContain("fn_contracting_request_backfill(p_dry_run boolean default true");
  });
});

describe("new-hire live flow", () => {
  const fn = ts("supabase/functions/trigger-new-hire-flow/index.ts");

  it("no phantom poster: team chat posts as Sam's real login", () => {
    expect(fn).not.toContain("4491dc82");
    expect(fn).toContain('supabase.rpc("fn_recruit_sam_user_id")');
  });

  it("checks suspension for the hire and the manager", () => {
    expect(fn).toContain('supabase.rpc("fn_agent_is_suspended", { p_agent_id: agentId })');
    expect(fn).toContain('supabase.rpc("fn_agent_is_suspended", { p_agent_id: m.id })');
  });

  it("leases instead of claiming the agent before the send; unlock happens at finish", () => {
    expect(fn).toContain('supabase.rpc("fn_new_hire_flow_claim", { p_agent_id: agentId })');
    expect(fn).not.toMatch(/\.update\(\{ has_production_access: true, production_unlocked_at/);
    expect(NEW_HIRE_RUNS).toMatch(/if p_done then[\s\S]*has_production_access = true, production_unlocked_at = coalesce\(production_unlocked_at, now\(\)\)/);
    expect(NEW_HIRE_RUNS).toContain("and r.attempts < 3");
  });

  it("every email has Reply-To and the SMS leg is gone", () => {
    expect(fn.match(/reply_to: BRAND_REPLY_TO/g)?.length).toBe(3);
    expect(fn).not.toContain("send-sms-auto-detect");
  });
});

describe("recruit owner email", () => {
  it("an hourly cap per owner, forward-only from the WP3 cutoff, untouched recruits only", () => {
    expect(RECRUIT_EMAIL).toContain("o.kind = 'recruit_page' and o.recipient_user_id = r.uid");
    expect(RECRUIT_EMAIL).toContain("and o.created_at > now() - interval '1 hour'");
    expect(RECRUIT_EMAIL).toContain("l.created_at >= greatest(v_cutoff, now() - interval '24 hours')");
    expect(RECRUIT_EMAIL).toContain("and a.human_last_contact_at is null");
  });

  it("one digest email per owner per Phoenix day; the backlog is a count, names are post-go-live only", () => {
    expect(RECRUIT_EMAIL).toContain("'recruit_digest:' || r.uid::text || ':' || to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD')");
    expect(RECRUIT_EMAIL).toContain("q.sla_state = 'NEW_UNTOUCHED' and q.post_deploy");
  });
});

describe("dialer invoices", () => {
  it("no invoice row while the dialer is not active, from the function or any other writer", () => {
    expect(INVOICES).toMatch(/'unset'\) <> 'active' then\s+raise notice/);
    expect(INVOICES).toContain("before insert on public.dialer_weekly_payments");
  });
});
