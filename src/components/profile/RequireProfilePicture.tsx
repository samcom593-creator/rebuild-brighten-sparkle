// Blocking modal shown the moment an authenticated user lands on any
// protected route without a profile picture. Discord posts use
// profiles.avatar_url for the deal-celebration thumbnail — Sam wants
// every producer's face on the feed, not a default grey circle.
//
// Flow:
//   1. On mount, check profiles.avatar_url for the current user
//   2. If missing, open a dismissible prompt with an upload input
//   3. Upload to Supabase storage → write profiles.avatar_url → close
//   4. "Later" snoozes it for 7 days; it never blocks access to the app
//
// 2026-08-18: this dialog used to be a HARD LOCK — the X was hidden, Escape and
// outside-click were preventDefault'd, and onOpenChange was a no-op, so the only
// exit was uploading a photo. Measured against production: 302 of 597 profiles
// (50.6%) have no avatar, so more than half of all users were shut out of every
// protected route in the product until they found a photo. A nudge to improve a
// Discord thumbnail is not worth locking an agent out of their own pipeline mid
// shift. It now asks, and takes no for an answer.
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
      // .limit(1) not .maybeSingle(): PostgREST returns data=null when a filter
      // matches MORE than one row, and profiles is not unique on user_id. A user
      // with duplicate rows would read as "no avatar" and — under the old hard
      // lock — be shut out of the product permanently, with an avatar on file.
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("user_id", user.id)
        .limit(1);
      if (cancelled) return;
      const url = (data as any)?.[0]?.avatar_url;
      if (url && url.length >= 10) return;

      // Respect a previous "Later" for 7 days so this is a nudge, not a nag.
      try {
        const until = Number(localStorage.getItem(`avatar-prompt-snooze:${user.id}`) ?? 0);
        if (Number.isFinite(until) && until > Date.now()) return;
      } catch { /* empty-catch-allow:storage-read-optional — blocked storage must not decide whether the prompt shows */ }
      setNeedsPicture(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id, isVaManager, isVa]);

  // Snooze for 7 days. Stored per user so a shared machine does not silence the
  // prompt for someone else.
  const dismiss = () => {
    setNeedsPicture(false);
    if (!user?.id) return;
    try {
      localStorage.setItem(
        `avatar-prompt-snooze:${user.id}`,
        String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      );
    } catch { /* empty-catch-allow:storage-write-optional — dismissal already applied in state; only persistence is lost */ }
  };

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
    <Dialog open={needsPicture} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="sm:max-w-md">
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

          <Button
            type="button"
            variant="ghost"
            disabled={uploading}
            className="w-full text-muted-foreground"
            onClick={dismiss}
          >
            Later
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            JPEG or PNG, up to 8 MB. You can change it later in Settings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
