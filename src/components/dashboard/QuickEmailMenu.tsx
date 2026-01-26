import { useState } from "react";
import { Mail, Loader2, ChevronDown } from "lucide-react";
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

interface QuickEmailMenuProps {
  applicationId: string;
  agentId: string | null;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  onEmailSent?: () => void;
  className?: string;
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
  | "schedule_consultation";

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
};

export function QuickEmailMenu({
  applicationId,
  agentId,
  licenseStatus,
  onEmailSent,
  className,
}: QuickEmailMenuProps) {
  const [sendingTemplate, setSendingTemplate] = useState<EmailTemplate | null>(null);
  const [showAllTemplates, setShowAllTemplates] = useState(false);

  const handleSendEmail = async (templateType: EmailTemplate) => {
    setSendingTemplate(templateType);
    try {
      const { error } = await supabase.functions.invoke("send-outreach-email", {
        body: { applicationId, agentId, templateType },
      });

      if (error) throw error;

      toast.success(`${emailTemplateLabels[templateType]} email sent!`);
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
    ? ["cold_licensed", "followup1_licensed", "followup2_licensed"]
    : ["cold_unlicensed", "followup1_unlicensed", "followup2_unlicensed", "licensing_reminder", "licensing_checkin"];

  // All templates
  const allTemplates: EmailTemplate[] = [
    "cold_licensed", 
    "cold_unlicensed", 
    "followup1_licensed", 
    "followup2_licensed",
    "followup1_unlicensed",
    "followup2_unlicensed",
    "licensing_reminder",
    "licensing_checkin",
    "course_help",
    "schedule_consultation",
  ];

  const templatesToShow = showAllTemplates ? allTemplates : contextualTemplates;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          disabled={sendingTemplate !== null}
        >
          {sendingTemplate ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Mail className="h-4 w-4 mr-1" />
          )}
          Email
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Quick Email Templates
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {templatesToShow.map((template) => (
          <DropdownMenuItem
            key={template}
            onClick={() => handleSendEmail(template)}
            disabled={sendingTemplate !== null}
            className="flex items-center gap-2"
          >
            {sendingTemplate === template && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            <span className="flex-1">{emailTemplateLabels[template]}</span>
            {/* Show indicator if template doesn't match current license status */}
            {!showAllTemplates ? null : (
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
  );
}
