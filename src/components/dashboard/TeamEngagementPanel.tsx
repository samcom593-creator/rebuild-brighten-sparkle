import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatTimeAgo } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * TeamEngagementPanel — /dashboard/team (2026-09-26).
 *
 * Sam: "fix the dashboards for my team… a lot more data for these people so I can
 * know how to help them… if they logged into their account, etc."
 *
 * Backed by the admin-only RPC admin_team_engagement(): the one place that puts an
 * agent's LOGIN truth (auth.users.last_sign_in_at) next to which onboarding emails
 * were actually SENT (Discord / course / get-licensed), whether the one-tap portal
 * link was sent and used, and course-module progress. Non-admins get zero rows, so
 * this renders nothing for them rather than an empty table that looks like data.
 */

type Row = {
  agent_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  license_status: string | null;
  onboarding_stage: string | null;
  hired_at: string | null;
  manager_name: string | null;
  has_login: boolean;
  last_sign_in_at: string | null;
  days_since_login: number | null;
  portal_email_last_sent_at: string | null;
  portal_link_used_at: string | null;
  discord_sent_at: string | null;
  discord_last_error: string | null;
  course_sent_at: string | null;
  get_licensed_sent_at: string | null;
  has_discord_access: boolean;
  has_training_course: boolean;
  modules_total: number | null;
  modules_completed: number | null;
  last_module_activity_at: string | null;
};

type FilterKey =
  | "all"
  | "never_logged_in"
  | "no_login"
  | "silent_7d"
  | "licensed_no_discord"
  | "portal_unused"
  | "no_course_progress";

const FILTERS: { key: FilterKey; label: string; hint: string; test: (r: Row) => boolean }[] = [
  { key: "all", label: "All", hint: "Every non-terminated agent", test: () => true },
  { key: "never_logged_in", label: "Never logged in", hint: "Has an account, has never signed in", test: (r) => r.has_login && !r.last_sign_in_at },
  { key: "no_login", label: "No account", hint: "No auth user attached — cannot log in at all", test: (r) => !r.has_login },
  { key: "silent_7d", label: "Silent 7d+", hint: "Logged in before, not in the last 7 days", test: (r) => !!r.last_sign_in_at && (r.days_since_login ?? 0) >= 7 },
  { key: "licensed_no_discord", label: "Licensed, no Discord email", hint: "Licensed but the Discord invite was never sent", test: (r) => r.license_status === "licensed" && !r.discord_sent_at },
  { key: "portal_unused", label: "Portal link unused", hint: "Got the one-tap login email, never used it, never signed in", test: (r) => !!r.portal_email_last_sent_at && !r.portal_link_used_at && !r.last_sign_in_at },
  { key: "no_course_progress", label: "Course, no progress", hint: "Enrolled in the course, zero modules completed", test: (r) => r.has_training_course && (r.modules_completed ?? 0) === 0 },
];

// Shared formatter: handles null ("—") and clamps future timestamps, per check:inline-timeago.
const rel = (iso: string | null): string => formatTimeAgo(iso);

function short(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]) as (keyof Row)[];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function TeamEngagementPanel() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  // See BrandLeadsPanel: d3cc9bdf referenced `open`/`setOpen` without declaring
  // them, so the toggle threw and the panel could never collapse.
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["admin-team-engagement"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("admin_team_engagement");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = query.data ?? [];
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<FilterKey, number>,
    [rows],
  );
  const visible = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
    const s = search.trim().toLowerCase();
    return rows
      .filter(active.test)
      .filter((r) => !s || [r.display_name, r.email, r.manager_name].some((v) => (v ?? "").toLowerCase().includes(s)));
  }, [rows, filter, search]);

  // Admin-only RPC returns zero rows for everyone else: render nothing, never a fake-empty table.
  if (!query.isLoading && !query.error && rows.length === 0) return null;

  const exportCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `team-engagement-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <CardTitle className="text-base sm:text-lg">Team engagement {open ? "▾" : "▸"}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {rows.length > 0
                ? `${counts.never_logged_in} never logged in · ${counts.silent_7d} silent 7d+ · ${counts.licensed_no_discord} licensed w/o Discord · tap to ${open ? "collapse" : "open"}`
                : "Who has logged in, which emails really went out, where each person is stuck."}
            </p>
          </button>
          {open && (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}>
              Export CSV ({visible.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.error && (
          <p className="text-sm text-amber-500">Couldn’t load engagement data: {(query.error as Error).message}</p>
        )}
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading engagement…</p>}

        {open && rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {FILTERS.filter((f) => f.key !== "all").map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(filter === f.key ? "all" : f.key)}
                  title={f.hint}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    filter === f.key ? "border-amber-500 bg-amber-500/10" : "border-border hover:border-amber-500/50"
                  }`}
                >
                  <div className="text-xl font-bold tabular-nums leading-none">{counts[f.key]}</div>
                  <div className="text-[12px] text-muted-foreground mt-1 leading-tight">{f.label}</div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, manager"
                className="h-9 max-w-xs"
              />
              {filter !== "all" && (
                <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>
                  Clear filter · showing {visible.length} of {rows.length}
                </Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hired</TableHead>
                    <TableHead>Last login</TableHead>
                    <TableHead>Portal link</TableHead>
                    <TableHead>Discord</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Manager</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.agent_id}>
                      <TableCell className="min-w-[180px]">
                        <div className="font-medium">{r.display_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.email ?? "no email"}{r.phone ? ` · ${r.phone}` : ""}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={r.license_status === "licensed" ? "default" : "secondary"}>{r.license_status ?? "—"}</Badge>
                          {r.onboarding_stage && <Badge variant="outline">{r.onboarding_stage.replace(/_/g, " ")}</Badge>}
                          {r.status !== "active" && <Badge variant="outline">{r.status}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{short(r.hired_at)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {!r.has_login ? (
                          <span className="text-amber-500">no account</span>
                        ) : !r.last_sign_in_at ? (
                          <span className="text-red-400">never</span>
                        ) : (
                          <span className={(r.days_since_login ?? 0) >= 7 ? "text-amber-500" : ""}>{rel(r.last_sign_in_at)}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.portal_email_last_sent_at ? (
                          <>
                            sent {rel(r.portal_email_last_sent_at)}
                            <div className={r.portal_link_used_at ? "text-emerald-400" : "text-muted-foreground"}>
                              {r.portal_link_used_at ? `used ${rel(r.portal_link_used_at)}` : "not used"}
                            </div>
                          </>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.discord_sent_at ? (
                          <span className="text-emerald-400">sent {rel(r.discord_sent_at)}</span>
                        ) : r.discord_last_error ? (
                          <span className="text-muted-foreground" title={r.discord_last_error}>skipped</span>
                        ) : (
                          <span className="text-amber-500">not sent</span>
                        )}
                        {r.has_discord_access && <div className="text-muted-foreground">access on</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.has_training_course ? (
                          <>
                            <span className="tabular-nums">{r.modules_completed ?? 0}/{r.modules_total ?? 0} modules</span>
                            <div className="text-muted-foreground">
                              {r.last_module_activity_at ? `active ${rel(r.last_module_activity_at)}` : r.course_sent_at ? `emailed ${rel(r.course_sent_at)}` : "no activity"}
                            </div>
                          </>
                        ) : r.get_licensed_sent_at ? (
                          <span className="text-muted-foreground">get-licensed emailed {rel(r.get_licensed_sent_at)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{r.manager_name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default TeamEngagementPanel;
