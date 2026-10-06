import { test } from "vitest";
import assert from "node:assert/strict";
import {
  SIGNUP_HEADERS, UPDATES_HEADERS, SIGNUP_AGENCY_COLUMNS, UPDATES_AGENCY_COLUMNS, ETHOS_COMP_LEVELS, S, U,
  classifyNpn, normalizeUsMobile, normalizeEmail, parseSheetBoolean, classifyCompLevel, classifyAdvanceTier,
  verifyHeaderSignature, readCarrierState, isPopulatedSignupRow, auditSignupTab, auditUpdatesTab,
  evaluateSignupGate, planSignupWrite, verifySignupReadBack, signupAgencyRange, buildUpdateRequestRow,
  derivePipelineStage, toMaskedReport, looksFormulaLike, maskId,
} from "../../../supabase/functions/_shared/ethos-contract.ts";

// Synthetic fixtures only. 555-01xx numbers are reserved and never real.
const NOW = Date.parse("2026-10-05T12:00:00Z");
const header = [...SIGNUP_HEADERS];
const row = (over: Partial<Record<keyof typeof S, unknown>> = {}) => {
  const r: unknown[] = ["Test", "Agent", "21000001", "21346366", "(555) 010-0001", "test.agent@example.com", "Level 12", "6 Month Advance", "Apex Financial Empire", "FALSE", "TRUE", "TRUE", "FALSE", "", "", "", "https://agents.ethoslife.com/invite/", "", ""];
  for (const [k, v] of Object.entries(over)) r[(S as Record<string, number>)[k]] = v;
  return r;
};
const approvalOk = {
  npn_verified_at: "2026-10-01T00:00:00Z", npn_verified_source: "NIPR lookup",
  license_verified_at: "2026-10-01T00:00:00Z", license_evidence_ref: "doc:lic-1",
  eo_verified_at: "2026-10-01T00:00:00Z", eo_expires_at: "2027-06-30", eo_evidence_ref: "doc:eo-1",
  approved_comp_level: "Level 12", approved_advance_tier: "6 Month Advance", approved_upline_npn: "21346366",
  approved_sub_agency: "Apex Financial Empire", approved_sub_agent_head: false, approved_by: "admin-1", approved_at: "2026-10-02T00:00:00Z",
};
const cand = { first_name: "Test", last_name: "Agent", npn: "21000001", mobile: "+15550100001", email: "Test.Agent@example.com" };
const codes = (list: { code: string }[]) => list.map((x) => x.code);

test("comp level: numeric 60/50 and '60%' rejected; canonical labels accepted; grid lookup uses passed labels", () => {
  for (const bad of ["60", "50", "60%", " 60 "]) assert.deepEqual(codes(classifyCompLevel(bad).findings), ["comp_level_raw_number"], bad);
  assert.equal(classifyCompLevel("Level 12").value, "Level 12");
  assert.equal(classifyCompLevel("Level 00 (LOA)").value, "Level 00 (LOA)");
  assert.deepEqual(codes(classifyCompLevel("Level 12", ["Level 10", "Level 11"]).findings), ["comp_level_not_on_grid"]);
  assert.deepEqual(codes(classifyCompLevel("level 12").findings), ["comp_level_label_casing"]);
  assert.equal(ETHOS_COMP_LEVELS.length, 28);
});

test("NPN: zero/missing/placeholder blocked; NPN=phone blocked; nine-digit is review not invalid", () => {
  assert.deepEqual(codes(classifyNpn("").findings), ["npn_missing"]);
  assert.deepEqual(codes(classifyNpn("0").findings), ["npn_zero_placeholder"]);
  assert.deepEqual(codes(classifyNpn("12345678").findings), ["npn_placeholder"]);
  assert.deepEqual(codes(classifyNpn("5550100001", { mobileDigits: "5550100001" }).findings), ["npn_equals_phone"]);
  assert.deepEqual(codes(classifyNpn("15550100001", { mobileDigits: "(555) 010-0001" }).findings), ["npn_equals_phone"]);
  const nine = classifyNpn("397298017");
  assert.equal(nine.digits, "397298017");
  assert.deepEqual(nine.findings.map((f) => [f.code, f.severity]), [["npn_unusual_length", "review"]]);
  assert.deepEqual(codes(classifyNpn("21346366").findings), []);
  assert.deepEqual(codes(classifyNpn("2134-6366").findings), ["npn_not_digits"]);
});

test("booleans: string FALSE is false, blank/other is unknown", () => {
  assert.equal(parseSheetBoolean("FALSE"), false);
  assert.equal(parseSheetBoolean("true"), true);
  assert.equal(parseSheetBoolean(""), "unknown");
  assert.equal(parseSheetBoolean("yes"), "unknown");
  assert.equal(parseSheetBoolean(false), false);
});

test("mobile + email normalization; suspicious domain is review only, never rewritten", () => {
  assert.deepEqual(normalizeUsMobile("+1 (555) 010-0001"), { ok: true, national: "5550100001", display: "(555) 010-0001" });
  assert.deepEqual(normalizeUsMobile("+44 20 7946 0000"), { ok: false, reason: "unsupported_format" });
  assert.deepEqual(normalizeUsMobile("555-0100 x12"), { ok: false, reason: "unsupported_format" });
  assert.deepEqual(normalizeUsMobile("1234567"), { ok: false, reason: "invalid_number" });
  const e = normalizeEmail("  Someone@GMAI.com ");
  assert.equal(e.value, "someone@gmai.com");
  assert.deepEqual(e.findings.map((f) => [f.code, f.severity]), [["email_domain_suspicious", "review"]]);
  assert.deepEqual(codes(normalizeEmail("someone@yahoo.con").findings), ["email_domain_suspicious"]);
  assert.deepEqual(codes(normalizeEmail("not-an-email").findings), ["email_invalid_syntax"]);
});

test("advance tier: blank is a blocker (Ethos defaults blank to 9 months), enum enforced", () => {
  assert.deepEqual(codes(classifyAdvanceTier("").findings), ["advance_tier_missing"]);
  assert.deepEqual(codes(classifyAdvanceTier("12 Month Advance").findings), ["advance_tier_invalid"]);
  assert.equal(classifyAdvanceTier("As Earned").value, "As Earned");
});

test("header signature: exact live headers pass; drift is named by column and stops the audit", () => {
  assert.equal(verifyHeaderSignature(SIGNUP_HEADERS, header).ok, true);
  const drifted = [...header]; drifted[2] = "NPN";
  const chk = verifyHeaderSignature(SIGNUP_HEADERS, drifted);
  assert.equal(chk.ok, false);
  assert.deepEqual(chk.drift, [{ column: "C", expected: "Agent NPN", actual: "NPN" }]);
  const audit = auditSignupTab([drifted, row()]);
  assert.equal(audit.header.ok, false);
  assert.equal(audit.rows.length, 0);
});

test("carrier state: bare invite is not unique; portal TRUE + needs reparenting are separate milestones", () => {
  const c = readCarrierState(row({ PORTAL: "TRUE", PORTAL_DATE: "needs reparenting", PARTNER_ID: "447060", PARTNER_CODE: "058832", INVITE: "https://agents.ethoslife.com/invite/" }));
  assert.equal(c.portalCreated, true);
  assert.equal(c.reparenting, "needed");
  assert.equal(c.inviteUnique, false);
  assert.equal(c.partnerCode, "058832"); // leading zero preserved as text
  const c2 = readCarrierState(row({ PORTAL_DATE: "7/20/2026", INVITE: "https://agents.ethoslife.com/invite/058832" }));
  assert.equal(c2.reparenting, "dated");
  assert.equal(c2.inviteUnique, true);
  const audit = auditSignupTab([header, row({ PORTAL: "TRUE", PORTAL_DATE: "needs reparenting", PARTNER_CODE: "058832", INVITE: "https://agents.ethoslife.com/invite/" })]);
  assert.ok(codes(audit.rows[0].findings).includes("reparenting_pending_with_portal"));
  assert.ok(codes(audit.rows[0].findings).includes("invite_link_missing"));
  assert.equal(audit.counts.needsReparentingRows, 1);
  assert.equal(audit.counts.portalCreatedRows, 1);
});

test("population: FALSE-only checkbox/formula rows and lone agency labels are not agents", () => {
  assert.equal(isPopulatedSignupRow(["", "", "", "", "", "", "", "", "", "FALSE", "FALSE", "FALSE", "FALSE", "", "", "", "https://agents.ethoslife.com/invite/", "", ""]), false);
  assert.equal(isPopulatedSignupRow(["", "", "", "", "", "", "", "", "Apex Financial Empire", "FALSE"]), false);
  assert.equal(isPopulatedSignupRow(row()), true);
  const audit = auditSignupTab([header, row(), ["", "", "", "", "", "", "", "", "", "FALSE", "FALSE", "FALSE"]]);
  assert.equal(audit.counts.populatedRows, 1);
});

test("duplicates: identical repeats vs conflicting records; conflict names the differing columns", () => {
  const a = row({ NPN: "21000002", EMAIL: "dup@example.com", MOBILE: "(555) 010-0002" });
  const b = row({ NPN: "21000002", EMAIL: "dup@example.com", MOBILE: "(555) 010-0002" });
  const c = row({ NPN: "21000003", FIRST: "An", EMAIL: "an@example.com", MOBILE: "(555) 010-0003", LEVEL: "Level 12" });
  const d = row({ NPN: "21000003", FIRST: "An-", EMAIL: "an@example.com", MOBILE: "(555) 010-0003", LEVEL: "Level 17", HEAD: "TRUE" });
  const audit = auditSignupTab([header, a, b, c, d]);
  assert.equal(audit.counts.repeatedNpnGroups, 2);
  assert.equal(audit.counts.repeatedNpnGroupsIdentical, 1);
  assert.equal(audit.counts.repeatedNpnGroupsConflicting, 1);
  const conflict = audit.duplicates.find((g) => g.kind === "conflict")!;
  assert.deepEqual(conflict.rows, [4, 5]);
  assert.deepEqual(conflict.differingColumns, ["A", "G", "J"]);
  assert.ok(codes(audit.rows[2].findings).includes("duplicate_npn_conflict"));
  assert.ok(codes(audit.rows[0].findings).includes("duplicate_npn_repeat"));
  // shared contact INSIDE a dup group is not a cross-identity collision
  assert.ok(!codes(audit.rows[0].findings).includes("email_shared_across_agents"));
  assert.equal(audit.counts.distinctNpn, 2);
});

test("collisions: phone/email shared across DIFFERENT NPNs is a blocker on every row; principal contact is a blocker", () => {
  const audit = auditSignupTab(
    [header, row({ NPN: "21000004", MOBILE: "(555) 010-0009", EMAIL: "x@example.com" }), row({ NPN: "21000005", MOBILE: "555-010-0009", EMAIL: "y@example.com" }), row({ NPN: "21000006", MOBILE: "(469) 767-6068", EMAIL: "z@example.com" })],
    { principal: { npn: "21346366", mobile: "469-767-6068", email: "principal@example.com" } },
  );
  assert.ok(codes(audit.rows[0].findings).includes("mobile_shared_across_agents"));
  assert.ok(codes(audit.rows[1].findings).includes("mobile_shared_across_agents"));
  assert.ok(codes(audit.rows[2].findings).includes("mobile_matches_principal"));
  assert.equal(audit.counts.rowsWithBlockers, 3);
});

test("audit flags unchecked license/E&O, blank advance, blank sub-agency, formula-like text, self-parent upline", () => {
  const audit = auditSignupTab([header, row({ LICENSED: "FALSE", EO: "", ADVANCE: "", SUBAGENCY: "", FIRST: "=HYPERLINK()", UPLINE: "21000001" })]);
  const f = codes(audit.rows[0].findings);
  for (const c of ["life_license_not_attested", "eo_not_attested", "advance_tier_missing", "sub_agency_missing", "formula_like_value", "upline_self_parent"]) assert.ok(f.includes(c), c);
  assert.equal(audit.counts.lifeUnchecked, 1);
  assert.equal(audit.counts.eoUnchecked, 1);
});

test("gate: all evidence + approvals present → ready with an exact 12-cell A:L payload; K/L true only from evidence", () => {
  const g = evaluateSignupGate(cand, approvalOk, { now: NOW });
  assert.equal(g.ready, true, JSON.stringify(g.blockers));
  assert.equal(g.payload!.length, SIGNUP_AGENCY_COLUMNS);
  assert.deepEqual(g.payload, ["Test", "Agent", "21000001", "21346366", "(555) 010-0001", "test.agent@example.com", "Level 12", "6 Month Advance", "Apex Financial Empire", false, true, true]);
  assert.equal(signupAgencyRange("agwnts", 175), "agwnts!A175:L175");
});

test("gate: approved vs requested comp are separate — no approval means no payload; requested note never feeds G", () => {
  const g = evaluateSignupGate(cand, { ...approvalOk, approved_comp_level: null }, { now: NOW });
  assert.equal(g.ready, false);
  assert.ok(codes(g.blockers).includes("approval_comp_level_missing"));
  assert.equal(g.payload, null);
  const g2 = evaluateSignupGate(cand, { ...approvalOk, approved_comp_level: "60" }, { now: NOW });
  assert.ok(codes(g2.blockers).includes("comp_level_raw_number"));
  const g3 = evaluateSignupGate(cand, null, { now: NOW });
  for (const c of ["npn_not_verified", "license_not_verified", "eo_not_verified", "approval_comp_level_missing", "approval_advance_tier_missing", "approval_upline_missing", "approval_sub_agency_missing", "approval_sub_agent_head_missing", "approval_unattributed"]) assert.ok(codes(g3.blockers).includes(c), c);
});

test("gate: expired or undated E&O evidence blocks; nine-digit NPN is review but unverified NPN blocks", () => {
  assert.ok(codes(evaluateSignupGate(cand, { ...approvalOk, eo_expires_at: "2026-01-01" }, { now: NOW }).blockers).includes("eo_expired"));
  assert.ok(codes(evaluateSignupGate(cand, { ...approvalOk, eo_expires_at: null }, { now: NOW }).blockers).includes("eo_expiry_unknown"));
  const g = evaluateSignupGate({ ...cand, npn: "397298017" }, approvalOk, { now: NOW });
  assert.equal(g.ready, true);
  assert.ok(codes(g.review).includes("npn_unusual_length"));
});

test("gate: different uplines preserved — payload carries the APPROVED upline, never a default; self-parent blocked", () => {
  const g = evaluateSignupGate(cand, { ...approvalOk, approved_upline_npn: "21448924" }, { now: NOW });
  assert.equal(g.payload![S.UPLINE], "21448924");
  assert.ok(codes(evaluateSignupGate(cand, { ...approvalOk, approved_upline_npn: "21000001" }, { now: NOW }).blockers).includes("upline_self_parent"));
});

test("gate: suspicious email domain requires contact confirmation; confirmed → ready with review item kept", () => {
  const c2 = { ...cand, email: "test.agent@gmai.com" };
  const g = evaluateSignupGate(c2, approvalOk, { now: NOW });
  assert.ok(codes(g.blockers).includes("contact_not_confirmed"));
  const g2 = evaluateSignupGate(c2, { ...approvalOk, contact_confirmed_at: "2026-10-03T00:00:00Z" }, { now: NOW });
  assert.equal(g2.ready, true);
  assert.ok(codes(g2.review).includes("email_domain_suspicious"));
});

test("gate: sheet collisions — NPN already present blocks a second submission; email under another NPN blocks; header drift blocks", () => {
  const sheet = [header, row({ NPN: "21000001" })];
  const g = evaluateSignupGate(cand, approvalOk, { now: NOW, sheetRows: sheet });
  assert.ok(codes(g.blockers).includes("sheet_npn_already_present"));
  assert.deepEqual(g.sheet.npnRows, [2]);
  const sheet2 = [header, row({ NPN: "21999999", EMAIL: "test.agent@example.com", MOBILE: "(555) 010-0777" })];
  assert.ok(codes(evaluateSignupGate(cand, approvalOk, { now: NOW, sheetRows: sheet2 }).blockers).includes("sheet_email_on_other_npn"));
  const drifted = [...header]; drifted[0] = "First";
  assert.ok(codes(evaluateSignupGate(cand, approvalOk, { now: NOW, sheetRows: [drifted] }).blockers).includes("sheet_header_drift"));
  // queue collision, excluding self
  const q = [{ id: "self", npn: "21000001" }, { id: "other", npn: "21000001" }];
  const g3 = evaluateSignupGate(cand, approvalOk, { now: NOW, queue: q, selfId: "self" });
  assert.deepEqual(codes(g3.blockers), ["queue_npn_duplicate"]);
});

test("write plan: append lands after the last populated identity row (not after pre-filled checkbox rows); NPN present → already_present; contact under other NPN → manual review", () => {
  const checkboxOnly = ["", "", "", "", "", "", "", "", "", "FALSE", "FALSE", "FALSE", "FALSE"];
  // rows with OTHER identities must carry their own contacts, or the plan correctly refuses to append
  const sheet = [header, row({ NPN: "21000010", MOBILE: "(555) 010-0010", EMAIL: "ten@example.com" }), row({ NPN: "21000011", MOBILE: "(555) 010-0011", EMAIL: "eleven@example.com" }), checkboxOnly, checkboxOnly];
  const payload = evaluateSignupGate(cand, approvalOk, { now: NOW }).payload!;
  assert.deepEqual(planSignupWrite(sheet, payload), { action: "append", rowNumber: 4 });
  assert.deepEqual(planSignupWrite([header, row({ NPN: "21000001" })], payload), { action: "already_present", rowNumbers: [2] });
  const other = planSignupWrite([header, row({ NPN: "21000099", MOBILE: "(555) 010-0001", EMAIL: "o@example.com" })], payload);
  assert.equal(other.action, "manual_review");
});

test("read-back: all twelve cells compared; booleans parsed; mobile on digits; a wrong row fails", () => {
  const payload = evaluateSignupGate(cand, approvalOk, { now: NOW }).payload!;
  const written = ["Test", "Agent", "21000001", "21346366", "555-010-0001", "TEST.AGENT@example.com", "Level 12", "6 Month Advance", "Apex Financial Empire", "FALSE", "TRUE", "TRUE"];
  assert.deepEqual(verifySignupReadBack(written, payload), { ok: true, mismatches: [] });
  const wrong = [...written]; wrong[S.NPN] = "21000002"; wrong[S.LICENSED] = "FALSE";
  assert.deepEqual(verifySignupReadBack(wrong, payload), { ok: false, mismatches: ["Agent NPN", "Life Licensed?"] });
});

test("Agent Updates: A:C + only requested changes; comp in E and advance in F (signup G/H never used); no-op row refused; unchanged fields stay blank; never I:L", () => {
  const b = buildUpdateRequestRow({ first_name: "Chuk", last_name: "Ifed", npn: "21755124", change_comp_level: "Level 17" });
  assert.deepEqual(b.row, ["Chuk", "Ifed", "21755124", "", "Level 17", "", "", ""]);
  assert.equal(b.row!.length, UPDATES_AGENCY_COLUMNS);
  assert.equal(b.row![U.LEVEL], "Level 17");
  assert.equal(b.row![U.ADVANCE], "");
  const noop = buildUpdateRequestRow({ first_name: "Chuk", last_name: "Ifed", npn: "21755124" });
  assert.equal(noop.row, null);
  assert.ok(codes(noop.blockers).includes("update_no_change_requested"));
  const term = buildUpdateRequestRow({ first_name: "A", last_name: "B", npn: "21000020", termination: { requested: true } });
  assert.equal(term.row, null);
  assert.ok(codes(term.blockers).includes("termination_not_authorized"));
  const termOk = buildUpdateRequestRow({ first_name: "A", last_name: "B", npn: "21000020", termination: { requested: true, authorized_by: "admin-1", authorized_at: "2026-10-01" } });
  assert.equal(termOk.row![U.TERMINATION], "Yes — terminate");
  assert.ok(codes(buildUpdateRequestRow({ first_name: "A", last_name: "B", npn: "21000020", change_comp_level: "60" }).blockers).includes("comp_level_raw_number"));
});

test("Agent Updates audit: historical out-of-schema row (signup-style values, booleans in date/notes) is a blocker + termination review", () => {
  const hdr = ["Required", "", "", "if update required", "", "", "", "", "Automatic", "", "", ""];
  const rows = [hdr, [...UPDATES_HEADERS], ["", "", "", "", "", "", "Name, mobile, or email", "If Ethos should process an agent termination", "", "", "", ""],
    ["Chuk", "Ifed", "21755124", "21346366", "Level 17", "6 Month Advance", "(555) 010-8228", "", "", "0", "0", "0", "0", "46223", "447060", "58832", "58832", "", "@Level 8 Financial"],
    ["Ter", "Minated", "21000030", "", "", "", "", "Yes", "", "", "", ""]];
  const a = auditUpdatesTab(rows);
  assert.equal(a.header.ok, true);
  assert.equal(a.counts.records, 2);
  assert.ok(codes(a.rows[0].findings).includes("update_row_out_of_schema"));
  assert.deepEqual(a.rows[0].requestedChanges, ["upline", "comp_level", "advance", "pii_correction"]);
  assert.ok(codes(a.rows[1].findings).includes("termination_requested_verify_authorization"));
  assert.equal(a.counts.terminationRequests, 1);
});

test("pipeline stage: failed sync > on-sheet carrier states > conflict > information > licensing > E&O > approval > ready", () => {
  const f = (code: string, severity: "blocker" | "review" = "blocker") => ({ code, severity, field: "", column: null, message: "", resolution: "" });
  assert.equal(derivePipelineStage({ deliveryState: "dead_letter", findings: [], onSheet: false }), "failed_sync");
  const carrier = readCarrierState(row({ PORTAL: "TRUE", PORTAL_DATE: "needs reparenting" }));
  assert.equal(derivePipelineStage({ findings: [], onSheet: true, carrier }), "reparenting");
  assert.equal(derivePipelineStage({ findings: [], onSheet: true, carrier: readCarrierState(row({ PORTAL: "TRUE", PORTAL_DATE: "7/20/2026" })) }), "carrier_confirmed");
  assert.equal(derivePipelineStage({ findings: [], onSheet: true, carrier: readCarrierState(row()) }), "submitted_awaiting_ethos");
  assert.equal(derivePipelineStage({ findings: [f("npn_equals_phone"), f("license_not_verified")], onSheet: false }), "validation_conflict");
  assert.equal(derivePipelineStage({ findings: [f("npn_missing"), f("eo_not_verified")], onSheet: false }), "needs_information");
  assert.equal(derivePipelineStage({ findings: [f("license_not_verified"), f("approval_comp_level_missing")], onSheet: false }), "licensing_pending");
  assert.equal(derivePipelineStage({ findings: [f("eo_expired")], onSheet: false }), "eo_pending");
  assert.equal(derivePipelineStage({ findings: [f("approval_upline_missing")], onSheet: false }), "approval_required");
  assert.equal(derivePipelineStage({ findings: [f("npn_unusual_length", "review")], onSheet: false }), "ready_to_submit");
});

test("masked report carries no identity values", () => {
  const audit = auditSignupTab([header, row({ NPN: "21000040", EMAIL: "secret@example.com" }), row({ NPN: "21000040", EMAIL: "secret@example.com" })]);
  const rep = JSON.stringify(toMaskedReport(audit, null, "test"));
  assert.ok(!rep.includes("21000040") && !rep.includes("secret@example.com") && !rep.includes("Test"));
  assert.equal(maskId("21346366"), "•••••366");
  assert.ok(looksFormulaLike("=1+1") && looksFormulaLike("@x") && !looksFormulaLike("(555) 010-0001") && !looksFormulaLike("La'Nyia"));
});

test("CSV parser handles quoted commas, doubled quotes and embedded newlines; HTML is never a sheet", async () => {
  const { parseCsv, looksLikeHtml } = await import("../../../supabase/functions/_shared/ethos-contract.ts");
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n"multi\nline",x,\n'), [["a", "b, c", 'say "hi"'], ["multi\nline", "x", ""]]);
  assert.equal(looksLikeHtml("<!DOCTYPE html><html><body>Sign in</body></html>"), true);
  assert.equal(looksLikeHtml("Agent First Name,Agent Last Name\n"), false);
});
