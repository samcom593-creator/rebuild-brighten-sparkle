/**
 * An in-memory stand-in for the two tables the Launch Board saves to, enforcing the same rules the real schema does:
 * one LIVE card per brief.idea_key (a unique index), a primary key on dismissals, and archived cards excluded from the
 * key. It implements only the query chain the save layer uses. Synthetic records only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type FailRule = { table: string; op: "insert" | "update" | "select" | "delete"; error: { message: string; code?: string }; once?: boolean };

export function fakeContentDb(seed: { cards?: Row[]; dismissals?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { content_cards: [...(seed.cards ?? [])], content_idea_dismissals: [...(seed.dismissals ?? [])] };
  const calls: string[] = [];
  const failures: FailRule[] = [];
  let seq = 0;

  const read = (row: Row, col: string) => {
    if (col.includes("->>")) { const [a, b] = col.split("->>"); return row[a]?.[b]; }
    return row[col];
  };
  const uniqueViolation = (table: string, rows: Row[], candidate: Row, ignoreId?: string) => {
    if (table === "content_cards") {
      const key = candidate.brief?.idea_key;
      if (key && !candidate.archived_at && rows.some((r) => r.id !== ignoreId && r.brief?.idea_key === key && !r.archived_at)) return { code: "23505", message: 'duplicate key value violates unique constraint "content_cards_idea_key_live_uniq"' };
    }
    if (table === "content_idea_dismissals" && rows.some((r) => r.idea_key === candidate.idea_key)) return { code: "23505", message: 'duplicate key value violates unique constraint "content_idea_dismissals_pkey"' };
    return null;
  };

  function builder(table: string) {
    const st: { op: string | null; payload: Row | null; filters: [string, (v: any) => boolean][]; returning: boolean; single: "one" | "maybe" | null } = { op: null, payload: null, filters: [], returning: false, single: null };
    const b: any = {
      insert(p: Row) { st.op = "insert"; st.payload = p; return b; },
      update(p: Row) { st.op = "update"; st.payload = p; return b; },
      delete() { st.op = "delete"; return b; },
      select() { if (!st.op) st.op = "select"; else st.returning = true; return b; },
      eq(c: string, v: any) { st.filters.push([c, (x) => x === v]); return b; },
      is(c: string, v: any) { st.filters.push([c, (x) => (v === null ? x == null : x === v)]); return b; },
      filter(c: string, _op: string, v: any) { st.filters.push([c, (x) => x === v]); return b; },
      order() { return b; },
      single() { st.single = "one"; return b; },
      maybeSingle() { st.single = "maybe"; return b; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve().then(() => run()).then(resolve, reject);
      },
    };
    function run() {
      const op = st.op ?? "select";
      calls.push(`${table}.${op}`);
      const f = failures.findIndex((x) => x.table === table && x.op === op);
      if (f >= 0) { const rule = failures[f]; if (rule.once !== false) failures.splice(f, 1); return { data: null, error: rule.error }; }
      const rows = tables[table];
      const matches = rows.filter((r) => st.filters.every(([c, test]) => test(read(r, c))));
      const out = (list: Row[]) => {
        if (st.single === "one") return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        if (st.single === "maybe") return { data: list[0] ?? null, error: null };
        return { data: list, error: null };
      };
      if (op === "select") return out(matches);
      if (op === "insert") {
        const row: Row = { id: `row-${++seq}`, archived_at: null, brief: {}, ...st.payload };
        const bad = uniqueViolation(table, rows, row);
        if (bad) return { data: null, error: bad };
        rows.push(row);
        return st.returning ? out([row]) : { data: null, error: null };
      }
      if (op === "update") {
        const changed: Row[] = [];
        for (const r of matches) {
          const next = { ...r, ...st.payload };
          const bad = uniqueViolation(table, rows, next, r.id);
          if (bad) return { data: null, error: bad };
          Object.assign(r, st.payload);
          changed.push(r);
        }
        return st.returning ? out(changed) : { data: null, error: null };
      }
      if (op === "delete") { for (const r of matches) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
      return { data: null, error: { message: `unsupported op ${op}` } };
    }
    return b;
  }

  return { from: (t: string) => builder(t), tables, calls, failures, cards: () => tables.content_cards, dismissals: () => tables.content_idea_dismissals };
}
