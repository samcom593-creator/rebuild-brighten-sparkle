import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

// MP-457 made requireSendAuth's role floor a PARAMETER so that
// send-course-enrollment-email could be gated on authentication without
// locking out the va_manager/va/recruiter and plain-agent surfaces that
// legitimately press its buttons. That parameter is also the regression this
// wave created: flip the DEFAULT and send-email + send-bulk-email silently
// drop from admin/manager to any signed-in user, with nothing red anywhere.
// check:credential-minting cannot see it — it grades whether a gate exists
// above the mint, not which floor that gate enforces.
describe("requireSendAuth role floor", () => {
  const primitive = read("supabase/functions/_shared/require-send-auth.ts");
  const course = read("supabase/functions/send-course-enrollment-email/index.ts");

  it("defaults to admin_or_manager, so the send-* wrappers keep the floor they were proven with", () => {
    expect(primitive).toMatch(/opts\.floor\s*\?\?\s*"admin_or_manager"/);
  });

  it("still enforces the role read on the default floor", () => {
    expect(primitive).toContain('.from("user_roles")');
    expect(primitive).toMatch(/forbidden: sending requires admin or manager/);
  });

  it("keeps both existing importers on the default by passing no options", () => {
    for (const file of ["supabase/functions/send-email/index.ts", "supabase/functions/send-bulk-email/index.ts"]) {
      const src = read(file);
      expect(src).toMatch(/requireSendAuth\(\s*req\s*\)/);
      // A second argument here is a floor change hiding in a diff nobody reads.
      expect(src).not.toMatch(/requireSendAuth\(\s*req\s*,/);
    }
  });

  it("gates send-course-enrollment-email ABOVE the mint and the agents lookup", () => {
    const gateAt = course.indexOf("requireSendAuth(");
    const mintAt = course.indexOf("magic_login_tokens");
    const lookupAt = course.indexOf('.from("agents")');
    expect(gateAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeGreaterThan(-1);
    // The mint lives in a helper declared above the handler, so ordering is
    // asserted against the LOOKUP — the first thing the request reaches — and
    // the helper is proven unreachable without passing the gate by the fact
    // that the handler is its only caller.
    expect(gateAt).toBeLessThan(lookupAt);
    expect(course.match(/generateMagicToken\(/g)?.length).toBe(2); // declaration + one call
  });

  // PL-WIB-COURSE-ENROLL-FLOOR: not admin (a silent disable for the va/recruiter
  // and CallCenter agents who press it), and not any_authenticated (signup is
  // open and every signup holds the 'agent' role, so that admitted strangers).
  it("uses the staff_or_agent floor there: no admin lockout, no stranger signups", () => {
    expect(course).toMatch(/requireSendAuth\(\s*req\s*,\s*\{\s*floor:\s*"staff_or_agent"\s*\}\s*\)/);
  });

  it("staff_or_agent reads an agents row, so the 'agent' role every signup gets is not enough", () => {
    const floorModule = read("supabase/functions/_shared/send-floor.ts");
    const branch = primitive.slice(primitive.indexOf('if (floor === "staff_or_agent")'));
    expect(branch).toContain('.from("agents")');
    expect(floorModule).not.toMatch(/STAFF_ROLES\s*=\s*new Set\([^)]*"agent"/);
  });
});
