import { useState } from "react";
import { cn } from "@/lib/utils";
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
import { invokeEdge } from "@/lib/edgeInvoke";
import { toast } from "sonner";
import { EmailPreviewModal } from "./EmailPreviewModal";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";

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

// Email templates for outreach
const getEmailContent = (
  template: EmailTemplate,
  name: string,
  licenseStatus: QuickEmailMenuProps["licenseStatus"],
): { subject: string; html: string } => {
  const firstName = name.split(" ")[0];
  const callbackLink = licenseStatus === "licensed" ? SCHEDULING_LINKS.licensed : SCHEDULING_LINKS.unlicensed;
  
  const templates: Record<EmailTemplate, { subject: string; html: string }> = {
    cold_licensed: {
      subject: `${firstName} — warm leads, weekly pay, no lead fees`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Saw you're already licensed. Quick pitch: APEX gives warm leads at no cost, pays weekly, and won't lock you out of your book.</p><p>If that's interesting, hit reply with a time this week or grab one here: <a href="${callbackLink}">${callbackLink}</a></p><p>If not, ignore this — no follow-up spam.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    cold_unlicensed: {
      subject: `${firstName} — APEX pays your licensing if you're serious`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>You applied to APEX but you're not licensed yet. That's fine — most of our top producers started there.</p><p>What APEX covers: pre-licensing course, study path, exam timeline. What you do: pass the test, then we plug you into warm leads and weekly pay.</p><p>Reply with where you are in the process, or book a 15-min call: <a href="${callbackLink}">${callbackLink}</a></p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    followup1_licensed: {
      subject: `Quick follow-up, ${firstName}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Following up from our last conversation. Two new agents wrote $5K in their first week last month — both came from where you're sitting right now.</p><p>If you're still open, grab a time: <a href="${callbackLink}">${callbackLink}</a></p><p>If timing's off, just tell me when to check back.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    followup2_licensed: {
      subject: `Last check, ${firstName}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Last note from me. If APEX isn't the right fit or the timing's wrong, no offense taken — just reply "not now" and I'll stop the thread.</p><p>If you want to talk: <a href="${callbackLink}">${callbackLink}</a></p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    followup1_unlicensed: {
      subject: `Where are you on licensing, ${firstName}?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Checking on your pre-licensing progress. Stuck on a chapter, haven't started, scheduled the exam — wherever you are, tell me and I'll point you at the next step.</p><p>Reply with one of: not started / mid-course / ready to test / passed.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    followup2_unlicensed: {
      subject: `${firstName} — still want to write?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>You applied a while back to write life insurance with APEX. Haven't seen progress on licensing.</p><p>If you still want this, reply with the date you'll have the course done. If not, say so and I'll close your file.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    licensing_reminder: {
      subject: `${firstName} — your licensing course is waiting`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Your pre-licensing course is paid for and sitting there. The longer it sits, the more material you re-read on attempt #2.</p><p>Set a target exam date this week and reply with it. I'll hold you to it.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    licensing_checkin: {
      subject: `Need Help With Licensing?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Quick check — where are you in the licensing process?</p><p>If you're stuck on a section or need a study plan, hit reply and I'll get you moving.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    course_help: {
      subject: `Stuck on the course, ${firstName}?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Looks like the course slowed down on your end. Tell me which chapter or section is the wall and I'll send you the way through it.</p><p>Reply with the chapter title or screenshot the page you're stuck on.</p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    schedule_consultation: {
      subject: `15 minutes, ${firstName}?`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;"><h2>Hi ${firstName},</h2><p>Let's do 15 minutes this week. I'll walk you through how APEX actually works — lead flow, comp, what week-one looks like — and you tell me if it's a fit.</p><p>Grab a slot: <a href="${callbackLink}">${callbackLink}</a></p><p>— Sam<br/>APEX Financial</p></body></html>`,
    },
    couldnt_reach_you: {
      subject: `${firstName} — tried to call, didn't get through`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background-color:#f9fafb;"><div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.05);"><h2 style="color:#14b8a6;margin:0 0 16px 0;">Hi ${firstName},</h2><p style="color:#374151;line-height:1.6;margin:0 0 16px 0;">Tried you today about the APEX opportunity — couldn't get through.</p><p style="color:#374151;line-height:1.6;margin:0 0 16px 0;">Two options:</p><ul style="color:#374151;line-height:1.8;margin:0 0 24px 0;padding-left:20px;"><li>Reply with the best number + time to call</li><li>Or book a slot directly:</li></ul><div style="text-align:center;margin:24px 0;"><a href="${callbackLink}" style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;">Pick a time</a></div><p style="color:#6b7280;font-size:14px;margin:24px 0 0 0;">— Sam<br/><strong style="color:#111827;">APEX Financial</strong></p></div></body></html>`,
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
    const content = getEmailContent(templateType, recipientName, licenseStatus);
    setSelectedTemplate(templateType);
    setPreviewContent(content);
    setPreviewOpen(true);
  };

  const handleSendEmail = async (customSubject?: string, customBody?: string) => {
    if (!selectedTemplate) return;

    if (!applicationId) {
      toast.error("Cannot send email: no lead ID found. Try refreshing the page.");
      return;
    }
    
    setSendingTemplate(selectedTemplate);
    try {
      await invokeEdge("send-outreach-email", {
        applicationId, 
        agentId, 
        templateType: selectedTemplate,
        customSubject,
        customBody,
        leadSource,
      });

      toast.success(`${emailTemplateLabels[selectedTemplate]} email sent!`);
      setPreviewOpen(false);
      onEmailSent?.();
    } catch (err: any) {
      console.error("Failed to send email:", err);
      toast.error(err.message || "Failed to send email");
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
        <DropdownMenuContent align="end" className="w-64 z-50">
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
