import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const migration = fs.readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261125100000_producer_status_and_run_rate.sql"), "utf8");
const cohort = migration.slice(migration.indexOf("create or replace function public.production_policy_cohort"));
const profile = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.producer_profile_detail"), migration.indexOf("-- Add identity provenance"));
const home = fs.readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261125101000_home_cohort_conversion.sql"), "utf8");
describe("operational SQL identity and cohort boundaries", () => {
  it("cannot collapse unrelated clients sharing a placeholder policy number such as 123456", () => {
    // Policy numbers are not identities: distinct deal IDs remain in the denominator.
    // This guards against reintroducing the observed 123456 fallback/deduplication defect.
    expect(cohort).not.toMatch(/distinct\s+on/i);
    expect(cohort).not.toContain("submission_key");
    expect(cohort).not.toContain("policy_number_key");
    expect(cohort).not.toContain("fn_carrier_pn_key");
    expect(cohort).toContain("and p.site_deal_id=d.id");
    expect(cohort).toContain("coalesce(pa.canonical_agent_id,pa.id)=d.agent_id");
    expect(cohort).toContain("lower(p.carrier)=lower(d.carrier)");
    expect(profile).toContain("and p.site_deal_id::text=b.row_key");
    expect(profile).not.toContain("fn_carrier_pn_key");
  });
  it("checks canonical self access and excludes future timestamps within the current day", () => {
    expect(cohort).toContain("coalesce(a.canonical_agent_id,a.id)=v_target and a.user_id=auth.uid()");
    expect(cohort).toContain("d.posted_at <= now()");
    expect(profile).toContain("nd.posted_at <= now()");
    expect(cohort).toContain("posted_date >= p_start and posted_date < p_end");
    expect(cohort).toContain("not conflict");
  });
  it("keeps financial source matching inside one carrier and emits scoped observation dates", () => {
    expect(migration).toContain("c.carrier = p.carrier and public.fn_carrier_pn_key(c.policy_number) = p.policy_key");
    expect(migration).toContain("case when carrier=''Chubb'' then ''Combined'' else carrier end as carrier");
    expect(migration).toContain("min(last_seen_on) as last_seen_on from p group by 1");
    expect(migration).toContain("''last_seen_on'', p.last_seen_on");
  });
  it("cannot count a future native timestamp later today as an observed recruiting conversion", () => {
    expect(home).toContain("p.posted_date<=v_today");
    expect(home).toContain("p.origin<>'apex_native' or exists(select 1 from public.deals nd");
    expect(home).toContain("nd.id::text=p.row_key and nd.posted_at<=now()");
    expect(home).toContain("public.home_conversion_people_range_uncached(date,date)");
    expect(home).not.toContain("create or replace function public.home_conversion_people_range(");
  });
});
