export interface SocialSnapshot {
  platform: string;
  handle: string;
  followers: number | null;
  following: number | null;
  posts_total: number | null;
  engagement_rate: number | null;
  growth_7d: number | null;
  views_7d: number | null;
  reach_7d: number | null;
  taken_at: string;
  source: string;
  payload?: { window_days?: number; total_likes?: number; total_comments?: number } | null;
}

/** A saved import proves an observation, not the current connection or schedule. */
export function snapshotObservation(snapshot: SocialSnapshot, now = Date.now()): string {
  const at = Date.parse(snapshot.taken_at);
  if (!Number.isFinite(at) || at > now + 300_000) return "Observation time unavailable";
  const age = Math.max(0, now - at);
  const when = new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" });
  return `${snapshot.source === "manual" ? "Manual entry" : snapshot.source ? `Imported observation (${snapshot.source.replace(/_/g, " ")})` : "Saved observation (source unavailable)"} · ${when} (Phoenix)${age > 86_400_000 ? " · older than 24 hours" : ""}`;
}

export function snapshotWindow(snapshot: SocialSnapshot): number {
  const days = snapshot.payload?.window_days;
  return typeof days === "number" && Number.isInteger(days) && days > 0 && days <= 366 ? days : 7;
}

export function snapshotAccounts(rows: SocialSnapshot[], platform: string): SocialSnapshot[] {
  const seen = new Set<string>();
  return rows.filter(row => row.platform === platform && typeof row.handle === "string" && row.handle.trim())
    .sort((a, b) => (Date.parse(b.taken_at) || 0) - (Date.parse(a.taken_at) || 0))
    .filter(row => {
      const key = row.handle.trim().replace(/^@/, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}

export function socialProfileUrl(platform: string, rawHandle: string): string | null {
  const handle = rawHandle.trim().replace(/^@/, "");
  if (!handle || !/^[A-Za-z0-9_.-]+$/.test(handle)) return null;
  const encoded = encodeURIComponent(handle);
  if (platform === "instagram") return `https://www.instagram.com/${encoded}/`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${encoded}`;
  if (platform === "youtube") return handle.startsWith("UC") ? `https://www.youtube.com/channel/${encoded}` : `https://www.youtube.com/@${encoded}`;
  if (platform === "snapchat") return `https://www.snapchat.com/add/${encoded}`;
  return null;
}

export function parseSnapshotNumber(value: string, name: string, allowNegative = false, percentage = false): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(n) || (!allowNegative && n < 0) || (percentage ? n > 100 : !Number.isSafeInteger(n))) {
    throw new Error(`Enter a valid ${name.toLowerCase()} value.`);
  }
  return n;
}
