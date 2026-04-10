import { supabase } from "@/integrations/supabase/client";

interface AwardParams {
  agentName: string;
  agentPhotoUrl: string | null;
  achievementType: string;
  achievementStat: string;
  date: string;
  instagramHandle?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

export function getAgentAvatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null;
  if (avatarPath.startsWith("http")) return avatarPath;
  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
}

export async function generateAwardCanvas(params: AwardParams): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;

  // Dark background
  ctx.fillStyle = "#030712";
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(540, 400, 0, 540, 400, 600);
  glow.addColorStop(0, "rgba(34, 211, 165, 0.06)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1080);

  // Green gradient top bar
  const topGrad = ctx.createLinearGradient(0, 0, 1080, 0);
  topGrad.addColorStop(0, "#22d3a5");
  topGrad.addColorStop(1, "#0ea5e9");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, 1080, 8);

  // Agent photo (circular with ring)
  const cx = 540, cy = 320, r = 180;
  if (params.agentPhotoUrl) {
    try {
      const img = await loadImage(params.agentPhotoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const aspect = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (aspect > 1) { sx = (img.width - img.height) / 2; sw = img.height; }
      else { sy = (img.height - img.width) / 2; sh = img.width; }
      ctx.drawImage(img, sx, sy, sw, sh, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    } catch {
      drawInitials(ctx, cx, cy, r, params.agentName);
    }
  } else {
    drawInitials(ctx, cx, cy, r, params.agentName);
  }

  // Photo ring
  ctx.strokeStyle = "#22d3a5";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.stroke();

  // Achievement badge pill
  const pillText = params.achievementType.toUpperCase();
  ctx.font = "bold 16px sans-serif";
  const pillMetrics = ctx.measureText(pillText);
  const pillW = pillMetrics.width + 48;
  const pillH = 40;
  const pillX = (1080 - pillW) / 2;
  const pillY = 548;
  ctx.fillStyle = "rgba(34, 211, 165, 0.12)";
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 20);
  ctx.fill();
  ctx.strokeStyle = "rgba(34, 211, 165, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#22d3a5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, 540, pillY + pillH / 2);

  // Achievement stat (big number)
  ctx.fillStyle = "#22d3a5";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(params.achievementStat, 540, 660);

  // Agent name
  ctx.fillStyle = "white";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(params.agentName, 540, 750);

  // Instagram handle
  if (params.instagramHandle) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "20px sans-serif";
    ctx.fillText(`@${params.instagramHandle.replace("@", "")}`, 540, 795);
  }

  // Date
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = "22px sans-serif";
  ctx.fillText(params.date, 540, 840);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(240, 890);
  ctx.lineTo(840, 890);
  ctx.stroke();

  // APEX branding
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("APEX FINANCIAL", 540, 940);

  // Bottom bar
  const bottomGrad = ctx.createLinearGradient(0, 1072, 1080, 1072);
  bottomGrad.addColorStop(0, "#22d3a5");
  bottomGrad.addColorStop(1, "#0ea5e9");
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, 1072, 1080, 8);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas to blob failed"))),
      "image/png"
    );
  });
}

function drawInitials(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, name: string) {
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#22d3a5";
  ctx.font = "bold 100px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  ctx.fillText(initials, cx, cy);
}

export async function saveAwardPng(blob: Blob, filename: string) {
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "APEX Award" });
        return;
      } catch { /* fall through to download */ }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
