import { readFileSync, existsSync } from "node:fs";

// check-deploy-credential-scopes — MP-486 (2026-09-09)
//
// The deploy job spends a Supabase PAT on TWO capabilities that carry
// DIFFERENT privileges:
//   `supabase functions deploy`  → needs the Edge Functions scope
//   `supabase secrets set`       → needs the project-secrets scope
//
// Until today both hid behind ONE name, SUPABASE_ACCESS_TOKEN, and the
// credential gate asked ONE question — "does GET /functions answer 200?" —
// then printed "✓ SUPABASE_ACCESS_TOKEN answers the management API". That
// sentence was TRUE and INSUFFICIENT. A functions-scoped PAT passes it and
// then 403s one step later. Measured, not theorised — run 34305246898:
// step 7 success, step 9 dead on "your account does not have the necessary
// privileges", byte-identical to a direct GET /secrets probe.
//
// WHAT THIS GUARD DEFENDS, and why each contract is load-bearing:
//
//  C1/C3  The two names must stay APART. Binding the functions credential to
//         SUPABASE_ACCESS_TOKEN job-wide "to make the gate pass" is exactly
//         how the collapse happened (the secret was overwritten at
//         2026-09-09T02:57:00Z, one minute before the failing run).
//
//  C2     The gate must probe each capability against the credential that
//         will actually PERFORM it. Probing a nearby capability and calling
//         it the real one is the disease itself.
//
//  C4/C5  A missing SECRETS scope must degrade ONE step, never fail the run.
//         Making that leg fatal would block every function deploy until a
//         human mints a PAT — converting a scope gap into an outage, which is
//         the mistake this workflow's own audit-job comment warns about. C5
//         is the contract most likely to be broken by someone "tightening"
//         the gate, and it is the one whose breach is silent: the workflow
//         just goes red forever and the site stops shipping.
//
// This guard reads STRUCTURE, never prose. Comment lines are stripped first,
// because an earlier cut of this very wave's proof harness matched the word
// "secrets" inside an error-message string and reported the old one-question
// gate as if it probed two endpoints (the MP-277 footnote bug).

const WF = ".github/workflows/deploy-supabase.yml";
if (!existsSync(WF)) {
  console.error(`check-deploy-credential-scopes: ${WF} is missing — the deploy pipeline it grades does not exist.`);
  process.exit(1);
}
const raw = readFileSync(WF, "utf8");

// Strip whole-line comments only. Trailing-# inside a shell string is not a
// comment, so nothing is removed mid-line.
const code = raw
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

const failures = [];
const pass = [];
const contract = (id, ok, desc, why) => {
  (ok ? pass : failures).push({ id, desc, why });
};

// ── C1: the functions credential has its own name in the deploy job env ─────
contract(
  "C1",
  /SUPABASE_FUNCTIONS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_FUNCTIONS_TOKEN/.test(code),
  "deploy job env defines SUPABASE_FUNCTIONS_TOKEN from its own secret",
  "Without a separate name there is only one credential, and one credential cannot be graded per-capability.",
);

// ── C2: the gate probes BOTH capabilities, each with its own credential ─────
const probesFunctions = /\bprobe\s+"\$SUPABASE_FUNCTIONS_TOKEN"\s+functions\b/.test(code);
const probesSecrets = /\bprobe\s+"\$SUPABASE_ACCESS_TOKEN"\s+secrets\b/.test(code);
contract(
  "C2",
  probesFunctions && probesSecrets,
  "credential gate probes /functions with the functions token AND /secrets with the full PAT",
  `functions-probe=${probesFunctions} secrets-probe=${probesSecrets}. Each capability must be tested against the credential that performs it.`,
);

// ── C3: function deploys spend the functions credential ─────────────────────
const deployStep = code.slice(code.indexOf("- name: Deploy edge functions"));
contract(
  "C3",
  /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_FUNCTIONS_TOKEN\s*\|\|/.test(
    deployStep.slice(0, 1200),
  ),
  "the Deploy edge functions step binds SUPABASE_ACCESS_TOKEN to the functions-scoped secret",
  "The CLI reads SUPABASE_ACCESS_TOKEN; without this override the deploy spends the full PAT and a functions-only credential cannot ship code.",
);

// ── C4: the secrets sync is gated on the gate's verdict ─────────────────────
const syncIdx = code.indexOf("- name: Sync rotated automation credential");
const syncIf = syncIdx === -1 ? "" : code.slice(syncIdx, syncIdx + 600);
contract(
  "C4",
  /steps\.cred\.outputs\.secrets_capable\s*!=\s*'false'/.test(syncIf),
  "the secrets-sync step is skipped only when the gate PROVED the scope absent",
  "`!= 'false'` and not `== 'true'` on purpose: an UNKNOWN verdict must ATTEMPT the sync, never silently skip it.",
);

// ── C5: a missing secrets scope must not fail the run ───────────────────────
// Isolate the secrets leg: everything after the secrets probe inside the gate.
const secIdx = code.indexOf('sec_code=$(probe "$SUPABASE_ACCESS_TOKEN" secrets)');
const gateEnd = code.indexOf("- uses: supabase/setup-cli@v1");
const secretsLeg = secIdx === -1 ? "" : code.slice(secIdx, gateEnd === -1 ? undefined : gateEnd);
contract(
  "C5",
  secIdx !== -1 && !/\bexit\s+1\b/.test(secretsLeg) && /secrets_capable=false/.test(secretsLeg),
  "an absent secrets scope sets secrets_capable=false and does NOT exit 1",
  "Making this leg fatal blocks every function deploy until a human mints a PAT — a scope gap turned into an outage.",
);

const label = "check-deploy-credential-scopes";
if (failures.length === 0) {
  console.log(`${label}: OK — ${pass.length}/${pass.length} contracts hold`);
  for (const p of pass) console.log(`  ✓ ${p.id} ${p.desc}`);
  process.exit(0);
}
console.error(`${label}: ${failures.length} BROKEN contract(s) in ${WF}\n`);
for (const f of failures) {
  console.error(`  ✗ ${f.id} ${f.desc}`);
  console.error(`      why it matters: ${f.why}\n`);
}
console.error("The deploy job spends one credential on two differently-scoped capabilities.");
console.error("Re-collapsing them makes the gate green for a token that cannot finish the deploy.");
process.exit(1);
