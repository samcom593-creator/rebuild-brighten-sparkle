import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260811221000_apex_native_deal_workflow.sql");
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
  [dialog, "Save & continue", "recoverable step save"],
  [dialog, "Submit deal", "native submit control"],
  [production, "Approve deal", "in-site approval control"],
  [production, "Decline", "in-site decline control"],
  [production, "createSignedUrl", "private evidence review links"],
  [legacyPost, 'source = "apex"', "legacy source constraint compatibility"],
];

const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`missing: ${label}`);
  process.exit(1);
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
