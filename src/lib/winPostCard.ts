// MP-WIN-POSTS (2026-11-23): canvas renderer for the Win Post Studio.
// Draws the approved Galaxy Win/Trophy card (1080×1350) entirely client-side —
// no screenshot library, no edge round-trip — so the preview IS the export.
// Photos load with crossOrigin=anonymous; a CORS failure resolves to null and
// falls back to the silhouette, so the canvas can never taint and block export.

import { AGENT_NAME_FALLBACK } from "@/shared/api/agentDisplayNames";

export interface WinPostStat {
  label: string;
  value: string;
}

export interface WinPostItem {
  kind: "win" | "trophy";
  tier: "S" | "A" | "B";
  date: string;
  agent_id: string;
  agent_name: string;
  photo_url: string | null;
  instagram_handle: string | null;
  // win fields
  alp?: number;
  deals?: number;
  avg_alp?: number;
  carrier?: string | null;
  product?: string | null;
  // trophy fields
  trophy?: string;
  headline?: string;
  subline?: string;
  stats?: WinPostStat[];
}

export interface WinPostFeed {
  as_of: string;
  period: { from: string; to: string };
  wins: WinPostItem[];
  trophies: WinPostItem[];
  error?: string;
}

export const CARD_W = 1080;
export const CARD_H = 1350;

const MINT = "#6EE7C8";
const GOLD = "#F5C84C";
const BG = "#0A0A0F";
const MUTED = "#9CA3AF";
const FAINT = "#71717A";
const FONT = '"Hanken Grotesk", system-ui, sans-serif';

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadCardImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}

let fontsReady: Promise<unknown> | null = null;
function ensureFonts(): Promise<unknown> {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`800 120px ${FONT}`),
      document.fonts.load(`700 40px ${FONT}`),
      document.fonts.load(`400 30px ${FONT}`),
      // empty-catch-allow:font-preload-miss-falls-back-to-system-ui-not-an-error
    ]).catch(() => null);
  }
  return fontsReady;
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // letterSpacing shipped in Chrome 99 / Safari 17; harmless no-op elsewhere.
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // bias the crop toward the top third — faces live there
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * 0.25, dw, dh);
  ctx.restore();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, basePx: number, minPx: number, weight = 800): number {
  let px = basePx;
  for (; px > minPx; px -= 2) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return px;
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function statRows(item: WinPostItem): WinPostStat[] {
  if (item.kind === "trophy") return (item.stats ?? []).slice(0, 4);
  const rows: WinPostStat[] = [{ label: "Deals closed", value: String(item.deals ?? 0) }];
  if ((item.deals ?? 0) > 1 && item.avg_alp) rows.push({ label: "Avg ALP / deal", value: fmtMoney(item.avg_alp) });
  if (item.carrier) rows.push({ label: "Carrier", value: item.carrier });
  if (item.product) rows.push({ label: "Product", value: item.product });
  return rows.slice(0, 4);
}

function draw(ctx: CanvasRenderingContext2D, item: WinPostItem, photo: HTMLImageElement | null) {
  const accent = item.kind === "trophy" ? GOLD : MINT;
  const M = 72; // side margin

  // ---- background + photo
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  if (photo) {
    drawCover(ctx, photo, 0, 0, CARD_W, 980);
    const top = ctx.createLinearGradient(0, 0, 0, 260);
    top.addColorStop(0, "rgba(6,7,11,0.82)");
    top.addColorStop(1, "rgba(6,7,11,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, CARD_W, 260);
    const bottom = ctx.createLinearGradient(0, 380, 0, 980);
    bottom.addColorStop(0, "rgba(10,10,15,0)");
    bottom.addColorStop(0.72, "rgba(10,10,15,0.92)");
    bottom.addColorStop(1, BG);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 380, CARD_W, 600);
  } else {
    // silhouette placeholder
    ctx.fillStyle = "#16161D";
    ctx.beginPath();
    ctx.arc(CARD_W / 2, 400, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(CARD_W / 2, 790, 300, 210, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#3F3F46";
    ctx.textAlign = "center";
    setSpacing(ctx, 4);
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText("AGENT PROFILE PHOTO", CARD_W / 2, 660);
    setSpacing(ctx, 0);
    ctx.textAlign = "left";
  }

  // ---- header
  ctx.textBaseline = "alphabetic";
  // four-point spark
  ctx.save();
  ctx.translate(M + 16, 100);
  ctx.fillStyle = accent;
  ctx.beginPath();
  const s = 17;
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(3, -3, s, 0);
  ctx.quadraticCurveTo(3, 3, 0, s);
  ctx.quadraticCurveTo(-3, 3, -s, 0);
  ctx.quadraticCurveTo(-3, -3, 0, -s);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#FFFFFF";
  setSpacing(ctx, 6);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("GALAXY FINANCIAL", M + 52, 112);
  setSpacing(ctx, 0);

  // pill top-right
  const pillLabel = item.kind === "trophy" ? "TROPHY" : "AGENT WIN";
  setSpacing(ctx, 4);
  ctx.font = `700 27px ${FONT}`;
  const pillTextW = ctx.measureText(pillLabel).width;
  const pillW = pillTextW + 64;
  const pillX = CARD_W - M - pillW;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  roundRect(ctx, pillX, 68, pillW, 60, 30);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillText(pillLabel, pillX + 32, 108);
  setSpacing(ctx, 2);
  ctx.fillStyle = MUTED;
  ctx.font = `500 27px ${FONT}`;
  const dateTxt = fmtDate(item.date);
  ctx.fillText(dateTxt, CARD_W - M - ctx.measureText(dateTxt).width, 172);
  setSpacing(ctx, 0);

  // ---- name
  const name = (item.agent_name || AGENT_NAME_FALLBACK).toUpperCase();
  ctx.fillStyle = "#FFFFFF";
  const namePx = fitFont(ctx, name, CARD_W - 2 * M, 78, 44, 800);
  ctx.font = `800 ${namePx}px ${FONT}`;
  ctx.fillText(name, M, 742);

  // ---- accent box
  const boxY = 772;
  const boxH = 162;
  ctx.fillStyle = accent;
  roundRect(ctx, M, boxY, CARD_W - 2 * M, boxH, 10);
  ctx.fill();
  ctx.fillStyle = "#0B0B0E";
  if (item.kind === "win") {
    const big = `+${fmtMoney(item.alp ?? 0)}`;
    const bigPx = fitFont(ctx, `${big} ALP`, CARD_W - 2 * M - 120, 120, 56, 800);
    ctx.font = `800 ${bigPx}px ${FONT}`;
    const bigW = ctx.measureText(big).width;
    const baseline = boxY + boxH / 2 + bigPx * 0.36;
    ctx.fillText(big, M + 30, baseline);
    ctx.font = `800 ${Math.max(Math.round(bigPx * 0.38), 28)}px ${FONT}`;
    ctx.fillText("ALP", M + 30 + bigW + 20, baseline);
  } else {
    const head = (item.headline ?? "").toUpperCase();
    const headPx = fitFont(ctx, head, CARD_W - 2 * M - 60, 96, 44, 800);
    ctx.font = `800 ${headPx}px ${FONT}`;
    ctx.fillText(head, M + 30, boxY + boxH / 2 + headPx * 0.36);
  }

  // ---- stats
  const rows = statRows(item);
  let y = boxY + boxH + 74;
  for (const row of rows) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 33px ${FONT}`;
    ctx.fillText(row.label, M + 2, y);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 33px ${FONT}`;
    ctx.fillText(row.value, M + 388, y);
    y += 60;
  }
  if (item.kind === "trophy" && item.subline) {
    ctx.fillStyle = FAINT;
    ctx.font = `400 28px ${FONT}`;
    ctx.fillText(item.subline, M + 2, y + 4);
  }

  // ---- footer
  const fy = 1252;
  const r = 36;
  ctx.save();
  ctx.beginPath();
  ctx.arc(M + r, fy, r, 0, Math.PI * 2);
  ctx.clip();
  if (photo) {
    const scale = Math.max((2 * r) / photo.naturalWidth, (2 * r) / photo.naturalHeight);
    ctx.drawImage(
      photo,
      M + r - (photo.naturalWidth * scale) / 2,
      fy - (photo.naturalHeight * scale) / 2,
      photo.naturalWidth * scale,
      photo.naturalHeight * scale,
    );
  } else {
    ctx.fillStyle = "#1F2937";
    ctx.fillRect(M, fy - r, 2 * r, 2 * r);
    ctx.fillStyle = accent;
    ctx.font = `700 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(initials(item.agent_name || "GA"), M + r, fy + 11);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(M + r, fy, r, 0, Math.PI * 2);
  ctx.stroke();

  const tx = M + 2 * r + 24;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(item.instagram_handle ? `@${item.instagram_handle.replace(/^@/, "")}` : item.agent_name, tx, fy - 2);
  ctx.fillStyle = MUTED;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText("Galaxy Financial · Now hiring", tx, fy + 36);
}

/** Render one card into a canvas at the given scale (1 = full 1080×1350). */
export async function renderCardToCanvas(canvas: HTMLCanvasElement, item: WinPostItem, scale = 1): Promise<void> {
  canvas.width = Math.round(CARD_W * scale);
  canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await ensureFonts();
  const photo = await loadCardImage(item.photo_url);
  ctx.save();
  ctx.scale(scale, scale);
  draw(ctx, item, photo);
  ctx.restore();
}

export function cardFilename(item: WinPostItem): string {
  const who = (item.agent_name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const what = item.kind === "trophy" ? (item.trophy ?? "trophy") : "win";
  return `galaxy-${what}-${who}-${item.date}.png`;
}

export async function exportCardBlob(item: WinPostItem): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderCardToCanvas(canvas, item, 1);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
  });
}

/**
 * Phone-first save: the iOS/Android share sheet (→ Save Image / straight into
 * the Instagram app) when available, else a plain download. Returns which path
 * ran so the page can toast accurately. A dismissed share sheet is not an error.
 */
export async function saveCard(item: WinPostItem): Promise<"shared" | "downloaded" | "dismissed"> {
  const blob = await exportCardBlob(item);
  const filename = cardFilename(item);
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Galaxy Win" });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "dismissed";
      // fall through to download on any other share failure
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  return "downloaded";
}

export function buildCaption(item: WinPostItem): string {
  const name = item.agent_name || AGENT_NAME_FALLBACK;
  const ig = item.instagram_handle ? `@${item.instagram_handle.replace(/^@/, "")}` : null;
  const lines: string[] = [];
  if (item.kind === "win") {
    const deals = item.deals ?? 0;
    lines.push(`${name} just put up ${fmtMoney(item.alp ?? 0)} ALP${deals > 1 ? ` across ${deals} deals` : ""}. 🏆`);
    if (item.carrier) lines.push(`Written with ${item.carrier}.`);
  } else {
    lines.push(`${item.headline ?? "TROPHY"} — ${name}. 🏆`);
    if (item.subline) lines.push(`${item.subline}.`);
  }
  if (ig) lines.push(`Go show ${ig} some love.`);
  lines.push("");
  lines.push("Galaxy Financial — now hiring. Link in bio.");
  lines.push("");
  lines.push("#GalaxyFinancial #LifeInsurance #SalesWins");
  return lines.join("\n");
}
