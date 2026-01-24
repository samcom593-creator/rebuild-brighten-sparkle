import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const DASHBOARD_URL = "https://rebuild-brighten-sparkle.lovable.app";

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

    const results: { flow: string; success: boolean; error?: string }[] = [];
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
                    🎓 Don't worry about not having a license yet - we cover ALL licensing costs and will guide you through the entire process!
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
                    Remember: We cover ALL licensing costs - the course, exam fees, and license application!
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

    // 7. 3-4 Day Licensed Follow-up (if not contacted)
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
