// Vercel serverless function: sync deal to InsuraCloud
// Uses session-based auth: login → CSRF → POST /api/deals
//
// IMPORTANT: credentials and user mapping MUST come from Vercel env. The old
// hardcoded fallback to Sam's account caused every unmapped deal to land on
// his InsuraCloud user (phantom production). Per Codex audit 2026-05-14 we
// fail fast instead of falling back.
const INSURACLOUD_BASE = "https://agentlink.insuracloud.ai";
const INSURACLOUD_EMAIL = process.env.INSURACLOUD_EMAIL;
const INSURACLOUD_PASSWORD = process.env.INSURACLOUD_PASSWORD;

// Map carrier names (lowercase) to InsuraCloud carrier IDs
const CARRIER_MAP: Record<string, number> = {
  "prudential": 24,
  "sbli": 2,
  "combined": 3,
  "ladder": 5,
  "corebridge": 8,
  "foresters": 10,
  "transamerica": 12,
  "newbridge": 20,
  "united home life": 6,
  "aflac": 13,
  "mutual of omaha": 11,
  "american amicable": 4,
  "baltimore life": 22,
  "american home life": 7,
  "national life group": 23,
  "guarantee trust life": 9,
  "royal neighbors": 14,
  "fidelity & guaranty": 25,
  "instabrain": 26,
};

function resolveCarrierId(carrierNameOrId: string | number | undefined): number | undefined {
  if (!carrierNameOrId) return undefined;
  if (typeof carrierNameOrId === "number") return carrierNameOrId;
  const parsed = parseInt(String(carrierNameOrId), 10);
  if (!isNaN(parsed)) return parsed;
  const key = String(carrierNameOrId).toLowerCase().trim();
  return CARRIER_MAP[key];
}

async function loginAndGetSession(): Promise<{ cookie: string; csrfToken: string } | null> {
  // Step 1: Get CSRF token and session cookie
  const csrfResp = await fetch(`${INSURACLOUD_BASE}/api/csrf-token`, {
    method: "GET",
    credentials: "include",
  });
  const setCookie = csrfResp.headers.get("set-cookie") || "";
  const csrfData = await csrfResp.json() as { csrfToken: string };
  const csrfToken = csrfData.csrfToken;

  // Extract GAESA cookie from set-cookie header
  const gaesaMatch = setCookie.match(/GAESA=([^;]+)/);
  const gaesa = gaesaMatch ? gaesaMatch[1] : "";

  // Step 2: Login
  const loginResp = await fetch(`${INSURACLOUD_BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      "Cookie": gaesa ? `GAESA=${gaesa}` : "",
    },
    body: JSON.stringify({ email: INSURACLOUD_EMAIL, password: INSURACLOUD_PASSWORD }),
  });

  if (!loginResp.ok) return null;

  const loginSetCookie = loginResp.headers.get("set-cookie") || "";
  const sidMatch = loginSetCookie.match(/connect\.sid=([^;]+)/);
  const newGaesaMatch = loginSetCookie.match(/GAESA=([^;]+)/);

  const sid = sidMatch ? sidMatch[1] : "";
  const newGaesa = newGaesaMatch ? newGaesaMatch[1] : gaesa;
  const cookieHeader = [
    sid ? `connect.sid=${sid}` : "",
    newGaesa ? `GAESA=${newGaesa}` : "",
  ].filter(Boolean).join("; ");

  // Step 3: Get fresh CSRF token for authenticated session
  const csrfResp2 = await fetch(`${INSURACLOUD_BASE}/api/csrf-token`, {
    headers: { "Cookie": cookieHeader },
  });
  const csrfData2 = await csrfResp2.json() as { csrfToken: string };

  return { cookie: cookieHeader, csrfToken: csrfData2.csrfToken };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    deal_id,
    client_first_name,
    client_last_name,
    client_phone,
    client_dob,
    product_sold,
    policy_number,
    monthly_premium,
    annual_premium,
    face_amount,
    effective_date,
    notes,
    carrier_id,
    carrier_name,
    agent_insuracloud_id,
  } = req.body ?? {};

  if (!deal_id) return res.status(400).json({ ok: false, error: "deal_id is required" });

  if (!INSURACLOUD_EMAIL || !INSURACLOUD_PASSWORD) {
    return res.status(500).json({
      ok: false,
      error: "InsuraCloud credentials not configured (set INSURACLOUD_EMAIL + INSURACLOUD_PASSWORD env vars).",
    });
  }

  // Fail fast when the deal has no agent_insuracloud_id mapping. Falling back
  // to Sam silently corrupted production attribution for months.
  if (!agent_insuracloud_id) {
    return res.status(400).json({
      ok: false,
      error: "agent_insuracloud_id is required — refusing to fall back to default user.",
      code: "MISSING_AGENT_MAPPING",
    });
  }

  const resolvedCarrierId = resolveCarrierId(carrier_id || carrier_name);
  const monthlyPremiumNum = parseFloat(String(monthly_premium || 0));
  const annualPremiumNum = parseFloat(String(annual_premium || 0)) || +(monthlyPremiumNum * 12).toFixed(2);

  const dealPayload: Record<string, unknown> = {
    externalId:        String(deal_id),
    userId:            agent_insuracloud_id,
    clientFirstName:   client_first_name || "Unknown",
    clientLastName:    client_last_name  || "Client",
    clientPhoneNumber: client_phone      || "+10000000000",
    clientDateOfBirth: client_dob        || "1980-01-01",
    productSold:       product_sold      || "Life Insurance",
    policyNumber:      policy_number     || `POL-${deal_id}`,
    monthlyPremium:    monthlyPremiumNum,
    annualPremium:     annualPremiumNum,
    faceAmount:        parseFloat(String(face_amount || 0)),
    effectiveDate:     effective_date    || new Date().toISOString().split("T")[0],
  };

  if (notes)             dealPayload.notes     = notes;
  if (resolvedCarrierId) dealPayload.carrierId  = resolvedCarrierId;

  try {
    const session = await loginAndGetSession();
    if (!session) {
      return res.status(401).json({ ok: false, error: "InsuraCloud login failed" });
    }

    const response = await fetch(`${INSURACLOUD_BASE}/api/deals`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-CSRF-Token":  session.csrfToken,
        "Cookie":        session.cookie,
      },
      body: JSON.stringify(dealPayload),
    });

    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: `InsuraCloud ${response.status}: ${text.slice(0, 400)}`,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
