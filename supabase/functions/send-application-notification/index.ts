import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Input validation schema
const ApplicationEmailSchema = z.object({
  firstName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
  lastName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
  email: z.string().email().max(254),
  phone: z.string().min(10).max(20).regex(/^[\d\s\-\+\(\)]+$/, "Invalid phone format"),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(50),
  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  hasInsuranceExperience: z.boolean(),
  yearsExperience: z.number().int().min(0).max(50).optional(),
  previousCompany: z.string().max(200).optional(),
  desiredIncome: z.number().min(0).max(10000000).optional(),
  availability: z.string().max(500),
  referralSource: z.string().max(500).optional(),
});

type ApplicationEmailRequest = z.infer<typeof ApplicationEmailSchema>;

// Simple rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5; // Max 5 requests per minute per IP
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

// Sanitize string for HTML output to prevent XSS
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting check
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || 
                     "unknown";
    
    if (!checkRateLimit(clientIP)) {
      console.error("Rate limit exceeded for IP:", clientIP);
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Parse and validate input
    const rawData = await req.json();
    const parseResult = ApplicationEmailSchema.safeParse(rawData);
    
    if (!parseResult.success) {
      console.error("Validation error:", parseResult.error.issues);
      return new Response(
        JSON.stringify({ error: "Invalid input data", details: parseResult.error.issues }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const data: ApplicationEmailRequest = parseResult.data;

    // Sanitize all string inputs for HTML
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
      desiredIncome: data.desiredIncome,
      availability: sanitizeHtml(data.availability),
      referralSource: data.referralSource ? sanitizeHtml(data.referralSource) : undefined,
    };

    const licenseStatusDisplay = {
      licensed: "Licensed",
      unlicensed: "Not Yet Licensed",
      pending: "License Pending",
    }[sanitized.licenseStatus] || sanitized.licenseStatus;

    // Send notification email to APEX team
    console.log("Sending admin notification email...");
    const adminEmailResponse = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: ["sam@apex-financial.org"],
      subject: sanitized.licenseStatus === 'licensed'
        ? `🔥 New LICENSED Application — ${sanitized.firstName} ${sanitized.lastName} | ${sanitized.city}, ${sanitized.state}`
        : `New ${licenseStatusDisplay.toUpperCase()} Application — ${sanitized.firstName} ${sanitized.lastName} | ${sanitized.city}, ${sanitized.state}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">New Agent Application</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
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
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Licensing &amp; Experience</h2>
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
              <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Goals &amp; Availability</h2>
              <table style="width: 100%; border-collapse: collapse;">
                ${sanitized.desiredIncome ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Desired Income:</td>
                  <td style="padding: 8px 0;">$${sanitized.desiredIncome.toLocaleString()}</td>
                </tr>
                ` : ''}
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
              </table>
            </div>

            <div style="margin-top: 25px; text-align: center;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 15px;">
                Submitted on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </div>
      `,
    });

    console.log("Admin notification sent:", adminEmailResponse);

    // ── Applicant confirmation email — NFL-tone, one-click CTAs ──────────
    const SAM_PHONE_DISPLAY = "(469) 767-6068";
    const SAM_PHONE_TEL     = "4697676068";
    const SAM_PHONE_SMS     = `sms:+1${SAM_PHONE_TEL}?&body=${encodeURIComponent(`Hey Sam, it's ${sanitized.firstName}. Just submitted my APEX app — ready to talk.`)}`;
    const LOGIN_URL         = "https://apex-financial.org/join";
    const XCEL_URL          = "https://partners.xcelsolutions.com/afe";
    const DISCORD_URL       = "https://discord.gg/JpUWA73UZX";

    const licensedBody = `
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 16px">
        You're licensed — good. That's the minimum. Now we find out who you really are.
      </p>
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 16px">
        This team is not for people looking for a job. It's for operators who want to get measured every single week
        against the top producers in the country. Our current top 5 agents wrote an average of <strong style="color:#14b8a6">$32K ALP last week alone</strong>.
        That's the scoreboard. You don't make it — you keep making it.
      </p>
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 24px">
        <strong style="color:#fff">Call me directly right now.</strong> The sooner we talk, the sooner we get you contracted and in the field.
      </p>`;

    const unlicensedBody = `
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 16px">
        You picked the hardest move in the industry and the most rewarding. The license is the gate.
        Get through it fast and you join a team where this week's top 5 wrote <strong style="color:#14b8a6">$32K ALP average</strong>.
      </p>
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 16px">
        We don't baby-sit. We give you the resources, you get the license. Start today — you'll be contracting inside of 2–3 weeks.
      </p>
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 24px">
        <strong style="color:#fff">Text or call me with any question.</strong> No fluff, no funnel — direct line.
      </p>`;

    const pendingBody = `
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 16px">
        License is processing — good. Don't sit still waiting. While it clears we set up your contracting, book your first call, and get you aligned with the team.
      </p>
      <p style="color:#d1d5db;line-height:1.7;margin:0 0 24px">
        <strong style="color:#fff">Call or text me now</strong> so we can move the minute your license hits.
      </p>`;

    const primaryCTA = sanitized.licenseStatus === 'licensed'
      ? `<a href="tel:+1${SAM_PHONE_TEL}" style="display:inline-block;background:#14b8a6;color:#fff;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">📞 Call Sam — ${SAM_PHONE_DISPLAY}</a>`
      : `<a href="${XCEL_URL}" style="display:inline-block;background:#14b8a6;color:#fff;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">📚 Start Your License Course</a>`;

    const stepsLicensed = `
      <ol style="color:#d1d5db;line-height:2;padding-left:20px;margin:0">
        <li><strong style="color:#fff">Call me</strong> — <a href="tel:+1${SAM_PHONE_TEL}" style="color:#14b8a6">${SAM_PHONE_DISPLAY}</a></li>
        <li>We get you contracted (same day most weeks)</li>
        <li>Plug into training + team Discord</li>
        <li>Start writing deals this week</li>
      </ol>`;
    const stepsUnlicensed = `
      <ol style="color:#d1d5db;line-height:2;padding-left:20px;margin:0">
        <li><strong style="color:#fff">Start the XCEL course</strong> — <a href="${XCEL_URL}" style="color:#14b8a6">click here</a></li>
        <li>Pass the state exam (most agents take 2–3 weeks)</li>
        <li>Contract with APEX immediately after</li>
        <li>Start writing deals</li>
      </ol>`;

    const bodyCopy = sanitized.licenseStatus === 'licensed' ? licensedBody
                    : sanitized.licenseStatus === 'pending' ? pendingBody
                    : unlicensedBody;
    const stepList = sanitized.licenseStatus === 'licensed' ? stepsLicensed : stepsUnlicensed;

    const applicantEmailResponse = await resend.emails.send({
      from: "Sam @ APEX <notifications@apex-financial.org>",
      to: [data.email],
      cc: ["sam@apex-financial.org"],
      reply_to: "sam@apex-financial.org",
      subject: sanitized.licenseStatus === 'licensed'
        ? `${sanitized.firstName}, call me — let's get you writing`
        : sanitized.licenseStatus === 'pending'
        ? `${sanitized.firstName}, while your license processes…`
        : `${sanitized.firstName}, the license is the gate — start today`,
      html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#14b8a6 0%,#0ea5e9 100%);padding:28px;text-align:center;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:-0.5px">APEX Financial</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;letter-spacing:1px;text-transform:uppercase">This is the NFL of insurance sales</p>
  </div>

  <div style="background:#0f0f1a;padding:32px;border-radius:0 0 12px 12px">
    <p style="color:#fff;font-size:20px;font-weight:700;margin:0 0 20px">${sanitized.firstName},</p>
    ${bodyCopy}

    <div style="text-align:center;margin:28px 0">${primaryCTA}</div>

    <h3 style="color:#14b8a6;font-size:14px;text-transform:uppercase;letter-spacing:1.5px;margin:32px 0 14px">Your path</h3>
    ${stepList}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:12px;flex-wrap:wrap">
      <a href="tel:+1${SAM_PHONE_TEL}" style="flex:1;min-width:140px;background:#1a1a2e;color:#14b8a6;padding:12px 16px;border-radius:8px;text-decoration:none;text-align:center;font-weight:600;font-size:13px">📞 ${SAM_PHONE_DISPLAY}</a>
      <a href="${SAM_PHONE_SMS}" style="flex:1;min-width:140px;background:#1a1a2e;color:#14b8a6;padding:12px 16px;border-radius:8px;text-decoration:none;text-align:center;font-weight:600;font-size:13px">💬 Text Sam</a>
      <a href="${DISCORD_URL}" style="flex:1;min-width:140px;background:#1a1a2e;color:#5865F2;padding:12px 16px;border-radius:8px;text-decoration:none;text-align:center;font-weight:600;font-size:13px">💬 Join Discord</a>
      <a href="${LOGIN_URL}" style="flex:1;min-width:140px;background:#1a1a2e;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;text-align:center;font-weight:600;font-size:13px">🔑 Log In</a>
    </div>

    <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:24px 0 0;border-top:1px solid rgba(255,255,255,0.05);padding-top:16px">
      — <strong style="color:#fff">Sam</strong>, Managing Partner · APEX Financial<br>
      Direct: ${SAM_PHONE_DISPLAY} · sam@apex-financial.org
    </p>
  </div>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin:16px 0 0">apex-financial.org</p>
</div>
</body></html>
      `,
      text: `${sanitized.firstName},

${sanitized.licenseStatus === 'licensed'
  ? `You're licensed — that's the minimum. Now we find out who you really are.

This team isn't for people looking for a job. It's for operators who want to be measured every week against the top producers in the country. Our top 5 wrote an average of $32K ALP last week.

Call me directly: ${SAM_PHONE_DISPLAY}

Your path:
1. Call me (${SAM_PHONE_DISPLAY})
2. We contract you same day
3. Plug into training + team Discord
4. Start writing deals this week`
  : `You picked the hardest, most rewarding move in the industry. The license is the gate.

Start the XCEL course today: ${XCEL_URL}
Text or call me with any question: ${SAM_PHONE_DISPLAY}

Your path:
1. Start the XCEL course (${XCEL_URL})
2. Pass the state exam (2-3 weeks)
3. Contract with APEX immediately after
4. Start writing deals`
}

Log in: ${LOGIN_URL}
Discord: ${DISCORD_URL}

— Sam
APEX Financial · ${SAM_PHONE_DISPLAY}`,
    });

    // ── Shadow SMS (same message, 160 chars, queued for email-gateway fan-out) ──
    try {
      if (sanitized.phone) {
        const smsBody = sanitized.licenseStatus === 'licensed'
          ? `APEX: ${sanitized.firstName}, you're in. Call Sam now at ${SAM_PHONE_DISPLAY} — let's get you contracted today.`
          : `APEX: ${sanitized.firstName}, start your license: ${XCEL_URL} · Questions? Text/call Sam ${SAM_PHONE_DISPLAY}`;
        const supabaseAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.50.0")).createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { persistSession: false } });
        await supabaseAdmin.rpc("queue_sms", { p_phone: sanitized.phone, p_body: smsBody, p_carrier: null });
      }
    } catch (e) {
      console.error("shadow SMS queue failed", e);
    }

    console.log("Applicant confirmation sent:", applicantEmailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        adminEmail: adminEmailResponse,
        applicantEmail: applicantEmailResponse 
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in send-application-notification function:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred processing your request" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
