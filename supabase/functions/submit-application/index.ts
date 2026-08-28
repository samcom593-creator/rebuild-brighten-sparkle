import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const SLACK_LINK = "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Simple rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW = 60000;

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

async function retainActiveReferralAgents(
  selectedReferralAgentId?: string | null,
  recruiterId?: string | null,
): Promise<{ selectedReferralAgentId: string | null; recruiterId: string | null }> {
  const ids = [...new Set([selectedReferralAgentId, recruiterId].filter((id): id is string => !!id))];
  if (ids.length === 0) return { selectedReferralAgentId: null, recruiterId: null };

  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, status, is_inactive, is_deactivated")
    .in("id", ids);

  if (error) {
    console.error("active referral validation failed", error);
    return { selectedReferralAgentId: null, recruiterId: null };
  }

  const activeIds = new Set(
    (data ?? [])
      .filter((agent: any) =>
        agent.is_inactive !== true &&
        agent.is_deactivated !== true &&
        !["inactive", "terminated"].includes(String(agent.status ?? "").toLowerCase())
      )
      .map((agent: any) => agent.id),
  );

  return {
    selectedReferralAgentId: selectedReferralAgentId && activeIds.has(selectedReferralAgentId)
      ? selectedReferralAgentId
      : null,
    recruiterId: recruiterId && activeIds.has(recruiterId) ? recruiterId : null,
  };
}

const NumOptional = (min: number, max: number) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === "") return undefined;
      if (typeof v === "number") return Number.isFinite(v) ? Math.floor(v) : undefined;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? Math.floor(n) : undefined;
      }
      return undefined;
    },
    z.number().min(min).max(max).optional(),
  );

function normalizeSubmittedPhone(value: string): string | null {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, "");
  let normalized: string | null = null;

  if (raw.startsWith("+")) normalized = digits;
  else if (digits.startsWith("011")) normalized = digits.slice(3);
  else if (digits.startsWith("00")) normalized = digits.slice(2);
  else if (digits.length === 10) normalized = `1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) normalized = digits;

  return normalized && normalized.length >= 8 && normalized.length <= 15 && !/^0+$/.test(normalized)
    ? `+${normalized}`
    : null;
}

const PhoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizeSubmittedPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid US number or an international number with country code",
      });
      return z.NEVER;
    }
    return normalized;
  });

// Consent data schema for Twilio compliance
const ConsentSchema = z.object({
  smsConsentGiven: z.boolean().default(false),
  smsConsentText: z.string().max(2000).optional().nullable(),
  emailConsentGiven: z.boolean().default(false),
  emailConsentText: z.string().max(2000).optional().nullable(),
  consentTimestampUtc: z.string().optional().nullable(),
  sourceUrl: z.string().max(500).optional().nullable(),
  userAgent: z.string().max(1000).optional().nullable(),
  formVersion: z.string().max(50).optional().nullable(),
});

/**
 * First-touch attribution fields (2026-08-04).
 *
 * Shared by the full-submit and quick-qualify schemas so the two paths can
 * never drift. All optional + nullable: the client is the only producer, and
 * a browser running a cached bundle from before this ship must keep working.
 *
 * Why this exists: Apply.tsx read utm_* off the /apply URL at submit time, so
 * anyone who landed on /?utm_source=...&gclid=... and clicked through lost the
 * params on the client-side route change. 776 of 783 applications recorded
 * utm_source = NULL, and gclid was never stored at all — which blocked Google
 * Ads offline conversion import entirely.
 *
 * Click-id max lengths are generous (gclid/gbraid/wbraid can run long) but
 * still bounded; attributionJson is an audit blob of the first/last/current
 * snapshots, capped client-side at 4 KB.
 */
const FirstTouchAttributionShape = {
  gclid: z.string().max(500).optional().nullable(),
  gbraid: z.string().max(500).optional().nullable(),
  wbraid: z.string().max(500).optional().nullable(),
  fbclid: z.string().max(500).optional().nullable(),
  ttclid: z.string().max(500).optional().nullable(),
  msclkid: z.string().max(500).optional().nullable(),
  firstTouchAt: z.string().max(64).optional().nullable(),
  firstLandingUrl: z.string().max(500).optional().nullable(),
  firstReferrer: z.string().max(500).optional().nullable(),
  attributionJson: z.record(z.unknown()).optional().nullable(),
};

/**
 * Map the validated first-touch fields onto applications columns. Returns a
 * plain object that is spread into the insert/update payloads — additive only,
 * so nothing existing changes shape.
 *
 * firstTouchAt is written to a timestamptz column, so a non-ISO string is
 * dropped rather than risking a 22007 on the whole insert.
 */
function firstTouchColumns(data: {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  firstTouchAt?: string | null;
  firstLandingUrl?: string | null;
  firstReferrer?: string | null;
  attributionJson?: Record<string, unknown> | null;
}): Record<string, unknown> {
  let firstTouchAt: string | null = null;
  if (data.firstTouchAt) {
    const parsed = new Date(data.firstTouchAt);
    if (!Number.isNaN(parsed.getTime())) firstTouchAt = parsed.toISOString();
  }
  return {
    gclid: data.gclid ?? null,
    gbraid: data.gbraid ?? null,
    wbraid: data.wbraid ?? null,
    fbclid: data.fbclid ?? null,
    ttclid: data.ttclid ?? null,
    msclkid: data.msclkid ?? null,
    first_touch_at: firstTouchAt,
    first_landing_url: data.firstLandingUrl ?? null,
    first_referrer: data.firstReferrer ?? null,
    attribution_json: data.attributionJson ?? null,
  };
}

const FIRST_TOUCH_COLUMN_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
  "msclkid",
  "first_touch_at",
  "first_landing_url",
  "first_referrer",
  "attribution_json",
] as const;

/**
 * Drop null first-touch keys from an UPDATE payload.
 *
 * First-touch is write-once by definition. On any update path (quick-qualify
 * re-submit, quick→full upgrade) the row may already hold a good gclid from an
 * earlier submit while this request carries none — the visitor cleared storage,
 * switched browsers, or came back through a different device. Sending null
 * there would erase real attribution. Inserts still write the full column set
 * (nulls included) because there is nothing to erase.
 */
function stripNullFirstTouch(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  for (const key of FIRST_TOUCH_COLUMN_KEYS) {
    if (out[key] === null || out[key] === undefined) delete out[key];
  }
  return out;
}

const FullSubmitApplicationSchema = z.object({
  quickQualifiedApplicationId: z.string().uuid().optional().nullable(),
  firstName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
  lastName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
  email: z.string().email().max(254),
  phone: PhoneSchema,
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(50),
  instagramHandle: z.string().max(50).optional().nullable(),
  carrier: z.string().max(20).optional().nullable(),

  hasInsuranceExperience: z.boolean().default(false),
  yearsExperience: NumOptional(0, 50),
  previousCompany: z.string().max(200).optional().nullable(),
  numberOfDownlines: NumOptional(0, 10000),

  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional().nullable(),
  licensedStates: z.array(z.string().min(2).max(50)).optional().nullable(),

  availability: z.string().min(1).max(500),
  referralSource: z.string().max(500).optional().nullable(),
  customReferrer: z.string().trim().max(120).optional().nullable(),
  
  // New: selected referral agent ID (the manager assigned)
  selectedReferralAgentId: z.string().uuid().optional().nullable(),
  // Recruiter (the agent whose ?ref= link was used) — saved separately from manager
  recruiterId: z.string().uuid().optional().nullable(),
  
  // Consent data for Twilio compliance
  consent: ConsentSchema.optional().nullable(),

  // Paid-social attribution captured from the public Apply URL.
  source: z.string().max(100).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmContent: z.string().max(200).optional().nullable(),
  utmTerm: z.string().max(200).optional().nullable(),
  landingUrl: z.string().max(500).optional().nullable(),
  // First-touch attribution (2026-08-04). See src/lib/attribution.ts — the
  // client now persists the landing campaign so it survives the SPA route
  // change to /apply. Every field is optional so older clients (and any
  // cached bundle still in a user's browser) keep submitting successfully.
  ...FirstTouchAttributionShape,
});

const QuickQualifySchema = z.object({
  quickQualify: z.literal(true),
  firstName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
  email: z.string().email().max(254),
  phone: PhoneSchema,
  licenseStatus: z.enum(["licensed", "unlicensed"]),
  selectedReferralAgentId: z.string().uuid().optional().nullable(),
  recruiterId: z.string().uuid().optional().nullable(),
  consent: ConsentSchema.optional().nullable(),
  source: z.string().max(100).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmContent: z.string().max(200).optional().nullable(),
  utmTerm: z.string().max(200).optional().nullable(),
  landingUrl: z.string().max(500).optional().nullable(),
  ...FirstTouchAttributionShape,
});

type SubmitApplicationRequest = z.infer<typeof FullSubmitApplicationSchema>;
type QuickQualifyRequest = z.infer<typeof QuickQualifySchema>;

// Sanitize string for HTML output to prevent XSS
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Get manager info by agent ID (including phone and Instagram)
interface ManagerInfo {
  email: string;
  name: string;
  phone?: string;
  instagramHandle?: string;
}

async function getManagerInfo(agentId: string): Promise<ManagerInfo | null> {
  try {
    // Get the agent's user_id
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", agentId)
      .single();
    
    if (agentError || !agent?.user_id) {
      console.log("Could not find agent:", agentError);
      return null;
    }
    
    // Get the profile info including phone and Instagram
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name, phone, instagram_handle")
      .eq("user_id", agent.user_id)
      .single();
    
    if (profileError || !profile?.email) {
      console.log("Could not find profile:", profileError);
      return null;
    }
    
    return {
      email: profile.email,
      name: profile.full_name || profile.email.split("@")[0],
      phone: profile.phone || undefined,
      instagramHandle: profile.instagram_handle || undefined,
    };
  } catch (err) {
    console.error("Error getting manager info:", err);
    return null;
  }
}

// Send manager notification email (with phone prompt if missing)
async function sendManagerNotification(
  data: SubmitApplicationRequest,
  manager: ManagerInfo,
  applicationId: string
) {
  if (!resend) return;

  const sanitized = {
    firstName: sanitizeHtml(data.firstName),
    lastName: sanitizeHtml(data.lastName),
    email: sanitizeHtml(data.email),
    phone: sanitizeHtml(data.phone),
    city: sanitizeHtml(data.city),
    state: sanitizeHtml(data.state),
    licenseStatus: data.licenseStatus,
    instagramHandle: data.instagramHandle ? sanitizeHtml(data.instagramHandle) : undefined,
  };

  const licenseStatusDisplay = {
    licensed: "Licensed",
    unlicensed: "Not Yet Licensed",
    pending: "License Pending",
  }[sanitized.licenseStatus] || sanitized.licenseStatus;

  // Phone prompt section for managers without phone
  const phonePromptSection = !manager.phone ? `
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; color: #92400e; font-weight: 500;">
        📱 Add your phone number! Your contact info is shared with applicants so they can reach you directly.
      </p>
      <p style="margin: 10px 0 0; color: #a16207; font-size: 14px;">
        Update your profile in the dashboard settings to add your phone number.
      </p>
    </div>
  ` : '';

  try {
    await resend.emails.send({
       from: "APEX Financial <notifications@apex-financial.org>",
      to: [manager.email],
      // 2026-07-29 Sam: same rule as the admin email — a manager must see licensed vs
      // unlicensed BEFORE anything else, because it decides whether they call now or
      // enroll. Status leads the subject so it survives phone truncation.
      subject: `${sanitized.licenseStatus === 'licensed' ? 'LICENSED ✅' : 'UNLICENSED'} — ${sanitized.firstName} ${sanitized.lastName} · your referral`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: ${sanitized.licenseStatus === 'licensed' ? '#047857' : '#b45309'}; padding: 22px 20px; text-align: center;">
            <div style="color: #ffffff; font-size: 30px; font-weight: 800; letter-spacing: 2px; line-height: 1.1;">
              ${sanitized.licenseStatus === 'licensed' ? 'LICENSED' : 'UNLICENSED'}
            </div>
            <div style="color: ${sanitized.licenseStatus === 'licensed' ? '#a7f3d0' : '#fde68a'}; font-size: 15px; margin-top: 6px; font-weight: 600;">
              ${sanitized.licenseStatus === 'licensed'
                ? 'Can write business today — call now'
                : 'Needs the course first — do not sell, enroll'}
            </div>
          </div>
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">New Team Application!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Hi ${manager.name}, someone applied using your referral link!</p>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            ${phonePromptSection}
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Applicant Details</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitized.firstName} ${sanitized.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${data.email}" style="color: #059669;">${sanitized.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                  <td style="padding: 8px 0;"><a href="tel:${data.phone}" style="color: #059669;">${sanitized.phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                  <td style="padding: 8px 0;">${sanitized.city}, ${sanitized.state}</td>
                </tr>
                ${sanitized.instagramHandle ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Instagram:</td>
                  <td style="padding: 8px 0;"><a href="https://instagram.com/${sanitized.instagramHandle}" style="color: #059669;">@${sanitized.instagramHandle}</a></td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">License Status:</td>
                  <td style="padding: 8px 0;">
                    <span style="background: ${sanitized.licenseStatus === 'licensed' ? '#d1fae5' : sanitized.licenseStatus === 'pending' ? '#fef3c7' : '#fee2e2'}; 
                                 color: ${sanitized.licenseStatus === 'licensed' ? '#047857' : sanitized.licenseStatus === 'pending' ? '#92400e' : '#991b1b'};
                                 padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                      ${licenseStatusDisplay}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                This applicant selected you as their referring manager. Follow up with them soon!
              </p>
            </div>

            <!-- Action Buttons -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
              <tr>
                <td align="center" style="padding: 6px;">
                  <a href="tel:${data.phone}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; max-width: 100%; box-sizing: border-box;">
                    📞 Call Now: ${sanitized.phone}
                  </a>
                </td>
              </tr>
              ${sanitized.instagramHandle ? `
              <tr>
                <td align="center" style="padding: 6px;">
                  <a href="https://instagram.com/${sanitized.instagramHandle}" style="display: inline-block; background: linear-gradient(135deg, #E1306C, #C13584); color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; max-width: 100%; box-sizing: border-box;">
                    📸 View Instagram: @${sanitized.instagramHandle}
                  </a>
                </td>
              </tr>
              ` : ''}
              <tr>
                <td align="center" style="padding: 6px;">
                  <a href="https://apex-financial.org/dashboard/applicants?lead=${applicationId}" style="display: inline-block; background: #111827; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; max-width: 100%; box-sizing: border-box;">
                    👤 View Lead in Dashboard
                  </a>
                </td>
              </tr>
            </table>

            <p style="color: #6b7280; font-size: 14px; margin-top: 15px; text-align: center;">
              Submitted on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
      `,
    });
    console.log("Manager notification sent to:", manager.email);
  } catch (error) {
    console.error("Error sending manager notification:", error);
  }
}

// Send email notifications
async function sendEmailNotifications(data: SubmitApplicationRequest, applicationId: string) {
  if (!resend) {
    console.warn("RESEND_API_KEY not configured, skipping email notifications");
    return;
  }

  const sanitized = {
    firstName: sanitizeHtml(data.firstName),
    lastName: sanitizeHtml(data.lastName),
    email: sanitizeHtml(data.email),
    phone: sanitizeHtml(data.phone),
    city: sanitizeHtml(data.city),
    state: sanitizeHtml(data.state),
    licenseStatus: data.licenseStatus,
    hasInsuranceExperience: data.hasInsuranceExperience,
    yearsExperience: data.yearsExperience,
    previousCompany: data.previousCompany ? sanitizeHtml(data.previousCompany) : undefined,
    availability: sanitizeHtml(data.availability),
    referralSource: data.referralSource ? sanitizeHtml(data.referralSource) : undefined,
    customReferrer: data.customReferrer ? sanitizeHtml(data.customReferrer) : undefined,
    instagramHandle: data.instagramHandle ? sanitizeHtml(data.instagramHandle) : undefined,
  };

  const licenseStatusDisplay = {
    licensed: "Licensed",
    unlicensed: "Not Yet Licensed",
    pending: "License Pending",
  }[sanitized.licenseStatus] || sanitized.licenseStatus;

  // Get manager info if there's a referral agent
  let managerInfo: ManagerInfo | null = null;
  if (data.selectedReferralAgentId) {
    managerInfo = await getManagerInfo(data.selectedReferralAgentId);
  }

  try {
    const isLicensedApplicant = sanitized.licenseStatus === 'licensed';
    
    // Build different admin email based on license status
    // 2026-07-29 Sam: "the first thing I should be able to see is: is this prospect
    // licensed or unlicensed... so I know whether to call them accordingly."
    //
    // The status is now the FIRST TOKEN of the subject, before the emoji and before the
    // name. Mail clients truncate subjects hard — iOS Mail shows ~35 chars in the list —
    // and the old subject led with "🔥 HOT LEAD - CALL NOW: <name>", so the word LICENSED
    // fell off the end on a phone. The one fact that decides whether Sam picks up the phone
    // has to survive truncation.
    const adminSubject = isLicensedApplicant
      ? `LICENSED ✅ — ${sanitized.firstName} ${sanitized.lastName} · ${sanitized.state} · CALL NOW`
      : `UNLICENSED — ${sanitized.firstName} ${sanitized.lastName} · ${sanitized.state} · course first`;
    
    const urgentBanner = isLicensedApplicant ? `
      <div style="background: linear-gradient(135deg, #dc2626, #991b1b); padding: 15px; text-align: center; margin-bottom: 0;">
        <h2 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">
          ⚠️ URGENT: Licensed Agent Ready to Start! ⚠️
        </h2>
        <p style="color: #fecaca; margin: 8px 0 0 0; font-size: 14px;">
          Call within 5 minutes for best results
        </p>
      </div>
    ` : '';
    
    const headerGradient = isLicensedApplicant 
      ? 'linear-gradient(135deg, #dc2626, #991b1b)'
      : 'linear-gradient(135deg, #059669, #047857)';
    
    const headerTitle = isLicensedApplicant
      ? '🔥 HOT LEAD - LICENSED AGENT'
      : 'New Agent Application';
    
    const callToActionStyle = isLicensedApplicant
      ? 'display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; text-decoration: none; padding: 18px 36px; border-radius: 8px; font-weight: 700; font-size: 18px; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.5);'
      : 'display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 15px;';
    
    const callToActionText = isLicensedApplicant
      ? '📞 CALL NOW: ' + sanitized.phone
      : '📞 View Lead & Call Now →';
    
    // Send notification email to APEX team
    const adminEmailResponse = await resend.emails.send({
      from: "APEX Applications <notifications@apex-financial.org>",
      to: ["sam@apex-financial.org"],
      subject: adminSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <!-- Status-first strip. Sam's #1 question on every one of these emails is
               "licensed or not" — it decides whether he calls immediately or routes them
               into the course. It is now the first pixel in the body, full-width, high
               contrast, readable in a preview pane without scrolling or opening. -->
          <div style="background: ${isLicensedApplicant ? '#047857' : '#b45309'}; padding: 22px 20px; text-align: center;">
            <div style="color: #ffffff; font-size: 30px; font-weight: 800; letter-spacing: 2px; line-height: 1.1;">
              ${isLicensedApplicant ? 'LICENSED' : 'UNLICENSED'}
            </div>
            <div style="color: ${isLicensedApplicant ? '#a7f3d0' : '#fde68a'}; font-size: 15px; margin-top: 6px; font-weight: 600;">
              ${isLicensedApplicant
                ? 'Can write business today — call now'
                : 'Needs the course first — do not sell, enroll'}
            </div>
          </div>
          ${urgentBanner}
          <div style="background: ${headerGradient}; padding: 30px; border-radius: ${isLicensedApplicant ? '0' : '10px 10px 0 0'};">
            <h1 style="color: white; margin: 0; font-size: 24px;">${headerTitle}</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            ${isLicensedApplicant ? `
            <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #991b1b; font-weight: bold; font-size: 16px;">
                📱 CLICK TO CALL IMMEDIATELY
              </p>
              <a href="tel:${data.phone}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 20px;">
                ${sanitized.phone}
              </a>
            </div>
            ` : ''}
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: ${isLicensedApplicant ? '#dc2626' : '#059669'}; margin-top: 0; font-size: 18px;">Applicant Details</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitized.firstName} ${sanitized.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${data.email}" style="color: ${isLicensedApplicant ? '#dc2626' : '#059669'};">${sanitized.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                  <td style="padding: 8px 0;"><a href="tel:${data.phone}" style="color: ${isLicensedApplicant ? '#dc2626' : '#059669'}; font-weight: bold; font-size: 16px;">${sanitized.phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                  <td style="padding: 8px 0;">${sanitized.city}, ${sanitized.state}</td>
                </tr>
                ${sanitized.instagramHandle ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Instagram:</td>
                  <td style="padding: 8px 0;"><a href="https://instagram.com/${sanitized.instagramHandle}" style="color: #059669;">@${sanitized.instagramHandle}</a></td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: ${isLicensedApplicant ? '#dc2626' : '#059669'}; margin-top: 0; font-size: 18px;">Licensing &amp; Experience</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">License Status:</td>
                  <td style="padding: 8px 0;">
                    <span style="background: ${sanitized.licenseStatus === 'licensed' ? '#d1fae5' : sanitized.licenseStatus === 'pending' ? '#fef3c7' : '#fee2e2'}; 
                                 color: ${sanitized.licenseStatus === 'licensed' ? '#047857' : sanitized.licenseStatus === 'pending' ? '#92400e' : '#991b1b'};
                                 padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                      ${licenseStatusDisplay}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Insurance Experience:</td>
                  <td style="padding: 8px 0;">${sanitized.hasInsuranceExperience ? 'Yes' : 'No'}</td>
                </tr>
                ${sanitized.yearsExperience ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Years of Experience:</td>
                  <td style="padding: 8px 0;">${sanitized.yearsExperience}</td>
                </tr>
                ` : ''}
                ${sanitized.previousCompany ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Previous Company:</td>
                  <td style="padding: 8px 0;">${sanitized.previousCompany}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px;">
              <h2 style="color: ${isLicensedApplicant ? '#dc2626' : '#059669'}; margin-top: 0; font-size: 18px;">Goals &amp; Availability</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Availability:</td>
                  <td style="padding: 8px 0;">${sanitized.availability}</td>
                </tr>
                ${sanitized.referralSource ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">How They Found Us:</td>
                  <td style="padding: 8px 0;">${sanitized.referralSource}</td>
                </tr>
                ` : ''}
                ${managerInfo ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Referred By:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitizeHtml(managerInfo.name)}</td>
                </tr>
                ` : ''}
                ${!managerInfo && sanitized.customReferrer ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Referred By:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitized.customReferrer}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="margin-top: 25px; text-align: center;">
              <a href="https://apex-financial.org/dashboard/applicants?lead=${applicationId}" style="${callToActionStyle}">
                ${callToActionText}
              </a>
              ${isLicensedApplicant ? `
              <p style="color: #dc2626; font-size: 14px; font-weight: bold; margin-top: 10px;">
                ⏰ Speed to lead wins! Contact within 5 minutes.
              </p>
              ` : ''}
              <p style="color: #6b7280; font-size: 14px; margin-top: 15px;">
                Submitted on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </div>
      `,
    });
    console.log("Admin notification sent:", JSON.stringify(adminEmailResponse));
    // Log to email_delivery_log so admins can audit what fired vs. failed
    // without digging into Resend's dashboard.
    try {
      await supabaseAdmin.from("email_delivery_log").insert({
        template: "submit-application-admin",
        recipient_email: "sam@apex-financial.org",
        subject: adminSubject,
        provider: "resend",
        provider_message_id: (adminEmailResponse as { data?: { id?: string } })?.data?.id ?? null,
        status: (adminEmailResponse as { error?: unknown })?.error ? "error" : "sent",
        error: (adminEmailResponse as { error?: { message?: string } })?.error?.message ?? null,
        related_record_id: applicationId,
        related_record_type: "application",
        sent_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("[email-log] admin write failed:", logErr);
    }

    // Determine content based on license status
    const isLicensed = sanitized.licenseStatus === 'licensed';
    
    // Licensed applicants get call scheduling, unlicensed get licensing resources
    const licensedCalendlyUrl = 'https://calendly.com/apexfinancialempire/1on1-call-clone';
    const testimonialsVideoUrl = 'https://youtu.be/YmlLSIwfGdE';
    const unlicensedVideoUrl = 'https://youtu.be/i1e5p-GEfAU?si=KMthNhQzcQnj9A6u';
    const licensingDocUrl = 'https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing';
    const preLicensingCourseUrl = 'https://partners.xcelsolutions.com/afe';

    // Build recruiter contact section if there's a referring manager
    const recruiterContactSection = managerInfo ? `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #1e40af; margin-top: 0; margin-bottom: 15px; font-size: 16px;">👤 Your Recruiter</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #3b82f6; width: 80px;">Name:</td>
            <td style="padding: 6px 0; font-weight: bold; color: #1e3a8a;">${sanitizeHtml(managerInfo.name)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #3b82f6;">Email:</td>
            <td style="padding: 6px 0;"><a href="mailto:${managerInfo.email}" style="color: #2563eb; font-weight: 500;">${sanitizeHtml(managerInfo.email)}</a></td>
          </tr>
          ${managerInfo.phone ? `
          <tr>
            <td style="padding: 6px 0; color: #3b82f6;">Phone:</td>
            <td style="padding: 6px 0;"><a href="tel:${managerInfo.phone}" style="color: #2563eb; font-weight: 500;">${sanitizeHtml(managerInfo.phone)}</a></td>
          </tr>
          ` : ''}
          ${managerInfo.instagramHandle ? `
          <tr>
            <td style="padding: 6px 0; color: #3b82f6;">Instagram:</td>
            <td style="padding: 6px 0;"><a href="https://instagram.com/${managerInfo.instagramHandle}" style="color: #2563eb; font-weight: 500;">@${sanitizeHtml(managerInfo.instagramHandle)}</a></td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #1e40af; font-size: 13px; margin-top: 12px; margin-bottom: 0;">
          Feel free to reach out with any questions about the opportunity!
        </p>
      </div>
    ` : '';

    // Build email HTML based on license status
    const emailHtml = isLicensed 
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to APEX Financial!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${sanitized.firstName},</h2>
            
            <p style="color: #4b5563; line-height: 1.6;">
              You just made a move that most people only talk about.
            </p>
            <p style="color: #4b5563; line-height: 1.6;">
              You're licensed. You have the hardest part done. Now it's time to actually use it to build something real.
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                Here's exactly what happens next:<br/>
                1. A manager will call you within 24 hours to walk you through getting contracted<br/>
                2. You'll receive your APEX portal login via a separate email<br/>
                3. Once contracted, you'll have access to scripts, leads, and the full training system
              </p>
            </div>

            ${recruiterContactSection}

            <h3 style="color: #111827; margin-bottom: 15px;">Hear From Our Agents</h3>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              Watch what our top agents have to say about working with APEX:
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${testimonialsVideoUrl}" 
                 style="display: inline-block; background: #111827; color: white; 
                        padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;
                        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);">
                ▶ Watch Agent Testimonials
              </a>
            </div>

            <h3 style="color: #111827; margin-bottom: 15px;">Schedule Your Call</h3>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              Ready to get started? Book your 1-on-1 onboarding call with our team:
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${licensedCalendlyUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; 
                        padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                        box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);">
                📅 Schedule Your Call
              </a>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 20px;">
              <h3 style="color: #111827; margin-top: 0; margin-bottom: 15px;">What Happens Next?</h3>
              <ol style="color: #4b5563; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Watch the agent testimonials above</li>
                <li>Schedule your onboarding call</li>
                <li>Complete the contracting process</li>
                <li>Start training and earning immediately!</li>
              </ol>
            </div>

            <p style="color: #4b5563; line-height: 1.6; margin-top: 25px;">
              If you have any questions, don't hesitate to reach out. We're here to help you succeed!
            </p>

            <p style="color: #4b5563; margin-top: 30px;">
              We don't do hand-holding here. We do results. And agents on this team are averaging $23,000 per month in production.
            </p>
            <p style="color: #4b5563; line-height: 1.6;">
              You applied. Now show up.
            </p>
            <p style="color: #4b5563; margin-top: 25px;">
              — Sam<br/>
              <strong style="color: #059669;">Managing Partner, APEX Financial</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">APEX Financial | apex-financial.org</p>
          </div>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to APEX Financial!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${sanitized.firstName},</h2>
            
            <p style="color: #4b5563; line-height: 1.6;">
              You took the first step. Most people never do.
            </p>
            <p style="color: #4b5563; line-height: 1.6;">
              You don't have your license yet — that's okay. Agents on this team went from exactly where you are right now to earning $5,000, $10,000, even $23,000 a month. The license is just a test. We'll help you pass it.
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                Your roadmap: Purchase pre-licensing course → Study & schedule exam → Pass and get contracted → Start closing deals
              </p>
            </div>

            ${recruiterContactSection}

            <h3 style="color: #111827; margin-bottom: 15px;">Step 1: Watch How to Get Licensed</h3>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              This video explains exactly how to get your life insurance license:
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${unlicensedVideoUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; 
                        padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                        box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);">
                ▶ How to Get Your License
              </a>
            </div>

            <h3 style="color: #111827; margin-bottom: 15px;">Step 2: Review the Licensing Steps</h3>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              Here's a detailed breakdown of the licensing process:
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${licensingDocUrl}" 
                 style="display: inline-block; background: #111827; color: white; 
                        padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);">
                📄 View Licensing Steps
              </a>
            </div>

            <h3 style="color: #111827; margin-bottom: 15px;">Step 3: Start Your Pre-Licensing Course</h3>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              Access your pre-licensing course here:
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${preLicensingCourseUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; 
                        padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">
                🎓 Start Pre-Licensing Course
              </a>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 20px;">
              <h3 style="color: #111827; margin-top: 0; margin-bottom: 15px;">What Happens Next?</h3>
              <ol style="color: #4b5563; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Watch the licensing video above</li>
                <li>Review the licensing steps document</li>
                <li>Complete the pre-licensing course (we cover the costs!)</li>
                <li>Pass your licensing exam</li>
                <li>Start training and begin earning!</li>
              </ol>
            </div>

            <p style="color: #4b5563; line-height: 1.6; margin-top: 25px;">
              You'll hear from a manager within 48 hours.
            </p>

            <div style="background: #f3e8ff; border: 1px solid #d8b4fe; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center;">
              <h3 style="color: #4A154B; margin-top: 0; margin-bottom: 10px; font-size: 16px;">📱 Join the APEX Slack</h3>
              <p style="color: #6b216f; font-size: 13px; margin-bottom: 15px;">Use the primary team workspace for licensing support, training questions, and progress updates.</p>
              <a href="${SLACK_LINK}"
                 style="display: inline-block; background: #4A154B; color: white;
                        padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
                Join Team Slack
              </a>
            </div>

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <h3 style="color: #1e40af; margin-top: 0; margin-bottom: 10px; font-size: 16px;">📋 Daily Check-In</h3>
              <p style="color: #2563eb; font-size: 13px; margin-bottom: 15px;">Submit your daily licensing progress check-in here:</p>
              <a href="https://apex-financial.org/daily-checkin" 
                 style="display: inline-block; background: #2563eb; color: white; 
                        padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;
                        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">
                Submit Daily Check-In
              </a>
            </div>

            <p style="color: #4b5563; margin-top: 25px;">
              — Sam<br/>
              <strong style="color: #059669;">Managing Partner, APEX Financial</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Save this email - it contains your important next steps!</p>
            <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
          </div>
        </div>
      `;

    // Build CC list - always CC admin, and CC referring manager if present
    const ccList = ['sam@apex-financial.org'];
    if (managerInfo?.email && managerInfo.email !== 'sam@apex-financial.org') {
      ccList.push(managerInfo.email);
    }

    // Send confirmation email to applicant with conditional links
    const applicantEmailResponse = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [data.email],
      cc: ccList,
      subject: sanitized.licenseStatus === 'licensed'
        ? `Welcome to APEX Financial, ${sanitized.firstName} — Licensed Agent Fast Track`
        : sanitized.licenseStatus === 'pending'
        ? `Welcome to APEX, ${sanitized.firstName} — You're Almost Ready to Earn`
        : `Welcome to APEX, ${sanitized.firstName} — Let's Get You Licensed`,
      html: emailHtml,
    });
    console.log("Applicant confirmation sent:", JSON.stringify(applicantEmailResponse));
    // Log applicant welcome email outcome — this is the email Sam reported
    // missing. With this row in place we can SELECT FROM email_delivery_log
    // WHERE template = 'submit-application-applicant' to confirm whether
    // it actually went out per application.
    try {
      const respErr = (applicantEmailResponse as { error?: { message?: string } })?.error;
      await supabaseAdmin.from("email_delivery_log").insert({
        template: "submit-application-applicant",
        recipient_email: data.email,
        subject:
          sanitized.licenseStatus === "licensed"
            ? `Welcome to APEX Financial, ${sanitized.firstName} — Licensed Agent Fast Track`
            : sanitized.licenseStatus === "pending"
              ? `Welcome to APEX, ${sanitized.firstName} — You're Almost Ready to Earn`
              : `Welcome to APEX, ${sanitized.firstName} — Let's Get You Licensed`,
        provider: "resend",
        provider_message_id: (applicantEmailResponse as { data?: { id?: string } })?.data?.id ?? null,
        status: respErr ? "error" : "sent",
        error: respErr?.message ?? null,
        related_record_id: applicationId,
        related_record_type: "application",
        sent_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("[email-log] applicant write failed:", logErr);
    }

    // Send notification to referring manager if selected
    if (data.selectedReferralAgentId && managerInfo) {
      await sendManagerNotification(data, managerInfo, applicationId);
    }

  } catch (error) {
    console.error("Error sending email notifications:", error);
  }
}

// Send leaderboard notification to ALL managers (competitive motivation)
async function sendLeaderboardNotification(data: SubmitApplicationRequest, applicationId: string): Promise<void> {
  try {
    console.log("[Leaderboard] Sending leaderboard notification for application:", applicationId);
    
    const response = await fetch(
      `${supabaseUrl}/functions/v1/notify-all-managers-leaderboard`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          applicationId: applicationId,
          scoringManagerId: data.selectedReferralAgentId || null,
          applicantName: `${data.firstName} ${data.lastName}`,
          applicantCity: data.city,
          applicantState: data.state,
          licenseStatus: data.licenseStatus,
          referralSource: data.referralSource,
        }),
      }
    );

    const result = await response.json();
    console.log("[Leaderboard] Notification result:", result);
  } catch (error) {
    console.error("[Leaderboard] Error sending notification:", error);
  }
}

function dispatchFullSubmissionSideEffects(data: SubmitApplicationRequest, applicationId: string): void {
  // Send email notifications in background (pass the application ID)
  sendEmailNotifications(data, applicationId).catch((err) => {
    console.error("Background email notification failed:", err);
  });

  // PL-SEMINAR-FUNNEL: fire-and-forget the seminar confirmation email
  // (Zoom + .ics + Telegram bot deep-link). Wrapped in try/catch so a
  // failure here never fails the parent application submission.
  (async () => {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/seminar-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ application_id: applicationId }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        console.error("[seminar-confirmation] non-ok response:", resp.status, txt.slice(0, 500));
      } else {
        console.log("[seminar-confirmation] dispatched for application:", applicationId);
      }
    } catch (e) {
      console.error("[seminar-confirmation] dispatch threw:", e);
    }
  })();

  // Send leaderboard notification to ALL managers (competitive motivation)
  sendLeaderboardNotification(data, applicationId).catch((err) => {
    console.error("Background leaderboard notification failed:", err);
  });

  // Auto opt-in: Send welcome notification via all channels (push + SMS + email)
  (async () => {
    try {
      // SMS welcome via auto-detect (applicant likely doesn't have an account yet)
      if (data.phone) {
        await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone: data.phone,
            message: `Welcome to Apex Financial, ${data.firstName}! 🚀 Your application has been received. Check your email for next steps!`.substring(0, 160),
            applicationId,
          }),
        });
        console.log("Welcome SMS sent to:", data.phone);
      }
    } catch (err) {
      console.error("Welcome notification failed:", err);
    }
  })();
}

async function handleQuickQualify(data: QuickQualifyRequest, clientIP: string): Promise<Response> {
  const activeReferral = await retainActiveReferralAgents(
    data.selectedReferralAgentId,
    data.recruiterId,
  );
  data.selectedReferralAgentId = activeReferral.selectedReferralAgentId;
  data.recruiterId = activeReferral.recruiterId;

  const normalizedEmail = data.email.toLowerCase().trim();
  const normalizedPhone = data.phone.replace(/\D/g, "").slice(-10);

  const { data: isBanned } = await supabaseAdmin.rpc("check_banned_prospect", {
    p_email: normalizedEmail,
    p_phone: normalizedPhone,
    p_first_name: data.firstName,
    p_last_name: "",
  });

  if (isBanned) {
    console.log(`Banned quick-qualified prospect detected: ${normalizedEmail}`);
    return new Response(
      JSON.stringify({ error: "This applicant has been blocked." }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  const SAM_DEFAULT_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";
  const resolvedAssigned = data.selectedReferralAgentId || data.recruiterId || SAM_DEFAULT_AGENT_ID;
  const resolvedRecruiter = data.recruiterId || SAM_DEFAULT_AGENT_ID;
  const resolvedReferralManager = data.selectedReferralAgentId || data.recruiterId || SAM_DEFAULT_AGENT_ID;
  // P3 (2026-06-08): referral_recruiter_id is the canonical CREDIT column.
  // Always populate it from the explicit recruiterId, or the selected
  // referral agent. Falls back to NULL (not Sam) so the recruiting
  // leaderboard doesn't credit Sam by default — only when someone is
  // actually attributed.
  const resolvedReferralRecruiter = data.recruiterId || data.selectedReferralAgentId || null;
  const consent = data.consent;

  // 2026-06-29 SECURITY FIX (Sam directive: 'agents on the apex site are
  // taking my recruits like they resubmit the form'). The quick-qualify
  // re-submit path was UNCONDITIONALLY overwriting recruiter_id +
  // assigned_agent_id + referral_manager_id + referral_recruiter_id with
  // whatever recruiter the new submission carried. Recruit-theft vector:
  // agent grabs target email, submits form with their own recruiter ID,
  // original recruiter loses credit silently.
  // Fix: pull the EXISTING attribution columns first, then only fill in
  // attribution fields that are NULL. First-write-wins — original
  // recruiter is protected forever.
  const { data: existingApp } = await supabaseAdmin
    .from("applications")
    .select("id, status, recruiter_id, assigned_agent_id, referral_manager_id, referral_recruiter_id")
    .or(`email.ilike.${normalizedEmail},phone.eq.${normalizedPhone}`)
    .is("terminated_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingApp) {
    if (existingApp.status !== "quick_qualified") {
      return new Response(
        JSON.stringify({ applicationId: existingApp.id, isDuplicate: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      first_name: data.firstName,
      phone: data.phone,
      email: data.email,
      license_status: data.licenseStatus,
      consent_source_url: consent?.sourceUrl ?? null,
      consent_ip_address: clientIP,
      consent_user_agent: consent?.userAgent ?? null,
      consent_form_version: consent?.formVersion ?? null,
    };

    // First-write-wins on attribution: only set if NOT already set.
    // Original recruiter is locked in on the FIRST submit, immune to
    // subsequent re-submits regardless of who submits them.
    if (!existingApp.assigned_agent_id) {
      update.assigned_agent_id = resolvedAssigned;
    }
    if (!existingApp.recruiter_id) {
      update.recruiter_id = resolvedRecruiter;
    }
    if (!existingApp.referral_manager_id) {
      update.referral_manager_id = resolvedReferralManager;
    }
    if (!existingApp.referral_recruiter_id && resolvedReferralRecruiter) {
      update.referral_recruiter_id = resolvedReferralRecruiter;
    }
    update.qualified_at = new Date().toISOString();
    update.referral_source = data.utmMedium === "paid_social" ? "paid_social" : (data.source ?? "paid_social");
    update.referral_source_detail = data.utmCampaign ?? data.utmSource ?? data.source ?? null;
    update.source = data.source ?? "ad";
    update.utm_source = data.utmSource ?? null;
    update.utm_medium = data.utmMedium ?? null;
    update.utm_campaign = data.utmCampaign ?? null;
    update.utm_content = data.utmContent ?? null;
    update.utm_term = data.utmTerm ?? null;
    update.landing_url = data.landingUrl ?? consent?.sourceUrl ?? null;
    Object.assign(update, stripNullFirstTouch(firstTouchColumns(data)));

    await supabaseAdmin.from("applications").update(update).eq("id", existingApp.id);

    return new Response(
      JSON.stringify({ applicationId: existingApp.id, status: "quick_qualified" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  const insertPayload = {
    first_name: data.firstName,
    last_name: "Pending",
    email: data.email,
    phone: data.phone,
    has_insurance_experience: false,
    license_status: data.licenseStatus,
    availability: null,
    referral_source: data.utmMedium === "paid_social" ? "paid_social" : (data.source ?? "paid_social"),
    referral_source_detail: data.utmCampaign ?? data.utmSource ?? data.source ?? null,
    source: data.source ?? "ad",
    utm_source: data.utmSource ?? null,
    utm_medium: data.utmMedium ?? null,
    utm_campaign: data.utmCampaign ?? null,
    utm_content: data.utmContent ?? null,
    utm_term: data.utmTerm ?? null,
    landing_url: data.landingUrl ?? consent?.sourceUrl ?? null,
    ...firstTouchColumns(data),
    notes: "Quick-qualified paid-social lead; full application pending.",
    assigned_agent_id: resolvedAssigned,
    recruiter_id: resolvedRecruiter,
    referral_manager_id: resolvedReferralManager,
    referral_recruiter_id: resolvedReferralRecruiter,
    status: "quick_qualified",
    qualified_at: new Date().toISOString(),
    sms_consent_given: consent?.smsConsentGiven ?? false,
    sms_consent_text: consent?.smsConsentText ?? null,
    email_consent_given: consent?.emailConsentGiven ?? false,
    email_consent_text: consent?.emailConsentText ?? null,
    consent_timestamp_utc: consent?.consentTimestampUtc ?? null,
    consent_source_url: consent?.sourceUrl ?? null,
    consent_ip_address: clientIP,
    consent_user_agent: consent?.userAgent ?? null,
    consent_form_version: consent?.formVersion ?? null,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("applications")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    console.error("submit-application quick qualify insert error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to save quick application" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  return new Response(
    JSON.stringify({ applicationId: inserted.id, status: "quick_qualified" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
}

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

    if (raw?.quickQualify === true) {
      const quickParsed = QuickQualifySchema.safeParse(raw);
      if (!quickParsed.success) {
        console.error("submit-application quick qualify validation error:", quickParsed.error.issues);
        return new Response(
          JSON.stringify({ error: "Invalid input data", details: quickParsed.error.issues }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      return await handleQuickQualify(quickParsed.data, clientIP);
    }

    const parsed = FullSubmitApplicationSchema.safeParse(raw);

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
    const activeReferral = await retainActiveReferralAgents(
      data.selectedReferralAgentId,
      data.recruiterId,
    );
    data.selectedReferralAgentId = activeReferral.selectedReferralAgentId;
    data.recruiterId = activeReferral.recruiterId;
    const customReferrer = (data.customReferrer ?? "").trim();
    const manualReferralNote = customReferrer ? `Referred by: ${customReferrer}` : null;

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

    // Check if prospect is banned
    const normalizedEmail = data.email.toLowerCase().trim();
    const normalizedPhone = data.phone.replace(/\D/g, '').slice(-10);

    const { data: isBanned } = await supabaseAdmin.rpc("check_banned_prospect", {
      p_email: normalizedEmail,
      p_phone: normalizedPhone,
      p_first_name: data.firstName,
      p_last_name: data.lastName,
    });

    if (isBanned) {
      console.log(`Banned prospect detected: ${normalizedEmail}`);
      return new Response(
        JSON.stringify({ error: "This applicant has been blocked." }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Extract consent data
    const consent = data.consent;

    // PL-082: When the applicant has no referrer (no ?ref= URL slug and
    // selected nothing / "none" / "other" in the picker), default both
    // assigned + recruiter to Sam James's canonical agent row. Sam's punch
    // list: "assure any applicant that clicks unknown auto goes to me."
    // Canonical row chosen by display_name='Samuel James' + admin role,
    // tiebreak on most-recruited.
    const SAM_DEFAULT_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";
    const fallbackAgentId = SAM_DEFAULT_AGENT_ID;
    const resolvedAssigned = data.selectedReferralAgentId || data.recruiterId || fallbackAgentId;
    const resolvedRecruiter = data.recruiterId || fallbackAgentId;
    const resolvedReferralManager = data.selectedReferralAgentId || data.recruiterId || fallbackAgentId;
    // P3 (2026-06-08): canonical CREDIT column — NULL when no explicit referrer
    // so the recruiting leaderboard doesn't auto-credit Sam.
    const resolvedReferralRecruiter = data.recruiterId || data.selectedReferralAgentId || null;

    const buildApplicationPayload = (includeRawId: boolean) => ({
      ...(includeRawId && raw?.id && typeof raw.id === "string" && uuidRegex.test(raw.id)
        ? { id: raw.id }
        : {}),

      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone,
      city: data.city,
      state: data.state,
      instagram_handle: instagramClean,
      carrier: data.carrier ?? null,

      has_insurance_experience: data.hasInsuranceExperience,
      years_experience: data.yearsExperience ?? null,
      previous_company: data.previousCompany ?? null,
      previous_production: data.numberOfDownlines ?? null, // Stores number of downlines

      license_status: data.licenseStatus,
      nipr_number: data.niprNumber ?? null,
      licensed_states: data.licensedStates && data.licensedStates.length > 0
        ? data.licensedStates
        : null,

      desired_income: null,
      availability: data.availability,
      referral_source: data.referralSource ?? (data.utmMedium === "paid_social" ? "paid_social" : data.source ?? null),
      referral_source_detail: data.utmCampaign ?? data.utmContent ?? data.utmSource ?? null,
      source: data.source ?? null,
      utm_source: data.utmSource ?? null,
      utm_medium: data.utmMedium ?? null,
      utm_campaign: data.utmCampaign ?? null,
      utm_content: data.utmContent ?? null,
      utm_term: data.utmTerm ?? null,
      landing_url: data.landingUrl ?? consent?.sourceUrl ?? null,
      ...firstTouchColumns(data),
      notes: manualReferralNote,

      // Assign to the selected referral agent. PL-082: when no referrer is
      // picked, route directly to Sam James instead of leaving null (the
      // legacy auto_assign trigger picked the wrong admin in practice).
      assigned_agent_id: resolvedAssigned,
      recruiter_id: resolvedRecruiter,
      referral_manager_id: resolvedReferralManager,
      referral_recruiter_id: resolvedReferralRecruiter,

      status: "new",
      reviewed_at: null,
      reviewed_by: null,
      contacted_at: null,
      qualified_at: null,
      closed_at: null,

      // Consent audit trail for Twilio compliance
      sms_consent_given: consent?.smsConsentGiven ?? false,
      sms_consent_text: consent?.smsConsentText ?? null,
      email_consent_given: consent?.emailConsentGiven ?? false,
      email_consent_text: consent?.emailConsentText ?? null,
      consent_timestamp_utc: consent?.consentTimestampUtc ?? null,
      consent_source_url: consent?.sourceUrl ?? null,
      consent_ip_address: clientIP,
      consent_user_agent: consent?.userAgent ?? null,
      consent_form_version: consent?.formVersion ?? null,
    });

    // ── HOLE 1: Duplicate Application Detection ──
    let existingApp: any = null;
    if (data.quickQualifiedApplicationId) {
      const { data: quickApp } = await supabaseAdmin
        .from("applications")
        .select("id, created_at, license_progress, status")
        .eq("id", data.quickQualifiedApplicationId)
        .is("terminated_at", null)
        .maybeSingle();
      existingApp = quickApp ?? null;
    }

    if (!existingApp) {
      const { data: matchedExistingApp } = await supabaseAdmin
        .from("applications")
        .select("id, created_at, license_progress, status")
        .or(`email.ilike.${normalizedEmail},phone.eq.${normalizedPhone}`)
        .is("terminated_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existingApp = matchedExistingApp ?? null;
    }

    if (existingApp) {
      // If the duplicate application has no referral attribution AND the new
      // submission DOES carry a referrer, propagate that referrer onto the
      // existing application so the right agent (e.g. KJ) gets credit and
      // visibility instead of the prospect being silently re-orphaned.
      const incomingReferrer = data.selectedReferralAgentId || data.recruiterId || null;
      const { data: existingFull } = await supabaseAdmin
        .from("applications")
        .select("id, assigned_agent_id, referral_manager_id, recruiter_id, notes")
        .eq("id", existingApp.id)
        .maybeSingle();

      if (existingApp.status === "quick_qualified") {
        // stripNullFirstTouch: the quick-qualify insert may already have stored
        // a gclid/first_touch_at. If this full submit carries none (storage
        // cleared, different device), leave the earlier values alone.
        const updatePayload = stripNullFirstTouch(buildApplicationPayload(false));
        const { error: upgradeError } = await supabaseAdmin
          .from("applications")
          .update({
            ...updatePayload,
            notes: manualReferralNote
              ? `Quick-qualified paid-social lead converted to full application.\n${manualReferralNote}`
              : "Quick-qualified paid-social lead converted to full application.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingApp.id);

        if (upgradeError) {
          console.error("submit-application quick qualify upgrade error:", upgradeError);
          return new Response(
            JSON.stringify({ error: "Failed to submit application" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        dispatchFullSubmissionSideEffects(data, existingApp.id);

        return new Response(
          JSON.stringify({ applicationId: existingApp.id, upgradedFromQuickQualified: true }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const existingHasReferrer = !!(
        existingFull?.referral_manager_id || existingFull?.recruiter_id
      );

      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        is_duplicate: true,
      };

      let referrerAdopted = false;
      if (incomingReferrer && !existingHasReferrer) {
        update.referral_manager_id = incomingReferrer;
        if (!existingFull?.recruiter_id && data.recruiterId) {
          update.recruiter_id = data.recruiterId;
        }
        // Only switch assigned_agent_id if it's currently null OR points to an
        // admin (default routing). Don't yank a lead away from a real owner.
        if (!existingFull?.assigned_agent_id) {
          update.assigned_agent_id = incomingReferrer;
        } else {
          const { data: assignedAgent } = await supabaseAdmin
            .from("agents")
            .select("user_id")
            .eq("id", existingFull.assigned_agent_id)
            .maybeSingle();
          if (assignedAgent?.user_id) {
            const { data: isAdminRow } = await supabaseAdmin
              .from("user_roles")
              .select("role")
              .eq("user_id", assignedAgent.user_id)
              .eq("role", "admin")
              .maybeSingle();
            if (isAdminRow) update.assigned_agent_id = incomingReferrer;
          }
        }
        referrerAdopted = true;
      }

      if (manualReferralNote) {
        const existingNotes = (existingFull?.notes ?? "").toString();
        update.notes = existingNotes.includes(manualReferralNote)
          ? existingNotes
          : existingNotes
            ? `${existingNotes}\n${manualReferralNote}`
            : manualReferralNote;
      }

      await supabaseAdmin.from("applications").update(update).eq("id", existingApp.id);

      if (referrerAdopted) {
        await supabaseAdmin.from("lead_activity").insert({
          lead_id: existingApp.id,
          activity_type: "referral_adopted_on_duplicate",
          title: `Duplicate submission carried referrer ${incomingReferrer} — adopted onto existing app.`,
          actor_name: "submit-application",
          actor_role: "system",
        });
      }

      if (resend) {
        try {
          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: ["sam@apex-financial.org"],
            subject: `🔄 Duplicate Application: ${data.firstName} ${data.lastName}${referrerAdopted ? " (referrer adopted)" : ""}`,
            html: `<p><strong>${data.firstName} ${data.lastName}</strong> applied again. They're already in your pipeline since ${new Date(existingApp.created_at).toLocaleDateString()}.</p>
                   <p>Current stage: ${existingApp.license_progress || existingApp.status}</p>
                   <p>Email: ${data.email} | Phone: ${data.phone}</p>
                   ${referrerAdopted ? `<p><strong>Referral credited:</strong> ${incomingReferrer}</p>` : ""}`,
          });
        } catch (e) { console.error("Duplicate notification failed:", e); }
      }

      return new Response(
        JSON.stringify({ applicationId: existingApp.id, isDuplicate: true, referrerAdopted }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const insertPayload = buildApplicationPayload(true);

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

    // Auto-merge: if person reapplied, terminate all old open apps and assign
    // new one to whichever Sam admin-agent is currently canonical. Resolve
    // dynamically by email so the hardcoded UUID can never go stale.
    let canonicalSamAgentId: string | null = null;
    try {
      const { data: samProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .in("email", ["sam.com593@gmail.com", "info@kingofsales.net"]);
      const profileIds = (samProfiles ?? []).map((p) => p.id).filter(Boolean);
      if (profileIds.length > 0) {
        // Treat NULL is_deactivated as "not deactivated" to be safe with
        // older agent rows.
        const { data: samAgent } = await supabaseAdmin
          .from("agents")
          .select("id, created_at, is_deactivated")
          .in("profile_id", profileIds)
          .order("created_at", { ascending: false });
        canonicalSamAgentId = (samAgent ?? [])
          .find((r: any) => r.is_deactivated !== true)?.id ?? null;
      }
    } catch (e) {
      console.error("canonical Sam lookup failed", e);
    }

    try {
      const { data: previousApps } = await supabaseAdmin
        .from("applications")
        .select("id, assigned_agent_id, created_at, contracted_at")
        .eq("email", data.email)
        .neq("id", inserted.id)
        .order("created_at", { ascending: false });

      if (previousApps && previousApps.length > 0 && canonicalSamAgentId) {
        const mostRecent = previousApps[0];
        const incomingReferrer = data.selectedReferralAgentId || data.recruiterId || null;

        // Only redirect to canonical Sam when the new submission has NO valid
        // referrer. Previously this always overrode KJ/manager credit on
        // reapplications, which silently strips ownership.
        if (mostRecent.contracted_at && !incomingReferrer) {
          await supabaseAdmin
            .from("applications")
            .update({ assigned_agent_id: canonicalSamAgentId })
            .eq("id", inserted.id);
        }

        // If previously contracted, notify Sam (rehire path) regardless of
        // whether ownership was redirected.
        if (mostRecent.contracted_at && resend) {
          try {
            await resend.emails.send({
              from: "APEX Financial <notifications@apex-financial.org>",
              to: ["sam@apex-financial.org"],
              subject: `🔄 Rehire Application — ${data.firstName} ${data.lastName}`,
              html: `<p><strong>${data.firstName} ${data.lastName}</strong> previously contracted with APEX and has reapplied.${incomingReferrer ? ` Referrer preserved: ${incomingReferrer}.` : " Assigned directly to you."} Original application: ${mostRecent.id}</p>`,
            });
          } catch (e) { console.error("Rehire notification failed:", e); }
        }

        // Terminate all previous open (non-contracted) applications.
        const idsToClose = previousApps
          .filter(a => a.id !== inserted.id)
          .map(a => a.id);

        if (idsToClose.length > 0) {
          await supabaseAdmin
            .from("applications")
            .update({ terminated_at: new Date().toISOString(), termination_reason: "reapplied_merged" })
            .in("id", idsToClose)
            .is("terminated_at", null);
        }

        // Log the merge
        for (const old of previousApps) {
          await supabaseAdmin.from("lead_activity").insert({
            lead_id: inserted.id,
            activity_type: "reapplication",
            title: `Reapplication — previous app merged (${old.id.slice(0, 8)}…). Assigned to Sam.`,
            actor_name: "System",
            actor_role: "system",
          });
        }
        console.log(`Reapplicant ${data.email}: merged ${previousApps.length} old apps, assigned to Sam`);
      }
    } catch (mergeErr) {
      console.error("Auto-merge error (non-fatal):", mergeErr);
    }

    dispatchFullSubmissionSideEffects(data, inserted.id);

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
