#!/usr/bin/env -S node --experimental-strip-types
// Read-only audit of the Ethos "Agent Portal Signup" sheet through the SAME validator the
// dispatcher and the Contracting Health page use (ethos-contract.ts). Produces a MASKED JSON
// report (no names/emails/phones/NPNs) plus a one-screen summary. It never writes to the
// sheet and never contacts agents or carriers.
//
//   npm run audit:ethos-sheet --                                               # fetch both tabs (link-reader export)
//   npm run audit:ethos-sheet --                                    --signup a.csv --updates u.csv --out report.json
//   --fail-on-blockers  exit 2 when any populated row carries a blocker (exit 1 = could not finish)
import { readFileSync, writeFileSync } from "node:fs";
import {
  SIGNUP_TAB, UPDATES_TAB, auditSignupTab, auditUpdatesTab, toMaskedReport, ETHOS_COMP_LEVELS, parseCsv, sheetCsvExportUrl, looksLikeHtml, ETHOS_SPREADSHEET_ID,
} from "../supabase/functions/_shared/ethos-contract.ts";


function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function fetchTab(gid: number): Promise<string> {
  const url = sheetCsvExportUrl(gid);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45_000);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: "follow" });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (looksLikeHtml(body)) throw new Error("got an HTML page instead of CSV (login wall or sharing changed)");
      return body;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    } finally { clearTimeout(t); }
  }
  throw new Error("unreachable");
}

async function main() {
  const signupPath = arg("--signup");
  const updatesPath = arg("--updates");
  const out = arg("--out");
  const principal = { npn: arg("--principal-npn") ?? "21346366", mobile: arg("--principal-mobile"), email: arg("--principal-email") };
  const knownSubAgencies = (arg("--sub-agencies") ?? "Apex Financial Empire,Kaeden Vaughns,Obiajulu Ifediora,Chukwudi Ifediora,Aisha Kebbeh").split(",").map((s) => s.trim()).filter(Boolean);

  const signupCsv = signupPath ? readFileSync(signupPath, "utf8") : await fetchTab(SIGNUP_TAB.sheetId);
  const updatesCsv = updatesPath ? readFileSync(updatesPath, "utf8") : await fetchTab(UPDATES_TAB.sheetId);
  const signupRows = parseCsv(signupCsv);
  const updatesRows = parseCsv(updatesCsv);

  const signup = auditSignupTab(signupRows, { principal, compLevels: ETHOS_COMP_LEVELS, knownSubAgencies });
  const updates = auditUpdatesTab(updatesRows);
  const report = toMaskedReport(signup, updates, `sheet ${ETHOS_SPREADSHEET_ID} / ${SIGNUP_TAB.title} + ${UPDATES_TAB.title}`);
  const json = JSON.stringify({ generated_at: new Date().toISOString(), allocated_rows: signupRows.length, ...report }, null, 1);
  if (out) writeFileSync(out, json);

  const c = signup.counts;
  const codeCounts = new Map<string, number>();
  for (const r of signup.rows) for (const f of r.findings) codeCounts.set(`${f.severity}:${f.code}`, (codeCounts.get(`${f.severity}:${f.code}`) ?? 0) + 1);
  const top = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`agwnts: header ${signup.header.ok ? "OK" : "DRIFT " + JSON.stringify(signup.header.drift)}; allocated rows ${signupRows.length}; populated ${c.populatedRows}; distinct NPN ${c.distinctNpn}; blank/zero NPN rows ${c.blankOrZeroNpnRows}`);
  console.log(`  repeated NPN groups ${c.repeatedNpnGroups} (identical ${c.repeatedNpnGroupsIdentical}, conflicting ${c.repeatedNpnGroupsConflicting}); needs reparenting rows ${c.needsReparentingRows} / distinct NPN ${c.needsReparentingDistinctNpn}; portal created ${c.portalCreatedRows}`);
  console.log(`  life unchecked ${c.lifeUnchecked}; E&O unchecked ${c.eoUnchecked}; rows with blockers ${c.rowsWithBlockers}; review-only ${c.rowsReviewOnly}; clean ${c.rowsClean}`);
  console.log(`  findings by code: ${top.map(([k, n]) => `${k}=${n}`).join("  ")}`);
  console.log(`Agent Updates: header ${updates.header.ok ? "OK" : "DRIFT"}; records ${updates.counts.records}; with changes ${updates.counts.withChanges}; out-of-schema ${updates.counts.outOfSchema}; termination requests ${updates.counts.terminationRequests}`);
  if (out) console.log(`masked report -> ${out}`);
  if (process.argv.includes("--fail-on-blockers") && (c.rowsWithBlockers > 0 || updates.counts.rowsWithBlockers > 0)) process.exit(2);
}

main().catch((e) => { console.error(`audit could not finish: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
