// Regression test for the ntfy emoji-header outage.
//
// Guards BOTH directions, because the interesting half is the negative one: this
// test asserts that the naive construction really does throw, so if a future Deno
// ever stops throwing, the test fails loudly rather than quietly protecting nothing.
//
// Run: deno test --allow-none supabase/functions/_shared/header-safe.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { headerSafe } from "./header-safe.ts";

// The exact subjects that were dying in production.
const REAL_SUBJECTS = [
  "🎓 Tyler Munis passed their license exam",
  "🔴 CRITICAL: the pipelines are not moving",
  "🟡 WARN: stale in_progress entries",
];

Deno.test("the naive header construction still throws — the bug is real", () => {
  for (const subject of REAL_SUBJECTS) {
    assertThrows(
      () => new Request("https://ntfy.sh/x", { method: "POST", headers: { Title: subject } }),
      TypeError,
      undefined,
      `expected a raw emoji Title to be rejected as a ByteString: ${subject}`,
    );
  }
});

Deno.test("headerSafe makes every real subject constructible", () => {
  for (const subject of REAL_SUBJECTS) {
    const encoded = headerSafe(subject);
    const req = new Request("https://ntfy.sh/x", { method: "POST", headers: { Title: encoded } });
    assertEquals(req.headers.get("Title"), encoded);
    assert(encoded.startsWith("=?UTF-8?B?"), `expected RFC 2047 encoding, got: ${encoded}`);
  }
});

Deno.test("ASCII is passed through untouched, not needlessly encoded", () => {
  const plain = "Tyler Munis passed their license exam";
  assertEquals(headerSafe(plain), plain);
});

Deno.test("encoding is lossless — decodes back to the original emoji", () => {
  for (const subject of REAL_SUBJECTS) {
    const b64 = headerSafe(subject).replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    assertEquals(new TextDecoder().decode(bytes), subject);
  }
});
