// Social Command Center (MP-308, 2026-10-28): one place for Sam and Aisha to work every
// platform. Everything here is a pure helper over the social_command_center() payload so
// the page stays a renderer and the rules are testable.

export type Bucket = "hot" | "human_lane" | "waiting" | "booked" | "answered" | "silent";

export interface InboxRow {
  source: string;
  sender_handle: string;
  sender_name: string | null;
  avatar: string | null;
  last_in: string | null;
  last_out: string | null;
  inbound_count: number;
  last_intent: string | null;
  sam_touched: boolean;
  last_text: string | null;
  application_id: string | null;
  lead_score: number | null;
  media_id: string | null;
  waiting_on_us: boolean;
  bucket: Bucket;
  application_status: string | null;
  application_license: string | null;
}

export interface FunnelRow {
  platform: string;
  posts: number; views: number; post_comments: number;
  messages_in: number; people_in: number; people_replied: number;
  partials_abandoned: number; applications: number; licensed: number; booked_or_further: number;
}

export interface PullRow {
  platform: string; lever: string; applications: number; licensed: number; booked_or_further: number; last_30d: number; last_application: string | null;
}

export interface LaneRow {
  lane: string;
  /** page = Sam's phone gets a critical when it dies; report = shown here and on the Sunday report only. */
  tier: "page" | "report";
  last_seen: string | null;
  expires_at: string | null;
  owner: string;
  fix: string | null;
  verdict: "alive" | "dead" | "never";
  hours_silent: number | null;
  hours_left: number | null;
}

export interface AlarmState {
  checked_at: string | null;
  dead_page_lanes: number;
  last_alert_at: string | null;
  last_alert_subject: string | null;
}

export interface DraftRow {
  id: number; draft_date: string | null; platform: string | null; slot: string | null; pillar: string | null; title: string | null;
  hook: string | null; cta: string | null; status: string; approved_at: string | null; shipped_at: string | null; notes: string | null; created_at: string;
}

/** The two call lists the brain keeps warm for the dialer: old applicants for ReadyMode and former agents to bring back. */
export interface PoolState {
  readymode_leads: number;
  readymode_licensed: number;
  readymode_never_contacted: number;
  winback_agents: number;
  winback_with_phone: number;
  readymode_csv_url: string | null;
  winback_csv_url: string | null;
}

export interface CommandCenterPayload {
  inbox: InboxRow[]; funnel: FunnelRow[]; pulls: PullRow[]; lanes: LaneRow[]; drafts: DraftRow[];
  alarm?: AlarmState | null; pools?: PoolState | null; youtube_reconnect_url?: string | null; generated_at: string;
}

export const SOCIAL_COMMAND_KEY = "social-command-center";

/** Work order. Hot first: a business intent nobody has answered. */
export const BUCKET_ORDER: Bucket[] = ["hot", "human_lane", "waiting", "booked", "answered", "silent"];
export const BUCKET_LABEL: Record<Bucket, string> = {
  hot: "Hot", human_lane: "Sam's threads", waiting: "Waiting on us", booked: "Booked", answered: "Answered", silent: "Silent by design",
};
export const BUCKET_TONE: Record<Bucket, string> = {
  hot: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  human_lane: "border-primary/40 bg-primary/10 text-primary",
  waiting: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  booked: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  answered: "border-border bg-muted text-muted-foreground",
  silent: "border-border bg-muted text-muted-foreground",
};

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", bio_link: "Bio link", untracked: "Untracked",
};
export const platformLabel = (p: string | null | undefined) => (p ? PLATFORM_LABEL[p] ?? p : "Unknown");

export function bucketCounts(rows: InboxRow[]): Record<Bucket, number> {
  const out = { hot: 0, human_lane: 0, waiting: 0, booked: 0, answered: 0, silent: 0 } as Record<Bucket, number>;
  for (const r of rows) out[r.bucket] = (out[r.bucket] ?? 0) + 1;
  return out;
}

export function filterInbox(rows: InboxRow[], bucket: Bucket | "all", platform: string, search: string): InboxRow[] {
  const s = search.trim().toLowerCase();
  return rows
    .filter((r) => (bucket === "all" ? r.bucket !== "silent" : r.bucket === bucket))
    .filter((r) => platform === "all" || r.source === platform)
    .filter((r) => !s || [r.sender_handle, r.sender_name, r.last_text, r.last_intent].some((v) => (v ?? "").toLowerCase().includes(s)))
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || (b.last_in ?? "").localeCompare(a.last_in ?? ""));
}

/** Where a person's thread lives, per platform. */
export function profileHref(r: InboxRow): string | null {
  const h = (r.sender_handle ?? "").replace(/^@/, "");
  if (!h) return null;
  if (r.source === "instagram") return `https://www.instagram.com/${encodeURIComponent(h)}/`;
  if (r.source === "tiktok") return `https://www.tiktok.com/@${encodeURIComponent(h)}`;
  if (r.source === "youtube") return h.startsWith("UC") ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${encodeURIComponent(h)}`;
  return null;
}

export function replyRate(f: FunnelRow): number | null {
  return f.people_in > 0 ? f.people_replied / f.people_in : null;
}

export const pct = (n: number | null) => (n == null ? "" : `${Math.round(n * 100)}%`);
export const num = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

/** "3h", "2d 4h", "never". */
export function silentFor(hours: number | null | undefined, verdict?: string): string {
  if (verdict === "never" || hours == null) return "never";
  const h = Math.max(0, Math.round(hours));
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const LANE_TONE: Record<LaneRow["verdict"], string> = {
  alive: "border-primary/40 bg-primary/10 text-primary",
  dead: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  never: "border-border bg-muted text-muted-foreground",
};

/** Dead lanes first, then alive, then never-built, each alphabetical. */
export function sortLanes(lanes: LaneRow[]): LaneRow[] {
  const rank = { dead: 0, alive: 1, never: 2 } as Record<string, number>;
  return [...lanes].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.lane.localeCompare(b.lane));
}

/** The one lane whose fix is a link: YouTube's Google consent, opened by the channel owner. */
export function laneLink(lane: string, youtubeReconnectUrl?: string | null): string | null {
  if ((lane === "youtube_oauth" || lane === "youtube_comments") && youtubeReconnectUrl) return youtubeReconnectUrl;
  return null;
}

/** "ok · 3h ago", "dead · 23d 7h", "expires in 41d", "never built". */
export function laneStatus(l: Pick<LaneRow, "verdict" | "hours_silent" | "hours_left">): string {
  if (l.verdict === "never") return "never built";
  if (l.hours_left != null) {
    const h = Math.round(l.hours_left);
    const span = h < 0 ? "expired" : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
    return l.verdict === "dead" ? (h < 0 ? "dead · token expired" : `dead · expires in ${span}`) : `ok · expires in ${span}`;
  }
  // Clamped so a clock skew between the view's now() and the browser can never print a negative age.
  const silent = silentFor(Math.max(0, l.hours_silent ?? 0), l.verdict);
  return l.verdict === "dead" ? `dead · ${silent}` : `ok · ${silent} ago`;
}

/** social_bot_drafts.platform was typed by hand over months: yt / youtube, snap / snapchat, ig / instagram. One key each. */
export function normalizePlatform(p: string | null | undefined): string {
  const k = (p ?? "").trim().toLowerCase();
  if (!k) return "unknown";
  if (k === "yt") return "youtube";
  if (k === "snap") return "snapchat";
  if (k === "ig" || k === "insta") return "instagram";
  if (k === "tt") return "tiktok";
  return k;
}

export function groupDrafts(drafts: DraftRow[]): { platform: string; drafts: DraftRow[] }[] {
  const m = new Map<string, DraftRow[]>();
  for (const d of drafts) {
    const k = normalizePlatform(d.platform);
    m.set(k, [...(m.get(k) ?? []), d]);
  }
  return [...m.entries()]
    .map(([platform, list]) => ({ platform, drafts: list }))
    .sort((a, b) => b.drafts.length - a.drafts.length || a.platform.localeCompare(b.platform));
}

/** One line per list: "664 old applicants, 75 already licensed, 2 never called". */
export function poolSummary(p: PoolState | null | undefined): { readymode: string; winback: string } {
  if (!p) return { readymode: "", winback: "" };
  return {
    readymode: `${num(p.readymode_leads)} old applicants with a dialable number, ${num(p.readymode_licensed)} already licensed, ${num(p.readymode_never_contacted)} never called`,
    winback: `${num(p.winback_agents)} former agents worth a call, ${num(p.winback_with_phone)} with a phone on file`,
  };
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" });
}
