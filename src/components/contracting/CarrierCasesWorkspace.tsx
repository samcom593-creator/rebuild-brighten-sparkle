/**
 * CarrierCasesWorkspace — /dashboard/contracting/cases
 *
 * One row per (agent, carrier). Lifecycle, blocker and accountable owner are
 * three independent columns, never collapsed into one "contracted" badge.
 *
 * Data: contracting_carrier_cases() over v_contracting_carrier_cases
 * (imported AgentLink carrier records joined to live, canonical,
 * non-placeholder agents, plus the staff tracking layer). The imported status
 * is labelled as an import with its last sync time everywhere it shows; staff
 * work cases here, never in AgentLink.
 *
 * Deep links: ?queue=<CASE_QUEUES key> opens a queue and ?q=<text> pre-fills
 * the search, so a count elsewhere can land on the cases it counted. Queue membership is decided in the database
 * (q_* columns) so this page and the staff digest cannot disagree.
 *
 * Writes: contracting_update_case() only. It logs before/after to the
 * append-only contracting_case_events. Nothing here sends a message.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { useAuth } from "@/hooks/useAuth";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BLOCKERS, BLOCKER_LABELS, CASE_QUEUES, LIFECYCLES, LIFECYCLE_LABELS, PRESUBMIT_LABELS, WAITING_ON, WAITING_ON_LABELS,
  agentLinkStatusLabel, blockerLabel, daysInStateLabel, distinctPeople, lifecycleLabel, mapAgentLinkStatus,
  summarizeQueues, verificationLabel, waitingOnLabel,
  type CarrierCaseRow,
} from "@/lib/contractingCases";
import { CARRIER_CASES_QUERY_KEY, fetchCarrierCases } from "@/lib/contractingCasesApi";

const ALL = "all";
const DERIVED = "__derived";
const NONE = "__none";

function lifecycleTone(lifecycle: string): string {
  switch (lifecycle) {
    case "verified_ready_to_write":
      return "border-success/40 bg-success/10 text-success";
    case "declined":
    case "additional_requirements":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "unknown":
      return "border-warning/40 bg-warning/10 text-warning";
    case "submitted":
    case "carrier_review":
    case "approved":
    case "ready_to_submit":
      return "border-primary/40 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function caseKey(r: Pick<CarrierCaseRow, "agent_id" | "carrier_name">): string {
  return `${r.agent_id}::${r.carrier_name}`;
}

// Sam 2026-10-06: the page listed every agent x carrier, mostly finished "Verified Ready to Write" rows,
// so the few cases that need something were buried. Default to those; "All cases" is one tap away.
const NEEDS = "__needs__";

export function CarrierCasesWorkspace() {
  const [searchParams] = useSearchParams();
  const [queue, setQueue] = useState<string>(() => {
    const requested = searchParams.get("queue");
    return requested && CASE_QUEUES.some((q) => q.key === requested) ? requested : requested === ALL ? ALL : NEEDS;
  });
  const [lifecycle, setLifecycle] = useState<string>(ALL);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [editing, setEditing] = useState<CarrierCaseRow | null>(null);

  const casesQ = useQuery({
    queryKey: CARRIER_CASES_QUERY_KEY,
    staleTime: 60_000,
    queryFn: () => fetchCarrierCases(),
  });

  const rows = useMemo(() => casesQ.data ?? [], [casesQ.data]);
  const queueCounts = useMemo(() => summarizeQueues(rows), [rows]);
  const needsRows = useMemo(() => rows.filter((r) => r.lifecycle !== "verified_ready_to_write"), [rows]);
  const lastSync = useMemo(
    () => rows.reduce<string | null>((max, r) => (r.al_synced_at && (!max || r.al_synced_at > max) ? r.al_synced_at : max), null),
    [rows],
  );
  const unknownCount = useMemo(() => rows.filter((r) => r.lifecycle === "unknown").length, [rows]);

  const shown = useMemo(() => {
    const q = CASE_QUEUES.find((x) => x.key === queue);
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (queue === NEEDS && r.lifecycle === "verified_ready_to_write") return false;
      if (q && r[q.column] !== true) return false;
      if (lifecycle !== ALL && r.lifecycle !== lifecycle) return false;
      if (!needle) return true;
      return (
        (r.agent_name ?? "").toLowerCase().includes(needle) ||
        r.carrier_name.toLowerCase().includes(needle) ||
        (r.owner_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, queue, lifecycle, search]);

  if (casesQ.isLoading) return <PageSkeleton />;

  if (casesQ.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">Carrier cases did not load.</p>
        <p className="mt-1 text-muted-foreground">{(casesQ.error as Error).message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => casesQ.refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            <span className="font-semibold tabular-nums text-foreground">{rows.length}</span> carrier cases across{" "}
            <span className="font-semibold tabular-nums text-foreground">{distinctPeople(rows)}</span> people
            {lastSync ? <> · imported AgentLink records, last synced {formatTimeAgo(lastSync)}</> : <> · no imported AgentLink records on file</>}
          </p>
          <p className="text-xs">
            Counts are carrier cases (one agent × one carrier); people are counted separately. Queues overlap and do not add up.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => casesQ.refetch()} disabled={casesQ.isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", casesQ.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {unknownCount > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" />
          {unknownCount} case{unknownCount === 1 ? "" : "s"} carry an imported AgentLink status this workspace does not recognise. They sit in Support, never in Verified.
        </p>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Carrier case queues">
        <QueueTab active={queue === NEEDS} onClick={() => setQueue(NEEDS)} label="Needs something" cases={needsRows.length} people={distinctPeople(needsRows)} />
        <QueueTab active={queue === ALL} onClick={() => setQueue(ALL)} label="All cases" cases={rows.length} people={distinctPeople(rows)} />
        {CASE_QUEUES.map((q) => (
          <QueueTab
            key={q.key}
            active={queue === q.key}
            onClick={() => setQueue(q.key)}
            label={q.label}
            hint={q.hint}
            cases={queueCounts[q.key]?.cases ?? 0}
            people={queueCounts[q.key]?.people ?? 0}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agent, carrier or owner"
          aria-label="Search carrier cases"
          className="h-9 w-64 max-w-full"
        />
        <Select value={lifecycle} onValueChange={setLifecycle}>
          <SelectTrigger className="h-9 w-56" aria-label="Filter by lifecycle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every lifecycle</SelectItem>
            {LIFECYCLES.map((l) => (
              <SelectItem key={l} value={l}>{LIFECYCLE_LABELS[l]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="ml-auto self-center text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{shown.length}</span> cases ·{" "}
          <span className="font-semibold tabular-nums text-foreground">{distinctPeople(shown)}</span> people shown
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No carrier cases yet: cases are built from imported AgentLink carrier records, and no live agent has one."
            : "No cases match this queue and filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Blocker</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Waiting on</TableHead>
                <TableHead>Last import</TableHead>
                <TableHead>In state</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <CaseRow key={caseKey(r)} row={r} onEdit={() => setEditing(r)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && <CaseDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function QueueTab({ active, onClick, label, hint, cases, people }: {
  active: boolean; onClick: () => void; label: string; hint?: string; cases: number; people: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={hint}
      onClick={onClick}
      className={cn(
        "shrink-0 border-b-2 px-3 py-2 text-left text-sm transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="block font-medium">{label}</span>
      <span className="block text-xs tabular-nums text-muted-foreground">
        {cases} cases · {people} people
      </span>
    </button>
  );
}

function CaseRow({ row, onEdit }: { row: CarrierCaseRow; onEdit: () => void }) {
  const verified = verificationLabel(row);
  const days = daysInStateLabel(row);
  const upstream = mapAgentLinkStatus(row.al_status);
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium">
        <AgentNameLink agentId={row.agent_id}>{row.agent_name ?? "Unnamed agent"}</AgentNameLink>
        {row.match_basis !== "agentlink_id" && (
          <span className="block text-xs text-muted-foreground">linked by {row.match_basis}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.carrier_name}
        {row.carrier_level && <span className="block text-xs text-muted-foreground">Level {row.carrier_level}</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className={cn("font-medium", lifecycleTone(row.lifecycle))}>{lifecycleLabel(row.lifecycle)}</Badge>
        <span className="block text-xs text-muted-foreground" title={`Imported AgentLink record alone reads as ${LIFECYCLE_LABELS[upstream.lifecycle]}`}>
          Imported status: {agentLinkStatusLabel(row.al_status)}
        </span>
        {verified && <span className="block text-xs text-success">{verified}</span>}
        {row.manual_verification_conflict && (
          <span className="block text-xs text-destructive">Staff verification conflicts with the imported AgentLink record</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        {blockerLabel(row.blocker) ?? <span className="text-muted-foreground">None</span>}
        {row.blocker_source === "staff" && <span className="block text-xs text-muted-foreground">set by staff</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        {row.owner_name ?? <span className="text-destructive">Unassigned</span>}
        {row.owner_source === "manager" && <span className="block text-xs text-muted-foreground">manager (default)</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">{waitingOnLabel(row.waiting_on) ?? <span className="text-muted-foreground">Nobody</span>}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {row.al_synced_at ? formatTimeAgo(row.al_synced_at) : "Never imported"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title={row.state_since_is_lower_bound ? "Already in this state when first observed; true age is at least this" : undefined}>
        {days ?? "Unknown"}
      </TableCell>
      <TableCell className="max-w-56 truncate text-sm" title={row.next_action ?? undefined}>
        {row.next_action ?? <span className="text-muted-foreground">Not set</span>}
      </TableCell>
      <TableCell className={cn("whitespace-nowrap text-sm tabular-nums", row.q_follow_up_due && "font-semibold text-destructive")}>
        {row.follow_up_on ?? <span className="text-muted-foreground">None</span>}
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={onEdit} aria-label={`Update ${row.carrier_name} case for ${row.agent_name ?? "agent"}`}>
          Update
        </Button>
      </TableCell>
    </TableRow>
  );
}

type OwnerOption = { user_id: string; name: string; roles: string[] };
type CaseEvent = { id: number; action: string; source: string; created_at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor_name: string | null };

function CaseDialog({ row, onClose }: { row: CarrierCaseRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin, isVa, isVaManager } = useAuth();
  const isStaff = !!(isAdmin || isVa || isVaManager);

  const [owner, setOwner] = useState<string>(row.owner_user_id ?? NONE);
  const [nextAction, setNextAction] = useState(row.next_action ?? "");
  const [followUp, setFollowUp] = useState(row.follow_up_on ?? "");
  const [waitingOn, setWaitingOn] = useState<string>(row.waiting_on_override ?? DERIVED);
  const [blocker, setBlocker] = useState<string>(
    row.blocker_override === "none" ? NONE : row.blocker_override ?? DERIVED,
  );
  const [note, setNote] = useState(row.note ?? "");
  const [stage, setStage] = useState<string>(row.carrier_stage ?? NONE);
  const [verifySource, setVerifySource] = useState("");
  const [evidence, setEvidence] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const ownersQ = useQuery({
    queryKey: ["contracting-case-owner-options"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OwnerOption[]> => {
      const { data, error } = await supabase.rpc("contracting_case_owner_options" as never);
      if (error) throw error;
      return (data ?? []) as unknown as OwnerOption[];
    },
  });

  const historyQ = useQuery({
    queryKey: ["contracting-case-events", row.agent_id, row.carrier_name],
    queryFn: async (): Promise<CaseEvent[]> => {
      const { data, error } = await supabase.rpc(
        "contracting_case_history" as never,
        { p_agent_id: row.agent_id, p_carrier: row.carrier_name } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as CaseEvent[];
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(
        "contracting_update_case" as never,
        { p_agent_id: row.agent_id, p_carrier: row.carrier_name, p_patch: patch } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Case updated");
      qc.invalidateQueries({ queryKey: CARRIER_CASES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["contracting-case-events", row.agent_id, row.carrier_name] });
      qc.invalidateQueries({ queryKey: ["agent-ready-to-write", row.agent_id] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Update refused"),
  });

  const saveTracking = () => {
    const patch: Record<string, unknown> = {
      next_action: nextAction.trim() || null,
      follow_up_on: followUp || null,
      note: note.trim() || null,
      owner_user_id: owner === NONE ? null : owner,
    };
    patch.waiting_on = waitingOn === DERIVED ? null : waitingOn;
    patch.blocker_override = blocker === DERIVED ? null : blocker === NONE ? "none" : blocker;
    if (isStaff && row.al_status === "submitted") patch.carrier_stage = stage === NONE ? null : stage;
    save.mutate(patch);
  };

  const presubmit = row.presubmit_missing ?? [];
  const verified = verificationLabel(row);
  const canVerify = isStaff && row.al_status !== "active" && !["declined", "additional_requirements"].includes(row.al_lifecycle);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.agent_name ?? "Agent"} · {row.carrier_name}</DialogTitle>
          <DialogDescription>
            {lifecycleLabel(row.lifecycle)} · imported AgentLink status “{agentLinkStatusLabel(row.al_status)}”
            {row.al_synced_at ? `, last synced ${formatTimeAgo(row.al_synced_at)}` : ""}.
            {row.upline_name ? ` Upline ${row.upline_name}.` : " No upline on the imported record."}
            {row.carrier_level ? ` Comp level ${row.carrier_level}.` : ""}
          </DialogDescription>
        </DialogHeader>

        {row.lifecycle === "ready_to_submit" && (
          <div className={cn("rounded-md border px-3 py-2 text-sm", presubmit.length ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10")}>
            <p className="font-medium">Pre-submission check</p>
            {presubmit.length === 0 ? (
              <p className="text-muted-foreground">Identity, NPN, agency approval, upline and comp level all present. Carrier-specific requirements still need a human check.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {presubmit.map((m) => <li key={m}>{PRESUBMIT_LABELS[m] ?? m}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="case-owner">Accountable owner</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="case-owner" aria-label="Accountable owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{row.manager_name ? `Default: manager (${row.manager_name})` : "Unassigned"}</SelectItem>
                {(ownersQ.data ?? []).map((o) => (
                  <SelectItem key={o.user_id} value={o.user_id}>{o.name} · {o.roles.join(", ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="case-follow-up">Follow-up date</Label>
            <Input id="case-follow-up" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="case-waiting-on">Waiting on</Label>
            <Select value={waitingOn} onValueChange={setWaitingOn}>
              <SelectTrigger id="case-waiting-on" aria-label="Waiting on"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DERIVED}>From imported record ({waitingOnLabel(mapAgentLinkStatus(row.al_status).waitingOn) ?? "nobody"})</SelectItem>
                {WAITING_ON.map((w) => <SelectItem key={w} value={w}>{WAITING_ON_LABELS[w]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="case-blocker">Blocker</Label>
            <Select value={blocker} onValueChange={setBlocker}>
              <SelectTrigger id="case-blocker" aria-label="Blocker"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DERIVED}>From imported record ({blockerLabel(mapAgentLinkStatus(row.al_status).blocker) ?? "none"})</SelectItem>
                <SelectItem value={NONE}>No blocker</SelectItem>
                {BLOCKERS.map((b) => <SelectItem key={b} value={b}>{BLOCKER_LABELS[b]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isStaff && row.al_status === "submitted" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="case-stage">Carrier stage (what the carrier told you)</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger id="case-stage" aria-label="Carrier stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Submitted, no carrier response recorded</SelectItem>
                  <SelectItem value="carrier_review">Carrier Review</SelectItem>
                  <SelectItem value="approved">Approved (not yet verified ready to write)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="case-next">Next action</Label>
            <Input id="case-next" value={nextAction} maxLength={500} onChange={(e) => setNextAction(e.target.value)} placeholder="The exact next step and who does it" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="case-note">Note</Label>
            <Textarea id="case-note" value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveTracking} disabled={save.isPending}>Save case</Button>
        </DialogFooter>

        {isStaff && (
          <div className="space-y-3 border-t border-border pt-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Verified ready to write</p>
              {verified ? (
                <p className="text-sm text-success">{verified}{row.evidence_ref ? ` · evidence: ${row.evidence_ref}` : ""}</p>
              ) : canVerify ? (
                <p className="text-xs text-muted-foreground">Record only what you confirmed yourself, with where you saw it.</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {row.al_status === "active" ? "Verified from the imported AgentLink carrier record." : `The imported AgentLink record shows ${agentLinkStatusLabel(row.al_status)}; staff verification is locked while it does. Record what the carrier tells you in the next action and note.`}
                </p>
              )}
            </div>
            {canVerify && !verified && (
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={verifySource} onChange={(e) => setVerifySource(e.target.value)} placeholder="Source (e.g. carrier portal, carrier email)" aria-label="Verification source" />
                <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence (writing number, ticket, link)" aria-label="Verification evidence reference" />
                <Button
                  variant="outline"
                  disabled={save.isPending || !verifySource.trim() || !evidence.trim()}
                  onClick={() => save.mutate({ verify: { source: verifySource.trim(), evidence_ref: evidence.trim() } })}
                >
                  Record verification
                </Button>
              </div>
            )}
            {verified && row.al_status !== "active" && (
              <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => save.mutate({ unverify: true })}>
                Remove staff verification
              </Button>
            )}
            {row.al_status !== "active" && (
              row.closed_at ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Closed: {row.closed_reason}</span>
                  <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate({ close: false })}>Reopen case</Button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Reason to close (e.g. agent not pursuing this carrier)" aria-label="Reason to close the case" />
                  <Button variant="outline" disabled={save.isPending || !closeReason.trim()} onClick={() => save.mutate({ close: true, closed_reason: closeReason.trim() })}>
                    Close case
                  </Button>
                </div>
              )
            )}
          </div>
        )}
        <div className="border-t border-border pt-3">
          <p className="text-sm font-semibold">History</p>
          {historyQ.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading history…</p>
          ) : historyQ.error ? (
            <p className="text-xs text-destructive">History did not load.</p>
          ) : (historyQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {(historyQ.data ?? []).map((e) => (
                <li key={e.id}>
                  <span className="tabular-nums">{formatTimeAgo(e.created_at)}</span> · {e.source === "agentlink_sync"
                    ? `Imported AgentLink status ${String(e.before?.status ?? "none")} → ${String(e.after?.status ?? "none")}`
                    : `${e.action}${e.actor_name ? ` by ${e.actor_name}` : ""}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CarrierCasesWorkspace;
