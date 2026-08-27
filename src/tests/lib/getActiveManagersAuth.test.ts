import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/get-active-managers/index.ts"),
  "utf8",
);

describe("get-active-managers authorization boundary", () => {
  it("authenticates and authorizes before any service-role manager read", () => {
    const auth = source.indexOf("supabaseAdmin.auth.getUser");
    const role = source.indexOf('.in("role", ["admin", "manager"])');
    const managerRead = source.indexOf('.in("role", ["manager", "admin"])');
    expect(auth).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(auth);
    expect(managerRead).toBeGreaterThan(role);
    expect(source).toContain('status: 401');
    expect(source).toContain('status: 403');
  });
});
