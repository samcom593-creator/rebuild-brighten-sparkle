import { useState } from "react";
import { Mail, Loader2, ChevronDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EmailPreviewModal } from "./EmailPreviewModal";

interface QuickEmailMenuProps {
  applicationId: string;
  agentId: string | null;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  recipientEmail: string;
  recipientName: string;
  leadSource?: "aged_leads" | "applications";
  onEmailSent?: () => void;
  className?: string;
  /** "full" shows icon+label; "icon" shows icon-only with fixed target size */
  displayMode?: "full" | "icon";
}

type EmailTemplate = 
  | "cold_licensed" 
  | "cold_unlicensed" 
  | "followup1_licensed" 
  | "followup2_licensed"
  | "followup1_unlicensed"
  | "followup2_unlicensed"
  | "licensing_reminder"
  | "licensing_checkin"
  | "course_help"
  | "schedule_consultation"
  | "couldnt_reach_you";

const emailTemplateLabels: Record<EmailTemplate, string> = {
  cold_licensed: "Cold Outreach (Licensed)",
  cold_unlicensed: "Cold Outreach (Unlicensed)",
  followup1_licensed: "Post-call Follow-up #1",
  followup2_licensed: "Post-call Follow-up #2",
  followup1_unlicensed: "Licensing Progress Check",
  followup2_unlicensed: "Opportunity Reminder",
  licensing_reminder: "License Reminder",
  licensing_checkin: "Check-in (Need Help?)",
  course_help: "Course Help Request",
  schedule_consultation: "Schedule Consultation",
  couldnt_reach_you: "Couldn't Reach You",
};

// Sample email content for preview (would ideally come from backend)
const getEmailContent = (template: EmailTemplate, name: string): { subject: string; html: string } => {
  const firstName = name.split(" ")[0];
  
  const templates: Record<EmailTemplate, { subject: string; html: string }> = {
    cold_licensed: {
      subject: `${firstName}, Let's Talk About Your Insurance Career`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>I noticed you're already licensed – that's a huge advantage! At Apex Financial, we help licensed agents maximize their earning potential with our proven systems.</p><p>Would you be open to a quick 15-minute call to explore if we might be a good fit?</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    cold_unlicensed: {
      subject: `${firstName}, Start Your Insurance Career with Us`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Thank you for your interest in joining Apex Financial! We help people just like you break into the insurance industry and build successful careers.</p><p>The first step is getting licensed. Would you like to learn more about our training program?</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    followup1_licensed: {
      subject: `Following Up - Ready to Grow Your Book?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Just following up on our conversation. I wanted to share some success stories from agents who've joined our team recently.</p><p>When would be a good time to continue our discussion?</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    followup2_licensed: {
      subject: `${firstName}, Don't Miss This Opportunity`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>I wanted to reach out one more time. Our team is growing and we'd love to have you join us.</p><p>Let me know if you have any questions!</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    followup1_unlicensed: {
      subject: `How's Your Licensing Progress Going?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Just checking in on your licensing progress. Have you had a chance to start the pre-licensing course?</p><p>Let me know if you need any guidance – we're here to help!</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    followup2_unlicensed: {
      subject: `${firstName}, This Could Change Your Career`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>I wanted to remind you about the opportunity waiting for you at Apex Financial.</p><p>Getting licensed is the first step to a rewarding career in insurance. Ready to take that step?</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    licensing_reminder: {
      subject: `Reminder: Complete Your Licensing`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>This is a friendly reminder to continue working on your insurance license.</p><p>Once you're licensed, you can start earning right away!</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    licensing_checkin: {
      subject: `Need Help With Licensing?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Just checking in to see if you need any help with the licensing process.</p><p>Our team is here to support you every step of the way!</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    course_help: {
      subject: `Need Help With Your Training?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>I noticed you might need some help with the training course.</p><p>Let me know what questions you have – I'm here to help!</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    schedule_consultation: {
      subject: `Let's Schedule a Call`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>I'd love to schedule a quick consultation call to discuss your career goals.</p><p>What time works best for you this week?</p><p>Best,<br/>Apex Financial Team</p></body></html>`,
    },
    couldnt_reach_you: {
      subject: `${firstName}, We Tried to Call You! 📞`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background-color:#f9fafb;"><div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.05);"><h2 style="color:#14b8a6;margin:0 0 16px 0;">Hey ${firstName}!</h2><p style="color:#374151;line-height:1.6;margin:0 0 16px 0;">We tried reaching out to you today about the opportunity at <strong>Apex Financial</strong>, but we couldn't get through to your number.</p><p style="color:#374151;line-height:1.6;margin:0 0 16px 0;">No worries—we still want to connect! Here's what you can do:</p><ul style="color:#374151;line-height:1.8;margin:0 0 24px 0;padding-left:20px;"><li>✓ Reply to this email with your best phone number</li><li>✓ Or schedule a time that works for you below</li></ul><div style="text-align:center;margin:24px 0;"><a href="https://calendly.com/apexlifeadvisors/15min" style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;">Schedule a Call</a></div><p style="color:#6b7280;font-size:14px;margin:24px 0 0 0;">Talk soon,<br/><strong style="color:#111827;">Apex Financial Team</strong></p></div></body></html>`,
    },
  };
  
  return templates[template];
};

export function QuickEmailMenu({
  applicationId,
  agentId,
  licenseStatus,
  recipientEmail,
  recipientName,
  leadSource = "applications",
  onEmailSent,
  className,
  displayMode = "full",
}: QuickEmailMenuProps) {
  const [sendingTemplate, setSendingTemplate] = useState<EmailTemplate | null>(null);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [previewContent, setPreviewContent] = useState<{ subject: string; html: string }>({ subject: "", html: "" });

  const handlePreviewEmail = (templateType: EmailTemplate) => {
    const content = getEmailContent(templateType, recipientName);
    setSelectedTemplate(templateType);
    setPreviewContent(content);
    setPreviewOpen(true);
  };

  const handleSendEmail = async (customSubject?: string, customBody?: string) => {
    if (!selectedTemplate) return;
    
    setSendingTemplate(selectedTemplate);
    try {
      const { error } = await supabase.functions.invoke("send-outreach-email", {
        body: { 
          applicationId, 
          agentId, 
          templateType: selectedTemplate,
          customSubject,
          customBody,
          leadSource,
        },
      });

      if (error) throw error;

      toast.success(`${emailTemplateLabels[selectedTemplate]} email sent!`);
      setPreviewOpen(false);
      onEmailSent?.();
    } catch (err) {
      console.error("Failed to send email:", err);
      toast.error("Failed to send email");
    } finally {
      setSendingTemplate(null);
    }
  };

  // Determine which templates to show based on license status
  const isLicensed = licenseStatus === "licensed";

  // Contextual templates (shown by default)
  const contextualTemplates: EmailTemplate[] = isLicensed 
    ? ["cold_licensed", "followup1_licensed", "followup2_licensed", "couldnt_reach_you"]
    : ["cold_unlicensed", "followup1_unlicensed", "followup2_unlicensed", "couldnt_reach_you", "licensing_reminder", "licensing_checkin"];

  // All templates
  const allTemplates: EmailTemplate[] = [
    "cold_licensed", 
    "cold_unlicensed", 
    "followup1_licensed", 
    "followup2_licensed",
    "followup1_unlicensed",
    "followup2_unlicensed",
    "couldnt_reach_you",
    "licensing_reminder",
    "licensing_checkin",
    "course_help",
    "schedule_consultation",
  ];

  const templatesToShow = showAllTemplates ? allTemplates : contextualTemplates;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={displayMode === "icon" ? "ghost" : "ghost"}
            size={displayMode === "icon" ? "icon" : "sm"}
            className={cn(displayMode === "icon" && "h-8 w-8", className)}
            disabled={sendingTemplate !== null}
            aria-label="Email templates"
            title="Email templates"
          >
            {sendingTemplate ? (
              <Loader2 className={cn("h-4 w-4 animate-spin", displayMode === "full" && "mr-1")} />
            ) : (
              <Mail className={cn("h-4 w-4", displayMode === "full" && "mr-1")} />
            )}
            {displayMode === "full" && "Email"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Quick Email Templates (Preview & Edit)
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {templatesToShow.map((template) => (
            <DropdownMenuItem
              key={template}
              onClick={() => handlePreviewEmail(template)}
              disabled={sendingTemplate !== null}
              className="flex items-center gap-2"
            >
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{emailTemplateLabels[template]}</span>
              {/* Show indicator if template doesn't match current license status */}
              {showAllTemplates && (
                template.includes("licensed") && !template.includes("unlicensed") && !isLicensed ? (
                  <span className="text-xs text-muted-foreground">(Licensed)</span>
                ) : template.includes("unlicensed") && isLicensed ? (
                  <span className="text-xs text-muted-foreground">(Unlicensed)</span>
                ) : null
              )}
            </DropdownMenuItem>
          ))}

          {/* Toggle to show all templates */}
          {!showAllTemplates && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  setShowAllTemplates(true);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="h-3 w-3 mr-1" />
                Show all templates
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Email Preview Modal */}
      <EmailPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        templateName={selectedTemplate ? emailTemplateLabels[selectedTemplate] : ""}
        subject={previewContent.subject}
        htmlContent={previewContent.html}
        recipientEmail={recipientEmail}
        recipientName={recipientName}
        onSend={handleSendEmail}
        isSending={sendingTemplate !== null}
      />
    </>
  );
}
