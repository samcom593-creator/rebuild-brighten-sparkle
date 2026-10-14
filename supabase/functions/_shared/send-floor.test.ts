// PL-WIB-COURSE-ENROLL-FLOOR. The verdict for floor "staff_or_agent", tested
// without a database. The case this floor exists for is the open-signup
// stranger: role 'agent' (handle_new_user gives every signup that) and no
// agents row. That must be 403, and a read error must never decide either way.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { staffOrAgentVerdict, staffVerdict } from "./send-floor.ts";

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

// PL-WIB-STAFF-PAGE-SENDERS. Floor "staff": the agents row that admits a real
// agent under staff_or_agent must NOT admit anyone here, so a plain agent is
// 403 whatever the agents table says (the verdict never sees it).
Deno.test("staff floor: role 'agent' -> 403", () => {
  assertEquals(staffVerdict([{ role: "agent" }], null).status, 403);
});

Deno.test("staff floor: no roles -> 403", () => {
  assertEquals(staffVerdict([], null).status, 403);
});

for (const role of ["admin", "super_admin", "manager", "va_manager", "va", "recruiter"]) {
  Deno.test(`staff floor: role ${role} -> 200`, () => {
    assertEquals(staffVerdict([{ role }], null).status, 200);
  });
}

Deno.test("staff floor: roles read failed -> 503, never a verdict", () => {
  assertEquals(staffVerdict(null, { message: "x" }).status, 503);
  assertEquals(staffVerdict([{ role: "admin" }], { message: "x" }).status, 503);
});
