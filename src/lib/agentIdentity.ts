/**
 * The one answer to "which agents row is this login?" (F17, 2026-10-14).
 *
 * Before this module every page chose differently: MyDeals took the earliest
 * row, MyCommissions the latest, CallCenter and Today used .maybeSingle(),
 * which PostgREST answers with data=null on a multi-row match, so two rows
 * read as no row. agents.user_id has no unique index.
 *
 * Measured live on 2026-10-14 (project xrzweoneiieddzxogewk): 234 agents rows,
 * 215 live (canonical_agent_id IS NULL), 19 merged away. 0 logins hold more
 * than one live row. 11 logins hold ONLY merged-away rows whose winner sits
 * under a different login, and 1 login (live + merged) gets three different
 * answers from the three page rules. So the resolver follows the merge
 * pointer when a login has no live row, and it reports a failed read as an
 * error, never as "none".
 *
 * agents has no terminated_at column. A row is "working" when status is not
 * terminated/inactive AND is_inactive AND is_deactivated are both false:
 * 27 live rows are status=active with one of those flags set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { errorMessage } from "@/lib/queryState";

export const AGENT_IDENTITY_COLUMNS =
  "id, user_id, agent_code, display_name, status, is_inactive, is_deactivated, created_at, canonical_agent_id";
// deactivation_reason is deliberately NOT selected: role authenticated has no SELECT
// grant on that column (column-level grants since MP-329), so including it turned
// every agent login's resolve into HTTP 403 / 42501. Proven under a real session on
// 2026-10-15. The working-row rule reads status, is_inactive and is_deactivated only.

/** Live rows read per login. More than one is already an anomaly; five keeps the ambiguous list useful. */
export const AGENT_IDENTITY_ROW_LIMIT = 5;

/** Merge pointers followed before giving up (0 chains exist today). */
const MAX_MERGE_HOPS = 3;

export interface AgentIdentityRow {
  id: string;
  user_id: string | null;
  agent_code: string | null;
  display_name: string | null;
  /** agent_status enum: active | inactive | pending | terminated. */
  status: string;
  is_inactive: boolean | null;
  is_deactivated: boolean | null;
  created_at: string;
  canonical_agent_id: string | null;
}

export type AgentIdentity =
  | {
      status: "resolved";
      agentId: string;
      row: AgentIdentityRow;
      /** Set when the row was chosen among several, or reached through a merge pointer. */
      note?: string;
      /** The merged-away row that belongs to this login, when the winner was reached through its pointer. */
      mergedFromAgentId?: string;
    }
  | { status: "none" }
  | { status: "ambiguous"; candidates: AgentIdentityRow[] }
  | { status: "error"; message: string };

/** The part of the Supabase client this module needs. Tests pass a stub cast to this type. */
export type AgentIdentityClient = Pick<SupabaseClient<Database>, "from">;

/** Statuses that mean the row is no longer the person's working record. The live vocabulary is active, inactive, terminated (pending exists in the enum, 0 rows). */
export const NOT_WORKING_STATUSES: ReadonlySet<string> = new Set(["terminated", "inactive"]);

export function isWorkingAgentRow(row: Pick<AgentIdentityRow, "status" | "is_inactive" | "is_deactivated">): boolean {
  return !NOT_WORKING_STATUSES.has(row.status) && row.is_inactive !== true && row.is_deactivated !== true;
}

/** TanStack key every consumer shares, so one invalidation reaches every page. */
export function agentIdentityQueryKey(userId: string | null | undefined): readonly ["agent-identity", string | null] {
  return ["agent-identity", userId ?? null];
}

type ReadResult = { data: unknown; error: unknown };

function readFailure(error: unknown): AgentIdentity {
  return { status: "error", message: errorMessage(error, "The agent record could not be read.") };
}

function asRows(result: ReadResult): AgentIdentityRow[] | AgentIdentity {
  if (result.error) return readFailure(result.error);
  if (!Array.isArray(result.data)) return { status: "error", message: "The agent record read returned no result set." };
  return result.data as AgentIdentityRow[];
}

function isIdentity(value: AgentIdentityRow[] | AgentIdentity): value is AgentIdentity {
  return !Array.isArray(value);
}

function liveRowsFor(client: AgentIdentityClient, userId: string): PromiseLike<ReadResult> {
  return client
    .from("agents")
    .select(AGENT_IDENTITY_COLUMNS)
    .eq("user_id", userId)
    .is("canonical_agent_id", null)
    .order("created_at", { ascending: true })
    .limit(AGENT_IDENTITY_ROW_LIMIT) as unknown as PromiseLike<ReadResult>;
}

function mergedRowsFor(client: AgentIdentityClient, userId: string): PromiseLike<ReadResult> {
  return client
    .from("agents")
    .select(AGENT_IDENTITY_COLUMNS)
    .eq("user_id", userId)
    .not("canonical_agent_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(AGENT_IDENTITY_ROW_LIMIT) as unknown as PromiseLike<ReadResult>;
}

function rowById(client: AgentIdentityClient, id: string): PromiseLike<ReadResult> {
  return client.from("agents").select(AGENT_IDENTITY_COLUMNS).eq("id", id).limit(1) as unknown as PromiseLike<ReadResult>;
}

/**
 * Resolve the agents row for a login.
 *
 *   one live row                         -> resolved
 *   several live rows, exactly one working -> resolved, with a note
 *   several live rows otherwise          -> ambiguous (never picks)
 *   no live row, merged-away row(s) that all point at one winner -> resolved via the winner, with a note
 *   no live row, pointers disagree       -> ambiguous
 *   no row of any kind                   -> none
 *   any failed read, or no login         -> error (never none)
 */
export async function resolveAgentIdentity(client: AgentIdentityClient, userId: string | null | undefined): Promise<AgentIdentity> {
  if (!userId) return { status: "error", message: "No signed-in user to resolve an agent record for." };
  try {
    const live = asRows(await liveRowsFor(client, userId));
    if (isIdentity(live)) return live;

    if (live.length === 1) return { status: "resolved", agentId: live[0].id, row: live[0] };
    if (live.length > 1) {
      const working = live.filter(isWorkingAgentRow);
      if (working.length === 1) {
        return {
          status: "resolved",
          agentId: working[0].id,
          row: working[0],
          note: `${live.length} agent records share this login; using the one that is still working.`,
        };
      }
      return { status: "ambiguous", candidates: live };
    }

    const merged = asRows(await mergedRowsFor(client, userId));
    if (isIdentity(merged)) return merged;
    if (merged.length === 0) return { status: "none" };

    const targets = Array.from(new Set(merged.map((row) => row.canonical_agent_id).filter((id): id is string => Boolean(id))));
    if (targets.length !== 1) return { status: "ambiguous", candidates: merged };

    let targetId = targets[0];
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
      const winners = asRows(await rowById(client, targetId));
      if (isIdentity(winners)) return winners;
      const winner = winners[0];
      if (!winner) {
        return { status: "error", message: "This login's agent record was merged into a record that could not be read." };
      }
      if (winner.canonical_agent_id === null) {
        return {
          status: "resolved",
          agentId: winner.id,
          row: winner,
          mergedFromAgentId: merged[0].id,
          note: `This login's agent record was merged into ${winner.display_name ?? winner.agent_code ?? winner.id}.`,
        };
      }
      targetId = winner.canonical_agent_id;
    }
    return { status: "error", message: "This login's agent record points through more merges than can be followed." };
  } catch (err) {
    return readFailure(err);
  }
}
