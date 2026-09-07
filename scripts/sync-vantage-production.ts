import { ORGANIZATION_ID, snapshotRow, syncDays, validateProduction } from "./lib/vantage-production.ts";

// Scheduled on GitHub Actions. Credentials live in encrypted repository secrets;
// no browser, provider login, local Mac uptime, or management PAT is required.
const key = process.env.VANTAGE_PRODUCTION_API_KEY;
const botToken = process.env.VANTAGE_SYNC_BOT_TOKEN;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

async function main() {
  if (!key || !botToken) throw new Error("Required sync credentials are not configured");
  const today = new Date().toISOString().slice(0, 10);
  const days = syncDays({ reconcile: args.has("--reconcile") }, today);
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`https://useagentcloud.com/api/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "APEX-Vantage-Production-Sync/1.0" },
      redirect: "error", signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Provider returned HTTP ${res.status} or non-JSON content`);
    }
    return res.json();
  };
  const identity = await get("whoami") as { organization_id?: string; organization?: string; scopes?: string[] };
  if (identity.organization_id !== ORGANIZATION_ID || identity.organization !== "Vantage Financial"
    || !identity.scopes?.includes("production:read") || !identity.scopes.includes("producers:read")) {
    throw new Error("Provider identity or read scopes do not match Vantage Financial");
  }
  const rows: ReturnType<typeof snapshotRow>[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < days.length; i += 4) {
    rows.push(...await Promise.all(days.slice(i, i + 4).map(async day =>
      snapshotRow(day, validateProduction(await get(`production?start=${day}&end=${day}`), day), now))));
  }
  const last = days[days.length - 1];
  const period = validateProduction(await get(`production?start=${days[0]}&end=${last}`), days[0], last);
  if (Math.abs(rows.reduce((n, r) => n + r.reported_alp, 0) - period.totals.premium) > 0.011
    || rows.reduce((n, r) => n + r.reported_policies, 0) !== period.totals.policies
    || Math.abs(rows.reduce((n, r) => n + r.metadata.placed_premium, 0) - period.totals.placed) > 0.011) {
    throw new Error("Daily totals disagree with the period; previous snapshots retained");
  }
  if (!dryRun) {
    // JSON is escaped as a SQL string, not interpolated into identifiers. The
    // typed recordset constrains every field and the write is one transaction.
    const literal = "'" + JSON.stringify(rows).replaceAll("'", "''") + "'";
    const query = `with incoming as (
      select * from jsonb_to_recordset(${literal}::jsonb) as x(
        agency_name text, business_date date, reported_policies integer,
        reported_alp numeric, source text, external_ref text, reported_at timestamptz,
        updated_at timestamptz, metadata jsonb
      )
    ), saved as (
      insert into public.production_external_daily_snapshots
        (agency_name,business_date,reported_policies,reported_alp,source,external_ref,reported_at,updated_at,metadata)
      select agency_name,business_date,reported_policies,reported_alp,source,external_ref,reported_at,updated_at,metadata from incoming
      on conflict (agency_name,business_date,source) do update set
        reported_policies=excluded.reported_policies, reported_alp=excluded.reported_alp,
        external_ref=excluded.external_ref, reported_at=excluded.reported_at,
        updated_at=excluded.updated_at, metadata=excluded.metadata
      returning business_date
    ) select count(*)::integer as saved_days from saved`;
    const response = await fetch("https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql", {
      method: "POST", headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Snapshot storage returned HTTP ${response.status}`);
    const result = await response.json() as { ok?: boolean; rows?: { saved_days: number }[] };
    if (!result.ok || result.rows?.[0]?.saved_days !== rows.length) throw new Error("Snapshot storage did not acknowledge every day");
  }
  console.log(JSON.stringify({ ok: true, dry_run: dryRun, days: rows.length, start: days[0], end: last, totals: period.totals, synced_at: now }));
}

main().catch(error => {
  // Do not emit request headers, raw provider responses, SQL, or stack traces.
  let message = error instanceof Error ? error.message : "Sync failed";
  for (const secret of [key, botToken]) if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(JSON.stringify({ ok: false, error: message, previous_snapshots_retained: true }));
  process.exitCode = 1;
});
