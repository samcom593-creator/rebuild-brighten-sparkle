import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DAILY_CAP, handleMilestone, type MilestoneDeps, validateMilestoneBody } from "./logic.ts";

const NOW = new Date("2026-11-10T20:00:00Z");
const APP = "11111111-2222-4333-8444-555555555555";

function deps(overrides: Partial<MilestoneDeps> = {}): MilestoneDeps & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    inserted,
    findApplication: async (id) => (id === APP ? { id, license_status: "unlicensed" } : null),
    recentReports: async () => [],
    insertReport: async (input) => {
      inserted.push(input);
      return { applied: { ok: true } };
    },
    now: () => NOW,
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("https://x/functions/v1/submit-licensing-milestone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("bad uuid -> 400 bad_application, nothing written", async () => {
  const d = deps();
  const res = await handleMilestone(post({ application_id: "not-a-uuid", kind: "exam_passed" }), d);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "bad_application");
  assertEquals(d.inserted.length, 0);
});

Deno.test("unknown application -> 404 no_application, nothing written", async () => {
  const d = deps();
  const res = await handleMilestone(
    post({ application_id: "99999999-2222-4333-8444-555555555555", kind: "exam_passed" }),
    d,
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "no_application");
  assertEquals(d.inserted.length, 0);
});

Deno.test("unknown kind -> 400", () => {
  const v = validateMilestoneBody({ application_id: APP, kind: "licensed" }, NOW);
  assertEquals(v.ok, false);
  if (!v.ok) assertEquals(v.code, "bad_kind");
});

Deno.test("exam date must be a real date in a sane window", () => {
  for (const exam_date of ["", "11/20/2026", "2026-13-40", "2020-01-01", "2030-01-01"]) {
    const v = validateMilestoneBody({ application_id: APP, kind: "exam_scheduled", exam_date }, NOW);
    assertEquals(v.ok, false, exam_date);
  }
  const ok = validateMilestoneBody({ application_id: APP, kind: "exam_scheduled", exam_date: "2026-11-20" }, NOW);
  assertEquals(ok.ok, true);
});

Deno.test("NPN keeps digits only and must be 5-10 of them", () => {
  assertEquals(validateMilestoneBody({ application_id: APP, kind: "npn", npn: "1234" }, NOW).ok, false);
  assertEquals(validateMilestoneBody({ application_id: APP, kind: "npn", npn: "12345678901" }, NOW).ok, false);
  const v = validateMilestoneBody({ application_id: APP, kind: "npn", npn: "NPN 1234-5678" }, NOW);
  assertEquals(v.ok, true);
  if (v.ok) assertEquals(v.value.npn, "12345678");
});

Deno.test("a licensed applicant cannot self-report exam milestones (409) but may add an NPN", async () => {
  const licensed = deps({ findApplication: async (id) => ({ id, license_status: "licensed" }) });
  const res = await handleMilestone(post({ application_id: APP, kind: "exam_passed" }), licensed);
  assertEquals(res.status, 409);
  const npn = await handleMilestone(post({ application_id: APP, kind: "npn", npn: "1234567" }), licensed);
  assertEquals(npn.status, 200);
});

Deno.test("double tap inside the dedupe window does not insert twice", async () => {
  const d = deps({ recentReports: async () => [{ kind: "exam_passed", created_at: "2026-11-10T19:59:30Z" }] });
  const res = await handleMilestone(post({ application_id: APP, kind: "exam_passed" }), d);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).deduped, true);
  assertEquals(d.inserted.length, 0);
});

Deno.test("daily cap -> 429", async () => {
  const many = Array.from({ length: DAILY_CAP }, () => ({ kind: "npn", created_at: "2026-11-10T10:00:00Z" }));
  const d = deps({ recentReports: async () => many });
  const res = await handleMilestone(post({ application_id: APP, kind: "exam_passed" }), d);
  assertEquals(res.status, 429);
  assertEquals(d.inserted.length, 0);
});

Deno.test("happy path inserts one report and returns what was applied", async () => {
  const d = deps();
  const res = await handleMilestone(post({ application_id: APP, kind: "exam_scheduled", exam_date: "2026-11-20" }), d);
  assertEquals(res.status, 200);
  assertEquals(d.inserted.length, 1);
  assertEquals((d.inserted[0] as { kind: string }).kind, "exam_scheduled");
});
