import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// check-contact-actions — MP-351 (guard written 2026-08-11, wired in 2026-08-31)
//
// Asserts the 24 backend/UI/security contracts behind the Licensed Inbox
// contact actions: the JWT gates on the SMS/email/dispatcher functions, the
// SMS-consent and email-unsubscribe checks, staff dispatch ownership, the
// idempotency constraint, and the truthful delivery/persistence states.
//
// WHY THE COMMENT STRIPPING (MP-351): every contract is a substring-presence
// test, so before this wave the guard was satisfied by the needle appearing
// ANYWHERE — including inside a comment. Commenting out the staff-ownership
// check, either authenticateCaller call, the SMS-consent check, or the
// email-unsubscribe check left it green, 5 for 5. Code contracts are now
// matched against comment-stripped source.
//
// WHY NOT STRIP FOR ALL OF THEM: exactly one contract is DELIBERATELY prose —
// `explicit, authenticated UI retry` is a SQL comment documenting the retry
// policy. Stripping comments for that one would pin the guard permanently red
// with no available remedy, which is the failure mode this repo has recorded
// nine times. It is marked `doc` and matched against raw source, and its
// verdict line says so.
//
// The stripper is string-aware (it copies string/template bodies verbatim
// rather than scanning them for comment markers). MEASURED, not assumed: on
// today's tree a naive line-comment strip destroys ZERO of the 23 code
// needles, so this costs nothing today and is kept as prevention — a needle
// added later that sits beside a `//` inside a string would otherwise be
// destroyed by the stripper and produce a FALSE red on valid code. No claim
// is made that it fixes a present bug.

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/**
 * Remove comments while preserving line structure and string contents.
 * `kind` is one of "ts" | "sql" | "toml".
 */
function stripComments(text, kind) {
  const lineCmt = kind === "toml" ? "#" : kind === "sql" ? "--" : "//";
  const blockOk = kind === "ts" || kind === "sql";
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // string / template literal — copy verbatim, honouring escapes
    if (ch === '"' || ch === "'" || (kind === "ts" && ch === "`")) {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // block comment — replace with blanks, keep newlines so line structure holds
    if (blockOk && text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) out += text[j] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    // line comment — drop to end of line, keep the newline itself
    if (text.startsWith(lineCmt, i)) {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const sources = {
  migration: ["supabase/migrations/20260811222000_apex_contact_actions.sql", "sql"],
  inbox: ["src/pages/LicensedInbox.tsx", "ts"],
  dispatcher: ["supabase/functions/apex-outbox-dispatcher/index.ts", "ts"],
  sms: ["supabase/functions/send-sms-auto-detect/index.ts", "ts"],
  email: ["supabase/functions/send-outreach-email/index.ts", "ts"],
  config: ["supabase/config.toml", "toml"],
};

// A missing/renamed target must fail CLOSED and say which file, never grade
// fewer contracts and report success.
const raw = {};
const code = {};
for (const [key, [path, kind]] of Object.entries(sources)) {
  let text;
  try {
    text = read(path);
  } catch (error) {
    console.error(`✗ check:contact-actions — cannot read ${path} (${error.code ?? error.message}).`);
    console.error("  A contract source moved or was deleted; the guard refuses to grade the rest.");
    process.exit(1);
  }
  raw[key] = text;
  code[key] = stripComments(text, kind);
}

// mode: "code" = must appear outside comments. "doc" = a documentation
// contract, satisfied by prose, and reported as such.
const requirements = [
  ["migration", "create table if not exists public.apex_contact_actions", "durable action table", "code"],
  ["migration", "create or replace function public.queue_apex_contact_action", "server queue RPC", "code"],
  ["migration", "public.apex_toolkit_can_work_application", "application scope check", "code"],
  ["migration", "sms_consent_given", "SMS consent check", "code"],
  ["migration", "email_unsubscribes", "email unsubscribe check", "code"],
  ["migration", "unique(requested_by, idempotency_key)", "idempotency constraint", "code"],
  ["migration", "record_apex_licensed_disposition", "atomic dispositions", "code"],
  ["migration", "explicit, authenticated UI retry", "targeted manual retry", "doc"],
  ["dispatcher", "contactActionId", "targeted dispatch", "code"],
  ["dispatcher", "provider_message_id", "provider receipt recovery", "code"],
  ["dispatcher", "deliveryConfirmed: false", "truthful delivery state", "code"],
  ["dispatcher", "idempotency-key", "provider idempotency header", "code"],
  ["dispatcher", '.eq("requested_by", authorization.userId)', "staff targeted-dispatch ownership", "code"],
  ["dispatcher", "Delivery attempt could not be recorded", "attempt audit before provider send", "code"],
  ["dispatcher", "persistenceFailures", "truthful state-write failures", "code"],
  ["inbox", 'label="Text"', "text control", "code"],
  ["inbox", 'label="Email"', "email control", "code"],
  ["inbox", "Confirm and send", "explicit confirmation", "code"],
  ["inbox", "Retry safely", "retry state", "code"],
  ["sms", "authenticateCaller", "legacy SMS authentication", "code"],
  ["email", "authenticateCaller", "legacy email authentication", "code"],
  ["config", "[functions.send-sms-auto-detect]\nverify_jwt = true", "SMS JWT gate", "code"],
  ["config", "[functions.send-outreach-email]\nverify_jwt = true", "email JWT gate", "code"],
  ["config", "[functions.apex-outbox-dispatcher]\nverify_jwt = true", "dispatcher JWT gate", "code"],
];

const missing = requirements.filter(([key, needle, , mode]) =>
  !(mode === "doc" ? raw[key] : code[key]).includes(needle),
);
if (missing.length) {
  for (const [, , label, mode] of missing) {
    console.error(
      mode === "doc"
        ? `missing: ${label} (documentation contract — expected in ${sources[missing[0][0]][0]})`
        : `missing: ${label} — absent from non-comment source (a commented-out contract does not count)`,
    );
  }
  process.exit(1);
}

if (/onClick=\{\(\) => void logContact\(r, "sms", "text_sent"\)\}/.test(code.inbox)) {
  console.error("Licensed Inbox regressed to a log-only text button");
  process.exit(1);
}

if (/idempotency_key, correlation_id\s+idempotency_key, correlation_id/.test(code.migration)) {
  console.error("Contact migration has duplicate outbox insert columns");
  process.exit(1);
}

const docCount = requirements.filter(([, , , m]) => m === "doc").length;
console.log(
  `✓ check:contact-actions — ${requirements.length} backend/UI/security contracts present ` +
    `(${requirements.length - docCount} matched outside comments, ${docCount} documentation).`,
);
