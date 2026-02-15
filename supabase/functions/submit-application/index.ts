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

const SubmitApplicationSchema = z.object({
  firstName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
  lastName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
  email: z.string().email().max(254),
  phone: z.string().min(10).max(20).regex(/^[\d\s\-\+\(\)]+$/, "Invalid phone format"),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(50),
  instagramHandle: z.string().max(50).optional().nullable(),

  hasInsuranceExperience: z.boolean().default(false),
  yearsExperience: NumOptional(0, 50),
  previousCompany: z.string().max(200).optional().nullable(),
  numberOfDownlines: NumOptional(0, 10000),

  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional().nullable(),
  licensedStates: z.array(z.string().min(2).max(50)).optional().nullable(),

  availability: z.string().min(1).max(500),
  referralSource: z.string().max(500).optional().nullable(),
  
  // New: selected referral agent ID
  selectedReferralAgentId: z.string().uuid().optional().nullable(),
  
  // Consent data for Twilio compliance
  consent: ConsentSchema.optional().nullable(),
});

type SubmitApplicationRequest = z.infer<typeof SubmitApplicationSchema>;

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
      from: "APEX Applications <applications@apex-financial.org>",
      to: [manager.email],
      subject: `🎯 New Team Applicant: ${sanitized.firstName} ${sanitized.lastName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0;">
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

            <div style="text-align: center; margin-top: 20px;">
              <a href="https://apex-financial.org/dashboard/applicants?lead=${applicationId}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 15px;">
                📞 View Lead & Call Now →
              </a>
              <p style="color: #6b7280; font-size: 14px; margin-top: 15px;">
                Submitted on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
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
    const adminSubject = isLicensedApplicant 
      ? `🔥 HOT LEAD - CALL NOW: ${sanitized.firstName} ${sanitized.lastName} is LICENSED!`
      : `New Application: ${sanitized.firstName} ${sanitized.lastName} (${licenseStatusDisplay})`;
    
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
      from: "APEX Applications <applications@apex-financial.org>",
      to: ["info@apex-financial.org"],
      subject: adminSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
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
    console.log("Admin notification sent:", adminEmailResponse);

    // Determine content based on license status
    const isLicensed = sanitized.licenseStatus === 'licensed';
    
    // Licensed applicants get call scheduling, unlicensed get licensing resources
    const licensedCalendlyUrl = 'https://calendly.com/sam-com593/1on1-call-clone';
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
              Congratulations! As a licensed agent, you're ready to hit the ground running with APEX Financial.
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                You're on the fast track! Schedule your call below to get started immediately.
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
              Best regards,<br>
              <strong style="color: #059669;">The APEX Financial Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Save this email - it contains your important next steps!</p>
            <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
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
              Thank you for applying to join APEX Financial! Here's how we'll help you get licensed (at no cost to you).
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                Don't worry about not having a license yet - we cover most of the licensing costs and guide you through every step!
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
              If you have any questions, don't hesitate to reach out. We're here to help you succeed!
            </p>

            <p style="color: #4b5563; margin-top: 30px;">
              Best regards,<br>
              <strong style="color: #059669;">The APEX Financial Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Save this email - it contains your important next steps!</p>
            <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
          </div>
        </div>
      `;

    // Send confirmation email to applicant with conditional links
    const applicantEmailResponse = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [data.email],
      subject: isLicensed 
        ? "You're on the Fast Track! - APEX Financial" 
        : "Your Next Steps - APEX Financial",
      html: emailHtml,
    });
    console.log("Applicant confirmation sent:", applicantEmailResponse);

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

    // Check for duplicate applications by email or phone
    
    const { data: existingByEmail } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, last_name, terminated_at")
      .ilike("email", normalizedEmail)
      .is("terminated_at", null)
      .maybeSingle();

    if (existingByEmail) {
      console.log(`Duplicate application detected for email: ${normalizedEmail}`);
      return new Response(
        JSON.stringify({ 
          error: "An application with this email already exists. If you need to update your application, please contact us.",
          duplicate: true 
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Also check phone (normalize to last 10 digits)
    const { data: existingApps } = await supabaseAdmin
      .from("applications")
      .select("id, phone, terminated_at")
      .is("terminated_at", null);

    const duplicateByPhone = existingApps?.find(app => {
      const appPhone = (app.phone || '').replace(/\D/g, '').slice(-10);
      return appPhone === normalizedPhone && appPhone.length === 10;
    });

    if (duplicateByPhone) {
      console.log(`Duplicate application detected for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ 
          error: "An application with this phone number already exists. If you need to update your application, please contact us.",
          duplicate: true 
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Extract consent data
    const consent = data.consent;

    const insertPayload = {
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
      previous_production: data.numberOfDownlines ?? null, // Stores number of downlines

      license_status: data.licenseStatus,
      nipr_number: data.niprNumber ?? null,
      licensed_states: data.licensedStates && data.licensedStates.length > 0
        ? data.licensedStates
        : null,

      desired_income: null,
      availability: data.availability,
      referral_source: data.referralSource ?? null,
      notes: null,
      
      // Assign to the selected referral agent, or default to admin
      assigned_agent_id: data.selectedReferralAgentId ?? "7c3c5581-3544-437f-bfe2-91391afb217d",

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

    // Send email notifications in background (pass the application ID)
    sendEmailNotifications(data, inserted.id).catch((err) => {
      console.error("Background email notification failed:", err);
    });

    // Send leaderboard notification to ALL managers (competitive motivation)
    sendLeaderboardNotification(data, inserted.id).catch((err) => {
      console.error("Background leaderboard notification failed:", err);
    });

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
