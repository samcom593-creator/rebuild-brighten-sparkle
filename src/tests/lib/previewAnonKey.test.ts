// PL-PREVIEW-ANON-KEY (2026-10-27). Source contract for the preview-only
// fallback in vite.config.ts. Three things it pins:
//   1. the literal is the PUBLIC anon key of THIS project (role=anon, ref
//      xrzweoneiieddzxogewk), so a service key or another project's key can
//      never be pasted there and survive CI;
//   2. the fallback is gated on Vercel saying "preview" AND the key being
//      unset, so production and local builds are untouched and a key that is
//      set is never overridden;
//   3. the key is referenced nowhere else in the config, so it cannot leak
//      into an unconditional define.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const config = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
}

describe("preview anon-key fallback", () => {
  const match = config.match(/const PREVIEW_PUBLIC_ANON_KEY =\s*"([^"]+)";/);

  it("declares exactly one key literal, and it is this project's anon role", () => {
    expect(match).not.toBeNull();
    const key = match![1];
    expect(config.split(key).length - 1).toBe(1);
    const payload = decodeJwtPayload(key);
    expect(payload.role).toBe("anon");
    expect(payload.ref).toBe("xrzweoneiieddzxogewk");
    expect(payload.iss).toBe("supabase");
  });

  it("pins the URL to the same project the key was minted for", () => {
    const url = config.match(/const PREVIEW_PUBLIC_SUPABASE_URL = "([^"]+)";/);
    expect(url).not.toBeNull();
    expect(url![1]).toBe("https://xrzweoneiieddzxogewk.supabase.co");
    const payload = decodeJwtPayload(match![1]);
    expect(url![1]).toContain(`https://${payload.ref}.supabase.co`);
  });

  it("applies only to Vercel preview builds, fills only what is unset, and never overrides a set value", () => {
    const gate = /if \(process\.env\.VERCEL_ENV === "preview"\) \{\s*if \(!process\.env\.VITE_SUPABASE_URL\) process\.env\.VITE_SUPABASE_URL = PREVIEW_PUBLIC_SUPABASE_URL;\s*if \(!process\.env\.VITE_SUPABASE_PUBLISHABLE_KEY\) process\.env\.VITE_SUPABASE_PUBLISHABLE_KEY = PREVIEW_PUBLIC_ANON_KEY;\s*\}/;
    expect(config).toMatch(gate);
    // Each constant is read in that one assignment and nowhere else (no define, no plugin).
    expect(config.split("PREVIEW_PUBLIC_ANON_KEY").length - 1).toBe(2);
    expect(config.split("PREVIEW_PUBLIC_SUPABASE_URL").length - 1).toBe(2);
  });
});
