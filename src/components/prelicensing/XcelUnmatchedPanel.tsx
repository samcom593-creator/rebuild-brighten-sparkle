// XcelUnmatchedPanel — WP1 (onboarding audit 2026-11-10).
//
// Active Xcel course-takers who belong to no application and no agent
// (public.v_xcel_unmatched_active). These are the highest-intent recruits in the
// lane: they paid for the course. Before WP1 matching was exact-email, once, at
// insert time, so a student who enrolled through a downline or before applying
// had no owner and no stage.
//
// Staff link each one to an application or an agent in one click
// (public.admin_link_xcel_student). The next write-back stamps that record
// forward-only; nothing here messages the student. Automatic phone/name/agent
// matches are listed below the backlog so a wrong one is one click to unlink.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Link2Off, Loader2, Search, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// New relations/RPCs are not in the generated types until the integrator
// regenerates them, so this file talks to the client through a narrow untyped
// facade instead of `any` (same pattern as useRecruitingWorklist).
type DbError = { message: string; code?: string | null };
type QueryResult<T> = { data: T | null; error: DbError | null };
interface UntypedQuery<T> extends PromiseLike<QueryResult<T>> {
  select(columns: string): UntypedQuery<T>;
  in(column: string, values: readonly unknown[]): UntypedQuery<T>;
  order(column: string, options?: { ascending?: boolean }): UntypedQuery<T>;
  limit(n: number): UntypedQuery<T>;
}
interface UntypedClient {
  from(relation: string): UntypedQuery<unknown[]>;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}
const db = supabase as unknown as UntypedClient;

export interface XcelUnmatchedRow {
  student_id: string;
  first_name: string | null;
  last_initial: string | null;
  pct_complete: number | string | null;
  last_log_in: string | null;
  completed_on: string | null;
  days_since_enrolled: number | null;
  days_unmatched: number | null;
  hiring_manager_name: string | null;
  course_name: string | null;
  was_unlinked: boolean | null;
}

interface AppCandidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  license_status: string | null;
}

interface AgentCandidate {
  id: string;
  display_name: string | null;
  status: string | null;
}

interface AutoMatchRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  match_method: string | null;
  application_id: string | null;
  matched_agent_id: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  email_agent: "agent email",
  phone_app: "phone",
  name_window: "name + date",
};

function displayName(first: string | null, lastInitial: string | null): string {
  const f = (first ?? "").trim();
  const l = (lastInitial ?? "").trim();
  if (!f && !l) return "—";
  return l ? `${f} ${l}.` : f;
}

function pctOf(v: number | string | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Case-insensitive contains match on any of the given name parts. */
export function nameMatches(query: string, ...parts: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

async function linkStudent(studentId: string, applicationId: string | null, agentId: string | null) {
  const { data, error } = await db.rpc("admin_link_xcel_student", {
    p_student_id: studentId,
    p_application_id: applicationId,
    p_agent_id: agentId,
  });
  if (error) throw error;
  return data as { ok?: boolean } | null;
}

export function XcelUnmatchedPanel({ showAutoMatches }: { showAutoMatches: boolean }) {
  const qc = useQueryClient();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const unmatchedQ = useQuery({
    queryKey: ["xcel-unmatched-active"],
    staleTime: 60_000,
    queryFn: async () => {
      // public.v_xcel_unmatched_active through its RPC wrapper (oldest first);
      // first name + last initial only, no contact columns.
      const { data, error } = await db.rpc("admin_xcel_unmatched_active", {});
      if (error) throw error;
      return ((data ?? []) as XcelUnmatchedRow[]).slice(0, 200);
    },
  });

  // Candidates load only while a picker is open: recent real applications and
  // canonical agents, filtered client-side (no LIKE patterns built from input).
  const candidatesQ = useQuery({
    queryKey: ["xcel-link-candidates"],
    enabled: openFor !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const [apps, agents] = await Promise.all([
        supabase
          .from("applications")
          .select("id, first_name, last_name, created_at, license_status")
          .eq("is_duplicate", false)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("agents")
          .select("id, display_name, status")
          .is("canonical_agent_id", null)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (apps.error) throw apps.error;
      if (agents.error) throw agents.error;
      return {
        apps: (apps.data ?? []) as unknown as AppCandidate[],
        agents: (agents.data ?? []) as unknown as AgentCandidate[],
      };
    },
  });

  const autoQ = useQuery({
    queryKey: ["xcel-auto-matches"],
    enabled: showAutoMatches,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("xcel_pre_licensing_students")
        .select("id, email, first_name, last_name, match_method, application_id, matched_agent_id")
        .in("match_method", ["phone_app", "name_window", "email_agent"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      // one row per student identity
      const seen = new Set<string>();
      const out: AutoMatchRow[] = [];
      for (const r of (data ?? []) as AutoMatchRow[]) {
        const key = (r.email ?? r.id).trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      return out;
    },
  });

  const rows = useMemo(() => unmatchedQ.data ?? [], [unmatchedQ.data]);
  const matches = useMemo(() => {
    const c = candidatesQ.data;
    if (!c || !openFor) return { apps: [] as AppCandidate[], agents: [] as AgentCandidate[] };
    return {
      apps: c.apps.filter((a) => nameMatches(query, a.first_name, a.last_name)).slice(0, 6),
      agents: c.agents.filter((g) => nameMatches(query, g.display_name)).slice(0, 4),
    };
  }, [candidatesQ.data, openFor, query]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["xcel-unmatched-active"] });
    qc.invalidateQueries({ queryKey: ["xcel-auto-matches"] });
    qc.invalidateQueries({ queryKey: ["xcel-students-latest"] });
  }

  async function onLink(studentId: string, appId: string | null, agentId: string | null, label: string) {
    setBusy(studentId);
    try {
      await linkStudent(studentId, appId, agentId);
      toast.success(appId || agentId ? `Linked to ${label}. Progress applied forward-only.` : "Unlinked. The matcher will not re-link this student.");
      setOpenFor(null);
      setQuery("");
      refresh();
    } catch (e) {
      toast.error(`Link failed: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <GlassCard className="p-4 space-y-3" data-testid="xcel-unmatched-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold">Owner needed</p>
          <h3 className="text-lg font-bold">Xcel students not linked to anyone</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            In the course, but no application or agent record. Link each one so their progress lands on a record with an owner. Nobody is messaged from here.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">{unmatchedQ.isLoading ? "…" : rows.length} open</Badge>
      </div>

      {unmatchedQ.isError ? (
        <p className="text-sm text-rose-400">Could not load unlinked students: {(unmatchedQ.error as Error)?.message}</p>
      ) : unmatchedQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every active Xcel student is linked to a record.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = displayName(r.first_name, r.last_initial);
            const open = openFor === r.student_id;
            return (
              <li key={r.student_id} className="rounded-lg border border-border/50 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{name}</span>
                      <Badge variant="outline" className="text-[11px]">{pctOf(r.pct_complete)}%</Badge>
                      {r.completed_on && <Badge variant="outline" className="text-[11px] text-emerald-400 border-emerald-500/40">Finished {r.completed_on}</Badge>}
                      {r.was_unlinked && <Badge variant="outline" className="text-[11px]">Unlinked by staff</Badge>}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      {r.last_log_in ? `Last login ${r.last_log_in}` : "Never logged in"}
                      {r.days_since_enrolled != null && <> · enrolled {r.days_since_enrolled}d ago</>}
                      {r.days_unmatched != null && <> · unlinked {r.days_unmatched}d</>}
                      {r.hiring_manager_name && <> · Xcel hiring manager: {r.hiring_manager_name}</>}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={open ? "secondary" : "outline"}
                    onClick={() => { setOpenFor(open ? null : r.student_id); setQuery(open ? "" : (r.first_name ?? "")); }}
                  >
                    <Link2 className="h-3.5 w-3.5 mr-1" /> {open ? "Close" : "Link"}
                  </Button>
                </div>

                {open && (
                  <div className="mt-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Type a first and/or last name"
                        aria-label={`Find a record for ${name}`}
                        className="pl-9"
                      />
                    </div>
                    {candidatesQ.isLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading records…</div>
                    ) : candidatesQ.isError ? (
                      <p className="text-sm text-rose-400">Could not load records: {(candidatesQ.error as Error)?.message}</p>
                    ) : matches.apps.length === 0 && matches.agents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No application or agent matches that name. Type at least two letters.</p>
                    ) : (
                      <div className="grid gap-1.5">
                        {matches.apps.map((a) => {
                          const label = `${(a.first_name ?? "").trim()} ${(a.last_name ?? "").trim()}`.trim() || "—";
                          return (
                            <div key={`app-${a.id}`} className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-sm">
                              <span className="min-w-0 truncate">
                                <Users className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />
                                Application · {label} · applied {a.created_at.slice(0, 10)}{a.license_status ? ` · ${a.license_status}` : ""}
                              </span>
                              <Button size="sm" variant="outline" disabled={busy === r.student_id}
                                onClick={() => onLink(r.student_id, a.id, null, label)}>
                                Link
                              </Button>
                            </div>
                          );
                        })}
                        {matches.agents.map((g) => {
                          const label = (g.display_name ?? "").trim() || "—";
                          return (
                            <div key={`agent-${g.id}`} className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-sm">
                              <span className="min-w-0 truncate">
                                <UserCheck className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />
                                Agent · {label}{g.status ? ` · ${g.status}` : ""}
                              </span>
                              <Button size="sm" variant="outline" disabled={busy === r.student_id}
                                onClick={() => onLink(r.student_id, null, g.id, label)}>
                                Link
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showAutoMatches && (autoQ.data?.length ?? 0) > 0 && (
        <div className="pt-2 border-t border-border/40">
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Automatic matches to double-check</p>
          <ul className="space-y-1.5">
            {(autoQ.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {displayName(m.first_name, (m.last_name ?? "").slice(0, 1))} · matched by {METHOD_LABEL[m.match_method ?? ""] ?? m.match_method}
                  {m.application_id && (
                    <> · <Link to={`/dashboard/applicants?id=${m.application_id}`} className="underline underline-offset-2">application</Link></>
                  )}
                </span>
                <Button size="sm" variant="ghost" disabled={busy === m.id}
                  onClick={() => onLink(m.id, null, null, "")}>
                  <Link2Off className="h-3.5 w-3.5 mr-1" /> Unlink
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}

export default XcelUnmatchedPanel;
