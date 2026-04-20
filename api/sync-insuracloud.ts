// Vercel serverless function: sync deal to InsuraCloud
const INSURACLOUD_BASE =
  process.env.INSURACLOUD_BASE_URL || "https://agentlink.replit.app";

const API_TOKEN =
  process.env.INSURACLOUD_API_TOKEN || "kytd75dtufjhgtydirykt";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

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
    agent_insuracloud_id,
  } = req.body ?? {};

  if (!deal_id) return res.status(400).json({ ok: false, error: "deal_id is required" });

  const dealPayload: Record<string, unknown> = {
    externalId:        deal_id,
    clientFirstName:   client_first_name,
    clientLastName:    client_last_name,
    clientPhoneNumber: client_phone,
    clientDateOfBirth: client_dob,
    productSold:       product_sold,
    policyNumber:      policy_number,
    monthlyPremium:    Number(monthly_premium || 0).toFixed(2),
    annualPremium:     Number(annual_premium  || 0).toFixed(2),
    faceAmount:        Number(face_amount     || 0).toFixed(2),
    effectiveDate:     effective_date,
  };

  if (notes)                dealPayload.notes    = notes;
  if (carrier_id)           dealPayload.carrierId = carrier_id;
  if (agent_insuracloud_id) dealPayload.userId    = agent_insuracloud_id;

  try {
    const response = await fetch(`${INSURACLOUD_BASE}/api/samuel-james/book`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${API_TOKEN}`,
        "x-api-key":    API_TOKEN,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({ deals: [dealPayload] }),
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
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
}
