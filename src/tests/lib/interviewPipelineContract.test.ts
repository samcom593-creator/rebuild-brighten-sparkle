import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("native recruiting interview contract", () => {
  it("routes every visible interview entry into the recruiting workspace", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/dashboard/recruiting/interviews"');
    expect(app).toContain('path="/dashboard/recruiting/training"');
    expect(app).toContain('<LegacyWorkspaceRedirect to="/dashboard/recruiting/interviews" />');
    expect(app).toContain('<LegacyWorkspaceRedirect to="/dashboard/recruiting/follow-ups" />');
    expect(read("src/pages/Interviews.tsx")).not.toContain("headhunter-sand.vercel.app");
  });

  it("keeps VA reads owned and writes versioned with an activity receipt", () => {
    const edge = read("supabase/functions/interviews-pipeline/index.ts");
    expect(edge).toContain('query = query.eq("va_id", actor.hhUser.id)');
    expect(edge).toContain('const VA_ACTIONS = new Set<InterviewAction>(["confirm", "no_show", "reschedule", "cancel"])');
    expect(edge).toContain('.eq("version", expectedVersion)');
    expect(edge).toContain('admin.from("hh_activity").insert');
    expect(edge).toContain("activityLogged: !activityError");
  });

  it("retires the legacy unversioned interview writer", () => {
    const legacy = read("supabase/functions/interviews-outcome/index.ts");
    expect(legacy).toContain("INTERVIEW_ENDPOINT_RETIRED");
    expect(legacy).not.toContain('.from("hh_applicants").update');
  });

  it("renders candidate Instagram identity as a sanitized one-tap link", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain("instagramProfileLink(row.instagram)");
    // The raw column never reaches an href; only the validated handle does.
    expect(page).not.toContain("instagram.com/${row.instagram");
    expect(page).toContain("href={instagram.href}");
    expect(page).toContain("onClick={(event) => event.stopPropagation()}");
    expect(page).toContain("title={`Open @${instagram.handle} on Instagram`}");
    const lib = read("src/lib/instagram.ts");
    expect(lib).toContain("/^[a-z0-9._]{1,30}$/i");
    expect(lib).toContain("https://www.instagram.com/");
  });

  it("never leaves the action dialog holding a version that no longer exists", () => {
    const page = read("src/pages/Interviews.tsx");
    // 409 from the versioned writer closes the dialog and refreshes the queue.
    expect(page).toContain("conflict = context.status === 409");
    expect(page).toContain("(error as { conflict?: boolean } | null)?.conflict");
    // A failed promotion after a persisted hire also closes and refetches,
    // pointing at the row's retry path instead of a doomed second hire write.
    expect(page).toContain("Retry from the row's Start onboarding button");
    const promoteFailure = page.indexOf("Retry from the row's Start onboarding button");
    const closeAfter = page.indexOf("setPending(null);", promoteFailure);
    expect(closeAfter).toBeGreaterThan(promoteFailure);
  });

  it("gates licensed hires on a well-formed self-reported NPN at both layers", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain('pending.row.application_license_status === "licensed" && !/^\\d{5,10}$/.test(hireNpn)');
    expect(page).toContain("registry verification remains a separate NIPR receipt");
    const lib = read("src/lib/hireToOnboarding.ts");
    expect(lib).toContain("npn.length < 5 || npn.length > 10");
  });

  it("never exposes a hire action that cannot create onboarding", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain('action !== "hire" || Boolean(row.application_id)');
    expect(page).toContain("Application link needed to hire");
    expect(page).toContain('selected.action === "promote"');
    expect(page).toContain("Link the ${BRAND.shortName} application");
    expect(page).toContain("choosePromotion(row)");
  });

  it("resolves identity only from unanimous unique signals and paginates source rows", () => {
    const edge = read("supabase/functions/interviews-pipeline/index.ts");
    expect(edge).toContain('byInstagram: buildUniqueMap(rows, "instagram")');
    expect(edge).toContain("identityConflict: signalIds.length > 1");
    expect(edge).toContain("identity_conflict: identityConflict");
    expect(edge).toContain(".range(from, from + PAGE_SIZE - 1)");
  });

  it("enforces the application/onboarding invariant in the server writer", () => {
    const edge = read("supabase/functions/interviews-pipeline/index.ts");
    expect(edge).toContain('if (action === "hire")');
    expect(edge).toContain("Link an APEX application before hiring");
    expect(edge).toContain("Candidate identity conflicts across APEX applications");
  });

  it("rejects past reschedules in the browser and canonical writer", () => {
    const page = read("src/pages/Interviews.tsx");
    const edge = read("supabase/functions/interviews-pipeline/index.ts");
    expect(page).toContain("new Date(appointmentAt).getTime() <= Date.now()");
    expect(edge).toContain('throw new Error("Rescheduling requires a future date")');
  });

  it("keeps the requested tab across reloads", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain('new URLSearchParams(window.location.search).get("tab")');
    expect(page).toContain("window.history.replaceState");
  });

  it("never converts loading or refresh failure into a false zero", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain('value: pipeline.data ? overdue.length + needsDecision : null');
    expect(page).toContain('pipeline.isError && pipeline.data');
    expect(page).toContain("Showing the last successful interview snapshot");
    expect(page).toContain("Showing the last successful onboarding snapshot");
  });

  it("counts hires from the canonical active roster instead of interview-only stages", () => {
    const page = read("src/pages/Interviews.tsx");
    const edge = read("supabase/functions/interviews-pipeline/index.ts");
    expect(edge).toContain("async function fetchActiveHires");
    expect(edge).toContain('.eq("status", "active")');
    expect(edge).toContain('.is("canonical_agent_id", null)');
    expect(edge).toContain("activeHires,");
    expect(page).toContain('label: "Active hires"');
    expect(page).toContain("value: pipeline.data ? activeHires.length : null");
    expect(page).not.toContain("value: pipeline.data ? pipeline.data.counts.hired");
  });

  it("renders the interview control room instead of the legacy flat queue", () => {
    const page = read("src/pages/Interviews.tsx");
    expect(page).toContain('title="Interview Control Room"');
    expect(page).toContain("Work next");
    expect(page).toContain("INTERVIEW_RAIL.map");
    expect(page).toContain("HIRE_RAIL.map");
    expect(page).toContain("One-link candidate intake");
    expect(page).toContain("New-hire launch board");
    expect(page).toContain("Live recruiting pulse");
    expect(page).toContain("J / K moves through priority candidates");
    expect(page).toContain('type SortMode = "priority" | "appointment" | "newest"');
    expect(page).toContain('type HireFilter = "all" | "licensed" | "unlicensed" | "needs_action"');
    expect(page).toContain("refetchOnWindowFocus: true");
  });
});
