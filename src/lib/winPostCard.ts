// MP-WIN-POSTS (2026-11-23): canvas renderer for the Win Post Studio.
// Draws the approved Galaxy Win/Trophy card (1080×1350) entirely client-side —
// no screenshot library, no edge round-trip — so the preview IS the export.
// Photos stay secondary. CORS failures and small avatars use a clean initials tile;
// recorded facts and export dimensions stay independent of the image.

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

const RED = "#F13945";
const GREEN = "#7BF5A8";
const CYAN = "#79DCEC";
const GOLD = "#F5CF70";
const BG = "#090A0D";
const PANEL = "#14161B";
const WHITE = "#F8F9FA";
const MUTED = "#B0B6C2";
const LINE = "#30343D";
const FONT = '"Hanken Grotesk", system-ui, sans-serif';
const UNAVAILABLE = "Not available";
const PREMIUM_NAME = "Annual Life Premium";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\p{Cc}\s]+/gu, " ").trim() : "";
}

function validPremium(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const cents = value * 100;
  return Number.isSafeInteger(Math.round(cents)) && Math.abs(cents - Math.round(cents)) < 0.00001;
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value: unknown): string {
  const iso = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return UNAVAILABLE;
  const date = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return UNAVAILABLE;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function initials(name: string): string {
  if (name === AGENT_NAME_FALLBACK) return "GF";
  const parts = name.split(/\s+/).filter(Boolean);
  return [parts[0], parts.length > 1 ? parts[parts.length - 1] : null]
    .filter((part): part is string => Boolean(part))
    .map(part => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
}

export interface WinPostDisplayStat extends WinPostStat {
  available: boolean;
  isPremium: boolean;
  numeric: boolean;
}

export interface WinPostPresentation {
  agentName: string;
  initials: string;
  handle: string | null;
  dateLabel: string;
  title: string;
  subline: string | null;
  metric: WinPostDisplayStat;
  stats: WinPostDisplayStat[];
}

function normalizeStat(stat: WinPostStat): WinPostDisplayStat | null {
  const label = cleanText(stat?.label);
  if (!label) return null;
  const value = cleanText(stat?.value);
  const isPremium = /\bALP\b|\bannual life premium\b/i.test(label);
  const isCount = /\b(deals?|hires?|days)\b/i.test(label);
  const knownText = Boolean(value) && !/^(?:null|undefined|nan|[+-]?infinity|n\/?a|not available|—|-)$/i.test(value);
  if (isPremium || value.startsWith("$")) {
    const matched = /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value);
    const amount = matched ? Number(value.replace(/[$,]/g, "")) : NaN;
    return { label, value: validPremium(amount) ? money(amount) : UNAVAILABLE, available: validPremium(amount), isPremium, numeric: true };
  }
  if (isCount) {
    const matched = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value);
    const count = matched ? Number(value.replace(/,/g, "")) : NaN;
    return { label, value: validCount(count) ? count.toLocaleString("en-US") : UNAVAILABLE, available: validCount(count), isPremium: false, numeric: true };
  }
  return { label, value: knownText ? value : UNAVAILABLE, available: knownText, isPremium: false, numeric: false };
}

/** Pure facts shared by the actual canvas and copy tools; never evaluates award eligibility. */
export function buildWinPostPresentation(item: WinPostItem): WinPostPresentation {
  const agentName = cleanText(item.agent_name) || AGENT_NAME_FALLBACK;
  const handle = cleanText(item.instagram_handle).replace(/^@+/, "");
  const identity = {
    agentName,
    initials: initials(agentName),
    handle: /^[a-z\d._]{1,30}$/i.test(handle) ? `@${handle}` : null,
    dateLabel: dateLabel(item.date),
  };
  if (item.kind === "win") {
    const stats: WinPostDisplayStat[] = [{
      label: "Deals", value: validCount(item.deals) ? item.deals.toLocaleString("en-US") : UNAVAILABLE,
      available: validCount(item.deals), isPremium: false, numeric: true,
    }];
    if (validCount(item.deals) && item.deals > 1) stats.push({
      label: "Average ALP / deal", value: validPremium(item.avg_alp) ? money(item.avg_alp) : UNAVAILABLE,
      available: validPremium(item.avg_alp), isPremium: true, numeric: true,
    });
    // The feed supplies these from the day's highest-premium row, not every deal.
    for (const [label, value] of [["Largest deal carrier", item.carrier], ["Largest deal product", item.product]]) {
      if (cleanText(value)) stats.push({ label, value: cleanText(value), available: true, isPremium: false, numeric: false });
    }
    return {
      ...identity,
      title: "ON THE BOARD",
      subline: null,
      metric: { label: "ALP", value: validPremium(item.alp) ? money(item.alp) : UNAVAILABLE, available: validPremium(item.alp), isPremium: true, numeric: true },
      stats,
    };
  }
  const stats = (Array.isArray(item.stats) ? item.stats : []).map(stat => {
    // The recorded fast-start ALP uses day 30, but its deal count uses day 60.
    // Keep those existing windows distinct instead of implying a shared period.
    if (item.trophy === "fast_start") {
      const label = cleanText(stat?.label);
      if (label === "ALP") return normalizeStat({ ...stat, label: "ALP through day 30" });
      if (label === "Deals") return normalizeStat({ ...stat, label: "Deals through day 60" });
    }
    return normalizeStat(stat);
  }).filter((stat): stat is WinPostDisplayStat => stat !== null);
  const premiumIndex = stats.findIndex(stat => stat.isPremium);
  const metricIndex = premiumIndex >= 0 ? premiumIndex : stats.findIndex(stat => stat.numeric);
  return {
    ...identity,
    title: cleanText(item.headline) || cleanText(item.trophy).replace(/_/g, " ").toUpperCase() || "AWARD RECORDED",
    // Calendar-date qualification does not prove elapsed 24 hours; the legacy
    // first-on-board award identifies a daily report, not the earliest sale.
    subline: item.trophy === "day_one" ? "First recorded production day"
      : item.trophy === "first_on_board" ? "First qualifying daily report recorded"
      : cleanText(item.subline) || null,
    metric: metricIndex >= 0 ? stats[metricIndex] : { label: "Recorded metrics", value: UNAVAILABLE, available: false, isPremium: false, numeric: false },
    stats: stats.filter((_, index) => index !== metricIndex),
  };
}

export interface WinPostTextFit {
  lines: string[];
  fontSize: number;
  truncated: boolean;
}

/** Measured wrapping keeps names/labels inside their boxes; copy text remains complete. */
export function fitWinPostText(
  text: string,
  measure: (value: string, fontSize: number) => number,
  options: { maxWidth: number; fontSize: number; minFontSize: number; maxLines?: number },
): WinPostTextFit {
  const { maxWidth, fontSize, minFontSize, maxLines = 1 } = options;
  if (![maxWidth, fontSize, minFontSize].every(value => Number.isFinite(value) && value > 0)
    || minFontSize > fontSize || !Number.isSafeInteger(maxLines) || maxLines < 1) throw new RangeError("Invalid card text bounds");
  const value = cleanText(text);
  if (!value) return { lines: [], fontSize, truncated: false };
  const wrap = (size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of value.split(" ")) {
      if (measure(line ? `${line} ${word}` : word, size) <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ""; }
      for (const char of Array.from(word)) {
        if (line && measure(line + char, size) > maxWidth) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  for (let size = fontSize; size >= minFontSize; size = Math.max(minFontSize, size - 1)) {
    const lines = wrap(size);
    if (lines.length <= maxLines && lines.every(line => measure(line, size) <= maxWidth)) return { lines, fontSize: size, truncated: false };
    if (size === minFontSize) break;
  }
  const lines = wrap(minFontSize).slice(0, maxLines);
  const last = Array.from(lines[lines.length - 1] ?? "");
  while (last.length && measure(`${last.join("").trimEnd()}…`, minFontSize) > maxWidth) last.pop();
  lines[lines.length - 1] = measure("…", minFontSize) <= maxWidth ? `${last.join("").trimEnd()}…` : "";
  return { lines, fontSize: minFontSize, truncated: true };
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
const IMAGE_TIMEOUT_MS = 8000;
const renderVersions = new WeakMap<HTMLCanvasElement, number>();

export function loadCardImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let promise = imgCache.get(url);
  if (!promise) {
    promise = new Promise(resolve => {
      const image = new Image();
      let settled = false;
      const finish = (result: HTMLImageElement | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(result);
      };
      const timeout = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
      image.crossOrigin = "anonymous";
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = url;
    });
    imgCache.set(url, promise);
  }
  return promise;
}

let fontsReady: Promise<unknown> | null = null;
function ensureFonts(): Promise<unknown> {
  if (!fontsReady) {
    fontsReady = document.fonts?.load ? Promise.all([
      document.fonts.load(`italic 900 160px ${FONT}`),
      document.fonts.load(`italic 800 80px ${FONT}`),
      document.fonts.load(`700 32px ${FONT}`),
      // empty-catch-allow:font-preload-miss-falls-back-to-system-ui-not-an-error
    ]).catch(() => null) : Promise.resolve(null);
  }
  return fontsReady;
}

function polygon(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
}

function textBox(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number,
  options: { fontSize: number; minFontSize?: number; maxLines?: number; weight?: number; italic?: boolean; lineHeight?: number },
): WinPostTextFit {
  const font = (size: number) => `${options.italic ? "italic " : ""}${options.weight ?? 700} ${size}px ${FONT}`;
  const fit = fitWinPostText(text, (value, size) => {
    ctx.font = font(size);
    const metrics = ctx.measureText(value);
    return Math.max(metrics.width, (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? metrics.width));
  }, { maxWidth: width - 12, fontSize: options.fontSize, minFontSize: options.minFontSize ?? options.fontSize, maxLines: options.maxLines });
  const lineHeight = fit.fontSize * (options.lineHeight ?? 1.1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, lineHeight * (options.maxLines ?? 1) + 8);
  ctx.clip();
  ctx.font = font(fit.fontSize);
  ctx.textBaseline = "top";
  fit.lines.forEach((line, index) => ctx.fillText(line, x + 6, y + index * lineHeight));
  ctx.restore();
  return fit;
}

function drawPhoto(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, who: string, x: number, y: number, size: number) {
  ctx.save();
  polygon(ctx, [[x, y], [x + size, y], [x + size, y + size - 24], [x + size - 24, y + size], [x, y + size]]);
  ctx.clip();
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, size, size);
  if (image && image.naturalWidth >= 120 && image.naturalHeight >= 120) {
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) * 0.25, width, height);
  } else {
    ctx.fillStyle = "#232730";
    polygon(ctx, [[x + 110, y], [x + 160, y], [x + 70, y + size], [x + 20, y + size]]);
    ctx.fill();
    ctx.fillStyle = WHITE;
    textBox(ctx, who, x + 24, y + 58, size - 48, { fontSize: 80, minFontSize: 48, italic: true, weight: 900 });
  }
  ctx.restore();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  polygon(ctx, [[x, y], [x + size, y], [x + size, y + size - 24], [x + size - 24, y + size], [x, y + size]]);
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.fillRect(x, y + size + 10, 64, 6);
}

function drawTrophy(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = GOLD;
  ctx.fillStyle = GOLD;
  ctx.lineWidth = 4;
  polygon(ctx, [[8, 0], [36, 0], [32, 24], [22, 31], [12, 24]]);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 5); ctx.lineTo(0, 5); ctx.lineTo(0, 14); ctx.lineTo(12, 23);
  ctx.moveTo(36, 5); ctx.lineTo(44, 5); ctx.lineTo(44, 14); ctx.lineTo(32, 23);
  ctx.moveTo(22, 28); ctx.lineTo(22, 40);
  ctx.stroke();
  ctx.fillRect(10, 40, 24, 5);
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, item: WinPostItem, photo: HTMLImageElement | null) {
  const view = buildWinPostPresentation(item);
  const margin = 66;
  const width = CARD_W - 2 * margin;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Static cut-paper shapes stay at the edges, clear of names and numbers.
  ctx.fillStyle = "#2E1118";
  polygon(ctx, [[890, 0], [1080, 0], [1080, 300], [1030, 300]]); ctx.fill();
  ctx.fillStyle = RED;
  polygon(ctx, [[1006, 0], [1044, 0], [1080, 126], [1080, 250]]); ctx.fill();
  polygon(ctx, [[0, 1190], [0, 1350], [92, 1350], [42, 1190]]); ctx.fill();
  ctx.fillStyle = "#23262E";
  for (let index = 0; index < 3; index += 1) {
    const x = 884 + index * 28;
    polygon(ctx, [[x, 1240], [x + 10, 1240], [x - 22, 1310], [x - 32, 1310]]); ctx.fill();
  }

  // Brand / recorded award, never an inferred rank or tier claim.
  ctx.fillStyle = RED;
  polygon(ctx, [[72, 65], [94, 65], [78, 112], [56, 112]]); ctx.fill();
  polygon(ctx, [[102, 65], [124, 65], [108, 112], [86, 112]]); ctx.fill();
  ctx.fillStyle = WHITE;
  textBox(ctx, "GALAXY FINANCIAL", 140, 68, 650, { fontSize: 36, minFontSize: 36, weight: 900 });
  ctx.fillStyle = item.kind === "trophy" ? GOLD : RED;
  textBox(ctx, view.title.toUpperCase(), margin, 164, width - (item.kind === "trophy" ? 64 : 0), { fontSize: 46, minFontSize: 30, weight: 900, italic: true });
  if (item.kind === "trophy") drawTrophy(ctx, CARD_W - margin - 46, 166);

  ctx.fillStyle = WHITE;
  textBox(ctx, view.agentName.toUpperCase(), margin, 268, width - 252, { fontSize: 82, minFontSize: 44, maxLines: 2, italic: true, weight: 900, lineHeight: 1.05 });
  drawPhoto(ctx, photo, view.initials, CARD_W - margin - 210, 250, 210);
  ctx.fillStyle = CYAN;
  textBox(ctx, view.dateLabel === UNAVAILABLE ? "DATE NOT AVAILABLE" : view.dateLabel.toUpperCase(), margin, 465, width - 252, { fontSize: 28, minFontSize: 24, weight: 700 });

  ctx.fillStyle = PANEL;
  polygon(ctx, [[margin, 536], [CARD_W - margin - 30, 536], [CARD_W - margin, 566], [CARD_W - margin, 816], [margin, 816]]); ctx.fill();
  ctx.fillStyle = RED;
  polygon(ctx, [[margin, 536], [margin + 180, 536], [margin + 172, 546], [margin, 546]]); ctx.fill();
  ctx.fillStyle = CYAN;
  textBox(ctx, view.metric.label.toUpperCase(), margin + 24, 566, width - 48, { fontSize: 28, minFontSize: 24, weight: 700 });
  ctx.fillStyle = view.metric.available ? (view.metric.isPremium ? GREEN : GOLD) : MUTED;
  textBox(ctx, view.metric.value.toUpperCase(), margin + 18, 608, width - 36, { fontSize: view.metric.available ? 162 : 76, minFontSize: 48, weight: 900, italic: true });
  ctx.fillStyle = MUTED;
  textBox(ctx, view.metric.isPremium ? PREMIUM_NAME.toUpperCase() : "RECORDED AWARD DETAIL", margin + 24, 775, width - 48, { fontSize: 24, minFontSize: 22, weight: 700 });

  view.stats.slice(0, 4).forEach((stat, index) => {
    const y = 858 + index * 65;
    ctx.fillStyle = MUTED;
    textBox(ctx, stat.label, margin, y, 348, { fontSize: 29, minFontSize: 24, weight: 500 });
    ctx.fillStyle = stat.available ? (stat.isPremium ? GREEN : WHITE) : MUTED;
    textBox(ctx, stat.value, margin + 378, y, width - 378, { fontSize: 32, minFontSize: 24, weight: 800 });
    ctx.fillStyle = LINE;
    ctx.fillRect(margin + 6, y + 48, width - 12, 1);
  });
  if (view.subline) {
    ctx.fillStyle = MUTED;
    textBox(ctx, view.subline, margin, 1130, width, { fontSize: 27, minFontSize: 24, maxLines: 2, weight: 500 });
  }

  ctx.fillStyle = RED;
  ctx.fillRect(margin + 6, 1210, 140, 5);
  ctx.fillStyle = WHITE;
  textBox(ctx, "GALAXYFINANCIAL.ORG", margin, 1242, 540, { fontSize: 29, minFontSize: 26, weight: 900, italic: true });
  if (view.handle) {
    ctx.fillStyle = CYAN;
    textBox(ctx, view.handle, 626, 1244, CARD_W - margin - 626, { fontSize: 26, minFontSize: 22, weight: 700 });
  }
}

/** Render one card into a canvas at the given scale (1 = full 1080×1350). */
export async function renderCardToCanvas(canvas: HTMLCanvasElement, item: WinPostItem, scale = 1): Promise<void> {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Invalid card scale");
  const version = (renderVersions.get(canvas) ?? 0) + 1;
  renderVersions.set(canvas, version);
  canvas.width = Math.round(CARD_W * scale);
  canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  await ensureFonts();
  const photo = await loadCardImage(item.photo_url);
  if (renderVersions.get(canvas) !== version) return;
  ctx.save();
  try {
    ctx.scale(scale, scale);
    draw(ctx, item, photo);
  } finally {
    ctx.restore();
  }
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

function copyStat(stat: WinPostDisplayStat): string {
  return `${stat.label}${stat.isPremium ? ` (${PREMIUM_NAME})` : ""}: ${stat.value}`;
}

/** Full recorded facts for a selectable, plain-text Copy stats action. */
export function buildAwardCopySummary(item: WinPostItem): string {
  const view = buildWinPostPresentation(item);
  return [
    "GALAXY FINANCIAL",
    `Agent: ${view.agentName}`,
    `Date: ${view.dateLabel}`,
    ...(item.kind === "trophy" ? [`Award: ${view.title}`] : []),
    copyStat(view.metric),
    ...view.stats.map(copyStat),
    ...(view.subline ? [view.subline] : []),
    ...(view.handle ? [`Instagram: ${view.handle}`] : []),
  ].join("\n");
}

/** Concise share copy uses the recorded date and facts, never inferred earnings or ranks. */
export function buildCaption(item: WinPostItem): string {
  const view = buildWinPostPresentation(item);
  const lines = item.kind === "win" ? [
    "ON THE BOARD.",
    view.metric.available
      ? `${view.agentName} — ${view.metric.value} in ${PREMIUM_NAME} (ALP).`
      : `${view.agentName} — production record.\nALP (${PREMIUM_NAME}): ${UNAVAILABLE}.`,
    validCount(item.deals) ? `${item.deals.toLocaleString("en-US")} ${item.deals === 1 ? "deal" : "deals"}.` : "Deal count: Not available.",
    `Date: ${view.dateLabel}.`,
  ] : [
    `${view.agentName} — ${view.title}.`,
    copyStat(view.metric),
    ...view.stats.map(copyStat),
    ...(view.subline ? [view.subline] : []),
    `Date: ${view.dateLabel}.`,
  ];
  if (view.handle) lines.push(view.handle);
  lines.push("", "Galaxy Financial", "#GalaxyFinancial #InsuranceProduction");
  return lines.join("\n");
}
