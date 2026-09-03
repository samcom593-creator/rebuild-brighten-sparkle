import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Briefcase,
  CheckCircle2,
  Clock3,
  Mail,
  Phone,
  Search,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { looseSupabase } from "@/lib/looseSupabase";
import { phoneHref, contactLinkProps } from "@/lib/phone";

type OldApplicantKind = "managers" | "licensedRecruiters";

const PAGE_SIZE = 50;

interface OldApplicantRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  state: string | null;
  status: string | null;
  license_status: string | null;
  license_progress: string | null;
  referral_source: string | null;
  assigned_agent_id: string | null;
  referral_manager_id: string | null;
  recruiter_id: string | null;
  created_at: string;
  updated_at: string | null;
  last_contacted_at: string | null;
  notes: string | null;
  days_dormant: number;
}

interface AgentName {
  id: string;
  name: string;
}

function fullName(row: OldApplicantRow): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.email;
}

function lastActivity(row: OldApplicantRow): string {
  const value = row.last_contacted_at || row.updated_at || row.created_at;
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function dormancyChip(days: number): { label: string; cls: string } {
  if (days >= 60) return { label: `${days}d`, cls: "border-red-500/40 bg-red-500/10 text-red-300" };
  if (days >= 30) return { label: `${days}d`, cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
  return { label: `${days}d`, cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300" };
}

export default function OldApplicants({ kind }: { kind: OldApplicantKind }) {
  const title = kind === "managers" ? "Old Manager Applicants" : "Old Licensed Applicants";
  usePageTitle(`${title} · APEX`);

  const [search, setSearch] = useState("");
  const [dormantMin, setDormantMin] = useState<14 | 30 | 60>(14);
  const [page, setPage] = useState(0);

  const viewName = kind === "managers" ? "v_old_manager_applicants" : "v_old_licensed_applicants";

  const appsQ = useQuery({
    queryKey: ["old-applicants", kind, dormantMin, page, search],
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: OldApplicantRow[]; total: number }> => {
      let q = looseSupabase
        .from<Record<string, unknown>>(viewName)
        .select(
          "id, first_name, last_name, email, phone, state, status, license_status, license_progress, referral_source, assigned_agent_id, referral_manager_id, recruiter_id, created_at, updated_at, last_contacted_at, notes, days_dormant",
          { count: "exact" },
        )
        .gte("days_dormant", dormantMin)
        .order("days_dormant", { ascending: false });

      if (search.trim()) {
        const s = search.trim().replace(/[%_]/g, "");
        q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error, count } = await q.range(from, to);
      if (error) throw error;
      return {
        rows: (data ?? []).map((row) => ({
          id: String(row.id),
          first_name: String(row.first_name ?? ""),
          last_name: String(row.last_name ?? ""),
          email: String(row.email ?? ""),
          phone: row.phone != null ? String(row.phone) : null,
          state: row.state != null ? String(row.state) : null,
          status: row.status != null ? String(row.status) : null,
          license_status: row.license_status != null ? String(row.license_status) : null,
          license_progress: row.license_progress != null ? String(row.license_progress) : null,
          referral_source: row.referral_source != null ? String(row.referral_source) : null,
          assigned_agent_id: row.assigned_agent_id != null ? String(row.assigned_agent_id) : null,
          referral_manager_id: row.referral_manager_id != null ? String(row.referral_manager_id) : null,
          recruiter_id: row.recruiter_id != null ? String(row.recruiter_id) : null,
          created_at: String(row.created_at),
          updated_at: row.updated_at != null ? String(row.updated_at) : null,
          last_contacted_at: row.last_contacted_at != null ? String(row.last_contacted_at) : null,
          notes: row.notes != null ? String(row.notes) : null,
          days_dormant: typeof row.days_dormant === "number" ? row.days_dormant : 0,
        })),
        total: count ?? 0,
      };
    },
  });

  const rows = appsQ.data?.rows ?? [];
  const total = appsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const agentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const app of rows) {
      if (app.assigned_agent_id) ids.add(app.assigned_agent_id);
      if (app.referral_manager_id) ids.add(app.referral_manager_id);
      if (app.recruiter_id) ids.add(app.recruiter_id);
    }
    return Array.from(ids);
  }, [rows]);

  const agentsQ = useQuery({
    queryKey: ["old-applicant-agent-names", agentIds],
    enabled: agentIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentName[]> => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("agents")
        .select("id, display_name, profile:profiles!agents_profile_id_fkey(full_name)")
        .in("id", agentIds);
      if (error) throw error;
      return (data ?? []).map((agent) => {
        const profile = (agent.profile as { full_name?: string } | null) ?? null;
        return {
          id: String(agent.id),
          name: profile?.full_name || String(agent.display_name || "—"),
        };
      });
    },
  });

  const agentMap = useMemo(
    () => new Map((agentsQ.data ?? []).map((agent) => [agent.id, agent.name])),
    [agentsQ.data],
  );

  const stats = useMemo(() => {
    const licensedCount = rows.filter((r) => r.license_status === "licensed").length;
    return { shown: rows.length, totalInLane: total, licensed: licensedCount };
  }, [rows, total]);

  return (
    <div className="page-enter px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Applicants · Recovery"
        eyebrowIcon={<Archive className="h-3 w-3" />}
        title={title}
        subtitle={
          kind === "managers"
            ? "Manager-track / agency-owner applicants who've gone dormant. Tagged via qualified_role, hiring_scope_at_intake, previous_team_size, or manager_track_flagged_at."
            : "Licensed applicants who've gone dormant. Recovery lane — call before they re-apply elsewhere."
        }
        accent={kind === "managers" ? "blue" : "emerald"}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Briefcase} label="On this page" value={stats.shown} />
        <Stat icon={Archive} label={`Total dormant ≥${dormantMin}d`} value={stats.totalInLane} />
        <Stat icon={CheckCircle2} label="Licensed signals" value={stats.licensed} />
      </div>

      <Card className="mt-5 border-border/60 bg-card/80">
        <CardHeader className="gap-3 border-b border-border/50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Recovery Lane</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1 rounded-lg border border-border/40 p-1">
                {([14, 30, 60] as const).map((d) => (
                  <Button
                    key={d}
                    variant={dormantMin === d ? "default" : "ghost"}
                    size="sm"
                    onClick={() => { setDormantMin(d); setPage(0); }}
                  >
                    ≥{d}d
                  </Button>
                ))}
              </div>
              <div className="relative md:w-72">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                  placeholder="Search name, email, phone..."
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {appsQ.isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading old applicants...</div>
          ) : appsQ.error ? (
            <div className="p-5 text-sm text-destructive">
              View {viewName} could not load: {appsQ.error instanceof Error ? appsQ.error.message : "something went wrong — refresh to try again"}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Archive className="h-6 w-6" />}
              title={
                kind === "managers"
                  ? `No manager-track applicants dormant ≥${dormantMin}d match this search`
                  : `No licensed applicants dormant ≥${dormantMin}d match this search`
              }
              description={
                kind === "managers"
                  ? "Tag manager-track candidates during intake (previous_team_size > 0, qualified_role 'manager'/'agency', or manager_track_flagged_at) to surface them here."
                  : "Lower the dormancy threshold or clear search to widen the lane."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Applicant</TableHead>
                  <TableHead>Dormant</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const ownerId = row.referral_manager_id || row.assigned_agent_id || row.recruiter_id;
                  const owner = ownerId ? agentMap.get(ownerId) : null;
                  const chip = dormancyChip(row.days_dormant);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{fullName(row)}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={chip.cls}>
                          <Clock3 className="mr-1 h-3 w-3" />
                          {chip.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            row.license_status === "licensed" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
                          )}
                        >
                          {row.license_progress || row.license_status || "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <UserRoundCheck className="h-4 w-4 text-muted-foreground" />
                          <span>{owner || "Unassigned"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{lastActivity(row)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {row.phone ? (
                            <Button asChild variant="ghost" size="icon" aria-label="Call">
                              <a href={phoneHref(row.phone) ?? `tel:${row.phone}`} {...contactLinkProps(phoneHref(row.phone))}><Phone className="h-4 w-4" /></a>
                            </Button>
                          ) : null}
                          <Button asChild variant="ghost" size="icon" aria-label="Email">
                            <a href={`mailto:${row.email}`}><Mail className="h-4 w-4" /></a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border/40 p-3 text-sm">
            <div className="text-muted-foreground">
              Page {page + 1} of {totalPages} · {total} total
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}
