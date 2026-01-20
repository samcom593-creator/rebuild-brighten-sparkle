import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// Simple rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // Max 10 requests per minute per IP
const RATE_LIMIT_WINDOW = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NumOptional = (min: number, max: number) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === "") return undefined;
      if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    },
    z.number().min(min).max(max).optional(),
  );

const SubmitApplicationSchema = z.object({
  firstName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
  lastName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
  email: z.string().email().max(254),
  phone: z.string().min(10).max(20).regex(/^[\d\s\-\+\(\)]+$/, "Invalid phone format"),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(50),
  instagramHandle: z.string().max(50).optional().nullable(),

  hasInsuranceExperience: z.boolean().default(false),
  yearsExperience: NumOptional(0, 50),
  previousCompany: z.string().max(200).optional().nullable(),
  previousProduction: NumOptional(0, 100000000),

  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional().nullable(),
  licensedStates: z.array(z.string().min(2).max(50)).optional().nullable(),

  desiredIncome: NumOptional(0, 10000000),
  availability: z.string().min(1).max(500),
  referralSource: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

type SubmitApplicationRequest = z.infer<typeof SubmitApplicationSchema>;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const raw = await req.json();
    const parsed = SubmitApplicationSchema.safeParse(raw);

    if (!parsed.success) {
      console.error("submit-application validation error:", parsed.error.issues);
      return new Response(
        JSON.stringify({ error: "Invalid input data", details: parsed.error.issues }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const data: SubmitApplicationRequest = parsed.data;

    // Normalize instagram handle
    const instagram = (data.instagramHandle ?? "").trim();
    const instagramClean = instagram
      ? (instagram.startsWith("@") ? instagram.slice(1) : instagram)
      : null;

    // Optional: validate uuid if clients ever send it
    if (raw?.id && typeof raw.id === "string" && !uuidRegex.test(raw.id)) {
      return new Response(JSON.stringify({ error: "Invalid application id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const insertPayload = {
      // Allow client-supplied id if valid; else DB default
      ...(raw?.id && typeof raw.id === "string" && uuidRegex.test(raw.id)
        ? { id: raw.id }
        : {}),

      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone,
      city: data.city,
      state: data.state,
      instagram_handle: instagramClean,

      has_insurance_experience: data.hasInsuranceExperience,
      years_experience: data.yearsExperience ?? null,
      previous_company: data.previousCompany ?? null,
      previous_production: data.previousProduction ?? null,

      license_status: data.licenseStatus,
      nipr_number: data.niprNumber ?? null,
      licensed_states: data.licensedStates && data.licensedStates.length > 0
        ? data.licensedStates
        : null,

      desired_income: data.desiredIncome ?? null,
      availability: data.availability,
      referral_source: data.referralSource ?? null,
      notes: data.notes ?? null,

      status: "new",
      assigned_agent_id: null,
      reviewed_at: null,
      reviewed_by: null,
      contacted_at: null,
      qualified_at: null,
      closed_at: null,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("applications")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("submit-application insert error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to submit application" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    return new Response(
      JSON.stringify({ applicationId: inserted.id }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (err) {
    console.error("submit-application unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
