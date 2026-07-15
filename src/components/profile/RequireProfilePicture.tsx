// Blocking modal shown the moment an authenticated user lands on any
// protected route without a profile picture. Discord posts use
// profiles.avatar_url for the deal-celebration thumbnail — Sam wants
// every producer's face on the feed, not a default grey circle.
//
// Flow:
//   1. On mount, check profiles.avatar_url for the current user
//   2. If missing, open a non-dismissible dialog with an upload input
//   3. Upload to Supabase storage → write profiles.avatar_url → close
//   4. Until they upload, they can't interact with the dashboard
//
// Mount in AuthenticatedShell once so every protected page enforces it.

import { useEffect, useState } from "react";
import { Camera, Loader2, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function RequireProfilePicture() {
  const { user, isVaManager, isVa } = useAuth();
  const [needsPicture, setNeedsPicture] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Check whether the current user has an avatar. Only prompts once per
  // session per user — if you've dismissed-after-uploading, we don't spam.
  // VA managers + VAs are back-office operators, not producers — their face
  // never appears on the Discord deal feed, so we never force the photo gate.
  useEffect(() => {
    if (!user?.id || isVaManager || isVa) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const url = (data as any)?.avatar_url;
      if (!url || url.length < 10) setNeedsPicture(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id, isVaManager, isVa]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be under 8MB");
      return;
    }

    setUploading(true);
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      const { error: profErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("user_id", user.id);
      if (profErr) throw profErr;

      toast.success("Profile picture set.");
      setNeedsPicture(false);
    } catch (err: any) {
      console.error("[avatar upload]", err);
      toast.error(err?.message ?? "Upload failed — try again.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={needsPicture} onOpenChange={() => { /* non-dismissible */ }}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"  // hide the X; they must upload
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Add your profile picture
          </DialogTitle>
          <DialogDescription>
            Your face shows up next to every deal you close on Discord. Agents
            compete harder when they see who's writing production. One upload and
            you're set.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden border border-border">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <User className="w-10 h-10 text-muted-foreground" />
            )}
          </div>

          <label className="w-full">
            <Button
              type="button"
              disabled={uploading}
              className="w-full"
              onClick={() => document.getElementById("apex-avatar-upload")?.click()}
            >
              {uploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
              ) : (
                <><Camera className="h-4 w-4 mr-2" /> Choose photo</>
              )}
            </Button>
            <input
              id="apex-avatar-upload"
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            />
          </label>

          <p className="text-xs text-muted-foreground text-center">
            JPEG or PNG, up to 8 MB. You can change it later in Settings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
