import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserX, AlertTriangle, Search, Phone, MessageSquare, Mail, MoreHorizontal, CheckCircle2,
  ArrowRight, RefreshCw, Flame,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { QueryState } from "@/components/ui/query-state";
import { contactLinkProps, phoneHref, smsHref } from "@/lib/phone";
import {
  EMPTY_STATE_FILTER,
  countStates,
  matchesStateFilter,
  normalizeStates,
  type RecoveryPerson,
  type StateCountSummary,
  type StateFilter,
} from "@/lib/teamRecovery";

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
  updated_at: string;
}

interface AgentInfo {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
  onboarding_stage?: string;
  licensed: boolean;
  canonicalId: string;
  canContact: boolean;
}

const SEVERITY_META: Record<string, { label: string; color: string; icon: any }> = {
  warning: { label: "Warning", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  critical: { label: "Critical", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: Flame },
  abandoned: { label: "Abandoned", color: "bg-gray-500/30 text-muted-foreground border-gray-500/40", icon: UserX },
};

const REASON_LABEL: Record<string, string> = {
  no_production_14d: "No production 14+ days",
  no_login_7d: "No login 7+ days",
  stalled_onboarding: "Stalled in onboarding",
  manual_flag: "Flagged manually",
  no_recorded_activity: "No recent production or calling activity recorded",
  no_activity_since_joining: "No production or calling activity recorded since joining",
  activity_resumed: "Activity resumed — review recovery",
};

type ProducerSegment = "all" | "recorded" | "none_recorded" | "unknown";

// Stable empties: a fresh [] on every render would re-fire the parent callbacks below forever.
const NO_ENTRIES: InactiveEntry[] = [];
const NO_AGENTS: AgentInfo[] = [];
const NO_STATES = new Map<string, string[]>();

/**
 * MP-TEAM-RECOVERY: the queue also lives inside /dashboard/team-recovery. `embedded` drops the page
 * header (the parent has one) and moves the scan button into the toolbar, `stateFilter` narrows the
 * cases, and the two callbacks hand the parent the state counts and the people so one filter bar and
 * one By-state view can cover both lists. States come from fn_agent_states_bulk (leaders only).
 */
export interface InactiveAgentsProps {
  embedded?: boolean;
  stateFilter?: StateFilter;
  onStateCounts?: (counts: StateCountSummary) => void;
  onPeople?: (people: RecoveryPerson[]) => void;
}

type StatesRpc = (fn: string, args: Record<string, unknown>) => Promise<{
  data: Array<{ agent_id: string; states: string[] | null }> | null;
  error: { message: string } | null;
}>;

export default function InactiveAgents({
  embedded = false,
  stateFilter = EMPTY_STATE_FILTER,
  onStateCounts,
  onPeople,
}: InactiveAgentsProps = {}) {
  const { user, isAdmin, isManager } = useAuth();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [contactEntry, setContactEntry] = useState<InactiveEntry | null>(null);
  const [contactNotes, setContactNotes] = useState("");
  const [contactOutcome, setContactOutcome] = useState("No answer");
  const [savingContact, setSavingContact] = useState(false);
  // A missing or failed evidence read must not classify someone as a non-producer.
  const [segment, setSegment] = useState<ProducerSegment>("all");
  const [visibleCount, setVisibleCount] = useState(100);

  const canAccess = isAdmin || isManager;

  useEffect(() => { setSelectedIds(new Set()); setVisibleCount(100); }, [statusFilter, segment, severityFilter, search, user?.id]);

  // Whole-object + throw-on-error: the queryFn used to swallow .error and return
  // [], so a dead inactive_agent_queue rendered "everyone's active" + 0 tiles — a
  // retention lie (producer churn is the agency's core problem).
  const entriesQuery = useQuery({
    queryKey: ["inactive-queue", user?.id, statusFilter],
    queryFn: async (): Promise<InactiveEntry[]> => {
      let q = supabase.from("inactive_agent_queue" as any).select("*");
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      // severity is filtered client-side (below) so the stat tiles stay stable
      // instead of collapsing to the filtered subset.
      const { data, error } = await q.order("days_inactive", { ascending: false });
      if (error) throw error;
      return (data as any) ?? [];
    },
    enabled: canAccess,
  });
  const entries = entriesQuery.data ?? NO_ENTRIES;
  const isLoading = entriesQuery.isLoading;
  const entriesErrored = entriesQuery.isError && entriesQuery.data === undefined;

  const sortedAgentIds = useMemo(
    () => [...entries.map((e) => e.agent_id)].sort(),
    [entries],
  );

  const agentInfoQuery = useQuery({
    queryKey: ["inactive-agents-info", user?.id, sortedAgentIds],
    queryFn: async (): Promise<AgentInfo[]> => {
      if (entries.length === 0) return [];
      const { data, error } = await supabase
        .from("agents")
        .select(
          "id, display_name, user_id, onboarding_stage, canonical_agent_id, license_status, status, is_inactive, is_deactivated, profile:profiles!agents_profile_id_fkey(full_name, email, phone)",
        )
        .in("id", entries.map((e) => e.agent_id));
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Agent details could not be read.");
      return (data || []).map((a: any) => ({
        id: a.id,
        display_name: a.profile?.full_name || a.display_name || "—",
        email: a.profile?.email,
        phone: a.profile?.phone,
        onboarding_stage: a.onboarding_stage,
        licensed: a.license_status === "licensed",
        canonicalId: a.canonical_agent_id || a.id,
        canContact: a.status === "active" && !a.is_inactive && !a.is_deactivated,
      }));
    },
    enabled: canAccess && entries.length > 0,
  });
  const agentInfo = agentInfoQuery.data ?? NO_AGENTS;

  const agentMap = useMemo(() => new Map(agentInfo.map((a) => [a.id, a])), [agentInfo]);

  // MP-TEAM-RECOVERY: which states each agent can be given leads in, for the shared state filter.
  // A failed read is shown, and everyone is then treated as "no state on file" rather than hidden.
  const statesQuery = useQuery({
    queryKey: ["inactive-agent-states", user?.id, sortedAgentIds],
    queryFn: async (): Promise<Map<string, string[]>> => {
      if (sortedAgentIds.length === 0) return new Map();
      const { data, error } = await (supabase.rpc as unknown as StatesRpc)("fn_agent_states_bulk", { p_agent_ids: sortedAgentIds });
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((r) => [r.agent_id, normalizeStates(r.states)]));
    },
    enabled: canAccess && sortedAgentIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const statesMap = statesQuery.data ?? NO_STATES;

  const canonicalIds = useMemo(() => [...new Set(agentInfo.map(agent => agent.canonicalId))].sort(), [agentInfo]);
  const evidenceQuery = useQuery({
    queryKey: ["inactive-production-evidence", user?.id, canonicalIds],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_agent_activation_state")
        .select("agent_id, first_deal_at").in("agent_id", canonicalIds);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Production evidence could not be read.");
      return data;
    },
    enabled: canAccess && canonicalIds.length > 0 && agentInfoQuery.isSuccess,
  });
  const productionState = useMemo(() => {
    const byId = new Map((evidenceQuery.data ?? []).map(row => [row.agent_id, row]));
    return new Map(entries.map(entry => {
      const canonical = agentMap.get(entry.agent_id)?.canonicalId;
      const row = canonical ? byId.get(canonical) : undefined;
      const state: ProducerSegment = !evidenceQuery.isSuccess || !row ? "unknown"
        : row.first_deal_at ? "recorded" : "none_recorded";
      return [entry.agent_id, state];
    }));
  }, [entries, agentMap, evidenceQuery.data, evidenceQuery.isSuccess]);

  const segmentCounts = useMemo(() => {
    let recorded = 0, none = 0, unknown = 0;
    for (const e of entries) {
      const state = productionState.get(e.agent_id);
      if (state === "recorded") recorded++;
      else if (state === "none_recorded") none++;
      else unknown++;
    }
    return { recorded, none, unknown };
  }, [entries, productionState]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter((e) => {
      // severity filter (moved here from the query so the stat tiles stay stable).
      if (severityFilter !== "all" && (e as any).severity !== severityFilter) return false;

      // PL-063: segment filter first.
      if (segment !== "all" && productionState.get(e.agent_id) !== segment) return false;

      // MP-TEAM-RECOVERY: the shared state filter.
      if (!matchesStateFilter(statesMap.get(e.agent_id) ?? null, stateFilter)) return false;

      if (!search) return true;
      const a = agentMap.get(e.agent_id);
      if (!a) return false;
      return (
        a.display_name.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.phone?.includes(q)
      );
    });
  }, [entries, search, agentMap, segment, productionState, severityFilter, statesMap, stateFilter]);

  // MP-TEAM-RECOVERY: hand the parent every case (before any filter) for the shared state bar and the
  // By-state view. Inputs are memoized above so these fire only when the data actually changes.
  useEffect(() => {
    onStateCounts?.(countStates(entries.map((e) => statesMap.get(e.agent_id) ?? null)));
  }, [entries, statesMap, onStateCounts]);
  useEffect(() => {
    // A case whose agent details did not load stays on this list as "details unavailable"; it is
    // never handed up under a made-up name.
    onPeople?.(entries.flatMap((e) => {
      const a = agentMap.get(e.agent_id);
      if (!a) return [];
      return [{
        key: `rq:${e.id}`,
        name: a.display_name,
        phone: a.phone ?? null,
        states: statesMap.get(e.agent_id) ?? [],
        source: "recovery" as const,
        detail: e.reason === "activity_resumed" ? "Recent activity recorded" : `${e.days_inactive} days since recorded activity`,
        href: `/dashboard/agent/${a.canonicalId}`,
      }];
    }));
  }, [entries, agentMap, statesMap, onPeople]);

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
      if (!res.data || typeof res.data.inserted !== "number") throw new Error("Scan result could not be confirmed.");
      const added = res?.data?.inserted ?? 0;
      toast.success(`Scan complete. ${added} new recovery case${added === 1 ? "" : "s"}; ${res.data.updated ?? 0} existing cases refreshed.`);
      if (res.data.evidence_unknown > 0) toast.warning(`${res.data.evidence_unknown} agent records had incomplete activity evidence and were left unchanged.`);
      queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message || "unknown"}`);
    } finally {
      setScanning(false);
    }
  };

  const resolve = async (id: string, status: string, note?: string) => {
    const confirmed = await askConfirm({ title: "Confirm this agent has resumed activity?",
      description: "Close this recovery case only after reviewing current activity. This records your review and does not change the agent's account, manager or access.",
      confirmText: "Confirm recovery" });
    if (!confirmed) return;
    try {
    const { data, error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
        resolution: note || status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id).eq("status", "open").select("id").single();
    if (error || !data) {
      toast.error("The recovery case could not be updated. Refresh the queue before retrying.");
      return;
    }
    toast.success("Recovery review recorded.");
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
    } catch { toast.error("The recovery case could not be updated. Refresh before retrying."); }
  };

  const logAttempt = async () => {
    const entry = contactEntry;
    if (!entry || savingContact) return;
    setSavingContact(true);
    const at = new Date().toISOString();
    const note = `${at} · ${contactOutcome}${contactNotes.trim() ? ` — ${contactNotes.trim()}` : ""}`;
    try {
    const { data, error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        recovery_attempts: (entry.recovery_attempts || 0) + 1,
        last_recovery_attempt_at: at,
        recovery_notes: [entry.recovery_notes, note].filter(Boolean).join("\n"),
        updated_at: at,
      })
      .eq("id", entry.id).eq("status", "open").eq("updated_at", entry.updated_at).select("id").single();
    if (error || !data) {
      toast.error("Contact outcome could not be saved, or another manager updated this case. Refresh before retrying.");
      const refreshed = await entriesQuery.refetch();
      const current = refreshed.data?.find(row => row.id === entry.id && row.status === "open");
      if (current) setContactEntry(current);
      return;
    }
    setContactEntry(null);
    setContactNotes("");
    toast.success("Contact outcome recorded.");
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
    } catch { toast.error("Contact outcome could not be saved. Refresh before retrying."); }
    finally { setSavingContact(false); }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const bulkResolve = async (status: string) => {
    if (selectedIds.size === 0) return;
    const ok = await askConfirm({
      title: `Confirm recovery for ${selectedIds.size} selected case${selectedIds.size === 1 ? "" : "s"}?`,
      description: "Record this only after reviewing resumed activity for every selected agent. Account status, manager and access are unchanged.",
      confirmText: "Confirm recovery",
    });
    if (!ok) return;
    try {
    const { data, error } = await supabase
      .from("inactive_agent_queue" as any)
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
        resolution: `Bulk ${status}`,
        updated_at: new Date().toISOString(),
      })
      .in("id", Array.from(selectedIds)).eq("status", "open").select("id");
    if (error || data?.length !== selectedIds.size) {
      toast.error("Not all selected recovery cases were updated. Refresh the queue before retrying.");
      void queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
      return;
    }
    toast.success(`${selectedIds.size} recovery reviews recorded.`);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["inactive-queue"] });
    } catch { toast.error("Recovery reviews could not be saved. Refresh before retrying."); }
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

  const scanButton = (
    <Button onClick={runScan} disabled={scanning}>
      <RefreshCw className={scanning ? "h-4 w-4 mr-1.5 animate-spin" : "h-4 w-4 mr-1.5"} />
      {scanning ? "Scanning..." : "Run Inactivity Scan"}
    </Button>
  );

  const recoveryHeader = embedded ? null : (
    <PageHeader
      accent="rose"
      eyebrow="Admin · Recovery"
      eyebrowIcon={<UserX className="h-3 w-3" />}
      title="Inactive Agent Recovery"
      subtitle="Review recorded activity, contact agents, and record recovery outcomes. Use the agent profile for manager or account changes."
      actions={scanButton}
    />
  );

  const shellClass = embedded ? "space-y-6" : "space-y-6 p-4 md:p-6 page-enter";

  // A failed read is never "everyone's active". Replace the whole body (tiles,
  // segments, list) with the error so no 0 on the page reads as a clean queue.
  if (entriesErrored) {
    return (
      <div className={shellClass}>
        {recoveryHeader}
        <QueryState status="error" label="the recovery queue" error={entriesQuery.error} onRetry={() => void entriesQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {recoveryHeader}
      {embedded && <div className="flex justify-end">{scanButton}</div>}

      {agentInfoQuery.isError && <QueryState status="error" label="agent details" error={agentInfoQuery.error} onRetry={() => void agentInfoQuery.refetch()} />}
      {evidenceQuery.isError && <QueryState status="error" label="production evidence" error={evidenceQuery.error} onRetry={() => void evidenceQuery.refetch()} />}
      {statesQuery.isError && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          States could not load for these agents; the state filter treats everyone here as having no state on file.
        </p>
      )}

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
          <p className="text-[11px] opacity-70">7-13 days inactive</p>
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
          <p className="text-[11px] opacity-70">14-29 days inactive</p>
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
          <p className="text-[11px] opacity-70">30+ days inactive</p>
        </button>
        <div className="p-4 rounded-md border bg-muted/30 text-left">
          <p className="text-xs uppercase text-muted-foreground">Total in Queue</p>
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-[11px] text-muted-foreground">Showing: {statusFilter}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Recorded production does not confirm issue or payment. Unknown evidence needs review.</p>
      <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 p-1 flex-wrap">
        {([
          { key: "all" as ProducerSegment, label: "All", count: entries.length },
          { key: "recorded" as ProducerSegment, label: "Production recorded", count: segmentCounts.recorded },
          { key: "none_recorded" as ProducerSegment, label: "No production recorded", count: segmentCounts.none },
          { key: "unknown" as ProducerSegment, label: "Evidence unknown", count: segmentCounts.unknown },
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
          <SelectTrigger aria-label="Filter inactivity records by status" className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="reactivated">Recovery confirmed</SelectItem>
            <SelectItem value="terminated">Termination noted</SelectItem>
            <SelectItem value="transferred">Transfer noted</SelectItem>
            <SelectItem value="snoozed">Legacy snoozed</SelectItem>
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
                .filter((e) => selectedIds.has(e.id) && e.status === "open" && agentMap.get(e.agent_id)?.canContact)
                .map((e) => agentMap.get(e.agent_id)?.phone)
                .filter(Boolean);
              if (phones.length === 0) {
                toast.error("No phones");
                return;
              }
              /* contact-scheme-allow: opens a multi-recipient draft only; no contact is recorded. */
              window.location.href = `sms:${phones.join(",")}`;
            }}
          >
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> Open group text
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const emails = filtered
                .filter((e) => selectedIds.has(e.id) && e.status === "open" && agentMap.get(e.agent_id)?.canContact)
                .map((e) => agentMap.get(e.agent_id)?.email)
                .filter(Boolean);
              if (emails.length === 0) {
                toast.error("No emails");
                return;
              }
              window.location.href = `mailto:${emails.join(",")}`;
            }}
          >
            <Mail className="h-3.5 w-3.5 mr-1" /> Open email draft
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkResolve("reactivated")}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm recovery
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
              No recovery cases match this filter.
            </CardContent>
          </Card>
        )}
        {filtered.slice(0, visibleCount).map((e) => {
          const agent = agentMap.get(e.agent_id);
          if (!agent) return <Card key={e.id}><CardContent className="p-4 text-sm text-muted-foreground">{agentInfoQuery.isLoading ? "Loading agent details…" : "Agent details unavailable. This recovery case needs review."}</CardContent></Card>;
          const sev = SEVERITY_META[e.severity] || SEVERITY_META.warning;
          const SevIcon = sev.icon;
          const isOpen = e.status === "open";

          return (
            <Card key={e.id} className={isOpen && e.severity === "critical" ? "border-red-500/30" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  {isOpen && <Checkbox aria-label={`Select ${agent.display_name}`} checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} />}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link className="font-semibold hover:underline" to={`/dashboard/agent/${agent.canonicalId}`}>{agent.display_name}</Link>
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
                      <span>{e.reason === "activity_resumed" ? "Recent activity recorded" : `${e.days_inactive} days since recorded activity`}</span>
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
                          Last outcome recorded{" "}
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
                    {agent.phone && agent.canContact && isOpen && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          asChild
                          title="Open phone app"
                          aria-label={`Open phone app for ${agent.display_name}`}
                        >
                          <a href={phoneHref(agent.phone) ?? `tel:${agent.phone}`} {...contactLinkProps(phoneHref(agent.phone))}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          asChild
                          title="Open text draft"
                          aria-label={`Open text draft for ${agent.display_name}`}
                        >
                          <a href={smsHref(agent.phone) ?? `sms:${agent.phone}`} {...contactLinkProps(smsHref(agent.phone))}>
                            <MessageSquare className="h-4 w-4" />
                          </a>
                        </Button>
                      </>
                    )}
                    {agent.email && agent.canContact && isOpen && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        asChild
                        title="Open email draft"
                        aria-label={`Open email draft for ${agent.display_name}`}
                      >
                        <a href={`mailto:${agent.email}`}>
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {isOpen && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Recovery actions for ${agent.display_name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setContactEntry(e); setContactNotes(""); setContactOutcome("No answer"); }}>
                            <MessageSquare className="h-4 w-4 mr-2" /> Record contact outcome
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => resolve(e.id, "reactivated", "Manager confirmed resumed activity")}>
                            <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Confirm recovery
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to={`/dashboard/agent/${agent.canonicalId}`}><ArrowRight className="h-4 w-4 mr-2" /> Open agent profile</Link>
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
      <Dialog open={!!contactEntry} onOpenChange={(open) => { if (!open && !savingContact) setContactEntry(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record contact outcome</DialogTitle><DialogDescription>Opening a phone, text or email app does not record contact. Save what actually happened.</DialogDescription></DialogHeader>
          <label className="text-sm font-medium" htmlFor="recovery-outcome">Outcome</label>
          <Select value={contactOutcome} onValueChange={setContactOutcome} disabled={savingContact}>
            <SelectTrigger id="recovery-outcome"><SelectValue /></SelectTrigger>
            <SelectContent>{["No answer", "Voicemail left", "Message sent", "Connected"].map(outcome => <SelectItem key={outcome} value={outcome}>{outcome}</SelectItem>)}</SelectContent>
          </Select>
          <label className="text-sm font-medium" htmlFor="recovery-notes">Notes</label>
          <Textarea id="recovery-notes" value={contactNotes} onChange={event => setContactNotes(event.target.value)} disabled={savingContact} placeholder="Channel used, result, and next step agreed" maxLength={2000} />
          <Button onClick={logAttempt} disabled={savingContact}>{savingContact ? "Saving…" : "Save outcome"}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
