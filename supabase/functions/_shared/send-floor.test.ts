// PL-WIB-COURSE-ENROLL-FLOOR. The verdict for floor "staff_or_agent", tested
// without a database. The case this floor exists for is the open-signup
// stranger: role 'agent' (handle_new_user gives every signup that) and no
// agents row. That must be 403, and a read error must never decide either way.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { staffOrAgentVerdict } from "./send-floor.ts";

Deno.test("stranger signup: role 'agent', no agents row -> 403", () => {
  assertEquals(staffOrAgentVerdict([{ role: "agent" }], null, [], null).status, 403);
});

Deno.test("no roles and no agents row -> 403", () => {
  assertEquals(staffOrAgentVerdict([], null, [], null).status, 403);
});

Deno.test("real agent: agents row present -> 200", () => {
  assertEquals(staffOrAgentVerdict([{ role: "agent" }], null, [{ id: "a" }], null).status, 200);
});

for (const role of ["admin", "super_admin", "manager", "va_manager", "va", "recruiter"]) {
  Deno.test(`staff role ${role} without an agents row -> 200`, () => {
    assertEquals(staffOrAgentVerdict([{ role }], null, [], null).status, 200);
  });
}

Deno.test("roles read failed -> 503, never a verdict", () => {
  assertEquals(staffOrAgentVerdict(null, { message: "x" }, [{ id: "a" }], null).status, 503);
});

Deno.test("agents read failed for a non-staff caller -> 503", () => {
  assertEquals(staffOrAgentVerdict([{ role: "agent" }], null, null, { message: "x" }).status, 503);
});
