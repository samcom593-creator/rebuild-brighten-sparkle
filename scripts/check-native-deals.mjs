import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260811221000_apex_native_deal_workflow.sql");
const parityMigration = read("supabase/migrations/20260823140000_post_a_deal_parity.sql");
const productsMigration = read("supabase/migrations/20260823152000_carrier_products.sql");
const discordMigration = read("supabase/migrations/20260824040000_durable_every_deal_discord.sql");
const dispatcher = read("supabase/functions/apex-outbox-dispatcher/index.ts");
const discordNotify = read("supabase/functions/discord-webhook-notify/index.ts");
const dialog = read("src/components/deals/SubmitDealDialog.tsx");
const production = read("src/pages/MyDeals.tsx");
const legacyPost = read("supabase/functions/post-deal/index.ts");

const requirements = [
  [migration, "create or replace function public.save_apex_deal_draft", "server draft RPC"],
  [migration, "create or replace function public.submit_apex_deal", "transactional submit RPC"],
  [migration, "perform pg_advisory_xact_lock", "concurrent idempotency lock"],
  [migration, "when (new.status <> 'draft')", "legacy draft trigger isolation"],
  [migration, "transition_apex_deal_status", "versioned review transition"],
  [migration, "public.apex_can_read_agent(d.agent_id)", "manager evidence access"],
  [migration, "da.object_path = name and da.deal_id is not null", "submitted evidence deletion guard"],
  [migration, "'attachment.scan_requested', 'file_scan'", "evidence scan queue"],
  [dialog, 'saveSection("review")', "recoverable pre-submit save"],
  [dialog, '"submit_apex_deal"', "native submit RPC"],
  [dialog, "Post Deal", "native submit control"],
  [production, 'count: "exact", head: true', "exact untruncated deal count"],
  [production, ".limit(3000)", "full AgentLink/Vantage book query"],
  [production, "deals.slice(0, visible)", "large-book DOM windowing"],
  [production, "AgentLink / Vantage sync", "canonical source label"],
  [legacyPost, 'source = "apex"', "legacy source constraint compatibility"],
  [dialog, 'title="Beneficiaries (Optional)"', "beneficiary form controls"],
  [dialog, 'id="deal-payment-method"', "payment method control"],
  [dialog, 'id="deal-policy-status"', "policy status control"],
  [parityMigration, "CREATE TABLE IF NOT EXISTS public.deal_beneficiaries", "private beneficiary storage"],
  [parityMigration, "public.apex_can_read_agent(d.agent_id)", "beneficiary scope enforcement"],
  [parityMigration, "REVOKE ALL ON FUNCTION public.submit_apex_deal", "submit RPC public revoke"],
  [dialog, 'list="deal-product-options"', "carrier product picker"],
  [productsMigration, "CREATE OR REPLACE VIEW public.v_carrier_products", "carrier product source"],
  [discordMigration, "'deal.posted:' || new.id::text || ':discord'", "one durable Discord event per deal"],
  [discordMigration, "after update of source on public.deals", "native deal promotion alert"],
  [discordMigration, "on conflict (idempotency_key) do nothing", "Discord alert idempotency"],
  [dispatcher, "response?.suppressed === true", "suppressed Discord delivery remains retryable"],
  [discordNotify, 'event_type === "deal_closed" ? 1_000 : 5', "deal alerts bypass shared five-per-hour ceiling"],
];

const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`missing: ${label}`);
  process.exit(1);
}

// The production list is a closed-book AgentLink/Vantage ledger, not a review
// queue. These controls were deliberately removed on 2026-08-19; bringing them
// back would recreate a false pending-approval workflow over already-sold deals.
for (const retired of ["Approve deal", "createSignedUrl"]) {
  if (production.includes(retired)) {
    console.error(`retired production-review contract returned: ${retired}`);
    process.exit(1);
  }
}

for (const pii of ["clientFirstName", "clientLastName", "clientPhone", "clientDob", "policyNumber", "notes"]) {
  const outboxStart = migration.indexOf("insert into public.outbox_events(");
  const auditStart = migration.indexOf("insert into public.audit_log(", outboxStart);
  const outboxBlock = migration.slice(outboxStart, auditStart);
  if (outboxBlock.includes(`p_payload->>'${pii}'`)) {
    console.error(`deal outbox payload contains restricted client field: ${pii}`);
    process.exit(1);
  }
}

console.log(`✓ check:native-deals — ${requirements.length} workflow/security contracts present.`);
