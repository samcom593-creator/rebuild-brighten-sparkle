import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260811222000_apex_contact_actions.sql");
const inbox = read("src/pages/LicensedInbox.tsx");
const dispatcher = read("supabase/functions/apex-outbox-dispatcher/index.ts");
const sms = read("supabase/functions/send-sms-auto-detect/index.ts");
const email = read("supabase/functions/send-outreach-email/index.ts");
const config = read("supabase/config.toml");

const requirements = [
  [migration, "create table if not exists public.apex_contact_actions", "durable action table"],
  [migration, "create or replace function public.queue_apex_contact_action", "server queue RPC"],
  [migration, "public.apex_toolkit_can_work_application", "application scope check"],
  [migration, "sms_consent_given", "SMS consent check"],
  [migration, "email_unsubscribes", "email unsubscribe check"],
  [migration, "unique(requested_by, idempotency_key)", "idempotency constraint"],
  [migration, "record_apex_licensed_disposition", "atomic dispositions"],
  [migration, "explicit, authenticated UI retry", "targeted manual retry"],
  [dispatcher, "contactActionId", "targeted dispatch"],
  [dispatcher, "provider_message_id", "provider receipt recovery"],
  [dispatcher, "deliveryConfirmed: false", "truthful delivery state"],
  [dispatcher, "idempotency-key", "provider idempotency header"],
  [dispatcher, ".eq(\"requested_by\", authorization.userId)", "staff targeted-dispatch ownership"],
  [dispatcher, "Delivery attempt could not be recorded", "attempt audit before provider send"],
  [dispatcher, "persistenceFailures", "truthful state-write failures"],
  [inbox, 'label="Text"', "text control"],
  [inbox, 'label="Email"', "email control"],
  [inbox, "Confirm and send", "explicit confirmation"],
  [inbox, "Retry safely", "retry state"],
  [sms, "authenticateCaller", "legacy SMS authentication"],
  [email, "authenticateCaller", "legacy email authentication"],
  [config, "[functions.send-sms-auto-detect]\nverify_jwt = true", "SMS JWT gate"],
  [config, "[functions.send-outreach-email]\nverify_jwt = true", "email JWT gate"],
  [config, "[functions.apex-outbox-dispatcher]\nverify_jwt = true", "dispatcher JWT gate"],
];

const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`missing: ${label}`);
  process.exit(1);
}

if (/onClick=\{\(\) => void logContact\(r, "sms", "text_sent"\)\}/.test(inbox)) {
  console.error("Licensed Inbox regressed to a log-only text button");
  process.exit(1);
}

if (/idempotency_key, correlation_id\s+idempotency_key, correlation_id/.test(migration)) {
  console.error("Contact migration has duplicate outbox insert columns");
  process.exit(1);
}

console.log(`✓ check:contact-actions — ${requirements.length} backend/UI/security contracts present.`);
