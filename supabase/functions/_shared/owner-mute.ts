// Owner inbox mute (MP-302, 2026-11-12).
//
// Sam's inbox carried copies of mail written for agents and applicants: the
// nightly numbers reminder, schedule auto-fill, licensing nudges addressed to
// his own test rows, a "just recruited" and a "started the course" notice per
// person. Over 14 days that was 60+ messages that asked nothing of him, and
// every one of those facts now arrives once a day in the owner overview.
//
// The switch is one row, system_settings.owner_email_mute, a JSON object:
//   { "enabled": true,
//     "owners":   ["info@kingofsales.net", ...],
//     "subjects": ["log your numbers", ...] }
// A send is muted when the recipient is an owner address AND the subject
// contains one of the phrases (case-insensitive). Anything else, including
// applicant alerts, sign-in links, payment and system failures, is untouched.
// Turn it off by setting enabled to false; nothing is deleted.
//
// A failed or missing lookup mutes nothing. This removes noise; it must never
// be the reason a message is lost because the database blinked.

export interface OwnerMutePolicy {
  enabled: boolean;
  owners: string[];
  subjects: string[];
}

export const REFUSED_OWNER_MUTED = "owner_muted";

const TTL_MS = 60_000;
let cache: { at: number; policy: OwnerMutePolicy | null } | null = null;

export function parseOwnerMute(raw: unknown): OwnerMutePolicy | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) =>
    Array.isArray(x) ? x.map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean) : [];
  return { enabled: v.enabled === true, owners: list(v.owners), subjects: list(v.subjects) };
}

/** The live policy, or null when it could not be read (callers then mute nothing). */
export async function loadOwnerMute(
  opts: { url?: string; key?: string; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<OwnerMutePolicy | null> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.policy;
  try {
    // Reading the environment sits inside the try: where it cannot be read at all, that is a
    // failed lookup like any other, and a failed lookup mutes nothing.
    const url = opts.url ?? Deno.env.get("SUPABASE_URL") ?? "";
    const key = opts.key ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return null;
    const res = await (opts.fetchImpl ?? fetch)(
      `${url}/rest/v1/system_settings?select=value&key=eq.owner_email_mute&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const policy = Array.isArray(rows) && rows.length > 0 ? parseOwnerMute(rows[0]?.value) : null;
    cache = { at: now, policy };
    return policy;
  } catch {
    return null;
  }
}

function plain(recipient: unknown): string {
  const s = String(recipient ?? "").trim();
  const m = s.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** True when this recipient should not get this subject. */
export function isOwnerMuted(policy: OwnerMutePolicy | null, recipient: unknown, subject: unknown): boolean {
  if (!policy || !policy.enabled) return false;
  if (!policy.owners.includes(plain(recipient))) return false;
  const s = String(subject ?? "").toLowerCase();
  return policy.subjects.some((p) => s.includes(p));
}

/** The recipients that still get the message. */
export function dropOwnerMuted<T>(policy: OwnerMutePolicy | null, recipients: T[], subject: unknown): T[] {
  return recipients.filter((r) => !isOwnerMuted(policy, r, subject));
}

/** Test hook. */
export function resetOwnerMuteCache(): void {
  cache = null;
}
