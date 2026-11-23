import { describe, expect, test, vi } from "vitest";
// The SAME token exchange the dispatcher runs before any Ethos write.
import { getAccessToken, isAuthorizedUser } from "../../../supabase/functions/_shared/google-sheets.ts";

// MP-304: the Ethos workbook is owned by Level 8 Financial; Sam is a writer without share rights, so the write
// credential is Sam's own user OAuth (authorized_user), never a service account. Both shapes ride the same secret.
const USER = { type: "authorized_user" as const, client_id: "cid.apps.googleusercontent.com", client_secret: "shh", refresh_token: "1//refresh" };

describe("google-sheets · authorized_user credential (MP-304)", () => {
  test("recognises the gcloud authorized_user shape and nothing else", () => {
    expect(isAuthorizedUser(USER)).toBe(true);
    expect(isAuthorizedUser({ client_email: "x@y.iam.gserviceaccount.com", private_key: "k" })).toBe(false);
    expect(isAuthorizedUser({ type: "authorized_user", client_id: "c" })).toBe(false);
  });

  test("exchanges the refresh token at the token endpoint with the spreadsheets client, no JWT signing", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("1//refresh");
      expect(body.get("client_id")).toBe("cid.apps.googleusercontent.com");
      return new Response(JSON.stringify({ access_token: "ya29.token", expires_in: 3599 }), { status: 200 });
    });
    const tok = await getAccessToken(USER, Date.now(), fetchImpl as never);
    expect(tok).toBe("ya29.token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a refused refresh is an error, never an empty token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 }));
    await expect(getAccessToken(USER, Date.now(), fetchImpl as never)).rejects.toThrow(/invalid_grant/);
  });
});
