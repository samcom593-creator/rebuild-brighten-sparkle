import { useState } from "react";
import { Loader2, Mail, Send, UserPlus, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";

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

      // Create agent record with status LIVE
      const { data: newAgent, error: agentError } = await supabase
        .from("agents")
        .insert({
          user_id: newUserId,
          profile_id: newProfileId,
          status: "active",
          invited_by_manager_id: currentAgent.id,
          onboarding_stage: "onboarding",
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
            destination: "portal",
          },
        }
      );

      if (linkError) throw linkError;

      const magicLink = linkData?.magicLink || `${window.location.origin}/agent-portal`;
      setGeneratedLink(magicLink);

      // Send welcome email with portal link
      await supabase.functions.invoke("send-agent-portal-login", {
        body: {
          email: email.trim(),
          name: fullName.trim(),
          magicLink,
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
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
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
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <p className="text-sm text-green-600 font-medium mb-2">
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
