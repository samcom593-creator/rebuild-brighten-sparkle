// Audience filtering for bulk email/SMS/Discord sends.
//
// Sam's spec: agents and managers only get messages relevant to them.
// Operational content (hiring-pipeline bottlenecks, system health alerts,
// sync errors, automation summaries) should never reach producers —
// those go to admins/managers only. Competitive/motivational content
// (deal celebrations, leaderboards, streak rewards) goes to everyone.
//
// Use from any edge function:
//   import { filterByAudience } from "../_shared/audience.ts";
//   const targets = await filterByAudience(supabase, recipients, "operational");
//
// Audience categories:
//   "all"          — no filtering
//   "producers"    — licensed agents only (skip unlicensed applicants)
//   "managers"     — has admin or manager role
//   "operational"  — admins + managers only; producers never see these
//   "motivational" — everyone (alias of "all" but semantic for clarity)

export type AudienceKind = "all" | "producers" | "managers" | "operational" | "motivational";

export interface Recipient {
  email: string;
  user_id?: string;
  agent_id?: string;
}

interface SupabaseLike {
  from: (t: string) => any;
}

// Resolve user roles for a batch in one round-trip.
async function resolveRoles(
  supabase: SupabaseLike,
  userIds: string[],
): Promise<Map<string, string[]>> {
  if (userIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);
    const map = new Map<string, string[]>();
    (data ?? []).forEach((r: any) => {
      const arr = map.get(r.user_id) ?? [];
      arr.push(r.role);
      map.set(r.user_id, arr);
    });
    return map;
  } catch {
    return new Map();
  }
}

// Resolve agent license-status for a batch.
async function resolveLicenseStatus(
  supabase: SupabaseLike,
  agentIds: string[],
): Promise<Map<string, string>> {
  if (agentIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("agents")
      .select("id, license_status")
      .in("id", agentIds);
    const map = new Map<string, string>();
    (data ?? []).forEach((a: any) => map.set(a.id, a.license_status ?? "unlicensed"));
    return map;
  } catch {
    return new Map();
  }
}

export async function filterByAudience<T extends Recipient>(
  supabase: SupabaseLike,
  recipients: T[],
  kind: AudienceKind,
): Promise<T[]> {
  if (kind === "all" || kind === "motivational") return recipients;

  const userIds  = Array.from(new Set(recipients.map((r) => r.user_id).filter(Boolean) as string[]));
  const agentIds = Array.from(new Set(recipients.map((r) => r.agent_id).filter(Boolean) as string[]));

  const [roleMap, licenseMap] = await Promise.all([
    resolveRoles(supabase, userIds),
    resolveLicenseStatus(supabase, agentIds),
  ]);

  return recipients.filter((r) => {
    const roles = r.user_id ? (roleMap.get(r.user_id) ?? []) : [];
    const isManager = roles.includes("manager") || roles.includes("admin");
    const isAdmin   = roles.includes("admin");
    const license   = r.agent_id ? licenseMap.get(r.agent_id) : undefined;
    const isLicensed = license === "licensed";

    switch (kind) {
      case "producers":   return isLicensed;
      case "managers":    return isManager;
      case "operational": return isManager;   // admins + managers only
      default:            return true;
    }
  });
}
