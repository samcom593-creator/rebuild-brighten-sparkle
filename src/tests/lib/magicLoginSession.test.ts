import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loginTokenFromRedirect } from "@/lib/magicLoginSession";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

// MP-HIRE-RESUME (2026-11-10): Danon Turner activated /hire/<token> at 19:09Z and
// never got logged in — the login rode a URL reached only when the onboarding video
// ENDED, and reopening the used link said "ask for a fresh link".
describe("loginTokenFromRedirect", () => {
  it("pulls the token out of the redirect consume-invite-token returns", () => {
    expect(loginTokenFromRedirect("/magic-login?token=abc123")).toBe("abc123");
    expect(loginTokenFromRedirect("/magic-login?foo=1&token=xyz")).toBe("xyz");
  });

  it("returns null for anything that is not a magic-login redirect", () => {
    expect(loginTokenFromRedirect(null)).toBeNull();
    expect(loginTokenFromRedirect(undefined)).toBeNull();
    expect(loginTokenFromRedirect("/agent-portal?welcome=1")).toBeNull();
    expect(loginTokenFromRedirect("/magic-login?token=")).toBeNull();
    expect(loginTokenFromRedirect("https://evil.example/magic-login?token=abc")).toBeNull();
  });
});

describe("hire activation never strands a new agent (source contract)", () => {
  const hire = read("src/pages/HireLink.tsx");
  const video = read("src/components/onboarding/PostSubmitOnboardingVideo.tsx");

  it("signs in before the onboarding video starts", () => {
    const signIn = hire.indexOf("signInWithLoginToken(loginToken)");
    const start = hire.indexOf("onboardingPlayerRef.current?.start(nextUrl)");
    expect(signIn).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(signIn);
  });

  it("turns a used hire link into a sign-in, not a dead end", () => {
    expect(hire).toContain('invalid === "invite_already_used" && token');
    expect(hire).toContain("<ActivatedLinkResume token={token} />");
    expect(hire).toContain('"invite_resume_login"');
  });

  it("a video that fails to load moves the hire on instead of trapping them", () => {
    expect(video).toMatch(/onError=\{\(\) => \{\s*failedRef\.current = true;\s*if \(startedRef\.current\) void finish\(\);/);
    expect(video).toContain("if (failedRef.current) {");
  });

  it("the resume function is in the mirrored migration with the never-signed-in rule", () => {
    const sql = read("supabase/migrations/20261110200000_invite_resume_login.sql");
    expect(sql).toContain("'already_signed_in'");
    expect(sql).toContain("accepted_email");
    expect(sql).toContain("grant execute on function public.invite_resume_login(text, text) to anon");
  });
});
