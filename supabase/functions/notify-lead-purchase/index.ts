 import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 import { Resend } from "https://esm.sh/resend@2.0.0";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
 const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers":
     "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
 };
 
 interface PurchaseNotificationRequest {
   purchaserName: string;
   purchaserEmail: string;
   packageName: string;
   price: number;
   paymentMethod: "venmo" | "cashapp";
   managerId?: string;
 }
 
 serve(async (req: Request) => {
   // Handle CORS preflight
   if (req.method === "OPTIONS") {
     return new Response("ok", { headers: corsHeaders });
   }
 
   try {
     const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
     const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
     const supabase = createClient(supabaseUrl, supabaseKey);
 
     const body: PurchaseNotificationRequest = await req.json();
     const { purchaserName, purchaserEmail, packageName, price, paymentMethod, managerId } = body;
 
     console.log("Processing lead purchase notification:", {
       purchaserName,
       purchaserEmail,
       packageName,
       price,
       paymentMethod,
     });
 
     const timestamp = new Date().toLocaleString("en-US", {
       timeZone: "America/Chicago",
       dateStyle: "medium",
       timeStyle: "short",
     });
 
     const emailsToSend: Array<{ to: string; subject: string; html: string }> = [];
 
     // 1. Admin notification
     // Get admin emails (users with admin role)
     const { data: adminRoles } = await supabase
       .from("user_roles")
       .select("user_id")
       .eq("role", "admin");
 
     if (adminRoles && adminRoles.length > 0) {
       const { data: adminProfiles } = await supabase
         .from("profiles")
         .select("email")
         .in("user_id", adminRoles.map((r) => r.user_id));
 
       for (const admin of adminProfiles || []) {
         emailsToSend.push({
           to: admin.email,
           subject: `💰 New Lead Purchase: ${packageName}`,
           html: `
             <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
               <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 20px; border-radius: 12px 12px 0 0;">
                 <h1 style="color: white; margin: 0; font-size: 24px;">New Lead Purchase</h1>
               </div>
               <div style="background: #1f2937; padding: 24px; border-radius: 0 0 12px 12px;">
                 <p style="color: #9ca3af; margin: 0 0 16px;">A team member has initiated a lead purchase:</p>
                 
                 <div style="background: #374151; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                   <p style="color: white; margin: 0 0 8px;"><strong>Purchaser:</strong> ${purchaserName}</p>
                   <p style="color: white; margin: 0 0 8px;"><strong>Email:</strong> ${purchaserEmail}</p>
                   <p style="color: white; margin: 0 0 8px;"><strong>Package:</strong> ${packageName}</p>
                   <p style="color: white; margin: 0 0 8px;"><strong>Amount:</strong> $${price}/week</p>
                   <p style="color: white; margin: 0 0 8px;"><strong>Payment Method:</strong> ${paymentMethod === "venmo" ? "Venmo" : "Cash App"}</p>
                   <p style="color: white; margin: 0;"><strong>Time:</strong> ${timestamp} CST</p>
                 </div>
                 
                 <p style="color: #9ca3af; margin: 0; font-size: 12px;">
                   ⚠️ Payment confirmation is pending manual verification.
                 </p>
               </div>
               <p style="color: #6b7280; font-size: 11px; text-align: center; margin-top: 16px;">
                 Powered by Apex Financial
               </p>
             </div>
           `,
         });
       }
     }
 
     // 2. Manager notification (if purchaser has a manager)
     if (managerId) {
       const { data: managerAgent } = await supabase
         .from("agents")
         .select("user_id")
         .eq("id", managerId)
         .single();
 
       if (managerAgent) {
         const { data: managerProfile } = await supabase
           .from("profiles")
           .select("email, full_name")
           .eq("user_id", managerAgent.user_id)
           .single();
 
         if (managerProfile) {
           emailsToSend.push({
             to: managerProfile.email,
             subject: `💰 Team Member Lead Purchase: ${purchaserName}`,
             html: `
               <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
                 <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 20px; border-radius: 12px 12px 0 0;">
                   <h1 style="color: white; margin: 0; font-size: 24px;">Team Lead Purchase</h1>
                 </div>
                 <div style="background: #1f2937; padding: 24px; border-radius: 0 0 12px 12px;">
                   <p style="color: #9ca3af; margin: 0 0 16px;">Hi ${managerProfile.full_name || "Manager"},</p>
                   <p style="color: #9ca3af; margin: 0 0 16px;">One of your team members has initiated a lead purchase:</p>
                   
                   <div style="background: #374151; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                     <p style="color: white; margin: 0 0 8px;"><strong>Agent:</strong> ${purchaserName}</p>
                     <p style="color: white; margin: 0 0 8px;"><strong>Package:</strong> ${packageName}</p>
                     <p style="color: white; margin: 0;"><strong>Amount:</strong> $${price}/week</p>
                   </div>
                   
                   <p style="color: #9ca3af; margin: 0; font-size: 12px;">
                     ${timestamp} CST
                   </p>
                 </div>
                 <p style="color: #6b7280; font-size: 11px; text-align: center; margin-top: 16px;">
                   Powered by Apex Financial
                 </p>
               </div>
             `,
           });
         }
       }
     }
 
     // 3. Purchaser confirmation
     emailsToSend.push({
       to: purchaserEmail,
       subject: `✅ Lead Purchase Initiated: ${packageName}`,
       html: `
         <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
           <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 12px 12px 0 0;">
             <h1 style="color: white; margin: 0; font-size: 24px;">Purchase Initiated</h1>
           </div>
           <div style="background: #1f2937; padding: 24px; border-radius: 0 0 12px 12px;">
             <p style="color: #9ca3af; margin: 0 0 16px;">Hi ${purchaserName},</p>
             <p style="color: #9ca3af; margin: 0 0 16px;">Thank you for investing in your pipeline! Here's your purchase summary:</p>
             
             <div style="background: #374151; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
               <p style="color: white; margin: 0 0 8px;"><strong>Package:</strong> ${packageName}</p>
               <p style="color: white; margin: 0 0 8px;"><strong>Amount:</strong> $${price}/week</p>
               <p style="color: white; margin: 0;"><strong>Payment Method:</strong> ${paymentMethod === "venmo" ? "Venmo" : "Cash App"}</p>
             </div>
             
             <p style="color: #9ca3af; margin: 0 0 16px;">
               <strong>Next Steps:</strong><br>
               Complete your payment via ${paymentMethod === "venmo" ? "Venmo" : "Cash App"} if you haven't already.
               Remember to type <strong>"leads"</strong> in the payment note field.
             </p>
             
             <p style="color: #9ca3af; margin: 0; font-size: 12px;">
               Your leads will be delivered once payment is confirmed. Questions? Reply to this email.
             </p>
           </div>
           <p style="color: #6b7280; font-size: 11px; text-align: center; margin-top: 16px;">
             Powered by Apex Financial
           </p>
         </div>
       `,
     });
 
     // Send all emails
     for (const email of emailsToSend) {
       try {
          await resend.emails.send({
            from: "APEX Financial <notifications@tx.apex-financial.org>",
            to: [email.to],
            subject: email.subject,
            html: email.html,
          });
         console.log(`Email sent to ${email.to}`);
       } catch (emailError) {
         console.error(`Failed to send email to ${email.to}:`, emailError);
       }
     }
 
     return new Response(
       JSON.stringify({ success: true, emailsSent: emailsToSend.length }),
       {
         status: 200,
         headers: { "Content-Type": "application/json", ...corsHeaders },
       }
     );
   } catch (error) {
     console.error("Error in notify-lead-purchase:", error);
     return new Response(
       JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
       {
         status: 500,
         headers: { "Content-Type": "application/json", ...corsHeaders },
       }
     );
   }
 });