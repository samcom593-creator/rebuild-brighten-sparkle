import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260811221000_apex_native_deal_workflow.sql");
const parityMigration = read("supabase/migrations/20260823140000_post_a_deal_parity.sql");
const productsMigration = read("supabase/migrations/20260823152000_carrier_products.sql");
const discordMigration = read("supabase/migrations/20260824040000_durable_every_deal_discord.sql");
const agentlinkDiscordMigration = read("supabase/migrations/20260825030000_agentlink_discord_gap_closure.sql");
const agentlinkDedupeMigration = read("supabase/migrations/20260825034000_agentlink_discord_dedupe_identity.sql");
const singleFeedMigration = read("supabase/migrations/20260825035000_single_deal_feed.sql");
const agencyPeriodMigration = read("supabase/migrations/20260825033000_imo_agency_period_truth.sql");
const crmScopeMigration = read("supabase/migrations/20260825010000_crm_production_scope.sql");
const homeDailyMigration = read("supabase/migrations/20260825060000_home_daily_production_truth.sql");
const scopedScoreboardMigration = read("supabase/migrations/20260825065000_scoped_production_scoreboard.sql");
const savedCompScoreboardMigration = read("supabase/migrations/20260825121500_scoreboard_saved_comp_truth.sql");
const contractingReconcileMigration = read("supabase/migrations/20260825061000_contracting_roster_live_reconcile.sql");
const dispatcher = read("supabase/functions/apex-outbox-dispatcher/index.ts");
const discordNotify = read("supabase/functions/discord-webhook-notify/index.ts");
const dialog = read("src/components/deals/SubmitDealDialog.tsx");
const production = read("src/pages/MyDeals.tsx");
const agentCloudHome = read("src/components/dashboard/AgentCloudHome.tsx");
const scopedScoreboard = read("src/components/dashboard/ScopedProductionScoreboard.tsx");
const imoByAgency = read("src/components/dashboard/ImoByAgency.tsx");
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
  [production, "Vantage live feed", "canonical source label"],
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
  [agentlinkDiscordMigration, "after insert on public.agentlink_book", "AgentLink book queues every fresh deal"],
  [agentlinkDiscordMigration, "'agentlink_book_deal'", "AgentLink durable outbox aggregate"],
  [agentlinkDiscordMigration, "public.fn_agent_is_roster_excluded", "departed agents never receive fresh alerts"],
  [agentlinkDiscordMigration, "'discord_subagency'", "Vantage receives an independent channel event"],
  [agentlinkDedupeMigration, "agentlink_discord_policy_ledger", "AgentLink refreshes announce each real policy once"],
  [agentlinkDedupeMigration, "fn_agentlink_policy_fingerprint", "duplicate upstream rows share one Discord identity"],
  [agentlinkDedupeMigration, "fn_canonical_agent_id(new.agent_id)", "departed duplicate identities cannot receive alerts"],
  [singleFeedMigration, "one durable main-channel event", "deal notifications use one feed"],
  [singleFeedMigration, "destination = 'discord_subagency'", "Vantage deal-channel queue is disabled"],
  [dispatcher, 'event.aggregate_type === "agentlink_book_deal"', "dispatcher reads canonical AgentLink payloads"],
  [dispatcher, "provider_message_id: result.providerMessageId ?? null", "Discord provider receipt is persisted"],
  [agencyPeriodMigration, "policies_mtd", "agency policy count uses the same MTD window as ALP"],
  [agencyPeriodMigration, "policies_30d", "agency policy count exposes the rolling 30-day window"],
  [agencyPeriodMigration, "public.imo_by_agency_period", "agency cards support exact selected periods"],
  [agentCloudHome, "start={win.start} end={win.end}", "home period selector reaches the agency query"],
  [homeDailyMigration, "from public.v_production_unified b", "home uses unified deduplicated production truth"],
  [homeDailyMigration, "where posted_date = v_today", "home daily totals use Phoenix today"],
  [contractingReconcileMigration, "'tab', 'agwnts'", "contracting targets the real live Ethos tab"],
  [scopedScoreboardMigration, "from public.v_production_unified u", "login scoreboard uses unified production truth"],
  [scopedScoreboardMigration, "with recursive caller_canon", "login scoreboard follows recursive hierarchy"],
  [savedCompScoreboardMigration, "a.contract_percentage between 0 and 200", "estimated earnings use saved producer comp"],
  [scopedScoreboard, "My personal production", "home shows scoped personal production"],
  [scopedScoreboard, "My team production", "home shows scoped team production"],
  [scopedScoreboard, "My estimated earnings", "home shows personal estimated earnings"],
  [imoByAgency, 'rpc("imo_by_agency_period"', "agency component queries the selected period"],
  [dispatcher, "response?.suppressed === true", "suppressed Discord delivery remains retryable"],
  [discordNotify, 'event_type === "deal_closed" ? 1_000 : 5', "deal alerts bypass shared five-per-hour ceiling"],
  [crmScopeMigration, "from public.v_production_unified b", "CRM uses unified production truth"],
  [crmScopeMigration, "and public.crm_can_read_agent_scope(a.id)", "manager CRM is team scoped"],
  [crmScopeMigration, "v_self or public.crm_can_read_agent_scope(p_agent_id)", "producer profiles are team scoped"],
  [production, 'isManager ? "Team Production"', "manager production title"],
  [production, '"book-truth-production", productionScopeKey', "production cache is scope keyed"],
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
