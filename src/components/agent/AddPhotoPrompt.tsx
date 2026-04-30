import { useState, useEffect } from "react";
import { Camera, X, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

/**
 * Top-of-page banner on the agent dashboard prompting agents to upload
 * a photo if their profile has none. Dismissible for the session.
 * Hidden entirely if a photo is already set.
 */
export function AddPhotoPrompt() {
  const { user, profile } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) { setHasPhoto(true); return; }
    if (sessionStorage.getItem("apex-add-photo-dismissed") === "1") {
      setDismissed(true);
      return;
    }
    // Re-check avatar_url directly in case profile hook is stale.
    // Tolerate the photo_url column being absent (post-migration projects
    // may not have it). If the query errors entirely, default to "has photo"
    // so we never show a stuck prompt to someone who actually has one.
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) { setHasPhoto(true); return; }
      setHasPhoto(!!(data as any)?.avatar_url);
    })();
  }, [user?.id, profile]);

  if (dismissed || hasPhoto === null || hasPhoto === true) return null;

  const dismiss = () => {
    sessionStorage.setItem("apex-add-photo-dismissed", "1");
    setDismissed(true);
  };

  return (
    <GlassCard className="relative overflow-hidden p-4 md:p-5 border border-primary/40 bg-gradient-to-r from-primary/15 via-violet-500/10 to-amber-500/10 win-glow">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 h-7 w-7 rounded-full hover:bg-background/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center shrink-0 shadow-lg shadow-primary/30">
          <Camera className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-bold">Add your photo</h3>
            <span className="text-[10px] uppercase tracking-widest text-primary bg-primary/15 px-2 py-0.5 rounded-full border border-primary/30">Unlocks plaques</span>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Every APEX plaque you earn gets rendered with your photo. Right now yours shows just your initials — takes 15 seconds to fix.
          </p>
        </div>
        <Link to="/dashboard/settings" className="shrink-0">
          <Button size="sm" className="gap-1.5">
            Upload Photo <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </GlassCard>
  );
}
