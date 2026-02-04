import { useState, useEffect } from "react";
import { Loader2, Mail, Send, UserPlus, Copy, Check, Link2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface SavedLink {
  id: string;
  name: string;
  url: string;
}

interface InviteTeamModalProps {
  open: boolean;
  onClose: () => void;
}

export function InviteTeamModal({ open, onClose }: InviteTeamModalProps) {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  // New fields
  const [licenseStatus, setLicenseStatus] = useState<"licensed" | "unlicensed">("unlicensed");
  const [sendCourse, setSendCourse] = useState(true);
  
  // Contracting links
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (open && user) {
      fetchCurrentAgent();
      fetchSavedLinks();
    }
  }, [open, user]);

  const fetchCurrentAgent = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (data) setCurrentAgentId(data.id);
  };

  const fetchSavedLinks = async () => {
    if (!user) return;
    setLoadingLinks(true);
    try {
      const { data: agent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .single();
      
      if (agent) {
        const { data: links } = await supabase
          .from("contracting_links")
          .select("*")
          .eq("manager_id", agent.id)
          .order("created_at", { ascending: false });
        
        setSavedLinks(links || []);
      }
    } catch (error) {
      console.error("Error fetching links:", error);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleSaveLink = async () => {
    if (!newLinkName.trim() || !newLinkUrl.trim() || !currentAgentId) {
      toast.error("Please enter a name and URL");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("contracting_links")
        .insert({
          manager_id: currentAgentId,
          name: newLinkName.trim(),
          url: newLinkUrl.trim(),
        })
        .select()
        .single();

      if (error) throw error;

      setSavedLinks(prev => [data, ...prev]);
      setNewLinkName("");
      setNewLinkUrl("");
      toast.success("Link saved!");
    } catch (error: any) {
      console.error("Error saving link:", error);
      toast.error("Failed to save link");
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      const { error } = await supabase
        .from("contracting_links")
        .delete()
        .eq("id", linkId);

      if (error) throw error;

      setSavedLinks(prev => prev.filter(l => l.id !== linkId));
      toast.success("Link deleted");
    } catch (error) {
      console.error("Error deleting link:", error);
      toast.error("Failed to delete link");
    }
  };

  const handleInvite = async () => {
    if (!email.trim() || !fullName.trim()) {
      toast.error("Name and email are required");
      return;
    }

    setIsSubmitting(true);
    try {
      // Get current user's agent ID
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user?.id)
        .single();

      if (!currentAgent) {
        throw new Error("Unable to find your agent profile");
      }

      // Create a UUID for the new agent
      const newUserId = crypto.randomUUID();
      const newProfileId = crypto.randomUUID();

      // Create profile
      const { error: profileError } = await supabase
        .from("profiles")
        .insert({
          id: newProfileId,
          user_id: newUserId,
          email: email.trim(),
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        });

      if (profileError) throw profileError;

      // Create agent record - set stage based on license status
      const onboardingStage = licenseStatus === "licensed" && !sendCourse 
        ? "evaluated" 
        : "onboarding";
      
      const { data: newAgent, error: agentError } = await supabase
        .from("agents")
        .insert({
          user_id: newUserId,
          profile_id: newProfileId,
          status: "active",
          license_status: licenseStatus,
          invited_by_manager_id: currentAgent.id,
          onboarding_stage: onboardingStage,
          has_training_course: sendCourse,
        })
        .select("id")
        .single();

      if (agentError) throw agentError;

      // Generate magic login link
      const { data: linkData, error: linkError } = await supabase.functions.invoke(
        "generate-magic-link",
        {
          body: {
            email: email.trim(),
            agentId: newAgent.id,
            destination: sendCourse ? "course" : "portal",
          },
        }
      );

      if (linkError) throw linkError;

      const magicLink = linkData?.magicLink || `${window.location.origin}/agent-portal`;
      setGeneratedLink(magicLink);

      // Send welcome email with onboarding flow (Contracting + Course)
      // Discord link will be sent after course completion
      await supabase.functions.invoke("welcome-new-agent", {
        body: {
          agentName: fullName.trim(),
          agentEmail: email.trim(),
          agentId: newAgent.id,
          managerId: currentAgent.id,
          courseLink: magicLink,
        },
      });

      toast.success(`Invite sent to ${fullName}!`);
    } catch (err: any) {
      console.error("Failed to invite:", err);
      toast.error(err.message || "Failed to send invite");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setEmail("");
    setFullName("");
    setPhone("");
    setGeneratedLink(null);
    setCopied(false);
    setLicenseStatus("unlicensed");
    setSendCourse(true);
    setShowLinkSection(false);
    setNewLinkName("");
    setNewLinkUrl("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Invite Team Member
          </DialogTitle>
          <DialogDescription>
            Create a portal login and send it to your new team member.
          </DialogDescription>
        </DialogHeader>

        {generatedLink ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium mb-2">
                ✓ Invite sent successfully!
              </p>
              <p className="text-xs text-muted-foreground">
                An email with portal access has been sent to {email}.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Magic Login Link</Label>
              <div className="flex gap-2">
                <Input
                  value={generatedLink}
                  readOnly
                  className="text-xs font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Basic Info */}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                placeholder="John Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {/* License Status */}
            <div className="space-y-2">
              <Label>License Status</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={licenseStatus === "licensed" ? "default" : "outline"}
                  onClick={() => setLicenseStatus("licensed")}
                  className="flex-1"
                >
                  Licensed
                </Button>
                <Button
                  type="button"
                  variant={licenseStatus === "unlicensed" ? "default" : "outline"}
                  onClick={() => setLicenseStatus("unlicensed")}
                  className="flex-1"
                >
                  Unlicensed
                </Button>
              </div>
            </div>

            {/* Send Course Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <Label htmlFor="sendCourse" className="font-medium">Send Onboarding Course</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically enroll in training
                </p>
              </div>
              <Switch
                id="sendCourse"
                checked={sendCourse}
                onCheckedChange={setSendCourse}
              />
            </div>

            {/* Saved Contracting Links Section */}
            <Collapsible open={showLinkSection} onOpenChange={setShowLinkSection}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    Contracting Links
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {savedLinks.length} saved
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {/* Add new link */}
                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <Input
                    placeholder="Link name (e.g., SilverScript)"
                    value={newLinkName}
                    onChange={(e) => setNewLinkName(e.target.value)}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://..."
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      size="icon"
                      onClick={handleSaveLink}
                      disabled={!newLinkName.trim() || !newLinkUrl.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Saved links list */}
                {loadingLinks ? (
                  <div className="text-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                ) : savedLinks.length > 0 ? (
                  <div className="space-y-1">
                    {savedLinks.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Link2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium truncate">{link.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              navigator.clipboard.writeText(link.url);
                              toast.success("Link copied!");
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteLink(link.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    No saved links yet
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleInvite}
                disabled={isSubmitting || !email.trim() || !fullName.trim()}
                className="flex-1 gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send Invite
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
