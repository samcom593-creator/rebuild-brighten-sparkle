// resolve-one.ts — single-row resolution that cannot report ambiguity as absence.
//
// WHY THIS EXISTS
// PostgREST's .maybeSingle() sets data=null AND error.code='PGRST116' when the
// filter matches MORE than one row. Callers across this repo destructure only
// { data } and then branch on `if (!row)`, so "two rows agree about this person"
// silently becomes "this person does not exist."
//
// That is not hypothetical. On 2026-08-11 (MP-273) two profile rows that AGREED
// on carrier='tmobile' were read through .maybeSingle() as "no carrier on file",
// and the alert dispatcher recorded 5 SMS as sent that were never attempted.
// The fix note in that wave said callers should branch on the ambiguity rather
// than treating the person as missing. This file is that branch, made reusable.
//
// The audit that produced it (2026-08-12): 397 .maybeSingle() call sites, 163 of
// them filtering on columns carrying no unique index. The largest single shape is
// 51 sites doing agents.eq('user_id', uid).maybeSingle() — agents.user_id has a
// unique index on id, agent_code and ref_slug, but NOT on user_id or profile_id.
//
// WHAT IT DOES NOT DO
// It does not merge duplicates and it does not invent a winner out of nothing.
// Choosing the canonical row among real duplicates is Sam's call via the existing
// /admin/agent-duplicates merge flow. This only guarantees that an ambiguous read
// resolves to a defensible row and SAYS it was ambiguous, instead of returning
// null and letting the caller render "no agent" at somebody who has two.

export type Resolution<T> = {
  /** The chosen row, or null when the filter genuinely matched nothing. */
  row: T | null;
  /** How many rows the filter actually matched. */
  matched: number;
  /** True when matched > 1 — the state .maybeSingle() would have hidden as null. */
  ambiguous: boolean;
};

/**
 * Run a PostgREST query that is *expected* to yield one row, without using
 * .maybeSingle(). Pass a builder already carrying .from/.select/.eq — do NOT
 * append .single()/.maybeSingle() yourself.
 *
 * `prefer` orders the candidates when more than one matches; the first entry
 * wins. Without it, resolution falls back to the query's own order.
 */
export async function resolveOne<T = Record<string, unknown>>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { prefer?: (a: T, b: T) => number; label?: string } = {},
): Promise<Resolution<T>> {
  const { data, error } = await query;
  if (error) throw new Error(`resolveOne(${opts.label ?? "query"}) failed: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return { row: null, matched: 0, ambiguous: false };
  if (rows.length === 1) return { row: rows[0], matched: 1, ambiguous: false };

  const ordered = opts.prefer ? [...rows].sort(opts.prefer) : rows;
  // Loud on purpose. An ambiguous identity read is a data defect that wants
  // adjudicating in /admin/agent-duplicates, not a quiet fallback.
  console.warn(
    `[resolve-one] ${opts.label ?? "query"} matched ${rows.length} rows; ` +
      `resolved to the preferred one. This needs a merge, not a retry.`,
  );
  return { row: ordered[0], matched: rows.length, ambiguous: true };
}

/**
 * Preference order for duplicate `agents` rows: a live row beats a dead one,
 * an active row beats an inactive one, and a newer row beats an older one.
 * Deterministic, so two callers reading the same duplicate pair agree.
 */
export function preferLiveAgent(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const dead = (r: Record<string, unknown>) =>
    r.is_deactivated === true || r.status === "terminated" ? 1 : 0;
  const inactive = (r: Record<string, unknown>) => (r.status === "active" ? 0 : 1);
  const created = (r: Record<string, unknown>) =>
    typeof r.created_at === "string" ? Date.parse(r.created_at) : 0;

  return dead(a) - dead(b) || inactive(a) - inactive(b) || created(b) - created(a);
}

/**
 * Columns preferLiveAgent needs in order to rank. Callers must include these in
 * their .select() or the ordering silently degrades to "newest wins" — select
 * them explicitly rather than relying on the row happening to carry them.
 */
export const AGENT_RANK_COLUMNS = "is_deactivated, status, created_at";
