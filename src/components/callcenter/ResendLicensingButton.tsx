import { useState } from "react";
import { GraduationCap, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ResendLicensingButtonProps {
  recipientEmail: string;
  recipientName: string;
  licenseStatus: "licensed" | "unlicensed" | "pending";
}

export function ResendLicensingButton({
  recipientEmail,
  recipientName,
  licenseStatus,
}: ResendLicensingButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const handleSend = async () => {
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-licensing-instructions",
        {
          body: {
            email: recipientEmail,
            firstName: recipientName,
            licenseStatus: licenseStatus,
          },
        }
      );

      if (error) throw error;

      setJustSent(true);
      toast({
        title: "Email Sent!",
        description: `Licensing instructions sent to ${recipientEmail}`,
      });

      // Reset after 3 seconds
      setTimeout(() => setJustSent(false), 3000);
    } catch (error: any) {
      console.error("Failed to send licensing email:", error);
      toast({
        title: "Failed to Send",
        description: error.message || "Could not send licensing email",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const tooltipText =
    licenseStatus === "licensed"
      ? "Send onboarding steps & Calendly link"
      : "Send licensing video, guide, and course link";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={handleSend}
            disabled={isSending}
            className={
              justSent
                ? "border-green-500/50 text-green-400 hover:text-green-300"
                : "border-primary/30 text-primary hover:text-primary hover:border-primary/50"
            }
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : justSent ? (
              <Check className="h-4 w-4" />
            ) : (
              <GraduationCap className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{justSent ? "Sent!" : tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
