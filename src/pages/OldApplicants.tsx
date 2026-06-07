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

import { supabase } from "@/integrations/supabase/client";
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

type OldApplicantKind = "managers" | "licensedRecruiters";

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
  hiring_scope_at_intake: string | null;
  referral_source: string | null;
  assigned_agent_id: string | null;
  referral_manager_id: string | null;
  recruiter_id: string | null;
  is_ghosted: boolean | null;
  created_at: string;
  updated_at: string | null;
  closed_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  notes: string | null;
}

interface AgentName {
  id: string;
  name: string;
}

const db = supabase as any;

function fullName(row: OldApplicantRow): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.email;
}

function isOld(row: OldApplicantRow): boolean {
  const status = String(row.status ?? "").toLowerCase();
  return Boolean(
    row.terminated_at ||
      row.closed_at ||
      row.is_ghosted ||
      ["rejected", "disqualified", "lapsed", "closed", "ghosted", "not_interested"].includes(status),
  );
}

function isManagerApplicant(row: OldApplicantRow): boolean {
  const hay = [
    row.referral_source,
    row.termination_reason,
    row.notes,
    row.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return Boolean(row.referral_manager_id || row.assigned_agent_id || hay.includes("manager"));
}

function isLicensedRecruiterApplicant(row: OldApplicantRow): boolean {
  const hay = [
    row.hiring_scope_at_intake,
    row.license_status,
    row.license_progress,
    row.referral_source,
    row.termination_reason,
    row.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes("licensed") || hay.includes("recruiter");
}

function displayStatus(row: OldApplicantRow): string {
  if (row.terminated_at) return "Archived";
  if (row.closed_at) return "Closed";
  return row.status || "Old";
}

function lastActivity(row: OldApplicantRow): string {
  const value = row.terminated_at || row.closed_at || row.updated_at || row.created_at;
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export default function OldApplicants({ kind }: { kind: OldApplicantKind }) {
  const title = kind === "managers" ? "Old Manager Applicants" : "Old Licensed Recruiter Applicants";
  usePageTitle(`${title} · APEX`);
  const [search, setSearch] = useState("");

  const appsQ = useQuery({
    queryKey: ["old-applicants", kind],
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<OldApplicantRow[]> => {
      const { data, error } = await db
        .from("applications")
        .select("id, first_name, last_name, email, phone, state, status, license_status, license_progress, hiring_scope_at_intake, referral_source, assigned_agent_id, referral_manager_id, recruiter_id, is_ghosted, created_at, updated_at, closed_at, terminated_at, termination_reason, notes")
        .order("updated_at", { ascending: false })
        .limit(700);
      if (error) throw error;
      return ((data ?? []) as OldApplicantRow[]).filter(isOld);
    },
  });

  const agentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const app of appsQ.data ?? []) {
      if (app.assigned_agent_id) ids.add(app.assigned_agent_id);
      if (app.referral_manager_id) ids.add(app.referral_manager_id);
      if (app.recruiter_id) ids.add(app.recruiter_id);
    }
    return Array.from(ids);
  }, [appsQ.data]);

  const agentsQ = useQuery({
    queryKey: ["old-applicant-agent-names", agentIds],
    enabled: agentIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentName[]> => {
      const { data, error } = await db
        .from("agents")
        .select("id, display_name, profile:profiles!agents_profile_id_fkey(full_name)")
        .in("id", agentIds);
      if (error) throw error;
      return ((data ?? []) as any[]).map((agent) => ({
        id: agent.id,
        name: agent.profile?.full_name || agent.display_name || "Unknown",
      }));
    },
  });

  const agentMap = useMemo(() => {
    return new Map((agentsQ.data ?? []).map((agent) => [agent.id, agent.name]));
  }, [agentsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = (appsQ.data ?? []).filter((row) =>
      kind === "managers" ? isManagerApplicant(row) : isLicensedRecruiterApplicant(row),
    );
    if (!q) return base;
    return base.filter((row) => {
      const hay = [
        fullName(row),
        row.email,
        row.phone,
        row.state,
        row.status,
        row.license_status,
        row.license_progress,
        row.termination_reason,
        row.assigned_agent_id ? agentMap.get(row.assigned_agent_id) : "",
        row.referral_manager_id ? agentMap.get(row.referral_manager_id) : "",
        row.recruiter_id ? agentMap.get(row.recruiter_id) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agentMap, appsQ.data, kind, search]);

  const stats = useMemo(() => {
    const licensed = filtered.filter((row) => row.license_status === "licensed" || row.license_progress === "licensed").length;
    const archived = filtered.filter((row) => row.terminated_at).length;
    return { total: filtered.length, licensed, archived };
  }, [filtered]);

  return (
    <div className="page-enter px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Applicants · Archive"
        eyebrowIcon={<Archive className="h-3 w-3" />}
        title={title}
        subtitle={
          kind === "managers"
            ? "Old applicants tied to manager ownership or manager-track language. Unrelated old applicant categories stay out of this view."
            : "Old applicants with licensed or recruiter signals, kept separate from general applicant archives."
        }
        accent={kind === "managers" ? "blue" : "emerald"}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Briefcase} label="Shown" value={stats.total} />
        <Stat icon={CheckCircle2} label="Licensed signals" value={stats.licensed} />
        <Stat icon={Archive} label="Archived" value={stats.archived} />
      </div>

      <Card className="mt-5 border-border/60 bg-card/80">
        <CardHeader className="gap-3 border-b border-border/50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Clean Archive</CardTitle>
            <div className="relative md:w-80">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search old applicants..."
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {appsQ.isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading old applicants...</div>
          ) : appsQ.error ? (
            <div className="p-5 text-sm text-destructive">
              Old applicants could not load: {appsQ.error instanceof Error ? appsQ.error.message : "Unknown error"}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Archive className="h-6 w-6" />}
              title="No old applicants in this lane"
              description="This view intentionally excludes unrelated archived applicant categories."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Applicant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Owner / recruiter</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const ownerId = row.referral_manager_id || row.assigned_agent_id || row.recruiter_id;
                  const owner = ownerId ? agentMap.get(ownerId) : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{fullName(row)}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{displayStatus(row)}</Badge>
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
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock3 className="h-4 w-4" />
                          {lastActivity(row)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                        {row.termination_reason || row.referral_source || row.status || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {row.phone ? (
                            <Button asChild variant="ghost" size="icon" title="Call">
                              <a href={`tel:${row.phone}`}><Phone className="h-4 w-4" /></a>
                            </Button>
                          ) : null}
                          <Button asChild variant="ghost" size="icon" title="Email">
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
