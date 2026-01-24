import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
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

type EmailTemplate = "cold_licensed" | "cold_unlicensed" | "followup1_licensed" | "followup2_licensed";

const emailTemplateLabels: Record<EmailTemplate, string> = {
  cold_licensed: "Cold Outreach (Licensed)",
  cold_unlicensed: "Cold Outreach (Unlicensed)",
  followup1_licensed: "Post-call Follow-up #1 (Licensed)",
  followup2_licensed: "Post-call Follow-up #2 (Licensed)",
};

export function QuickEmailMenu({
  applicationId,
  agentId,
  licenseStatus,
  onEmailSent,
  className,
}: QuickEmailMenuProps) {
  const [sendingTemplate, setSendingTemplate] = useState<EmailTemplate | null>(null);

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
        
        {isLicensed ? (
          <>
            <DropdownMenuItem
              onClick={() => handleSendEmail("cold_licensed")}
              disabled={sendingTemplate !== null}
            >
              {sendingTemplate === "cold_licensed" && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Cold Outreach (Licensed)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSendEmail("followup1_licensed")}
              disabled={sendingTemplate !== null}
            >
              {sendingTemplate === "followup1_licensed" && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Post-call Follow-up #1 (Licensed)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSendEmail("followup2_licensed")}
              disabled={sendingTemplate !== null}
            >
              {sendingTemplate === "followup2_licensed" && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Post-call Follow-up #2 (Licensed)
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            onClick={() => handleSendEmail("cold_unlicensed")}
            disabled={sendingTemplate !== null}
          >
            {sendingTemplate === "cold_unlicensed" && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Cold Outreach (Unlicensed)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
