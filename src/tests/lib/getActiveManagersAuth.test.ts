import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/get-active-managers/index.ts"),
  "utf8",
);
const publicSource = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/get-public-recruiters/index.ts"),
  "utf8",
);
const applySource = fs.readFileSync(
  path.resolve(__dirname, "../../../src/pages/Apply.tsx"),
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

  it("keeps public application attribution on a minimal rate-limited endpoint", () => {
    expect(applySource).toContain('invoke("get-public-recruiters")');
    expect(applySource).not.toContain('invoke("get-active-managers")');
    expect(publicSource).toContain("MAX_PER_WINDOW = 30");
    expect(publicSource).toContain('.select("id, user_id, display_name")');
    expect(publicSource).not.toContain('select("id, user_id, display_name, photo_url")');
    expect(source).not.toContain('.select("id, photo_url, display_name")');
    expect(publicSource).not.toContain("email");
    expect(publicSource).not.toContain("phone");
  });
});
