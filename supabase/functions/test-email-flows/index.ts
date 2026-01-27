import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const DASHBOARD_URL = "https://apex-financial.org";

// Test data
const testApplicant = {
  firstName: "John",
  lastName: "TestApplicant",
  email: "test@example.com",
  phone: "(555) 123-4567",
  city: "Atlanta",
  state: "GA",
  instagramHandle: "johndoe_apex",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!resend) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { testEmail, flowType } = await req.json();

    if (!testEmail) {
      return new Response(
        JSON.stringify({ error: "testEmail is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const results: { flow: string; success: boolean; error?: string; details?: string; sentResults?: any[] }[] = [];
    const allFlows = !flowType || flowType === "all";

    // 1. Licensed Applicant Confirmation Email
    if (allFlows || flowType === "licensed-confirmation") {
      try {
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 🎉 You're on the Fast Track! - Licensed Agent Welcome",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to APEX Financial!</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">You're Already Ahead of the Game 🚀</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hi ${testApplicant.firstName},</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  Congratulations on taking the first step toward financial freedom! As a licensed agent, you're already on the fast track to success with APEX Financial.
                </p>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 500;">
                    🎯 Since you're already licensed, we can get you started FAST. Expect a call from our team within 24-48 hours!
                  </p>
                </div>

                <h3 style="color: #111827; margin-bottom: 15px;">Watch This Success Story</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  See how other licensed agents have built thriving careers with APEX:
                </p>
                <a href="https://youtu.be/YmlLSIwfGdE" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  ▶️ Watch Testimonial Video
                </a>

                <h3 style="color: #111827; margin: 25px 0 15px;">Ready to Get Started?</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  Schedule your 1-on-1 onboarding call to fast-track your career:
                </p>
                <a href="https://calendly.com/sam-com593/1on1-call-clone" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  📅 Schedule Your Onboarding Call
                </a>

                <p style="color: #4b5563; margin-top: 30px;">
                  Best regards,<br>
                  <strong style="color: #059669;">The APEX Financial Team</strong>
                </p>
              </div>

              <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
                <p>&copy; ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
                <p style="color: #dc2626; font-weight: bold;">[TEST EMAIL - This is a preview of the licensed applicant confirmation]</p>
              </div>
            </div>
          `,
        });
        results.push({ flow: "licensed-confirmation", success: true });
      } catch (e: any) {
        results.push({ flow: "licensed-confirmation", success: false, error: e.message });
      }
    }

    // 2. Unlicensed Applicant Confirmation Email
    if (allFlows || flowType === "unlicensed-confirmation") {
      try {
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 📋 Your Next Steps to Getting Licensed - APEX Financial",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to APEX Financial!</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Your Journey to Financial Freedom Starts Now 🌟</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hi ${testApplicant.firstName},</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  Thank you for applying to join the APEX Financial team! We're excited to help you start your career in insurance sales.
                </p>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 500;">
                    🎓 Don't worry about not having a license yet - we cover most of the licensing costs and will guide you through the entire process!
                  </p>
                </div>

                <h3 style="color: #111827; margin-bottom: 15px;">Step 1: Watch This Important Video</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  Learn exactly how the licensing process works:
                </p>
                <a href="https://youtu.be/i1e5p-GEfAU" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  ▶️ Watch Licensing Video
                </a>

                <h3 style="color: #111827; margin: 25px 0 15px;">Step 2: Review the Licensing Guide</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  Get all the details about what to expect:
                </p>
                <a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  📄 View Licensing Document
                </a>

                <h3 style="color: #111827; margin: 25px 0 15px;">Step 3: Start Your Pre-Licensing Course</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  Begin studying for your license exam (we pay for this!):
                </p>
                <a href="https://partners.xcelsolutions.com/afe" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  📚 Access Pre-Licensing Course
                </a>

                <h3 style="color: #111827; margin: 25px 0 15px;">Have Questions?</h3>
                <p style="color: #4b5563; line-height: 1.6;">
                  Schedule a call with our team:
                </p>
                <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0;">
                  📅 Schedule a Call
                </a>

                <p style="color: #4b5563; margin-top: 30px;">
                  Best regards,<br>
                  <strong style="color: #059669;">The APEX Financial Team</strong>
                </p>
              </div>

              <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
                <p>&copy; ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
                <p style="color: #dc2626; font-weight: bold;">[TEST EMAIL - This is a preview of the unlicensed applicant confirmation]</p>
              </div>
            </div>
          `,
        });
        results.push({ flow: "unlicensed-confirmation", success: true });
      } catch (e: any) {
        results.push({ flow: "unlicensed-confirmation", success: false, error: e.message });
      }
    }

    // 3. Admin HOT LEAD Alert (Licensed)
    if (allFlows || flowType === "admin-hot-lead") {
      try {
        await resend.emails.send({
          from: "APEX Applications <applications@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 🔥 HOT LEAD - CALL NOW: John TestApplicant is LICENSED!",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #dc2626, #991b1b); padding: 15px; text-align: center;">
                <h2 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">
                  ⚠️ URGENT: Licensed Agent Ready to Start! ⚠️
                </h2>
                <p style="color: #fecaca; margin: 8px 0 0 0; font-size: 14px;">
                  Call within 5 minutes for best results
                </p>
              </div>
              <div style="background: linear-gradient(135deg, #dc2626, #991b1b); padding: 30px;">
                <h1 style="color: white; margin: 0; font-size: 24px;">🔥 HOT LEAD - LICENSED AGENT</h1>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
                  <p style="margin: 0 0 10px 0; color: #991b1b; font-weight: bold; font-size: 16px;">
                    📱 CLICK TO CALL IMMEDIATELY
                  </p>
                  <a href="tel:${testApplicant.phone}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 20px;">
                    ${testApplicant.phone}
                  </a>
                </div>
                
                <div style="background: white; padding: 20px; border-radius: 8px;">
                  <h2 style="color: #dc2626; margin-top: 0; font-size: 18px;">Applicant Details</h2>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                      <td style="padding: 8px 0; font-weight: bold;">${testApplicant.firstName} ${testApplicant.lastName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                      <td style="padding: 8px 0;"><a href="mailto:${testApplicant.email}" style="color: #dc2626;">${testApplicant.email}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                      <td style="padding: 8px 0;"><a href="tel:${testApplicant.phone}" style="color: #dc2626; font-weight: bold;">${testApplicant.phone}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                      <td style="padding: 8px 0;">${testApplicant.city}, ${testApplicant.state}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Instagram:</td>
                      <td style="padding: 8px 0;"><a href="https://instagram.com/${testApplicant.instagramHandle}" style="color: #059669;">@${testApplicant.instagramHandle}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">License Status:</td>
                      <td style="padding: 8px 0;">
                        <span style="background: #d1fae5; color: #047857; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                          Licensed
                        </span>
                      </td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="${DASHBOARD_URL}/dashboard/applicants?lead=test-id" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; text-decoration: none; padding: 18px 36px; border-radius: 8px; font-weight: 700; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.5);">
                    📞 CALL NOW: ${testApplicant.phone}
                  </a>
                </div>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the admin HOT LEAD alert]
              </div>
            </div>
          `,
        });
        results.push({ flow: "admin-hot-lead", success: true });
      } catch (e: any) {
        results.push({ flow: "admin-hot-lead", success: false, error: e.message });
      }
    }

    // 4. Admin Standard Alert (Unlicensed)
    if (allFlows || flowType === "admin-standard") {
      try {
        await resend.emails.send({
          from: "APEX Applications <applications@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] New Application: John TestApplicant (Not Yet Licensed)",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 24px;">New Agent Application</h1>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <div style="background: white; padding: 20px; border-radius: 8px;">
                  <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Applicant Details</h2>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                      <td style="padding: 8px 0; font-weight: bold;">${testApplicant.firstName} ${testApplicant.lastName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                      <td style="padding: 8px 0;"><a href="mailto:${testApplicant.email}" style="color: #059669;">${testApplicant.email}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                      <td style="padding: 8px 0;"><a href="tel:${testApplicant.phone}" style="color: #059669;">${testApplicant.phone}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                      <td style="padding: 8px 0;">${testApplicant.city}, ${testApplicant.state}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">License Status:</td>
                      <td style="padding: 8px 0;">
                        <span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                          Not Yet Licensed
                        </span>
                      </td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="${DASHBOARD_URL}/dashboard/applicants?lead=test-id" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    📞 View Lead & Call Now →
                  </a>
                </div>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the standard admin notification]
              </div>
            </div>
          `,
        });
        results.push({ flow: "admin-standard", success: true });
      } catch (e: any) {
        results.push({ flow: "admin-standard", success: false, error: e.message });
      }
    }

    // 5. Manager Referral Notification
    if (allFlows || flowType === "manager-referral") {
      try {
        await resend.emails.send({
          from: "APEX Applications <applications@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 🎯 New Team Applicant: John TestApplicant",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 24px;">New Team Application!</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Hi Manager, someone applied using your referral link!</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                  <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Applicant Details</h2>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                      <td style="padding: 8px 0; font-weight: bold;">${testApplicant.firstName} ${testApplicant.lastName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                      <td style="padding: 8px 0;"><a href="mailto:${testApplicant.email}" style="color: #059669;">${testApplicant.email}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                      <td style="padding: 8px 0;"><a href="tel:${testApplicant.phone}" style="color: #059669;">${testApplicant.phone}</a></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                      <td style="padding: 8px 0;">${testApplicant.city}, ${testApplicant.state}</td>
                    </tr>
                  </table>
                </div>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 500;">
                    This applicant selected you as their referring manager. Follow up with them soon!
                  </p>
                </div>

                <div style="text-align: center; margin-top: 20px;">
                  <a href="${DASHBOARD_URL}/dashboard/applicants?lead=test-id" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    📞 View Lead & Call Now →
                  </a>
                </div>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the manager referral notification]
              </div>
            </div>
          `,
        });
        results.push({ flow: "manager-referral", success: true });
      } catch (e: any) {
        results.push({ flow: "manager-referral", success: false, error: e.message });
      }
    }

    // 6. 3-Day Unlicensed Follow-up
    if (allFlows || flowType === "unlicensed-followup") {
      try {
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] Need Help Getting Licensed? We're Here For You! 📋",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Need Help Getting Licensed?</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">We're here to guide you every step of the way</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hi ${testApplicant.firstName},</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  We noticed you applied to join APEX Financial a few days ago. We wanted to check in and see if you have any questions about the licensing process!
                </p>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 500;">
                    Remember: We cover most of the licensing costs - the course, exam fees, and license application!
                  </p>
                </div>

                <h3 style="color: #111827; margin-bottom: 15px;">Quick Links to Get Started:</h3>
                <ul style="color: #4b5563; line-height: 2;">
                  <li><a href="https://youtu.be/i1e5p-GEfAU" style="color: #059669;">▶️ Watch the Licensing Explained Video</a></li>
                  <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669;">📄 Review the Licensing Guide</a></li>
                  <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669;">📚 Start Your Pre-Licensing Course</a></li>
                </ul>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    📅 Schedule a Call - Let's Talk!
                  </a>
                </div>

                <p style="color: #4b5563; margin-top: 30px;">
                  Best regards,<br>
                  <strong style="color: #059669;">The APEX Financial Team</strong>
                </p>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the 3-day unlicensed follow-up]
              </div>
            </div>
          `,
        });
        results.push({ flow: "unlicensed-followup", success: true });
      } catch (e: any) {
        results.push({ flow: "unlicensed-followup", success: false, error: e.message });
      }
    }

    // 7. 7-Day Unlicensed Follow-up ("Are You Licensed Yet?")
    if (allFlows || flowType === "unlicensed-followup-2") {
      try {
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] Are You Licensed Yet? 🎓",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 26px;">How's It Coming Along?</h1>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hey ${testApplicant.firstName}! 👋</h2>
                
                <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                  It's been about a week since you applied to join APEX Financial. We wanted to check in and see how your licensing journey is going!
                </p>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 600; font-size: 18px;">
                    🎓 Are you licensed yet?
                  </p>
                </div>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                  If you've completed your licensing, <strong>congratulations!</strong> Let's get you started right away. Book your onboarding call below:
                </p>
                
                <div style="text-align: center; margin: 25px 0;">
                  <a href="https://calendly.com/sam-com593/1on1-call-clone" 
                     style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; 
                            padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                            box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);">
                    📅 I'm Licensed - Schedule My Call!
                  </a>
                </div>

                <div style="border-top: 1px solid #e5e7eb; margin: 25px 0; padding-top: 25px;">
                  <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                    <strong>Still working on it?</strong> No worries! Here are your resources again:
                  </p>
                  
                  <ul style="color: #4b5563; line-height: 2; font-size: 15px; margin: 15px 0;">
                    <li><a href="https://youtu.be/i1e5p-GEfAU" style="color: #059669; font-weight: 500;">▶️ Watch: Licensing Overview Video</a></li>
                    <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669; font-weight: 500;">📄 Licensing Step-by-Step Guide</a></li>
                    <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669; font-weight: 500;">📚 Start/Continue Pre-Licensing Course</a></li>
                  </ul>
                </div>

                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #92400e; font-weight: 500;">
                    💡 Need help? Schedule a quick call and we'll walk you through the process step-by-step!
                  </p>
                </div>
                
                <div style="text-align: center; margin: 25px 0;">
                  <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" 
                     style="display: inline-block; background: #f59e0b; color: white; 
                            padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
                    📞 I Need Help Getting Licensed
                  </a>
                </div>

                <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
                  We're here to support you every step of the way!
                </p>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the 7-day "Are you licensed yet?" follow-up]
              </div>
            </div>
          `,
        });
        results.push({ flow: "unlicensed-followup-2", success: true });
      } catch (e: any) {
        results.push({ flow: "unlicensed-followup-2", success: false, error: e.message });
      }
    }

    // 8. 3-4 Day Licensed Follow-up (if not contacted)
    if (allFlows || flowType === "licensed-followup") {
      try {
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] Did We Get to You Yet? Let's Connect! 🚀",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Let's Get You Started!</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Your opportunity is waiting 🚀</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hi ${testApplicant.firstName},</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  We saw that you applied to join APEX Financial and are already licensed - that's amazing! We want to make sure we connected with you.
                </p>

                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #92400e; font-weight: 500;">
                    If we haven't reached you yet, please schedule a call directly - we don't want you to miss this opportunity!
                  </p>
                </div>

                <h3 style="color: #111827; margin-bottom: 15px;">Why Join APEX?</h3>
                <ul style="color: #4b5563; line-height: 1.8;">
                  <li>💰 Top-tier commissions in the industry</li>
                  <li>📈 Proven lead generation system</li>
                  <li>🎯 Full training and mentorship</li>
                  <li>🚀 Fast-track onboarding for licensed agents</li>
                </ul>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="https://calendly.com/sam-com593/1on1-call-clone" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    📅 Schedule Your 1-on-1 Call Now
                  </a>
                </div>

                <p style="color: #4b5563; margin-top: 30px;">
                  Best regards,<br>
                  <strong style="color: #059669;">The APEX Financial Team</strong>
                </p>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the licensed follow-up email]
              </div>
            </div>
          `,
        });
        results.push({ flow: "licensed-followup", success: true });
      } catch (e: any) {
        results.push({ flow: "licensed-followup", success: false, error: e.message });
      }
    }

    // 8. Abandoned Application Alert
    if (allFlows || flowType === "abandoned-alert") {
      try {
        await resend.emails.send({
          from: "APEX Alerts <alerts@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] ⚠️ 3 Abandoned Applications - Follow Up Required",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 30px; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 24px;">⚠️ Abandoned Applications Alert</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">
                  3 potential leads started but didn't complete the application
                </p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin-bottom: 20px; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #92400e; font-weight: 500;">
                    These leads showed interest but abandoned the form. Consider reaching out to help them complete the process!
                  </p>
                </div>

                <div style="background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                      <tr style="background: #f9fafb;">
                        <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Name</th>
                        <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Email</th>
                        <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Phone</th>
                        <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 12px 8px; font-weight: 500;">Sarah Johnson</td>
                        <td style="padding: 12px 8px;"><a href="mailto:sarah@example.com" style="color: #059669;">sarah@example.com</a></td>
                        <td style="padding: 12px 8px;"><a href="tel:5551234567" style="color: #059669;">(555) 123-4567</a></td>
                        <td style="padding: 12px 8px; color: #dc2626;">Step 2/4</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 12px 8px; font-weight: 500;">Mike Williams</td>
                        <td style="padding: 12px 8px;"><a href="mailto:mike@example.com" style="color: #059669;">mike@example.com</a></td>
                        <td style="padding: 12px 8px;">-</td>
                        <td style="padding: 12px 8px; color: #dc2626;">Step 1/4</td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 8px; font-weight: 500;">Lisa Chen</td>
                        <td style="padding: 12px 8px;">-</td>
                        <td style="padding: 12px 8px;"><a href="tel:5559876543" style="color: #059669;">(555) 987-6543</a></td>
                        <td style="padding: 12px 8px; color: #dc2626;">Step 3/4</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="${DASHBOARD_URL}/dashboard/admin" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    View Admin Dashboard →
                  </a>
                </div>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the abandoned application alert]
              </div>
            </div>
          `,
        });
        results.push({ flow: "abandoned-alert", success: true });
      } catch (e: any) {
        results.push({ flow: "abandoned-alert", success: false, error: e.message });
      }
    }

    // 9. Weekly Analytics Email
    if (allFlows || flowType === "weekly-analytics") {
      try {
        await resend.emails.send({
          from: "APEX Analytics <analytics@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 📊 Your Weekly Team Performance - APEX Financial",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">📊 Weekly Performance Report</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
              
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2 style="color: #111827; margin-top: 0;">Hi Manager,</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  Here's your team's performance summary for the past week:
                </p>

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0;">
                  <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">New Leads</p>
                    <p style="color: #059669; margin: 0; font-size: 32px; font-weight: bold;">12</p>
                  </div>
                  <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">Contacted</p>
                    <p style="color: #3b82f6; margin: 0; font-size: 32px; font-weight: bold;">8</p>
                  </div>
                  <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">Qualified</p>
                    <p style="color: #8b5cf6; margin: 0; font-size: 32px; font-weight: bold;">5</p>
                  </div>
                  <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">Closed</p>
                    <p style="color: #10b981; margin: 0; font-size: 32px; font-weight: bold;">3</p>
                  </div>
                </div>

                <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                  <p style="margin: 0; color: #047857; font-weight: 500;">
                    🎉 Great work! Your close rate this week is 25% - above team average!
                  </p>
                </div>

                <div style="text-align: center; margin-top: 25px;">
                  <a href="${DASHBOARD_URL}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    View Full Dashboard →
                  </a>
                </div>
              </div>
              <div style="text-align: center; padding: 20px; color: #dc2626; font-weight: bold;">
                [TEST EMAIL - This is a preview of the weekly analytics email]
              </div>
            </div>
          `,
        });
        results.push({ flow: "weekly-analytics", success: true });
      } catch (e: any) {
        results.push({ flow: "weekly-analytics", success: false, error: e.message });
      }
    }

    // 10. Leaderboard Notification (Sample)
    if (allFlows || flowType === "leaderboard") {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [testEmail],
          subject: "[TEST] 🏆 KJ Vaughns Scored Another Recruit!",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">🏆</div>
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">
                  KJ Vaughns just landed a new recruit!
                </h1>
              </div>

              <div style="background-color: #ffffff; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                
                <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                  <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <div style="background-color: #1e3a5f; color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; margin-right: 15px;">
                      J
                    </div>
                    <div>
                      <h2 style="margin: 0; color: #1e293b; font-size: 18px;">John TestApplicant</h2>
                      <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">📍 Atlanta, GA</p>
                    </div>
                  </div>
                  
                  <div style="display: inline-block; background-color: #22c55e; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                    LICENSED
                  </div>
                </div>

                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
                  <p style="margin: 0; color: #92400e; font-size: 14px;">Referred by</p>
                  <p style="margin: 5px 0 0 0; color: #78350f; font-size: 20px; font-weight: 700;">⭐ KJ Vaughns</p>
                </div>

                <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <p style="color: #64748b; font-size: 14px; margin: 0;">
                    Keep recruiting and grow your team! 💪
                  </p>
                </div>
              </div>

              <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
                <p style="margin: 0;">Apex Financial Enterprises</p>
                <p style="color: #dc2626; font-weight: bold; margin-top: 10px;">[TEST EMAIL - Leaderboard notification preview]</p>
              </div>
            </div>
          `,
        });
        results.push({ flow: "leaderboard", success: true });
      } catch (e: any) {
        results.push({ flow: "leaderboard", success: false, error: e.message });
      }
    }

    // 11. Send retroactive leaderboard notifications for ALL existing applications
    if (flowType === "retroactive-leaderboard") {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        
        // Dynamically import createClient for this flow
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

        // Get all active applications
        const { data: applications, error: appError } = await supabaseAdmin
          .from("applications")
          .select("id, first_name, last_name, city, state, license_status, assigned_agent_id, referral_source, created_at")
          .is("terminated_at", null)
          .order("created_at", { ascending: true });

        if (appError) {
          throw new Error(`Failed to fetch applications: ${appError.message}`);
        }

        console.log(`[Retroactive] Found ${applications?.length || 0} applications to notify`);

        const sentResults: { applicant: string; success: boolean; error?: string }[] = [];

        for (const app of applications || []) {
          try {
            const response = await fetch(
              `${supabaseUrl}/functions/v1/notify-all-managers-leaderboard`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                  applicationId: app.id,
                  scoringManagerId: app.assigned_agent_id || null,
                  applicantName: `${app.first_name} ${app.last_name}`,
                  applicantCity: app.city,
                  applicantState: app.state,
                  licenseStatus: app.license_status,
                  referralSource: app.referral_source,
                }),
              }
            );

            const result = await response.json();
            console.log(`[Retroactive] Sent for ${app.first_name} ${app.last_name}:`, result);
            sentResults.push({ 
              applicant: `${app.first_name} ${app.last_name}`,
              success: response.ok 
            });

            // Small delay to avoid overwhelming email service
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e: any) {
            sentResults.push({ 
              applicant: `${app.first_name} ${app.last_name}`,
              success: false,
              error: e.message
            });
          }
        }

        const successfulSends = sentResults.filter(r => r.success).length;
        results.push({ 
          flow: "retroactive-leaderboard", 
          success: true,
          details: `Sent ${successfulSends}/${applications?.length || 0} retroactive notifications`,
          sentResults
        });
      } catch (e: any) {
        results.push({ flow: "retroactive-leaderboard", success: false, error: e.message });
      }
    }

    // 12. Instagram Handle Reminder Email to all managers
    if (flowType === "instagram-reminder") {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

        // Get all managers/admins
        const { data: roleData } = await supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in("role", ["manager", "admin"]);

        const sentResults: { email: string; name: string; success: boolean; error?: string }[] = [];

        for (const role of roleData || []) {
          // Get email from auth.users
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(role.user_id);
          
          if (authError || !authData?.user?.email) {
            continue;
          }

          // Get name and instagram handle from profiles
          const { data: profileData } = await supabaseAdmin
            .from("profiles")
            .select("full_name, instagram_handle")
            .eq("user_id", role.user_id)
            .single();

          const managerName = profileData?.full_name || authData.user.email;
          const hasInstagram = !!profileData?.instagram_handle;

          // Send reminder email
          try {
            await resend.emails.send({
              from: "APEX Financial <noreply@apex-financial.org>",
              to: [authData.user.email],
              subject: hasInstagram 
                ? "📱 Your Instagram Handle is Set - Thanks!" 
                : "📱 Add Your Instagram Handle for Referrals",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #D4AF37, #C5A028); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: #000000; margin: 0; font-size: 24px;">
                      ${hasInstagram ? "✅ Your Profile is Complete!" : "📱 Update Your Profile"}
                    </h1>
                  </div>
                  
                  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #111827; margin-top: 0;">Hi ${managerName.split(' ')[0]},</h2>
                    
                    ${hasInstagram ? `
                      <p style="color: #4b5563; line-height: 1.6;">
                        Great news! Your Instagram handle <strong>@${profileData?.instagram_handle}</strong> is already set up and visible to applicants.
                      </p>
                      <p style="color: #4b5563; line-height: 1.6;">
                        When applicants select you as their referrer, they'll see: <strong>${managerName} (@${profileData?.instagram_handle})</strong>
                      </p>
                    ` : `
                      <p style="color: #4b5563; line-height: 1.6;">
                        Applicants can now select you as their referrer when applying to APEX! To help them recognize you (especially from Instagram), please update your Instagram handle in your profile settings.
                      </p>
                      
                      <div style="background: #fef3c7; border-left: 4px solid #D4AF37; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                        <p style="margin: 0; color: #92400e; font-weight: 500;">
                          📌 Without your Instagram handle, applicants only see your name. Adding your handle makes it easier for recruits from Instagram to identify you!
                        </p>
                      </div>

                      <div style="text-align: center; margin: 25px 0;">
                        <a href="${DASHBOARD_URL}/settings" style="display: inline-block; background: linear-gradient(135deg, #D4AF37, #C5A028); color: #000000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                          ⚙️ Update Your Profile Now
                        </a>
                      </div>

                      <p style="color: #6b7280; font-size: 14px;">
                        <strong>How to update:</strong><br>
                        1. Go to Dashboard → Settings<br>
                        2. Find "Instagram Handle" field<br>
                        3. Enter your handle (without the @)<br>
                        4. Click Save Changes
                      </p>
                    `}

                    <p style="color: #4b5563; margin-top: 30px;">
                      Keep scaling up! 🚀<br>
                      <strong style="color: #D4AF37;">The APEX Team</strong>
                    </p>
                  </div>

                  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
                    <p>Apex Financial Enterprises</p>
                  </div>
                </div>
              `,
            });
            sentResults.push({ email: authData.user.email, name: managerName, success: true });
          } catch (e: any) {
            sentResults.push({ email: authData.user.email, name: managerName, success: false, error: e.message });
          }

          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const successfulSends = sentResults.filter(r => r.success).length;
        results.push({ 
          flow: "instagram-reminder", 
          success: true,
          details: `Sent ${successfulSends}/${sentResults.length} Instagram reminder emails`,
          sentResults
        });
      } catch (e: any) {
        results.push({ flow: "instagram-reminder", success: false, error: e.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        success: failCount === 0,
        message: `Sent ${successCount} test emails${failCount > 0 ? `, ${failCount} failed` : ""}`,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in test-email-flows:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
