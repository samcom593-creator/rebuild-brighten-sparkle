import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ApplicationEmailRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  licenseStatus: string;
  hasInsuranceExperience: boolean;
  yearsExperience?: number;
  previousCompany?: string;
  desiredIncome?: number;
  availability: string;
  referralSource?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: ApplicationEmailRequest = await req.json();

    const licenseStatusDisplay = {
      licensed: "Licensed",
      unlicensed: "Not Yet Licensed",
      pending: "License Pending",
    }[data.licenseStatus] || data.licenseStatus;

    // Send notification email to APEX team
    const adminEmailResponse = await resend.emails.send({
      from: "APEX Applications <onboarding@resend.dev>",
      to: ["applications@apexfinancial.com"], // Replace with your actual email
      subject: `New Application: ${data.firstName} ${data.lastName} (${licenseStatusDisplay})`,
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
                  <td style="padding: 8px 0; font-weight: bold;">${data.firstName} ${data.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${data.email}" style="color: #059669;">${data.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                  <td style="padding: 8px 0;"><a href="tel:${data.phone}" style="color: #059669;">${data.phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                  <td style="padding: 8px 0;">${data.city}, ${data.state}</td>
                </tr>
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Licensing & Experience</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">License Status:</td>
                  <td style="padding: 8px 0;">
                    <span style="background: ${data.licenseStatus === 'licensed' ? '#d1fae5' : data.licenseStatus === 'pending' ? '#fef3c7' : '#fee2e2'}; 
                                 color: ${data.licenseStatus === 'licensed' ? '#047857' : data.licenseStatus === 'pending' ? '#92400e' : '#991b1b'};
                                 padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                      ${licenseStatusDisplay}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Insurance Experience:</td>
                  <td style="padding: 8px 0;">${data.hasInsuranceExperience ? 'Yes' : 'No'}</td>
                </tr>
                ${data.yearsExperience ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Years of Experience:</td>
                  <td style="padding: 8px 0;">${data.yearsExperience}</td>
                </tr>
                ` : ''}
                ${data.previousCompany ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Previous Company:</td>
                  <td style="padding: 8px 0;">${data.previousCompany}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px;">
              <h2 style="color: #059669; margin-top: 0; font-size: 18px;">Goals & Availability</h2>
              <table style="width: 100%; border-collapse: collapse;">
                ${data.desiredIncome ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Desired Income:</td>
                  <td style="padding: 8px 0;">$${data.desiredIncome.toLocaleString()}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Availability:</td>
                  <td style="padding: 8px 0;">${data.availability}</td>
                </tr>
                ${data.referralSource ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">How They Found Us:</td>
                  <td style="padding: 8px 0;">${data.referralSource}</td>
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

    // Send confirmation email to applicant
    const applicantEmailResponse = await resend.emails.send({
      from: "APEX Financial <onboarding@resend.dev>",
      to: [data.email],
      subject: "Application Received - APEX Financial",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to APEX Financial!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${data.firstName},</h2>
            
            <p style="color: #4b5563; line-height: 1.6;">
              Thank you for applying to join the APEX Financial team! We've received your application and are excited to learn more about you.
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                ${data.licenseStatus === 'licensed' 
                  ? "As a licensed agent, you're on the fast track! Expect to hear from us within 24-48 hours."
                  : "Don't worry about not having a license yet - we cover all licensing costs and will guide you through the process!"}
              </p>
            </div>

            <h3 style="color: #111827; margin-bottom: 15px;">What Happens Next?</h3>
            <ol style="color: #4b5563; line-height: 1.8;">
              <li>Watch the onboarding video on your success page</li>
              <li>Schedule your discovery call with our team</li>
              <li>Complete the contracting process</li>
              <li>Start your training and begin earning!</li>
            </ol>

            <p style="color: #4b5563; line-height: 1.6;">
              If you have any questions in the meantime, don't hesitate to reach out. We're here to help you succeed!
            </p>

            <p style="color: #4b5563; margin-top: 30px;">
              Best regards,<br>
              <strong style="color: #059669;">The APEX Financial Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} APEX Financial. All rights reserved.</p>
          </div>
        </div>
      `,
    });

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
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
