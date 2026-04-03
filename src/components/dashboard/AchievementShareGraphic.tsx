import { useState, useRef } from "react";
import { Download, Instagram, Share2, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface AchievementShareGraphicProps {
  agentName: string;
  achievement: string;
  value: string;
  subtitle?: string;
  onClose?: () => void;
}

export function AchievementShareGraphic({
  agentName,
  achievement,
  value,
  subtitle,
  onClose,
}: AchievementShareGraphicProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [generating, setGenerating] = useState(false);

  const generateImage = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Instagram Story size
    canvas.width = 1080;
    canvas.height = 1920;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 1080, 1920);
    bg.addColorStop(0, "#030712");
    bg.addColorStop(0.5, "#0f172a");
    bg.addColorStop(1, "#030712");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1920);

    // Accent glow
    const glow = ctx.createRadialGradient(540, 800, 100, 540, 800, 600);
    glow.addColorStop(0, "rgba(34, 211, 165, 0.15)");
    glow.addColorStop(1, "rgba(34, 211, 165, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 200, 1080, 1200);

    // Trophy circle
    ctx.beginPath();
    ctx.arc(540, 700, 120, 0, Math.PI * 2);
    const circleGrad = ctx.createLinearGradient(420, 580, 660, 820);
    circleGrad.addColorStop(0, "#22d3a5");
    circleGrad.addColorStop(1, "#f59e0b");
    ctx.fillStyle = circleGrad;
    ctx.fill();

    // Trophy emoji
    ctx.font = "bold 100px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🏆", 540, 730);

    // Achievement title
    ctx.font = "bold 56px sans-serif";
    ctx.fillStyle = "#22d3a5";
    ctx.fillText(achievement, 540, 920);

    // Value
    ctx.font = "bold 96px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(value, 540, 1060);

    // Agent name
    ctx.font = "bold 48px sans-serif";
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(agentName, 540, 1180);

    // Subtitle
    if (subtitle) {
      ctx.font = "32px sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(subtitle, 540, 1240);
    }

    // Brand
    ctx.font = "bold 36px sans-serif";
    ctx.fillStyle = "#22d3a5";
    ctx.fillText("APEX FINANCIAL", 540, 1700);
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Protecting Families. Building Legacies.", 540, 1750);

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  };

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const blob = await generateImage();
      if (!blob) throw new Error("Failed to generate");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apex-achievement-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Achievement graphic downloaded! Share it on Instagram 📸");
    } catch {
      toast.error("Failed to generate graphic");
    } finally {
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    setGenerating(true);
    try {
      const blob = await generateImage();
      if (!blob) throw new Error("Failed");

      if (navigator.share && navigator.canShare?.({ files: [new File([blob], "achievement.png", { type: "image/png" })] })) {
        await navigator.share({
          title: `${agentName} - ${achievement}`,
          text: `${value} - ${achievement} 🏆 #APEXFinancial`,
          files: [new File([blob], "apex-achievement.png", { type: "image/png" })],
        });
      } else {
        // Fallback to download
        handleDownload();
      }
    } catch {
      handleDownload();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Preview card */}
      <GlassCard className="p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-amber-500/5" />
        <div className="relative space-y-3">
          <Trophy className="h-12 w-12 mx-auto text-amber-400" />
          <h3 className="text-xl font-bold text-primary">{achievement}</h3>
          <p className="text-3xl font-bold">{value}</p>
          <p className="text-amber-400 font-semibold">{agentName}</p>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </GlassCard>

      <div className="flex gap-2">
        <Button onClick={handleDownload} disabled={generating} className="flex-1 gap-2">
          <Download className="h-4 w-4" />
          Download for IG Story
        </Button>
        <Button onClick={handleShare} variant="outline" disabled={generating} className="gap-2">
          <Share2 className="h-4 w-4" />
          Share
        </Button>
      </div>
    </div>
  );
}

// Dialog wrapper for triggering share from anywhere
interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  achievement: string;
  value: string;
  subtitle?: string;
}

export function AchievementShareDialog({ open, onOpenChange, ...props }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-primary" />
            Share Achievement
          </DialogTitle>
        </DialogHeader>
        <AchievementShareGraphic {...props} />
      </DialogContent>
    </Dialog>
  );
}
