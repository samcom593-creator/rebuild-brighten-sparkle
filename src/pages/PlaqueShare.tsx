import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Download,
  Share2,
  Copy,
  Instagram,
  Twitter,
  Facebook,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface PlaqueData {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string | null;
  amount: number;
  image_png_url: string | null;
  image_svg_url: string | null;
  share_slug: string | null;
  color_hex: string | null;
  badge_label: string | null;
  agent_name?: string;
  agent_instagram?: string | null;
}

/**
 * Public plaque page: /plaque/:slug
 * Unauthenticated — anyone with the link can view.
 */
export default function PlaqueShare() {
  const { slug } = useParams<{ slug: string }>();
  const [plaque, setPlaque] = useState<PlaqueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("plaque_awards" as any)
          .select("*")
          .eq("share_slug", slug)
          .maybeSingle();
        if (qErr) throw qErr;
        if (!data) {
          setError("Plaque not found. It may have been deleted or the link is incorrect.");
          setLoading(false);
          return;
        }

        const { data: agent } = await supabase
          .from("agents")
          .select("profile_id")
          .eq("id", (data as any).agent_id)
          .single();
        let agentName = "Team Member";
        let instagram: string | null = null;
        if (agent?.profile_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, instagram_handle")
            .eq("id", agent.profile_id)
            .single();
          agentName = (profile as any)?.full_name || agentName;
          instagram = (profile as any)?.instagram_handle || null;
        }

        setPlaque({ ...(data as any), agent_name: agentName, agent_instagram: instagram });
      } catch (e: any) {
        setError(e.message || "Failed to load plaque");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied — paste anywhere to share");
  };

  const downloadPng = async () => {
    const src = plaque?.image_png_url || plaque?.image_svg_url;
    if (!src) {
      toast.error("Image not ready yet");
      return;
    }
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // data URIs preserve their mime; use the right extension so downloads open cleanly
      const ext = blob.type.includes("svg") ? "svg" : "png";
      a.download = `apex-${plaque.milestone_type || "plaque"}-${plaque.agent_name?.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch (e: any) {
      toast.error("Download failed: " + e.message);
    }
  };

  const shareNative = async () => {
    const src = plaque?.image_png_url || plaque?.image_svg_url;
    if (!src) return;
    try {
      if (navigator.share && (navigator as any).canShare) {
        const res = await fetch(src);
        const blob = await res.blob();
        const ext = blob.type.includes("svg") ? "svg" : "png";
        const file = new File([blob], `plaque.${ext}`, { type: blob.type || "image/png" });
        if ((navigator as any).canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: plaque.badge_label || "APEX Plaque",
            text: `${plaque.agent_name} just earned ${plaque.badge_label}`,
          });
          return;
        }
      }
      copyLink();
    } catch {
      copyLink();
    }
  };

  const shareTwitter = () => {
    if (!plaque) return;
    const text = encodeURIComponent(
      `${plaque.agent_name} just earned ${plaque.badge_label} at APEX Financial! ${plaque.amount ? `$${Math.round(plaque.amount).toLocaleString()}` : ""}`,
    );
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(window.location.href)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const shareFacebook = () => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="animate-pulse w-full max-w-2xl px-4">
          <div className="aspect-[4/5] rounded-md bg-[#111]" />
        </div>
      </div>
    );
  }

  if (error || !plaque) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Plaque not found</h1>
          <p className="text-muted-foreground">{error || "Something went wrong — refresh to try again"}</p>
          <Link to="/">
            <Button variant="outline">Go to APEX</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <div className="text-center space-y-2">
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: plaque.color_hex || "#C9A962" }}
          >
            {plaque.badge_label || "Achievement"}
          </p>
          <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>
            {plaque.agent_name}
          </h1>
          {plaque.agent_instagram && (
            <p className="text-sm text-muted-foreground">@{plaque.agent_instagram}</p>
          )}
        </div>

        <div className="rounded-md overflow-hidden border border-white/10 bg-[#111]">
          {(plaque.image_png_url || plaque.image_svg_url) ? (
            <img
              src={plaque.image_png_url || plaque.image_svg_url!}
              alt={`${plaque.badge_label} plaque for ${plaque.agent_name}`}
              className="w-full h-auto block"
            />
          ) : (
            <div className="aspect-[4/5] flex items-center justify-center text-muted-foreground text-sm">
              Image is still rendering. Refresh in a moment.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Button onClick={downloadPng} className="col-span-2 md:col-span-1">
            <Download className="h-4 w-4 mr-2" /> Download
          </Button>
          <Button onClick={shareNative} variant="outline">
            <Share2 className="h-4 w-4 mr-2" /> Share
          </Button>
          <Button onClick={copyLink} variant="outline">
            <Copy className="h-4 w-4 mr-2" /> Copy Link
          </Button>
          <Button onClick={shareTwitter} variant="outline">
            <Twitter className="h-4 w-4 mr-2" /> X
          </Button>
          <Button onClick={shareFacebook} variant="outline">
            <Facebook className="h-4 w-4 mr-2" /> Facebook
          </Button>
        </div>

        <div className="rounded-md border border-pink-500/20 bg-rose-500/5 p-4 flex items-start gap-3">
          <Instagram className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium mb-1">Post to Instagram</p>
            <p className="text-xs text-muted-foreground mb-2">
              1. Tap <strong>Download</strong> above · 2. Open Instagram · 3. Tap the + icon · 4. Pick the plaque image from your camera roll · 5. Post as a story or feed post
            </p>
            <p className="text-xs text-muted-foreground">
              The image is 1080×1350 — optimized for Instagram feed posts.
            </p>
          </div>
        </div>

        <div className="text-center pt-8 border-t border-white/10">
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-white transition inline-flex items-center gap-1"
          >
            APEX Financial Group <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
