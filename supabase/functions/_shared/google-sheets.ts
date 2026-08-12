// Minimal Google Sheets v4 client for the Ethos Agents sheet.
//
// Uses only fetch and Web Crypto, both of which exist in Deno and in Node 18+,
// so the same module the dispatcher runs is the module the tests exercise
// against a stubbed fetch.
//
// Scope is deliberately the narrowest that does the job: read a range, update a
// range, append a row. No delete, no formatting, no batch mutation. The service
// account should likewise be granted Editor on THIS sheet only, never
// drive-wide scope.

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Sign a service-account assertion and exchange it for an access token. */
export async function getAccessToken(
  sa: ServiceAccount,
  now: number,
  fetchImpl: FetchLike,
): Promise<string> {
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(now / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: SHEETS_SCOPE,
        aud: tokenUri,
        iat,
        exp: iat + 3600,
      }),
    ),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;

  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  let body: { access_token?: string } | null = null;
  try {
    body = await res.json();
  } catch { // empty-catch-allow:token-endpoint-body-may-be-non-json
    // A non-JSON body from the token endpoint is still fully described by the
    // status code below. The parse failure itself carries nothing actionable,
    // and anything it did carry would be adjacent to key material.
  }
  if (!res.ok || !body?.access_token) {
    // Never echo the assertion or the key material into an error string.
    throw new Error(`Google token exchange returned ${res.status}`);
  }
  return String(body.access_token);
}

export type SheetsClient = {
  getRange(range: string): Promise<string[][]>;
  updateRange(range: string, values: string[][]): Promise<string>;
  appendRow(range: string, values: string[]): Promise<string>;
};

export function createSheetsClient(
  sheetId: string,
  accessToken: string,
  fetchImpl: FetchLike,
): SheetsClient {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const auth = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

  async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { // empty-catch-allow:provider-body-may-be-non-json
      // A non-JSON body is still described by the status and a short excerpt.
    }
    if (!res.ok) {
      const detail =
        (parsed?.error as { message?: string } | undefined)?.message ?? text.slice(0, 200);
      throw new Error(`Google Sheets returned ${res.status}: ${detail}`);
    }
    return parsed ?? {};
  }

  return {
    async getRange(range) {
      const body = await call(`${base}/values/${encodeURIComponent(range)}`, { headers: auth });
      return (body.values as string[][] | undefined) ?? [];
    },
    async updateRange(range, values) {
      const body = await call(
        `${base}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        { method: "PUT", headers: auth, body: JSON.stringify({ values }) },
      );
      // updatedRange is the provider receipt: it names exactly which cells moved.
      const receipt = body.updatedRange as string | undefined;
      if (!receipt) throw new Error("Google Sheets accepted the update without returning updatedRange");
      return receipt;
    },
    async appendRow(range, values) {
      const body = await call(
        `${base}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", headers: auth, body: JSON.stringify({ values: [values] }) },
      );
      const updates = body.updates as { updatedRange?: string } | undefined;
      const receipt = updates?.updatedRange;
      if (!receipt) throw new Error("Google Sheets accepted the append without returning updatedRange");
      return receipt;
    },
  };
}
