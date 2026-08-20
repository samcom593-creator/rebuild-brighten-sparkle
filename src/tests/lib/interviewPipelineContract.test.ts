import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("native recruiting interview contract", () => {
  it("routes every visible interview entry into the recruiting workspace", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/dashboard/recruiting/interviews"');
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
});
