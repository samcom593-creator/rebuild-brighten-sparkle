import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Database,
  FileWarning,
  Filter,
  Loader2,
  Mail,
  Phone,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  firstAttemptDueAt,
  normalizeRecoveryStatus,
  scoreRecoveryOpportunity,
  type PriorityBand,
  type RecoveryLane,
  type RecoveryScore,
} from "@/lib/recovery/scoring";
import { cn } from "@/lib/utils";
import { logger } from "@/shared/lib/logger";

type SourceType = "ETHOS" | "AGENTLINK";
type WorkflowStatus =
  | "NEW"
  | "TRIAGE"
  | "ASSIGNED"
  | "ATTEMPTED"
  | "CONTACTED"
  | "REAPPLICATION_STARTED"
  | "SUBMITTED"
  | "ISSUED"
  | "PREMIUM_PAYING"
  | "NOT_INTERESTED"
  | "UNREACHABLE"
  | "SUPPRESSED"
  | "DUPLICATE"
  | "INELIGIBLE"
  | "DECEASED"
  | "CLOSED_OTHER";

type AgentRow = {
  id: string;
  display_name: string | null;
  license_states: string[] | null;
  is_deactivated: boolean | null;
  is_inactive: boolean | null;
};

type RecoveryCaseRow = {
  id: string;
  source_type: string;
  source_id: string;
  source_owner_agent_id: string;
  customer_state: string | null;
  assigned_agent_id: string | null;
  workflow_status: WorkflowStatus;
  disposition: string | null;
  suppression_status: "CLEAR" | "SUPPRESSED" | "NEEDS_REVIEW";
  compliance_status: "CLEAR" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
  contact_basis_confirmed: boolean;
  probable_duplicate: boolean;
  first_assigned_at: string | null;
  last_attempt_at: string | null;
  next_follow_up_at: string | null;
  next_action: string | null;
  calculated_score: number;
  calculated_band: PriorityBand;
  score_confidence: "complete" | "partial" | "low";
  score_components: unknown;
  manual_priority_band: PriorityBand | null;
  manual_priority_reason: string | null;
  version: number;
  updated_at: string;
};

type SourceRow = {
  sourceType: SourceType;
  sourceId: string;
  ownerAgentId: string;
  customerFirstName: string;
  customerLastName: string;
  customerState: string | null;
  phone: string | null;
  email: string | null;
  rawStatus: string;
  recordDate: string | null;
  importedAt: string;
  product: string | null;
  carrier: string;
  policyNumber: string | null;
  monthlyPremium: number | null;
  annualPremium: number | null;
  coverage: number | null;
  deceased: boolean;
  resumeCapable: boolean;
};

type Opportunity = SourceRow & {
  customerName: string;
  ownerName: string;
  assignedName: string | null;
  score: RecoveryScore;
  caseRow: RecoveryCaseRow | null;
  effectiveBand: PriorityBand;
  slaDueAt: string | null;
  slaState: "clear" | "risk" | "overdue";
};

type NoteRow = { id: string; body: string; created_at: string };
type AuditRow = { id: string; action: string; created_at: string };

const LANE_ORDER: Array<{ value: RecoveryLane | "ALL"; label: string; helper: string }> = [
  { value: "ALL", label: "All work", helper: "Every visible record" },
  { value: "LOW_HANGING", label: "Low-hanging fruit", helper: "Highest conversion likelihood" },
  { value: "RECOVERY", label: "Recovery queue", helper: "Eligible reactivation work" },
  { value: "ACTIVE_POLICY_REVIEW", label: "Active review", helper: "Compliance-gated only" },
  { value: "BLOCKED", label: "Blocked", helper: "Resolve data or compliance" },
  { value: "RECOVERED", label: "Recovered", helper: "Premium paying only" },
];

const WORKFLOW_OPTIONS: Array<{ value: WorkflowStatus; label: string }> = [
  { value: "NEW", label: "New" },
  { value: "TRIAGE", label: "Triaged" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "ATTEMPTED", label: "Attempted" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "REAPPLICATION_STARTED", label: "Reapplication started" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "ISSUED", label: "Issued" },
  { value: "PREMIUM_PAYING", label: "Premium paying" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "UNREACHABLE", label: "Unreachable" },
  { value: "SUPPRESSED", label: "Suppressed" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "INELIGIBLE", label: "Ineligible" },
  { value: "DECEASED", label: "Deceased" },
  { value: "CLOSED_OTHER", label: "Closed — other" },
];

const PHONE_PATTERN = /^\+?[\d\s().-]{10,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractState(address: string | null, payload: unknown): string | null {
  const source = recordObject(payload);
  const direct = [source.customer_state, source.client_state, source.state, source.resident_state]
    .map(textValue)
    .find((value) => value && /^[a-z]{2}$/i.test(value));
  if (direct) return direct.toUpperCase();
  const match = address?.toUpperCase().match(/(?:,|\s)\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?|\s*$)/);
  return match?.[1] ?? null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currency(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(value);
}

function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function localDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function timeUntil(value: string | null): string {
  if (!value) return "No SLA";
  const minutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  if (minutes < 0) return `${Math.abs(minutes)}m overdue`;
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.ceil(minutes / 60)}h left`;
}

function statusLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isAdministrativeStatus(rawStatus: string): boolean {
  return ["INITIAL_PREMIUM_FAILED", "PENDING_INITIAL_PREMIUM", "ROLLOVER_INCOMPLETE"]
    .includes(normalizeRecoveryStatus(rawStatus));
}

function priorityClasses(band: PriorityBand): string {
  if (band === "A") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (band === "B") return "border-primary/40 bg-primary/10 text-primary";
  if (band === "C") return "border-border bg-secondary text-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function laneClasses(lane: RecoveryLane): string {
  if (lane === "LOW_HANGING") return "border-primary/40 bg-primary/10 text-primary";
  if (lane === "BLOCKED") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (lane === "RECOVERED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  return "border-border bg-secondary text-secondary-foreground";
}

function sourceRows(ethos: Array<Record<string, unknown>>, agentLink: Array<Record<string, unknown>>): SourceRow[] {
  const ethosRows = ethos.map((row): SourceRow => {
    const payload = recordObject(row.source_payload);
    const rawStatus = String(row.raw_status ?? "Unknown");
    const address = textValue(row.client_address);
    return {
      sourceType: "ETHOS",
      sourceId: String(row.id),
      ownerAgentId: String(row.owner_agent_id),
      customerFirstName: String(row.client_first_name ?? ""),
      customerLastName: String(row.client_last_name ?? ""),
      customerState: extractState(address, payload),
      phone: textValue(row.client_phone),
      email: textValue(row.client_email),
      rawStatus,
      recordDate: textValue(payload.created_at) ?? textValue(payload.created_date) ?? textValue(row.effective_date) ?? textValue(row.imported_at),
      importedAt: String(row.imported_at),
      product: textValue(row.product_sold),
      carrier: String(row.carrier_name ?? "Ethos"),
      policyNumber: textValue(row.policy_number),
      monthlyPremium: numberValue(row.monthly_premium),
      annualPremium: numberValue(row.annual_premium),
      coverage: numberValue(row.face_amount),
      deceased: false,
      resumeCapable: ["INITIAL_PREMIUM_FAILED", "PENDING_INITIAL_PREMIUM", "ROLLOVER_INCOMPLETE", "APPLICATION_STARTED"]
        .includes(normalizeRecoveryStatus(rawStatus)) || Boolean(payload.resume_url ?? payload.resumeUrl),
    };
  });

  const agentLinkRows = agentLink.map((row): SourceRow => ({
    sourceType: "AGENTLINK",
    sourceId: String(row.deal_key),
    ownerAgentId: String(row.agent_id ?? ""),
    customerFirstName: String(row.client_first_name ?? ""),
    customerLastName: String(row.client_last_name ?? ""),
    customerState: null,
    phone: null,
    email: null,
    rawStatus: String(row.status ?? "Unknown"),
    recordDate: textValue(row.posted_date) ?? textValue(row.effective_date) ?? textValue(row.imported_at),
    importedAt: String(row.imported_at),
    product: textValue(row.product),
    carrier: String(row.carrier ?? "Carrier not mapped"),
    policyNumber: textValue(row.policy_number),
    monthlyPremium: numberValue(row.monthly_premium),
    annualPremium: numberValue(row.annual_premium),
    coverage: numberValue(row.face_amount),
    deceased: Boolean(row.is_dead),
    resumeCapable: false,
  }));

  return [...ethosRows, ...agentLinkRows].filter((row) => row.ownerAgentId);
}

function MetricCard({ label, value, helper, tone = "default" }: { label: string; value: string; helper: string; tone?: "default" | "danger" | "success" }) {
  return (
    <Card className={cn(tone === "danger" && "border-destructive/40", tone === "success" && "border-emerald-500/40")}>
      <CardContent className="p-4 sm:p-5">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}

function PriorityBadge({ band, score }: { band: PriorityBand; score: number }) {
  return (
    <span className={cn("inline-flex min-w-[74px] items-center justify-center rounded-md border px-3 py-2 text-sm font-bold tabular-nums", priorityClasses(band))}>
      {band} · {score}
    </span>
  );
}

export default function RecoveryCommand() {
  const { toast } = useToast();
  const [rawRows, setRawRows] = useState<SourceRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cases, setCases] = useState<RecoveryCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflowAvailable, setWorkflowAvailable] = useState(true);
  const [lane, setLane] = useState<RecoveryLane | "ALL">("LOW_HANGING");
  const [query, setQuery] = useState("");
  const [bandFilter, setBandFilter] = useState<PriorityBand | "ALL">("ALL");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    const [ethosResult, agentLinkResult, agentsResult, casesResult] = await Promise.all([
      supabase
        .from("ethos_book_policies")
        .select("id, owner_agent_id, client_first_name, client_last_name, client_address, client_phone, client_email, face_amount, raw_status, effective_date, product_sold, policy_number, monthly_premium, annual_premium, carrier_name, source_payload, imported_at")
        .order("imported_at", { ascending: false })
        .limit(5000),
      supabase
        .from("v_agentlink_book_scoped")
        .select("deal_key, agent_id, client_first_name, client_last_name, face_amount, status, effective_date, posted_date, product, policy_number, monthly_premium, annual_premium, carrier, is_dead, imported_at")
        .order("imported_at", { ascending: false })
        .limit(5000),
      supabase
        .from("agents")
        .select("id, display_name, license_states, is_deactivated, is_inactive")
        .eq("is_deactivated", false)
        .eq("is_inactive", false),
      supabase
        .from("policy_recovery_cases" as never)
        .select("*")
        .order("updated_at", { ascending: false }),
    ]);

    if (ethosResult.error && agentLinkResult.error) {
      setLoadError("Recovery sources could not be loaded. Verify the signed-in manager scope and source imports.");
      logger.error("[RecoveryCommand] source reads failed", { ethos: ethosResult.error.message, agentLink: agentLinkResult.error.message });
    }
    if (agentsResult.error) logger.warn("[RecoveryCommand] agent roster read failed", { error: agentsResult.error.message });
    if (casesResult.error) {
      setWorkflowAvailable(false);
      logger.warn("[RecoveryCommand] workflow store unavailable", { error: casesResult.error.message });
    } else {
      setWorkflowAvailable(true);
    }

    setRawRows(sourceRows(
      (ethosResult.data ?? []) as unknown as Array<Record<string, unknown>>,
      (agentLinkResult.data ?? []) as unknown as Array<Record<string, unknown>>,
    ));
    setAgents((agentsResult.data ?? []) as AgentRow[]);
    setCases(casesResult.error ? [] : (casesResult.data ?? []) as unknown as RecoveryCaseRow[]);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const opportunities = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const caseBySource = new Map(cases.map((row) => [`${row.source_type}:${row.source_id}`, row]));
    return rawRows.map((row): Opportunity => {
      const caseRow = caseBySource.get(`${row.sourceType}:${row.sourceId}`) ?? null;
      const availableLicensedAgents = row.customerState
        ? agents.filter((agent) => (agent.license_states ?? []).map((state) => state.toUpperCase()).includes(row.customerState as string))
        : [];
      const score = scoreRecoveryOpportunity({
        rawStatus: row.rawStatus,
        recordDate: row.recordDate,
        resumeCapable: row.resumeCapable,
        hasProductSelection: Boolean(row.product && (row.monthlyPremium || row.annualPremium || row.coverage)),
        administrativeIssue: isAdministrativeStatus(row.rawStatus),
        hasValidPhone: PHONE_PATTERN.test(row.phone ?? ""),
        hasValidEmail: EMAIL_PATTERN.test(row.email ?? ""),
        contactBasisConfirmed: caseRow?.contact_basis_confirmed ?? false,
        lastAttemptAt: caseRow?.last_attempt_at,
        suppressed: caseRow?.suppression_status === "SUPPRESSED" || caseRow?.workflow_status === "SUPPRESSED",
        deceased: row.deceased || caseRow?.workflow_status === "DECEASED",
        probableDuplicate: caseRow?.probable_duplicate ?? false,
        complianceReviewRequired: caseRow?.compliance_status === "NEEDS_REVIEW",
        hasLicensedAgentAvailable: availableLicensedAgents.length > 0,
        workflow: caseRow?.workflow_status,
      });
      const effectiveBand = caseRow?.manual_priority_band ?? score.band;
      const slaDueAt = firstAttemptDueAt(caseRow?.first_assigned_at, effectiveBand);
      const minutesUntilDue = slaDueAt ? (Date.parse(slaDueAt) - Date.now()) / 60_000 : null;
      const attempted = Boolean(caseRow?.last_attempt_at) || !["NEW", "TRIAGE", "ASSIGNED"].includes(caseRow?.workflow_status ?? "NEW");
      const slaState = !attempted && minutesUntilDue != null && minutesUntilDue < 0
        ? "overdue"
        : !attempted && minutesUntilDue != null && minutesUntilDue <= 30
          ? "risk"
          : "clear";
      return {
        ...row,
        customerName: `${row.customerFirstName} ${row.customerLastName}`.trim() || "Customer name missing",
        ownerName: agentById.get(row.ownerAgentId)?.display_name ?? "Owner not mapped",
        assignedName: caseRow?.assigned_agent_id ? agentById.get(caseRow.assigned_agent_id)?.display_name ?? "Assigned agent" : null,
        score,
        caseRow,
        effectiveBand,
        slaDueAt,
        slaState,
      };
    }).sort((a, b) => {
      const bandRank: Record<PriorityBand, number> = { A: 0, B: 1, C: 2, D: 3 };
      return bandRank[a.effectiveBand] - bandRank[b.effectiveBand]
        || b.score.score - a.score.score
        || (Date.parse(b.recordDate ?? "") || 0) - (Date.parse(a.recordDate ?? "") || 0);
    });
  }, [agents, cases, rawRows]);

  const laneCounts = useMemo(() => {
    const counts: Record<RecoveryLane | "ALL", number> = { ALL: opportunities.length, LOW_HANGING: 0, RECOVERY: 0, ACTIVE_POLICY_REVIEW: 0, BLOCKED: 0, RECOVERED: 0 };
    for (const opportunity of opportunities) counts[opportunity.score.lane] += 1;
    return counts;
  }, [opportunities]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return opportunities.filter((opportunity) => {
      if (lane !== "ALL" && opportunity.score.lane !== lane) return false;
      if (bandFilter !== "ALL" && opportunity.effectiveBand !== bandFilter) return false;
      if (!needle) return true;
      return [opportunity.customerName, opportunity.policyNumber, opportunity.carrier, opportunity.product, opportunity.ownerName, opportunity.assignedName]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [bandFilter, lane, opportunities, query]);

  const selected = useMemo(
    () => opportunities.find((opportunity) => `${opportunity.sourceType}:${opportunity.sourceId}` === selectedKey) ?? null,
    [opportunities, selectedKey],
  );

  useEffect(() => {
    if (!selected?.caseRow?.id || !workflowAvailable) {
      setNotes([]);
      setAudits([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      supabase.from("policy_recovery_notes" as never).select("id, body, created_at").eq("case_id", selected.caseRow.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("policy_recovery_audit_events" as never).select("id, action, created_at").eq("case_id", selected.caseRow.id).order("created_at", { ascending: false }).limit(20),
    ]).then(([noteResult, auditResult]) => {
      if (cancelled) return;
      setNotes((noteResult.data ?? []) as unknown as NoteRow[]);
      setAudits((auditResult.data ?? []) as unknown as AuditRow[]);
    });
    return () => { cancelled = true; };
  }, [selected?.caseRow?.id, workflowAvailable]);

  const metrics = useMemo(() => {
    const priorityA = opportunities.filter((item) => item.score.eligible && item.effectiveBand === "A").length;
    const unassigned = opportunities.filter((item) => item.score.eligible && !item.caseRow?.assigned_agent_id).length;
    const slaRisk = opportunities.filter((item) => item.slaState !== "clear").length;
    const eligibleAssigned = opportunities.filter((item) => item.caseRow?.first_assigned_at && item.score.lane !== "ACTIVE_POLICY_REVIEW");
    const recovered = eligibleAssigned.filter((item) => item.caseRow?.workflow_status === "PREMIUM_PAYING");
    const assignedLast60 = eligibleAssigned.filter((item) => Date.now() - Date.parse(item.caseRow?.first_assigned_at ?? "") <= 60 * 86_400_000);
    const recoveredLast60 = assignedLast60.filter((item) => item.caseRow?.workflow_status === "PREMIUM_PAYING");
    return {
      priorityA,
      unassigned,
      slaRisk,
      recovered: recovered.length,
      recoveredPremium: recovered.reduce((sum, item) => sum + (item.monthlyPremium ?? (item.annualPremium ? item.annualPremium / 12 : 0)), 0),
      conversion: assignedLast60.length ? recoveredLast60.length / assignedLast60.length : 0,
      assignmentCoverage: opportunities.filter((item) => item.score.eligible).length
        ? opportunities.filter((item) => item.score.eligible && item.caseRow?.assigned_agent_id).length / opportunities.filter((item) => item.score.eligible).length
        : 0,
    };
  }, [opportunities]);

  const latestImport = useMemo(() => {
    const timestamp = Math.max(...rawRows.map((row) => Date.parse(row.importedAt)).filter(Number.isFinite));
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }, [rawRows]);
  const importAgeHours = latestImport ? (Date.now() - latestImport.getTime()) / 3_600_000 : null;
  const best = opportunities.find((item) => item.score.eligible && item.effectiveBand === "A")
    ?? opportunities.find((item) => item.score.eligible)
    ?? null;

  const eligibleAgents = useMemo(() => {
    if (!selected?.customerState) return [];
    return agents.filter((agent) => (agent.license_states ?? []).map((state) => state.toUpperCase()).includes(selected.customerState as string));
  }, [agents, selected?.customerState]);

  const saveCase = useCallback(async (opportunity: Opportunity, patch: Record<string, unknown>): Promise<RecoveryCaseRow | null> => {
    if (!workflowAvailable) {
      toast({ title: "Workflow setup required", description: "Apply the Recovery Command database migration before saving assignments or outcomes.", variant: "destructive" });
      return null;
    }
    setSavingId(opportunity.sourceId);
    const nextWorkflow = String(patch.workflow_status ?? opportunity.caseRow?.workflow_status ?? "NEW");
    const nextSuppression = String(patch.suppression_status ?? opportunity.caseRow?.suppression_status ?? "CLEAR");
    const nextCompliance = String(patch.compliance_status ?? opportunity.caseRow?.compliance_status ?? "CLEAR");
    const nextScore = scoreRecoveryOpportunity({
      rawStatus: opportunity.rawStatus,
      recordDate: opportunity.recordDate,
      resumeCapable: opportunity.resumeCapable,
      hasProductSelection: Boolean(opportunity.product && (opportunity.monthlyPremium || opportunity.annualPremium || opportunity.coverage)),
      administrativeIssue: isAdministrativeStatus(opportunity.rawStatus),
      hasValidPhone: PHONE_PATTERN.test(opportunity.phone ?? ""),
      hasValidEmail: EMAIL_PATTERN.test(opportunity.email ?? ""),
      contactBasisConfirmed: Boolean(patch.contact_basis_confirmed ?? opportunity.caseRow?.contact_basis_confirmed),
      lastAttemptAt: textValue(patch.last_attempt_at) ?? opportunity.caseRow?.last_attempt_at,
      suppressed: nextSuppression === "SUPPRESSED" || nextWorkflow === "SUPPRESSED",
      deceased: opportunity.deceased || nextWorkflow === "DECEASED",
      probableDuplicate: Boolean(patch.probable_duplicate ?? opportunity.caseRow?.probable_duplicate),
      complianceReviewRequired: nextCompliance === "NEEDS_REVIEW",
      hasLicensedAgentAvailable: Boolean(opportunity.customerState && agents.some((agent) => (agent.license_states ?? []).map((state) => state.toUpperCase()).includes(opportunity.customerState as string))),
      workflow: nextWorkflow,
    });
    const scoringFields = {
      source_type: opportunity.sourceType,
      source_id: opportunity.sourceId,
      source_owner_agent_id: opportunity.ownerAgentId,
      customer_state: opportunity.customerState,
      calculated_score: nextScore.score,
      calculated_band: nextScore.band,
      score_confidence: nextScore.confidence,
      score_version: "recovery-v1",
      score_components: nextScore.components,
    };
    let result;
    if (opportunity.caseRow) {
      result = await supabase
        .from("policy_recovery_cases" as never)
        .update({ ...scoringFields, ...patch } as never)
        .eq("id", opportunity.caseRow.id)
        .eq("version", opportunity.caseRow.version)
        .select("*")
        .maybeSingle();
    } else {
      result = await supabase
        .from("policy_recovery_cases" as never)
        .insert({ ...scoringFields, ...patch } as never)
        .select("*")
        .single();
    }
    setSavingId(null);
    if (result.error || !result.data) {
      toast({
        title: result.error ? "Change was not saved" : "This case changed in another session",
        description: result.error?.message ?? "Refresh and try again so another manager's work is not overwritten.",
        variant: "destructive",
      });
      return null;
    }
    const saved = result.data as unknown as RecoveryCaseRow;
    setCases((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
    toast({ title: "Recovery case updated", description: "Assignment, score snapshot, and audit history were saved." });
    return saved;
  }, [agents, toast, workflowAvailable]);

  const addNote = async () => {
    if (!selected || !note.trim()) return;
    const caseRow = selected.caseRow ?? await saveCase(selected, { workflow_status: "TRIAGE" });
    if (!caseRow) return;
    setSavingId(selected.sourceId);
    const { error } = await supabase.from("policy_recovery_notes" as never).insert({ case_id: caseRow.id, body: note.trim() } as never);
    setSavingId(null);
    if (error) {
      toast({ title: "Note was not saved", description: error.message, variant: "destructive" });
      return;
    }
    setNote("");
    setNotes((current) => [{ id: crypto.randomUUID(), body: note.trim(), created_at: new Date().toISOString() }, ...current]);
    toast({ title: "Note added", description: "The note is immutable and attached to this recovery case." });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-10">
      <PageHeader
        eyebrow="Manager workspace"
        eyebrowIcon={<Radar className="h-4 w-4" />}
        title="Recovery Command"
        subtitle="Rank the warmest policy opportunities, assign licensed agents, and track real premium-paying recoveries."
        actions={(
          <>
            <Button variant="outline" asChild>
              <Link to="/dashboard/import"><Database className="mr-2 h-4 w-4" />Import data</Link>
            </Button>
            <Button onClick={() => void loadData(true)} disabled={refreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh
            </Button>
          </>
        )}
      />

      {!workflowAvailable && (
        <Alert className="border-primary/40 bg-primary/5">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Read-only preview</AlertTitle>
          <AlertDescription>Source opportunities are live. Apply migration 20260906234500 to enable assignments, outcomes, notes, and audit history.</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Recovery data unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {best && (
        <section aria-labelledby="act-first-heading" className="rounded-[10px] border border-primary/45 bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="px-2.5 py-1 text-xs">ACT FIRST</Badge>
                <span className="text-sm font-medium text-muted-foreground">Highest conversion likelihood right now</span>
              </div>
              <h2 id="act-first-heading" className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {best.customerName}
              </h2>
              <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
                {best.score.reasons[0] ?? "Eligible recovery opportunity"}. {best.product ?? "Product not mapped"} with {currency(best.monthlyPremium, 2)} monthly premium.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="py-1 text-xs">{best.carrier}</Badge>
                <Badge variant="outline" className="py-1 text-xs">{best.customerState ?? "State missing"}</Badge>
                <Badge variant="outline" className="py-1 text-xs">{best.assignedName ?? "Unassigned"}</Badge>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <PriorityBadge band={best.effectiveBand} score={best.score.score} />
              <Button size="lg" onClick={() => setSelectedKey(`${best.sourceType}:${best.sourceId}`)}>
                Open case <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      <section aria-label="Recovery performance" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Priority A" value={String(metrics.priorityA)} helper="First attempt due within 2 hours" tone={metrics.priorityA ? "danger" : "default"} />
        <MetricCard label="Unassigned" value={String(metrics.unassigned)} helper={`${Math.round(metrics.assignmentCoverage * 100)}% assignment coverage`} />
        <MetricCard label="SLA at risk" value={String(metrics.slaRisk)} helper="Due in 30 minutes or overdue" tone={metrics.slaRisk ? "danger" : "default"} />
        <MetricCard label="Recovered" value={String(metrics.recovered)} helper={`${currency(metrics.recoveredPremium, 2)} monthly premium`} tone="success" />
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Ranked opportunity queue</h2>
                  <p className="text-sm text-muted-foreground">Conversion likelihood first. Score reasons stay visible.</p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-foreground">{filtered.length} shown</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search opportunities" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, policy, carrier, or agent" className="pl-9" />
                </div>
                <Select value={bandFilter} onValueChange={(value) => setBandFilter(value as PriorityBand | "ALL")}>
                  <SelectTrigger aria-label="Filter by priority" className="w-full sm:w-[175px]"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All priorities</SelectItem>
                    <SelectItem value="A">Priority A</SelectItem>
                    <SelectItem value="B">Priority B</SelectItem>
                    <SelectItem value="C">Priority C</SelectItem>
                    <SelectItem value="D">Priority D</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Opportunity lanes">
                {LANE_ORDER.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={lane === item.value}
                    onClick={() => setLane(item.value)}
                    className={cn(
                      "min-h-11 shrink-0 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                      lane === item.value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="block text-sm font-semibold">{item.label} <span className="tabular-nums">{laneCounts[item.value]}</span></span>
                    <span className="block text-xs">{item.helper}</span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading recoverable policies…</div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="No opportunities in this view" description="Change the lane or filters. A clear low-hanging queue means there is no unworked high-confidence recovery data in the current scope." variant="success" className="m-4" />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/35 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-3">Priority</th>
                        <th className="px-5 py-3">Customer</th>
                        <th className="px-5 py-3">Why now</th>
                        <th className="px-5 py-3">Policy value</th>
                        <th className="px-5 py-3">Owner / SLA</th>
                        <th className="px-5 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((opportunity) => (
                        <tr key={`${opportunity.sourceType}:${opportunity.sourceId}`} className="border-b border-border/70 align-middle last:border-0 hover:bg-muted/30">
                          <td className="px-5 py-4"><PriorityBadge band={opportunity.effectiveBand} score={opportunity.score.score} /></td>
                          <td className="px-5 py-4">
                            <p className="font-semibold text-foreground">{opportunity.customerName}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{opportunity.carrier} · {opportunity.customerState ?? "State missing"}</p>
                          </td>
                          <td className="max-w-[360px] px-5 py-4">
                            <p className="text-sm font-medium leading-snug text-foreground">{opportunity.score.reasons[0] ?? opportunity.score.blockReasons[0] ?? "Needs manager review"}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge className={laneClasses(opportunity.score.lane)}>{statusLabel(opportunity.score.lane)}</Badge>
                              <Badge variant="outline">{statusLabel(opportunity.score.status)}</Badge>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-semibold tabular-nums text-foreground">{currency(opportunity.monthlyPremium, 2)}<span className="text-xs font-normal text-muted-foreground"> / mo</span></p>
                            <p className="mt-1 text-sm tabular-nums text-muted-foreground">{compactMoney(opportunity.coverage)} coverage</p>
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-sm font-medium text-foreground">{opportunity.assignedName ?? "Unassigned"}</p>
                            <p className={cn("mt-1 text-sm", opportunity.slaState === "overdue" ? "font-semibold text-destructive" : opportunity.slaState === "risk" ? "font-semibold text-primary" : "text-muted-foreground")}>
                              {opportunity.caseRow?.first_assigned_at ? timeUntil(opportunity.slaDueAt) : opportunity.ownerName}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Button variant="outline" onClick={() => setSelectedKey(`${opportunity.sourceType}:${opportunity.sourceId}`)}>Open</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-border md:hidden">
                  {filtered.map((opportunity) => (
                    <button key={`${opportunity.sourceType}:${opportunity.sourceId}`} type="button" onClick={() => setSelectedKey(`${opportunity.sourceType}:${opportunity.sourceId}`)} className="w-full p-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-foreground">{opportunity.customerName}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{opportunity.carrier} · {currency(opportunity.monthlyPremium, 2)}/mo</p>
                        </div>
                        <PriorityBadge band={opportunity.effectiveBand} score={opportunity.score.score} />
                      </div>
                      <p className="mt-3 text-sm leading-snug text-foreground">{opportunity.score.reasons[0] ?? opportunity.score.blockReasons[0]}</p>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span>{opportunity.assignedName ?? "Unassigned"}</span>
                        <span className={cn(opportunity.slaState !== "clear" && "font-semibold text-destructive")}>{opportunity.caseRow?.first_assigned_at ? timeUntil(opportunity.slaDueAt) : statusLabel(opportunity.score.lane)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-3">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-primary" /><h2 className="font-semibold text-foreground">Recovery health</h2></div>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">60-day conversion</span><span className="font-semibold tabular-nums">{Math.round(metrics.conversion * 100)}%</span></div>
                  <Progress value={metrics.conversion * 100} className="mt-2 h-2" />
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Assignment coverage</span><span className="font-semibold tabular-nums">{Math.round(metrics.assignmentCoverage * 100)}%</span></div>
                  <Progress value={metrics.assignmentCoverage * 100} className="mt-2 h-2" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={cn(importAgeHours != null && importAgeHours > 48 && "border-destructive/40")}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2"><Database className="h-5 w-5 text-muted-foreground" /><h2 className="font-semibold text-foreground">Source freshness</h2></div>
              <p className="mt-4 text-2xl font-semibold text-foreground">{latestImport ? dateLabel(latestImport.toISOString()) : "No import found"}</p>
              <p className={cn("mt-1 text-sm", importAgeHours != null && importAgeHours > 48 ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {importAgeHours == null ? "Import Ethos or carrier data to begin." : importAgeHours > 48 ? "Critical: source data is over 48 hours old." : importAgeHours > 24 ? "Warning: source data is over 24 hours old." : "Source data is within the 24-hour target."}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-muted-foreground" /><h2 className="font-semibold text-foreground">Guardrails</h2></div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />No automatic calls, texts, emails, or replacements.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />State licensing is checked before assignment.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Only premium paying counts as recovered.</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected && (
            <div className="space-y-6 pb-8">
              <SheetHeader className="pr-10">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge band={selected.effectiveBand} score={selected.score.score} />
                  <Badge className={laneClasses(selected.score.lane)}>{statusLabel(selected.score.lane)}</Badge>
                </div>
                <SheetTitle className="pt-2 text-2xl">{selected.customerName}</SheetTitle>
                <SheetDescription className="text-sm">{selected.carrier} · {selected.product ?? "Product not mapped"} · {selected.policyNumber ?? "Policy number missing"}</SheetDescription>
              </SheetHeader>

              {selected.score.blockReasons.length > 0 && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Assignment blocked</AlertTitle>
                  <AlertDescription>{selected.score.blockReasons.join(" · ")}</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly premium</p><p className="mt-2 text-xl font-semibold tabular-nums">{currency(selected.monthlyPremium, 2)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coverage</p><p className="mt-2 text-xl font-semibold tabular-nums">{currency(selected.coverage)}</p></CardContent></Card>
              </div>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Manager controls</h3>
                <div className="mt-3 grid gap-4 rounded-[10px] border border-border p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="recovery-assignee">Assign licensed agent</Label>
                    <Select
                      value={selected.caseRow?.assigned_agent_id ?? "UNASSIGNED"}
                      onValueChange={(value) => value !== "UNASSIGNED" && void saveCase(selected, { assigned_agent_id: value })}
                      disabled={!selected.score.eligible || eligibleAgents.length === 0 || savingId === selected.sourceId}
                    >
                      <SelectTrigger id="recovery-assignee"><SelectValue placeholder="Choose agent" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNASSIGNED" disabled>Unassigned</SelectItem>
                        {eligibleAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.display_name ?? "Unnamed agent"} · {selected.customerState}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{selected.customerState ? `${eligibleAgents.length} active agent${eligibleAgents.length === 1 ? "" : "s"} licensed in ${selected.customerState}.` : "Customer state must be resolved before assignment."}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-workflow">Workflow stage</Label>
                    <Select value={selected.caseRow?.workflow_status ?? "NEW"} onValueChange={(value) => void saveCase(selected, { workflow_status: value })} disabled={savingId === selected.sourceId}>
                      <SelectTrigger id="recovery-workflow"><SelectValue /></SelectTrigger>
                      <SelectContent>{WORKFLOW_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Premium paying is the only stage counted as recovered.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-compliance">Compliance status</Label>
                    <Select value={selected.caseRow?.compliance_status ?? "CLEAR"} onValueChange={(value) => void saveCase(selected, { compliance_status: value })} disabled={savingId === selected.sourceId}>
                      <SelectTrigger id="recovery-compliance"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CLEAR">Clear</SelectItem>
                        <SelectItem value="NEEDS_REVIEW">Needs review</SelectItem>
                        <SelectItem value="APPROVED">Approved</SelectItem>
                        <SelectItem value="REJECTED">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Active-policy work remains isolated from recovery conversion.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Contact basis</Label>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => void saveCase(selected, { contact_basis_confirmed: !selected.caseRow?.contact_basis_confirmed })}
                      disabled={savingId === selected.sourceId}
                    >
                      <CheckCircle2 className={cn("mr-2 h-4 w-4", selected.caseRow?.contact_basis_confirmed ? "text-primary" : "text-muted-foreground")} />
                      {selected.caseRow?.contact_basis_confirmed ? "Documented" : "Mark as documented"}
                    </Button>
                    <p className="text-xs text-muted-foreground">Adds two points only when a valid contact basis is documented.</p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="recovery-next-action">Next action</Label>
                    <Input
                      key={`${selected.sourceType}:${selected.sourceId}:action:${selected.caseRow?.next_action ?? ""}`}
                      id="recovery-next-action"
                      defaultValue={selected.caseRow?.next_action ?? ""}
                      placeholder="Example: Call to update payment method"
                      onBlur={(event) => {
                        const value = event.currentTarget.value.trim();
                        if (value !== (selected.caseRow?.next_action ?? "")) void saveCase(selected, { next_action: value || null });
                      }}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="recovery-follow-up">Follow-up deadline</Label>
                    <Input
                      key={`${selected.sourceType}:${selected.sourceId}:followup:${selected.caseRow?.next_follow_up_at ?? ""}`}
                      id="recovery-follow-up"
                      type="datetime-local"
                      defaultValue={localDateTimeValue(selected.caseRow?.next_follow_up_at)}
                      onBlur={(event) => {
                        const value = event.currentTarget.value;
                        const iso = value ? new Date(value).toISOString() : null;
                        if (iso !== selected.caseRow?.next_follow_up_at) void saveCase(selected, { next_follow_up_at: iso });
                      }}
                    />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Why this score</h3>
                <div className="mt-3 divide-y divide-border rounded-[10px] border border-border">
                  {selected.score.components.map((component) => (
                    <div key={component.key} className="grid grid-cols-[1fr_auto] gap-4 p-4">
                      <div><p className="font-semibold text-foreground">{component.label}</p><p className="mt-1 text-sm leading-snug text-muted-foreground">{component.reason}</p></div>
                      <p className="text-base font-bold tabular-nums text-foreground">+{component.points}<span className="text-xs font-normal text-muted-foreground">/{component.maximum}</span></p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Calculated with recovery-v1. Missing inputs receive zero points; weights are never redistributed. Confidence: {selected.score.confidence}.</p>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Customer and source</h3>
                <dl className="mt-3 grid gap-3 rounded-[10px] border border-border p-4 sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="mt-1 flex items-center gap-2 text-sm font-medium"><Phone className="h-4 w-4" />{selected.phone ?? "Missing"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="mt-1 flex items-center gap-2 break-all text-sm font-medium"><Mail className="h-4 w-4" />{selected.email ?? "Missing"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Raw status</dt><dd className="mt-1 text-sm font-medium">{selected.rawStatus}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Normalized status</dt><dd className="mt-1 text-sm font-medium">{statusLabel(selected.score.status)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Record date</dt><dd className="mt-1 text-sm font-medium">{dateLabel(selected.recordDate)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Source owner</dt><dd className="mt-1 text-sm font-medium">{selected.ownerName}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Source</dt><dd className="mt-1 text-sm font-medium">{selected.sourceType}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">SLA</dt><dd className={cn("mt-1 text-sm font-medium", selected.slaState !== "clear" && "text-destructive")}>{selected.caseRow?.first_assigned_at ? timeUntil(selected.slaDueAt) : "Starts at assignment"}</dd></div>
                </dl>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Case notes</h3>
                <div className="mt-3 space-y-3">
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Document context, outcome, and the next follow-up…" maxLength={4000} />
                  <Button onClick={() => void addNote()} disabled={!note.trim() || savingId === selected.sourceId}>Add immutable note</Button>
                  {notes.length > 0 && <div className="divide-y divide-border rounded-[10px] border border-border">{notes.map((item) => <div key={item.id} className="p-3"><p className="text-sm text-foreground">{item.body}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(item.created_at)}</p></div>)}</div>}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Audit history</h3>
                {audits.length ? (
                  <div className="mt-3 space-y-2">{audits.map((event) => <div key={event.id} className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm"><span className="font-medium">{statusLabel(event.action)}</span><span className="text-xs text-muted-foreground">{dateLabel(event.created_at)}</span></div>)}</div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Audit events appear after the first saved case action.</p>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
