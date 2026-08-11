#!/usr/bin/env node
/**
 * check:rules-of-hooks — zero conditionally-called React hooks in src/.
 *
 * On 2026-08-11 error_logs surfaced "Minified React error #310" on
 * /dashboard/call-center — 13 hits across 2 real users. #310 is "Rendered more
 * hooks than during the previous render": CallCenter.tsx had an
 * `if (!started) { return … }` early return with a useMemo below it, so pressing
 * Start changed the hook count on a mounted component and React tore the tree
 * down.
 *
 * The part worth remembering: eslint-plugin-react-hooks was already installed,
 * and eslint.config.js already spreads reactHooks.configs.recommended.rules,
 * which sets react-hooks/rules-of-hooks to "error". The rule that would have
 * caught this crash was configured and correct — nothing ever ran it.
 * `npm run lint` is in package.json but appears in neither verify:core nor
 * .husky/pre-commit. A guard nobody executes is a guard that does not exist.
 *
 * A repo-wide sweep after fixing CallCenter found six more live instances of the
 * identical crash, all latent:
 *   AgentCredentialsPanel.tsx  useQuery after a non-admin early return, where
 *                              isAdmin resolves async and flips false -> true
 *   DashboardAgedLeads.tsx     two useMemo after an access-check early return
 *   StateCareerLanding.tsx     two useMemo + a useEffect after an invalid-slug
 *                              Navigate, on a PUBLIC SEO landing page
 *
 * This gates only that one rule, at zero. The repo carries ~1,544 other lint
 * problems, so enabling `npm run lint` wholesale would be permanently red and
 * therefore permanently ignored — the failure mode this codebase has documented
 * four separate times. One rule, held at zero, that actually runs.
 */
import { ESLint } from "eslint";

const RULE = "react-hooks/rules-of-hooks";

const eslint = new ESLint({
  // Use the project's own config so the plugin resolves exactly as `npm run
  // lint` would, then silence everything except the one rule we gate.
  overrideConfig: { rules: { [RULE]: "error" } },
});

const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);

const violations = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== RULE) continue;
    violations.push({
      file: r.filePath.replace(`${process.cwd()}/`, ""),
      line: m.line,
      message: m.message,
    });
  }
}

if (violations.length) {
  console.error(
    `\n✗ check:rules-of-hooks — ${violations.length} conditionally-called React hook(s).\n`,
  );
  console.error(
    "Each one is a React #310 crash waiting for the condition to flip on a mounted",
  );
  console.error(
    "component. Move the hook above every early return; gate its work with an",
  );
  console.error(
    "`enabled` option or an internal guard instead of skipping the hook itself.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.message}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `✓ check:rules-of-hooks — ${results.length} files, 0 conditionally-called hooks.`,
);
