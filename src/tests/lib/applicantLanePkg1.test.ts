// MP-ONBOARD-ANCHOR-PKG1 (2026-11-12): applicant-lane contracts that span the edge functions
// and the migrations, held in one place so a later edit to either side fails here first.
//   - the day-0 welcome: one button, no income claim, no promised call-back, Reply-To the one
//     inbox that exists, staff copies by BCC (never CC), the status page always linked;
//   - every PKG1 recruit-facing sender sets a live Reply-To;
//   - the dispatcher asks the send gate before any rung, strips the dead mailto, and never
//     treats a Telegram queue row or a gateway SMS as a delivery;
//   - the migrations: one drip (cadence + cron 108 unscheduled), retry drain dry-run by
//     default, forward-only anchors, service-role-only definer functions.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApplicantWelcome } from "../../../supabase/functions/submit-application/welcome.ts";
import { RECRUIT_REPLY_TO, resolveReplyTo } from "../../../supabase/functions/_shared/reply-to.ts";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const MIG = "supabase/migrations";
const pkg1Migrations = fs.readdirSync(path.join(root, MIG)).filter((f) => /^20261112000[1]\d\d_pkg1_.*\.sql$/.test(f)).sort();
const migration = (prefix: string) => {
  const f = pkg1Migrations.find((m) => m.startsWith(prefix));
  if (!f) throw new Error(`missing migration ${prefix}`);
  return read(`${MIG}/${f}`);
};

describe("day-0 welcome (submit-application)", () => {
  const app = "00000000-0000-4000-8000-0000000000aa";
  it.each(["licensed", "pending", "unlicensed"])("%s: one button, status page, no claim, no promise", (licenseStatus) => {
    const w = buildApplicantWelcome({ applicationId: app, firstName: "Ana", lastName: "Ruiz", email: "ana@example.com", licenseStatus });
    expect((w.html.match(/display:inline-block/g) ?? []).length).toBe(1);
    expect(w.html).toContain(`/status/${app}`);
    expect(`${w.subject} ${w.text}`).not.toMatch(/\$\s?\d|earn|income|per month|within (24|48) hours|manager will/i);
    expect(w.subject).toMatch(/Galaxy|Sam/);
  });

  it("the send uses Reply-To, BCC for staff, and the built welcome; no CC, no inline income copy", () => {
    const src = read("supabase/functions/submit-application/index.ts");
    expect(src).toContain("reply_to: RECRUIT_REPLY_TO");
    expect(src).toContain("bcc: bccList");
    expect(src).toContain("subject: welcome.subject");
    expect(src).not.toMatch(/\bcc:\s*ccList/);
    expect(src).not.toMatch(/\$23,000|\$5,000|\$10,000|earning immediately|Almost Ready to Earn/);
    expect(src).not.toMatch(/within 24 hours|within 48 hours/);
    // a suspended manager gets no copy and no notification
    expect(src).toContain("!managerInfo.suspended");
  });
});

describe("reply path", () => {
  it("the shared default is the one inbox that exists; dead and empty values cannot replace it", () => {
    expect(RECRUIT_REPLY_TO).toBe("info@kingofsales.net");
    expect(resolveReplyTo("")).toBe(RECRUIT_REPLY_TO);
    expect(resolveReplyTo("hello@apex-financial.org")).toBe(RECRUIT_REPLY_TO);
    const email = read("supabase/functions/_shared/email.ts");
    expect(email).toContain('BRAND_REPLY_TO = resolveReplyTo(Deno.env.get("EMAIL_REPLY_TO"))');
    expect(email).toContain("reply_to: resolveReplyTo(reply_to ?? DEFAULT_REPLY_TO)");
  });

  it("send-notification and system-health-check set an explicit Reply-To on every send", () => {
    // code only: comments in these files quote resend.emails.send() while explaining history
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const sn = code(read("supabase/functions/send-notification/index.ts"));
    const snSends = (sn.match(/resend\.emails\.send\(/g) ?? []).length;
    expect(snSends).toBe(2);
    expect((sn.match(/reply_to: RECRUIT_REPLY_TO/g) ?? []).length).toBe(snSends);
    const shc = code(read("supabase/functions/system-health-check/index.ts"));
    const shcSends = (shc.match(/resend\.emails\.send\(/g) ?? []).length;
    expect(shcSends).toBe(1);
    expect((shc.match(/reply_to: RECRUIT_REPLY_TO/g) ?? []).length).toBe(shcSends);
  });
});

describe("next-step-dispatch", () => {
  const src = read("supabase/functions/next-step-dispatch/index.ts");
  it("asks the send gate before any rung and records skips and deferrals on the row", () => {
    const gateAt = src.indexOf('supabase.rpc("fn_next_step_send_gate"');
    const ladderAt = src.indexOf("await runLadder(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(ladderAt).toBeGreaterThan(-1);
    expect(src.indexOf("const gate = await gateFor(msg, person.email)")).toBeLessThan(ladderAt);
    expect(src).toContain("error: `skipped: ${verdict.reason ?? \"gate\"}`");
    expect(src).toContain("not_before: verdict.not_before");
  });

  it("claims rows atomically, strips the dead mailto, and records the Reply-To on each email", () => {
    expect(src).toContain('supabase.rpc("fn_next_step_claim"');
    expect(src).toContain("stripDeadReplyStop(");
    expect(src).toContain("reply_to: BRAND_REPLY_TO");
    expect(src).toContain("metadata: { reply_to: BRAND_REPLY_TO");
  });

  it("a Telegram queue row no longer stamps the parent as sent", () => {
    const tg = src.slice(src.indexOf("// Channel 1: Telegram"), src.indexOf("// Channel 2: SMS"));
    expect(tg).not.toMatch(/sent_at/);
  });
});

describe("migrations", () => {
  it("are in PKG1's version range, each with a header comment", () => {
    expect(pkg1Migrations.length).toBe(9);
    for (const f of pkg1Migrations) {
      const v = Number(f.slice(0, 14));
      expect(v).toBeGreaterThanOrEqual(20261112000100);
      expect(v).toBeLessThanOrEqual(20261112000199);
      expect(read(`${MIG}/${f}`).startsWith("-- MP-ONBOARD-ANCHOR-PKG1")).toBe(true);
    }
  });

  it("one drip: applied / licensed_book_call at hour 24, 72, 168; call_booked one post-call step; cron 108 unscheduled", () => {
    const copy = migration("20261112000110");
    expect(copy.match(/reminder_cadence = 'hour:24,72,168'/g)?.length).toBe(2);
    expect(copy).toContain("reminder_cadence = 'hour:24'");
    expect(copy).not.toMatch(/'[^']*mailto:hello@apex-financial\.org[^']*'\s*\|\|/);
    const cron = migration("20261112000130");
    expect(cron).toContain("jobname = 'apex-followup-emails-daily'");
    expect(cron).toContain("cron.unschedule");
  });

  it("send-capable functions default to dry run; the cron passes p_dry_run => false explicitly", () => {
    const drain = migration("20261112000120");
    expect(drain).toContain("fn_next_step_retry_drain(p_dry_run boolean default true");
    expect(drain).toContain("fn_next_step_retry_drain(p_dry_run => false");
    const reapply = migration("20261112000150");
    expect(reapply).toContain("p_dry_run boolean default true");
    expect(reapply).toContain("interval '30 days'");
  });

  it("every new SECURITY DEFINER function pins search_path and is closed to anon", () => {
    for (const f of pkg1Migrations) {
      const sql = read(`${MIG}/${f}`);
      const defs = [...sql.matchAll(/create or replace function (public\.[a-z0-9_]+)\(/gi)].map((m) => m[1]);
      for (const fn of defs) {
        const body = sql.slice(sql.indexOf(fn));
        if (!/security definer/i.test(body.slice(0, 2500))) continue;
        expect(body.slice(0, 2500), `${f} ${fn}`).toMatch(/set search_path/i);
        if (fn === "public.applications_flag_duplicates") continue; // trigger function, replaced in place
        expect(sql, `${f} ${fn}`).toMatch(new RegExp(`revoke all on function ${fn.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`, "i"));
      }
    }
  });

  it("the owned-people view and the health view are service-role only", () => {
    const owned = migration("20261112000170");
    expect(owned).toContain("revoke all on public.v_onboarding_owned_people from public, anon, authenticated");
    expect(owned).toContain("grant select on public.v_onboarding_owned_people to service_role");
    const health = migration("20261112000180");
    expect(health).toContain("revoke all on public.v_applicant_lane_pkg1_health from public, anon, authenticated");
  });
});
