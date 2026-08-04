import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserX, AlertTriangle, Search, Phone, MessageSquare, Mail, MoreHorizontal, CheckCircle2, XCircle,
  ArrowRightLeft, PauseCircle, RefreshCw, Flame,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

interface InactiveEntry {
  id: string;
  agent_id: string;
  detected_at: string;
  days_inactive: number;
  last_production_date: string | null;
  last_login_at: string | null;
  last_contact_attempt_at: string | null;
  reason: string;
  severity: string;
  assigned_recovery_manager: string | null;
  recovery_attempts: number;
  last_recovery_attempt_at: string | null;
  recovery_notes: string | null;
  status: string;
  resolved_at: string | null;
  resolution: string | null;
}

interface AgentInfo {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
  onboarding_stage?: string;
  licensed: boolean;
}

const SEVERITY_META: Record<string, { label: string; color: string; icon: any }> = {
  warning: { label: "Warning", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  critical: { label: "Critical", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: Flame },
  abandoned: { label: "Abandoned", color: "bg-gray-500/30 text-gray-400 border-gray-500/40", icon: UserX },
};

const REASON_LABEL: Record<string, string> = {
  no_production_14d: "No production 14+ days",
  no_login_7d: "No login 7+ days",
  stalled_onboarding: "Stalled in onboarding",
  manual_flag: "Flagged manually",
};

type ProducerSegment = "all" | "never_sold" | "sold_at_least_one" | "sold_only_one";

export default function InactiveAgents() {
  const { user, isAdmin, isManager } = useAuth();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  // PL-063: CRM-grade segmentation — never sold, sold at least one,
  // sold exactly one. Each group needs different outreach pressure.
  const [segment, setSegment] = useState<ProducerSegment>("all");
  const [visibleCount, setVisibleCount] = useState(100);

  const canAccess = isAdmin || isManager;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["inactive-queue", statusFilter],
    queryFn: async (): Promise<InactiveEntry[]> => {
      let q = supabase.from("inactive_agent_queue" as any).select("*");
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      // severity is filtered client-side (below) so the stat tiles stay stable
      // instead of collapsing to the filtered subset.
      const { data, error } = await q.order("days_inactive", { ascending: false });
      if (error) {
        console.error(error);
        return [];
      }
      return (data as any) ?? [];
    },
    enabled: canAccess,
  });

  const sortedAgentIds = useMemo(
    () => [...entries.map((e) => e.agent_id)].sort(),
    [entries],
  );

  const { data: agentInfo = [] } = useQuery({
    queryKey: ["inactive-agents-info", sortedAgentIds],
    queryFn: async (): Promise<AgentInfo[]> => {
      if (entries.length === 0) return [];
      const { data } = await supabase
        .from("agents")
        .select(
          "id, display_name, user_id, onboarding_stage, profile:profiles!agents_profile_id_fkey(full_name, email, phone)",
        )
        .in("id", entries.map((e) => e.agent_id));
      const emails = ((data || []).map((a: any) => a.profile?.email).filter(Boolean)) as string[];
      let licensedEmails = new Set<string>();
      if (emails.length > 0) {
        const { data: apps } = await supabase
          .from("applications")
          .select("email, license_status")
          .in("email", emails);
        licensedEmails = new Set(
          (apps || []).filter((a: any) => a.license_status === "licensed").map((a: any) => a.email),
        );
      }
      return (data || []).map((a: any) => ({
        id: a.id,
        display_name: a.profile?.full_name || a.display_name || "—",
        email: a.profile?.email,
        phone: a.profile?.phone,
        onboarding_stage: a.onboarding_stage,
        licensed: licensedEmails.has(a.profile?.email),
      }));
    },
    enabled: entries.length > 0,
  });

  const agentMap = useMemo(() => new Map(agentInfo.map((a) => [a.id, a])), [agentInfo]);

  // PL-063: deal count per inactive agent for CRM segmentation.
  const { data: dealCounts = {} } = useQuery({
    queryKey: ["inactive-agents-deal-counts", sortedAgentIds],
    queryFn: async (): Promise<Record<string, number>> => {
      if (entries.length === 0) return {};
      const { data } = await supabase
        .from("deals")
        .select("agent_id")
        .in("agent_id", entries.map((e) => e.agent_id))
        .in("status", ["active", "submitted"]);
      const counts: Record<string, number> = {};
      for (const row of (data as Array<{ agent_id: string }>) ?? []) {
        counts[row.agent_id] = (counts[row.agent_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: entries.length > 0,
  });

  const segmentCounts = useMemo(() => {
    let neverSold = 0, atLeastOne = 0, onlyOne = 0;
    for (const e of entries) {
      const n = dealCounts[e.agent_id] ?? 0;
      if (n === 0) neverSold += 1;
      else {
        atLeastOne += 1;
        if (n === 1) onlyOne += 1;
      }
    }
    return { neverSold, atLeastOne, onlyOne };
  }, [entries, dealCounts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter((e) => {
      // severity filter (moved here from the query so the stat tiles stay stable).
      if (severityFilter !== "all" && (e as any).severity !== severityFilter) return false;

      // PL-063: segment filter first.
      const dealN = dealCounts[e.agent_id] ?? 0;
      if (segment === "never_sold" && dealN !== 0) return false;
      if (segment === "sold_at_least_one" && dealN === 0) return false;
      if (segment === "sold_only_one" && dealN !== 1) return false;

      if (!search) return true;
      const a = agentMap.get(e.agent_id);
      if (!a) return false;
      return (
        a.display_name.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.phone?.includes(q)
      );
    });
  }, [entries, search, agentMap, segment, dealCounts, severityFilter]);

  const stats = useMemo(() => {
    const result = { warning: 0, critical: 0, abandoned: 0, total: entries.length };
    for (const e of entries) {
      if (e.status !== "open") continue;
      if (e.severity in result) (result as any)[e.severity]++;
    }
    return result;
  }, [entries]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res: any = await supabase.functions.invoke("detect-inactive-agents", { body: {} });
      if (res?.error) throw new Error(res.error.message || "Scan failed");
      const added = res?.data?.inserted ?? 0;
      toast.success(`Scan complete. ${added} new inactive agent${added === 1 ? "" : "s"} flagged.`);
      queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message || "unknown"}`);
    } finally {
      setScanning(false);
    }
  };

  const resolve = async (id: string, status: string, note?: string) => {
    const { error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
        resolution: note || status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Marked ${status}`);
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
  };

  const logAttempt = async (id: string, notes: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const { error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        recovery_attempts: (entry.recovery_attempts || 0) + 1,
        last_recovery_attempt_at: new Date().toISOString(),
        recovery_notes: notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const bulkResolve = async (status: string) => {
    if (selectedIds.size === 0) return;
    const ok = await askConfirm({
      title: `Mark ${selectedIds.size} agent${selectedIds.size === 1 ? "" : "s"} as ${status}?`,
      description: `Every selected row gets status ${status} + resolved timestamp. This can be re-opened by editing the row.`,
      confirmText: `Mark ${status}`,
    });
    if (!ok) return;
    const { error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
        resolution: `Bulk ${status}`,
      })
      .in("id", Array.from(selectedIds));
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${selectedIds.size} marked ${status}`);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
  };

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Manager or admin access required</p>
      </div>
    );
  }

  if (isLoading && entries.length === 0) {
    return <PageLoadingSkeleton variant="list" />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <PageHeader
        accent="rose"
        eyebrow="Admin · Recovery"
        eyebrowIcon={<UserX className="h-3 w-3" />}
        title="Inactive Agent Recovery"
        subtitle="Find, re-engage, or re-route agents who've gone quiet. Severity color-coded by how long since last activity."
        actions={
          <Button onClick={runScan} disabled={scanning}>
            <RefreshCw className={scanning ? "h-4 w-4 mr-1.5 animate-spin" : "h-4 w-4 mr-1.5"} />
            {scanning ? "Scanning..." : "Run Inactivity Scan"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setSeverityFilter(severityFilter === "warning" ? "all" : "warning")}
          className={`p-4 rounded-md border text-left transition ${SEVERITY_META.warning.color} ${
            severityFilter === "warning" ? "ring-2 ring-primary" : ""
          }`}
        >
          <p className="text-xs uppercase opacity-70 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Warning
          </p>
          <p className="text-2xl font-bold">{stats.warning}</p>
          <p className="text-[10px] opacity-70">7-13 days inactive</p>
        </button>
        <button
          onClick={() => setSeverityFilter(severityFilter === "critical" ? "all" : "critical")}
          className={`p-4 rounded-md border text-left transition ${SEVERITY_META.critical.color} ${
            severityFilter === "critical" ? "ring-2 ring-primary" : ""
          }`}
        >
          <p className="text-xs uppercase opacity-70 flex items-center gap-1">
            <Flame className="h-3 w-3" /> Critical
          </p>
          <p className="text-2xl font-bold">{stats.critical}</p>
          <p className="text-[10px] opacity-70">14-30 days inactive</p>
        </button>
        <button
          onClick={() => setSeverityFilter(severityFilter === "abandoned" ? "all" : "abandoned")}
          className={`p-4 rounded-md border text-left transition ${SEVERITY_META.abandoned.color} ${
            severityFilter === "abandoned" ? "ring-2 ring-primary" : ""
          }`}
        >
          <p className="text-xs uppercase opacity-70 flex items-center gap-1">
            <UserX className="h-3 w-3" /> Abandoned
          </p>
          <p className="text-2xl font-bold">{stats.abandoned}</p>
          <p className="text-[10px] opacity-70">30+ days inactive</p>
        </button>
        <div className="p-4 rounded-md border bg-muted/30 text-left">
          <p className="text-xs uppercase text-muted-foreground">Total in Queue</p>
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-[10px] text-muted-foreground">Showing: {statusFilter}</p>
        </div>
      </div>

      {/* PL-063: Producer segment tabs. Each group needs different outreach. */}
      <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 p-1 flex-wrap">
        {([
          { key: "all" as ProducerSegment,                label: "All",                  count: entries.length },
          { key: "never_sold" as ProducerSegment,         label: "Never sold",           count: segmentCounts.neverSold },
          { key: "sold_at_least_one" as ProducerSegment,  label: "Sold ≥ 1",             count: segmentCounts.atLeastOne },
          { key: "sold_only_one" as ProducerSegment,      label: "Sold only one",        count: segmentCounts.onlyOne },
        ]).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSegment(key)}
            className={
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors " +
              (segment === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")
            }
          >
            {label} <span className="opacity-70">({count})</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="reactivated">Reactivated</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
            <SelectItem value="transferred">Transferred</SelectItem>
            <SelectItem value="snoozed">Snoozed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 flex-wrap">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const phones = filtered
                .filter((e) => selectedIds.has(e.id))
                .map((e) => agentMap.get(e.agent_id)?.phone)
                .filter(Boolean);
              if (phones.length === 0) {
                toast.error("No phones");
                return;
              }
              window.location.href = `sms:${phones.join(",")}`;
            }}
          >
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> Text All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const emails = filtered
                .filter((e) => selectedIds.has(e.id))
                .map((e) => agentMap.get(e.agent_id)?.email)
                .filter(Boolean);
              if (emails.length === 0) {
                toast.error("No emails");
                return;
              }
              window.location.href = `mailto:${emails.join(",")}`;
            }}
          >
            <Mail className="h-3.5 w-3.5 mr-1" /> Email All
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkResolve("reactivated")}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Reactivated
          </Button>
          <Button size="sm" variant="destructive" onClick={() => bulkResolve("terminated")}>
            <XCircle className="h-3.5 w-3.5 mr-1" /> Terminate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="ml-auto">
            Clear
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {isLoading && (
          <div className="space-y-2" aria-label="Loading inactive agents">
            {[0,1,2,3,4].map((i) => (
              /* stable-key-allow:skeleton */
              <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No inactive agents match this filter.{" "}
              {statusFilter === "open" && "Nice — everyone's active."}
            </CardContent>
          </Card>
        )}
        {filtered.slice(0, visibleCount).map((e) => {
          const agent = agentMap.get(e.agent_id);
          if (!agent) return null;
          const sev = SEVERITY_META[e.severity] || SEVERITY_META.warning;
          const SevIcon = sev.icon;
          const isOpen = e.status === "open";

          return (
            <Card key={e.id} className={isOpen && e.severity === "critical" ? "border-red-500/30" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} />
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold">{agent.display_name}</p>
                      <Badge variant="outline" className={sev.color + " text-xs"}>
                        <SevIcon className="h-3 w-3 mr-0.5" /> {sev.label}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {REASON_LABEL[e.reason] || e.reason}
                      </Badge>
                      {agent.licensed && (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs"
                        >
                          Licensed
                        </Badge>
                      )}
                      {!isOpen && (
                        <Badge variant="outline" className="bg-muted/30 text-xs">
                          {e.status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{e.days_inactive} days inactive</span>
                      {e.last_production_date && (
                        <span>Last prod {format(new Date(e.last_production_date), "MMM d")}</span>
                      )}
                      {e.recovery_attempts > 0 && (
                        <span>
                          {e.recovery_attempts} attempt{e.recovery_attempts === 1 ? "" : "s"}
                        </span>
                      )}
                      {e.last_recovery_attempt_at && (
                        <span>
                          Last contact{" "}
                          {formatDistanceToNow(new Date(e.last_recovery_attempt_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    {e.recovery_notes && (
                      <p className="text-xs text-muted-foreground italic mt-1 line-clamp-1">
                        Note: {e.recovery_notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {agent.phone && isOpen && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          asChild
                          title="Call"
                          onClick={() => logAttempt(e.id, "Called")}
                        >
                          <a href={`tel:${agent.phone}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          asChild
                          title="Text"
                          onClick={() => logAttempt(e.id, "Texted")}
                        >
                          <a href={`sms:${agent.phone}`}>
                            <MessageSquare className="h-4 w-4" />
                          </a>
                        </Button>
                      </>
                    )}
                    {agent.email && isOpen && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        asChild
                        title="Email"
                        onClick={() => logAttempt(e.id, "Emailed")}
                      >
                        <a href={`mailto:${agent.email}`}>
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {isOpen && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => resolve(e.id, "reactivated", "Agent came back")}>
                            <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Mark Reactivated
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => resolve(e.id, "transferred", "Transferred to another manager")}
                          >
                            <ArrowRightLeft className="h-4 w-4 mr-2 text-blue-400" /> Transfer to Another Manager
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => resolve(e.id, "snoozed", "Snoozed 14 days")}>
                            <PauseCircle className="h-4 w-4 mr-2 text-amber-400" /> Snooze 14 days
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => resolve(e.id, "terminated", "Terminated due to inactivity")}
                            className="text-destructive focus:text-destructive"
                          >
                            <XCircle className="h-4 w-4 mr-2" /> Terminate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {filtered.length > visibleCount && (
        <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
          <span className="text-muted-foreground">Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}</span>
          <button type="button" onClick={() => setVisibleCount((n) => n + 200)} className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted">Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)</button>
          <button type="button" onClick={() => setVisibleCount(filtered.length)} className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline">Show all</button>
        </div>
      )}
    </div>
  );
}
