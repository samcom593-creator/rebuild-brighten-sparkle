import { useState } from "react";
import { Instagram, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InstagramPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  onComplete?: () => void;
}

export function InstagramPromptDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  onComplete,
}: InstagramPromptDialogProps) {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!handle.trim()) {
      handleSkip();
      return;
    }

    setLoading(true);
    try {
      // Get the agent's user_id to update their profile
      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();

      if (agent?.user_id) {
        const { error } = await supabase
          .from("profiles")
          .update({ instagram_handle: handle.replace("@", "") })
          .eq("user_id", agent.user_id);

        if (error) throw error;

        toast.success("Instagram handle saved!");
      }

      onComplete?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Error saving Instagram handle:", err);
      toast.error("Failed to save Instagram handle");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onComplete?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            Welcome to the Team! 🎉
          </DialogTitle>
          <DialogDescription>
            {agentName} is now LIVE! Would you like to add their Instagram handle for team visibility?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram Handle (Optional)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="instagram"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace("@", ""))}
                placeholder="username"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleSkip}
              disabled={loading}
            >
              <X className="h-4 w-4 mr-2" />
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={loading}
            >
              <Check className="h-4 w-4 mr-2" />
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
