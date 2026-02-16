import { useState, useEffect } from "react";
import { Loader2, Link as LinkIcon, CheckCircle, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ContractedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    license_status: "licensed" | "unlicensed" | "pending";
    license_progress?: "unlicensed" | "course_purchased" | "passed_test" | "waiting_on_license" | "licensed" | null;
    source?: "applications" | "aged_leads";
  };
  agentId: string;
  onSuccess?: () => void;
}

export function ContractedModal({
  open,
  onOpenChange,
  application,
  agentId,
  onSuccess,
}: ContractedModalProps) {
  const [crmLink, setCrmLink] = useState("");
  const [savedLink, setSavedLink] = useState<string | null>(null);
  const [useSavedLink, setUseSavedLink] = useState(false);
  const [saveForNextTime, setSaveForNextTime] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [alreadyContracted, setAlreadyContracted] = useState(false);

  // Fetch manager's saved CRM link on mount
  useEffect(() => {
    const fetchSavedLink = async () => {
      if (!agentId) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("agents")
          .select("crm_setup_link")
          .eq("id", agentId)
          .single();

        if (!error && data?.crm_setup_link) {
          setSavedLink(data.crm_setup_link);
          setUseSavedLink(true);
          setCrmLink(data.crm_setup_link);
        }
      } catch (err) {
        console.error("Error fetching saved link:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (open) {
      fetchSavedLink();
    }
  }, [open, agentId]);

  const handleSubmit = async () => {
    const linkToUse = useSavedLink && savedLink ? savedLink : crmLink;
    
    if (!alreadyContracted && !linkToUse.trim()) {
      toast.error("Please enter a CRM setup link");
      return;
    }

    setIsSubmitting(true);
    try {
      let newAgentId: string | null = null;

      if (alreadyContracted) {
        // Skip agent creation — just look up existing agent by email
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", application.email)
          .maybeSingle();

        if (!existingProfile?.user_id) {
          toast.error("No existing agent found for this email. Uncheck 'Already contracted' to create one.");
          return;
        }

        const { data: existingAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", existingProfile.user_id)
          .maybeSingle();

        if (!existingAgent?.id) {
          toast.error("No existing agent record found. Uncheck 'Already contracted' to create one.");
          return;
        }

        newAgentId = existingAgent.id;
      } else {
        // Determine license status
        const finalLicenseStatus = 
          application.license_progress === "licensed" 
            ? "licensed" 
            : application.license_status;

        // 1. Create agent via the add-agent edge function
        const { data: addAgentResult, error: addAgentError } = await supabase.functions.invoke("add-agent", {
          body: {
            firstName: application.first_name,
            lastName: application.last_name,
            email: application.email,
            phone: application.phone,
            managerId: agentId,
            licenseStatus: finalLicenseStatus,
            crmSetupLink: linkToUse,
            hasTrainingCourse: true,
          },
        });

        if (addAgentError || !addAgentResult?.success) {
          const errorMsg = addAgentResult?.error || addAgentError?.message || "Failed to create agent";
          console.error("Add agent error:", errorMsg);
          toast.error(errorMsg);
          return;
        }

        newAgentId = addAgentResult.agentId;
      }

      // 2. Mark application as contracted based on source
      const isAgedLead = application.source === "aged_leads";
      
      if (isAgedLead) {
        const { error: updateError } = await supabase
          .from("aged_leads")
          .update({ 
            status: "contracted",
            processed_at: new Date().toISOString(),
          })
          .eq("id", application.id);
        if (updateError) throw updateError;
      } else {
        const { error: updateError } = await supabase
          .from("applications")
          .update({ 
            status: "contracting" as any,
            contracted_at: new Date().toISOString(),
            closed_at: new Date().toISOString(),
          })
          .eq("id", application.id);
        if (updateError) throw updateError;
      }

      // 3. Save CRM link for future use if requested
      if (!alreadyContracted && saveForNextTime && !useSavedLink) {
        await supabase
          .from("agents")
          .update({ crm_setup_link: linkToUse })
          .eq("id", agentId);
      }

      // 4. Send contracted email with CRM link (skip for already contracted)
      if (!alreadyContracted) {
        const { error: emailError } = await supabase.functions.invoke("notify-agent-contracted", {
          body: {
            applicationId: application.id,
            agentId,
            crmSetupLink: linkToUse,
          },
        });

        if (emailError) {
          console.error("Email send error:", emailError);
          toast.warning("Agent contracted but email notification failed");
        } else {
          toast.success(`${application.first_name} contracted and added to CRM!`);
        }

        // Notify all managers about the contract
        supabase.functions.invoke("notify-hire-announcement", {
          body: {
            hirerName: "Manager",
            hireeName: `${application.first_name} ${application.last_name}`,
            actionType: "contracted",
          },
        }).catch(err => console.error("Failed to send hire announcement:", err));
      } else {
        toast.success(`${application.first_name} enrolled in coursework!`);
      }

      // Send course enrollment email (add-agent already sets has_training_course)
      if (newAgentId) {
        // For "already contracted" agents, ensure has_training_course is set
        if (alreadyContracted) {
          const { error: courseErr } = await supabase
            .from("agents")
            .update({ has_training_course: true, onboarding_stage: "training_online" as any })
            .eq("id", newAgentId);
          if (courseErr) console.error("Failed to set has_training_course:", courseErr);
        }

        const { error: enrollErr } = await supabase.functions.invoke("send-course-enrollment-email", {
          body: { agentId: newAgentId },
        });
        if (enrollErr) console.error("Failed to send course enrollment email:", enrollErr);
        else console.log("Course enrollment email sent for agent", newAgentId);
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Error contracting agent:", error);
      toast.error("Failed to contract agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkModeChange = (useExisting: boolean) => {
    setUseSavedLink(useExisting);
    if (useExisting && savedLink) {
      setCrmLink(savedLink);
    } else {
      setCrmLink("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            Contract {application.first_name} {application.last_name}
          </DialogTitle>
          <DialogDescription>
            This will mark the applicant as contracted and send them an email with CRM setup instructions.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Already Contracted Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
              <div className="space-y-0.5">
                <Label htmlFor="already-contracted" className="text-sm font-medium cursor-pointer">
                  Already contracted
                </Label>
                <p className="text-xs text-muted-foreground">
                  Skip agent creation — just enroll in coursework
                </p>
              </div>
              <Switch
                id="already-contracted"
                checked={alreadyContracted}
                onCheckedChange={setAlreadyContracted}
              />
            </div>

            {!alreadyContracted && (
              <>
            {/* Saved link option */}
            {savedLink && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">CRM Setup Link</Label>
                
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant={useSavedLink ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleLinkModeChange(true)}
                    className="flex-1"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Use Saved Link
                  </Button>
                  <Button
                    type="button"
                    variant={!useSavedLink ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleLinkModeChange(false)}
                    className="flex-1"
                  >
                    <LinkIcon className="h-4 w-4 mr-2" />
                    New Link
                  </Button>
                </div>

                {useSavedLink && (
                  <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 break-all">
                    {savedLink}
                  </div>
                )}
              </div>
            )}

            {/* New link input */}
            {(!savedLink || !useSavedLink) && (
              <div className="space-y-2">
                <Label htmlFor="crm-link">CRM Setup Link</Label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="crm-link"
                    placeholder="https://..."
                    value={crmLink}
                    onChange={(e) => setCrmLink(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This link will be sent to {application.first_name} to set up their CRM access.
                </p>
              </div>
            )}

            {/* Save for next time */}
            {!savedLink && crmLink && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="save-link"
                  checked={saveForNextTime}
                  onCheckedChange={(checked) => setSaveForNextTime(checked === true)}
                />
                <Label htmlFor="save-link" className="text-sm cursor-pointer">
                  Save this link for next time
                </Label>
              </div>
            )}
            </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || isLoading}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Contracting...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Contract & Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
