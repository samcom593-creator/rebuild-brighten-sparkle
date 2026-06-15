import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Instagram,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  StickyNote,
  TrendingUp,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type InterviewKind =
  | "licensed_prospect"
  | "licensed_call"
  | "leader_call"
  | "final_expense_review"
  | "callback";

type ReviewStatus =
  | "needs_review"
  | "contacted"
  | "follow_up"
  | "selected"
  | "contracted"
  | "hired"
  | "passed"
  | "no_show"
  | "not_fit"
  | "ghosted";

interface InterviewEvent {
  id: string;
  person: string;
  startAt: string;
  endAt: string;
  title: string;
  kind: InterviewKind;
  alias?: string;
  instagramHandle?: string;
  conflict?: boolean;
}

interface Candidate {
  id: string;
  name: string;
  alias?: string;
  seedInstagram?: string;
  events: InterviewEvent[];
  firstAt: string;
  latestAt: string;
  hasConflict: boolean;
  hasCallback: boolean;
  hasLeaderCall: boolean;
  hasLicensedCall: boolean;
}

interface CandidateDraft {
  reviewStatus: ReviewStatus;
  contracted: boolean;
  hired: boolean;
  outcome: string;
  instagramHandle: string;
  monthlyProduction: string;
  legs: string;
  sourceNotes: string;
  transcription: string;
  leaderNotes: string;
  nextStep: string;
  updatedAt: string;
}

interface ApplicationMatchRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  license_status: string | null;
  status: string | null;
  license_progress: string | null;
  instagram_handle: string | null;
  created_at: string | null;
  contracted_at: string | null;
}

const STORAGE_KEY = "apex.interviewCommandCenter.v1";

const REVIEW_STATUS_OPTIONS: Array<{ key: ReviewStatus; label: string; tone: string }> = [
  { key: "needs_review", label: "Needs Review", tone: "border-slate-500/30 bg-slate-500/10 text-slate-300" },
  { key: "contacted", label: "Contacted", tone: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  { key: "follow_up", label: "Follow-Up", tone: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  { key: "selected", label: "Selected", tone: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" },
  { key: "contracted", label: "Contracted", tone: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  { key: "hired", label: "Hired", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  { key: "passed", label: "Passed", tone: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" },
  { key: "no_show", label: "No-Show", tone: "border-orange-500/30 bg-orange-500/10 text-orange-300" },
  { key: "not_fit", label: "Not Fit", tone: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  { key: "ghosted", label: "Ghosted", tone: "border-red-500/30 bg-red-500/10 text-red-300" },
];

const OUTCOME_OPTIONS = [
  "Unset",
  "Strong hire",
  "Contracting next",
  "Needs follow-up",
  "Licensed producer",
  "Leader candidate",
  "Call-back booked",
  "No-show",
  "Not a fit",
  "Do not pursue",
];

const INTERVIEW_EVENTS: InterviewEvent[] = [
  {
    id: "isaac-foster-2026-05-31-0945",
    person: "Isaac Foster",
    startAt: "2026-05-31T09:45:00-07:00",
    endAt: "2026-05-31T10:00:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "taylor-2026-06-02-1345",
    person: "Taylor",
    startAt: "2026-06-02T13:45:00-07:00",
    endAt: "2026-06-02T14:00:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "moises-camacho-2026-06-03-1300",
    person: "Moises Camacho",
    startAt: "2026-06-03T13:00:00-07:00",
    endAt: "2026-06-03T13:15:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "moises-camacho-2026-06-03-1315",
    person: "Moises Camacho",
    startAt: "2026-06-03T13:15:00-07:00",
    endAt: "2026-06-03T13:30:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "pranac-kodali-2026-06-04-1000",
    person: "Pranac Kodali",
    startAt: "2026-06-04T10:00:00-07:00",
    endAt: "2026-06-04T10:15:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "francisco-palomares-2026-06-09-1415",
    person: "Francisco Palomares",
    startAt: "2026-06-09T14:15:00-07:00",
    endAt: "2026-06-09T14:30:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
  },
  {
    id: "ibrahiim-dixon-2026-06-09-2130",
    person: "Ibrahiim Dixon",
    startAt: "2026-06-09T21:30:00-07:00",
    endAt: "2026-06-09T21:45:00-07:00",
    title: "Licensed Prospect Call",
    kind: "licensed_prospect",
    conflict: true,
  },
  {
    id: "anthony-chinn-2026-06-11-2000",
    person: "Anthony Chinn",
    startAt: "2026-06-11T20:00:00-07:00",
    endAt: "2026-06-11T20:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "ibrahiim-dixon-2026-06-12-1145",
    person: "Ibrahiim Dixon",
    startAt: "2026-06-12T11:45:00-07:00",
    endAt: "2026-06-12T12:00:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "mase-2026-06-12-1200",
    person: "Mase",
    startAt: "2026-06-12T12:00:00-07:00",
    endAt: "2026-06-12T12:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
    instagramHandle: "masendinh",
  },
  {
    id: "moe-swole-2026-06-12-1400",
    person: "Moe Swole",
    startAt: "2026-06-12T14:00:00-07:00",
    endAt: "2026-06-12T14:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "colin-jackson-2026-06-12-1430",
    person: "Colin Jackson",
    startAt: "2026-06-12T14:30:00-07:00",
    endAt: "2026-06-12T14:45:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "taysakk-2026-06-12-1530",
    person: "Taysakk",
    alias: "LONEWOLF",
    startAt: "2026-06-12T15:30:00-07:00",
    endAt: "2026-06-12T15:45:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "haylee-ashe-2026-06-12-1600",
    person: "Haylee Ashe",
    startAt: "2026-06-12T16:00:00-07:00",
    endAt: "2026-06-12T16:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "jaymin-matthes-2026-06-12-1615",
    person: "Jaymin Matthes",
    startAt: "2026-06-12T16:15:00-07:00",
    endAt: "2026-06-12T16:30:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "reid-weckwerth-2026-06-12-1630",
    person: "Reid Weckwerth",
    startAt: "2026-06-12T16:30:00-07:00",
    endAt: "2026-06-12T16:45:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "haylee-ashe-2026-06-12-1700",
    person: "Haylee Ashe",
    startAt: "2026-06-12T17:00:00-07:00",
    endAt: "2026-06-12T17:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "merice-caleb-2026-06-12-1715",
    person: "merice caleb",
    startAt: "2026-06-12T17:15:00-07:00",
    endAt: "2026-06-12T17:30:00-07:00",
    title: "Preferred Final Expense Review",
    kind: "final_expense_review",
  },
  {
    id: "eugene-tomanpos-2026-06-12-1830",
    person: "Eugene Tomanpos",
    startAt: "2026-06-12T18:30:00-07:00",
    endAt: "2026-06-12T18:45:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "joshghuncho-2026-06-12-2000",
    person: "JoshgHuncho",
    startAt: "2026-06-12T20:00:00-07:00",
    endAt: "2026-06-12T20:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "mj-2026-06-13-1200",
    person: "MJ",
    startAt: "2026-06-13T12:00:00-07:00",
    endAt: "2026-06-13T12:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "derek-fredrick-2026-06-13-1300",
    person: "Derek Fredrick",
    startAt: "2026-06-13T13:00:00-07:00",
    endAt: "2026-06-13T13:15:00-07:00",
    title: "Licensed Call",
    kind: "licensed_call",
  },
  {
    id: "matthew-2026-06-13-1400",
    person: "Matthew",
    startAt: "2026-06-13T14:00:00-07:00",
    endAt: "2026-06-13T14:15:00-07:00",
    title: "Leader Call",
    kind: "leader_call",
  },
  {
    id: "annas-yassin-2026-06-13-2200",
    person: "Annas Yassin",
    startAt: "2026-06-13T22:00:00-07:00",
    endAt: "2026-06-13T22:15:00-07:00",
    title: "Leader Call",
    kind: "leader_call",
  },
  {
    id: "mj-2026-06-14-1100",
    person: "MJ",
    startAt: "2026-06-14T11:00:00-07:00",
    endAt: "2026-06-14T11:20:00-07:00",
    title: "CALL: MJ (Licensed Call-Back)",
    kind: "callback",
  },
  {
    id: "derek-fredrick-2026-06-14-1120",
    person: "Derek Fredrick",
    startAt: "2026-06-14T11:20:00-07:00",
    endAt: "2026-06-14T11:40:00-07:00",
    title: "CALL: Derek Fredrick (Licensed Call-Back)",
    kind: "callback",
  },
  {
    id: "matthew-2026-06-14-1140",
    person: "Matthew",
    startAt: "2026-06-14T11:40:00-07:00",
    endAt: "2026-06-14T12:00:00-07:00",
    title: "CALL: Matthew (Leader Call - Unlicensed)",
    kind: "callback",
  },
  {
    id: "annas-yassin-2026-06-14-1200",
    person: "Annas Yassin",
    startAt: "2026-06-14T12:00:00-07:00",
    endAt: "2026-06-14T12:20:00-07:00",
    title: "CALL: Annas Yassin (Leader Call - Spain)",
    kind: "callback",
  },
];

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildCandidates(events: InterviewEvent[]): Candidate[] {
  const byPerson = new Map<string, InterviewEvent[]>();
  for (const event of events) {
    const key = normalizeName(event.person);
    byPerson.set(key, [...(byPerson.get(key) ?? []), event]);
  }

  return Array.from(byPerson.entries())
    .map(([key, personEvents]) => {
      const sorted = [...personEvents].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
      const seedInstagram = sorted.find((event) => event.instagramHandle)?.instagramHandle;
      const alias = sorted.find((event) => event.alias)?.alias;
      return {
        id: slugify(key),
        name: sorted[0].person,
        alias,
        seedInstagram,
        events: sorted,
        firstAt: sorted[0].startAt,
        latestAt: sorted[sorted.length - 1].startAt,
        hasConflict: sorted.some((event) => event.conflict),
        hasCallback: sorted.some((event) => event.kind === "callback"),
        hasLeaderCall: sorted.some((event) => event.kind === "leader_call"),
        hasLicensedCall: sorted.some((event) => event.kind === "licensed_call" || event.kind === "licensed_prospect"),
      };
    })
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

function defaultDraft(candidate?: Candidate, match?: ApplicationMatchRow | null): CandidateDraft {
  return {
    reviewStatus: "needs_review",
    contracted: Boolean(match?.contracted_at),
    hired: false,
    outcome: "Unset",
    instagramHandle: normalizeHandle(candidate?.seedInstagram ?? match?.instagram_handle ?? ""),
    monthlyProduction: "",
    legs: "",
    sourceNotes: "",
    transcription: "",
    leaderNotes: "",
    nextStep: "",
    updatedAt: "",
  };
}

function loadDrafts(): Record<string, CandidateDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CandidateDraft>;
  } catch {
    return {};
  }
}

function formatEventWindow(event: InterviewEvent): string {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return `${format(start, "EEE, MMM d")} · ${format(start, "h:mm a")} - ${format(end, "h:mm a")}`;
}

function minutesBetween(startAt: string, endAt: string): number {
  return Math.max(0, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000));
}

function kindLabel(kind: InterviewKind): string {
  switch (kind) {
    case "licensed_prospect":
      return "Licensed Prospect";
    case "licensed_call":
      return "Licensed";
    case "leader_call":
      return "Leader";
    case "final_expense_review":
      return "Final Expense";
    case "callback":
      return "Callback";
    default:
      return "Interview";
  }
}

function statusMeta(status: ReviewStatus) {
  return REVIEW_STATUS_OPTIONS.find((option) => option.key === status) ?? REVIEW_STATUS_OPTIONS[0];
}

function moneyLabel(value: string): string {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function copyText(value: string, label: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Could not copy"),
  );
}

export default function InterviewCommandCenter() {
  usePageTitle("Interviews · APEX");

  const candidates = useMemo(() => buildCandidates(INTERVIEW_EVENTS), []);
  const [drafts, setDrafts] = useState<Record<string, CandidateDraft>>(() => loadDrafts());
  const [selectedId, setSelectedId] = useState(() => candidates[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "callbacks" | "licensed" | "leaders" | "open" | "done">("all");

  const applicationMatches = useQuery({
    queryKey: ["interview-command-application-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, state, license_status, status, license_progress, instagram_handle, created_at, contracted_at")
        .gte("created_at", "2026-05-01T00:00:00-07:00")
        .limit(1500);
      if (error) throw error;
      return (data ?? []) as unknown as ApplicationMatchRow[];
    },
    staleTime: 120_000,
  });

  const matchesByName = useMemo(() => {
    const map = new Map<string, ApplicationMatchRow>();
    for (const row of applicationMatches.data ?? []) {
      const fullName = normalizeName(`${row.first_name ?? ""} ${row.last_name ?? ""}`);
      if (fullName && !map.has(fullName)) map.set(fullName, row);
    }
    return map;
  }, [applicationMatches.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  }, [drafts]);

  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const selectedMatch = selectedCandidate ? matchesByName.get(normalizeName(selectedCandidate.name)) ?? null : null;
  const selectedDraft = selectedCandidate
    ? { ...defaultDraft(selectedCandidate, selectedMatch), ...(drafts[selectedCandidate.id] ?? {}) }
    : defaultDraft();

  const filteredCandidates = useMemo(() => {
    const term = normalizeName(search);
    return candidates.filter((candidate) => {
      const draft = { ...defaultDraft(candidate, matchesByName.get(normalizeName(candidate.name))), ...(drafts[candidate.id] ?? {}) };
      if (term) {
        const hay = normalizeName([
          candidate.name,
          candidate.alias,
          candidate.seedInstagram,
          draft.instagramHandle,
          draft.outcome,
          draft.leaderNotes,
        ].filter(Boolean).join(" "));
        if (!hay.includes(term)) return false;
      }
      if (filter === "callbacks" && !candidate.hasCallback) return false;
      if (filter === "licensed" && !candidate.hasLicensedCall) return false;
      if (filter === "leaders" && !candidate.hasLeaderCall) return false;
      if (filter === "open" && ["hired", "contracted", "passed", "not_fit"].includes(draft.reviewStatus)) return false;
      if (filter === "done" && !["hired", "contracted", "passed", "not_fit"].includes(draft.reviewStatus)) return false;
      return true;
    });
  }, [candidates, drafts, filter, matchesByName, search]);

  useEffect(() => {
    if (!filteredCandidates.length) return;
    if (!filteredCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(filteredCandidates[0].id);
    }
  }, [filteredCandidates, selectedId]);

  const metrics = useMemo(() => {
    const draftList = candidates.map((candidate) => ({
      candidate,
      draft: { ...defaultDraft(candidate, matchesByName.get(normalizeName(candidate.name))), ...(drafts[candidate.id] ?? {}) },
    }));
    return {
      candidates: candidates.length,
      events: INTERVIEW_EVENTS.length,
      callbacks: candidates.filter((candidate) => candidate.hasCallback).length,
      leaders: candidates.filter((candidate) => candidate.hasLeaderCall).length,
      contracted: draftList.filter(({ draft }) => draft.contracted || draft.reviewStatus === "contracted").length,
      hired: draftList.filter(({ draft }) => draft.hired || draft.reviewStatus === "hired").length,
    };
  }, [candidates, drafts, matchesByName]);

  const patchDraft = (patch: Partial<CandidateDraft>) => {
    if (!selectedCandidate) return;
    setDrafts((prev) => ({
      ...prev,
      [selectedCandidate.id]: {
        ...defaultDraft(selectedCandidate, selectedMatch),
        ...(prev[selectedCandidate.id] ?? {}),
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const resetSelected = () => {
    if (!selectedCandidate) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selectedCandidate.id];
      return next;
    });
    toast.success("Candidate file reset");
  };

  if (!selectedCandidate) {
    return (
      <div className="px-4 sm:px-6 pb-24">
        <PageHeader title="Interviews" subtitle="No interview records are loaded." accent="amber" />
      </div>
    );
  }

  const currentStatus = statusMeta(selectedDraft.reviewStatus);
  const selectedInstagram = normalizeHandle(selectedDraft.instagramHandle);
  const latestEvent = selectedCandidate.events[selectedCandidate.events.length - 1];
  const promptPack = [
    `Candidate: ${selectedCandidate.name}${selectedCandidate.alias ? ` (${selectedCandidate.alias})` : ""}`,
    `Interview timeline: ${selectedCandidate.events.map(formatEventWindow).join("; ")}`,
    `Status: ${currentStatus.label}`,
    `Contracted: ${selectedDraft.contracted ? "yes" : "no"}`,
    `Hired: ${selectedDraft.hired ? "yes" : "no"}`,
    `Outcome: ${selectedDraft.outcome}`,
    `Instagram: ${selectedInstagram ? `@${selectedInstagram}` : "unknown"}`,
    `Monthly production: ${moneyLabel(selectedDraft.monthlyProduction)}`,
    `Legs: ${selectedDraft.legs || "0"}`,
    `Notes: ${selectedDraft.leaderNotes || "none"}`,
    `Transcript: ${selectedDraft.transcription || "none"}`,
    `Next step: ${selectedDraft.nextStep || "none"}`,
  ].join("\n");

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Interviews"
        eyebrowIcon={<ClipboardCheck className="h-3 w-3" />}
        title="Interview Command Center"
        subtitle="Leader review files for the May 31 through June 14 recruiting calls. Pick a candidate, review the calendar timeline, capture the transcript, and mark the decision."
        accent="amber"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => applicationMatches.refetch()}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", applicationMatches.isFetching && "animate-spin")} />
              Match Apps
            </Button>
            <Button size="sm" onClick={() => toast.success("Interview file saved")}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricTile icon={Users} label="Candidates" value={metrics.candidates} hint={`${metrics.events} calendar calls`} />
        <MetricTile icon={PhoneCall} label="Callbacks" value={metrics.callbacks} hint="June 14 queue" tone="sky" />
        <MetricTile icon={UserCheck} label="Leader Calls" value={metrics.leaders} hint="manager path" tone="cyan" />
        <MetricTile icon={BadgeCheck} label="Contracted" value={metrics.contracted} hint="marked here" tone="violet" />
        <MetricTile icon={CheckCircle2} label="Hired" value={metrics.hired} hint="marked here" tone="emerald" />
        <MetricTile icon={AlertTriangle} label="Conflicts" value={candidates.filter((candidate) => candidate.hasConflict).length} hint="calendar flag" tone="rose" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-4 xl:self-start space-y-3">
          <div className="rounded-md border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold">Interview Side Nav</h2>
                <p className="text-xs text-muted-foreground">{filteredCandidates.length} visible</p>
              </div>
              <Filter className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search candidate, IG, note..."
                className="pl-8"
              />
            </div>
            <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter interviews" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All interviews</SelectItem>
                <SelectItem value="callbacks">Callbacks</SelectItem>
                <SelectItem value="licensed">Licensed calls</SelectItem>
                <SelectItem value="leaders">Leader calls</SelectItem>
                <SelectItem value="open">Open files</SelectItem>
                <SelectItem value="done">Decided files</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 max-h-[68vh] overflow-y-auto pr-1">
            {filteredCandidates.map((candidate) => {
              const match = matchesByName.get(normalizeName(candidate.name));
              const draft = { ...defaultDraft(candidate, match), ...(drafts[candidate.id] ?? {}) };
              const meta = statusMeta(draft.reviewStatus);
              const active = candidate.id === selectedCandidate.id;
              const handle = normalizeHandle(draft.instagramHandle);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setSelectedId(candidate.id)}
                  className={cn(
                    "w-full rounded-md border bg-card p-3 text-left transition-all hover:border-amber-400/50 hover:bg-amber-500/5",
                    active && "border-amber-400 bg-amber-500/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{candidate.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {format(new Date(candidate.latestAt), "MMM d, h:mm a")}
                        {candidate.alias ? ` · ${candidate.alias}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", meta.tone)}>
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{candidate.events.length} calls</Badge>
                    {candidate.hasCallback && <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-300">callback</Badge>}
                    {candidate.hasLeaderCall && <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-300">leader</Badge>}
                    {candidate.hasConflict && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-300">conflict</Badge>}
                    {handle && <Badge variant="outline" className="border-pink-500/30 bg-pink-500/10 text-[10px] text-pink-300">@{handle}</Badge>}
                    {draft.contracted && <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-300">contracted</Badge>}
                    {draft.hired && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">hired</Badge>}
                  </div>
                </button>
              );
            })}
            {!filteredCandidates.length && (
              <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                No interview files match that filter.
              </div>
            )}
          </div>
        </aside>

        <main className="space-y-4 min-w-0">
          <section className="rounded-md border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("text-xs", currentStatus.tone)}>{currentStatus.label}</Badge>
                  {selectedCandidate.hasCallback && <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-300">Callback</Badge>}
                  {selectedCandidate.hasLeaderCall && <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300">Leader</Badge>}
                  {selectedCandidate.hasConflict && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-300">Conflict</Badge>}
                </div>
                <h2 className="mt-3 text-2xl font-extrabold leading-tight">{selectedCandidate.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest touch: {formatEventWindow(latestEvent)}
                  {selectedCandidate.alias ? ` · Alias: ${selectedCandidate.alias}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedInstagram && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`https://instagram.com/${selectedInstagram}`} target="_blank" rel="noopener noreferrer">
                      <Instagram className="h-3.5 w-3.5 mr-1.5" />
                      @{selectedInstagram}
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => copyText(promptPack, "Candidate brief")}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copy Brief
                </Button>
                <Button variant="outline" size="sm" onClick={resetSelected}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <InfoPill icon={CalendarDays} label="First Interview" value={format(new Date(selectedCandidate.firstAt), "MMM d, h:mm a")} />
              <InfoPill icon={Clock} label="Total Call Time" value={`${selectedCandidate.events.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0)} min`} />
              <InfoPill icon={Briefcase} label="Production" value={moneyLabel(selectedDraft.monthlyProduction)} />
              <InfoPill icon={TrendingUp} label="Legs" value={selectedDraft.legs || "0"} />
            </div>
          </section>

          {applicationMatches.isLoading ? (
            <Skeleton className="h-16 rounded-md" />
          ) : selectedMatch ? (
            <section className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Matched to application record</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedMatch.email || "No email"} · {selectedMatch.phone || "No phone"} · {selectedMatch.state || "No state"} · {selectedMatch.status || "No status"}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/dashboard/applicants?focus=${selectedMatch.id}`}>
                    Open Application
                    <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </a>
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-md border bg-muted/30 p-4">
              <p className="text-sm font-semibold">No exact application match yet</p>
              <p className="text-xs text-muted-foreground">Use the Instagram and notes fields below until the applicant record exists or the name is normalized.</p>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-amber-400" />
                    <h3 className="font-bold">Decision File</h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Review status</Label>
                      <Select value={selectedDraft.reviewStatus} onValueChange={(value) => patchDraft({ reviewStatus: value as ReviewStatus })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REVIEW_STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Outcome</Label>
                      <Select value={selectedDraft.outcome} onValueChange={(value) => patchDraft({ outcome: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OUTCOME_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ToggleRow
                      icon={BadgeCheck}
                      label="Contracted"
                      checked={selectedDraft.contracted}
                      onCheckedChange={(checked) => patchDraft({ contracted: checked, reviewStatus: checked ? "contracted" : selectedDraft.reviewStatus })}
                    />
                    <ToggleRow
                      icon={CheckCircle2}
                      label="Hired"
                      checked={selectedDraft.hired}
                      onCheckedChange={(checked) => patchDraft({ hired: checked, reviewStatus: checked ? "hired" : selectedDraft.reviewStatus })}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="ig-handle">Instagram</Label>
                      <div className="relative">
                        <Instagram className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ig-handle"
                          value={selectedDraft.instagramHandle}
                          onChange={(event) => patchDraft({ instagramHandle: normalizeHandle(event.target.value) })}
                          placeholder="handle"
                          className="pl-8"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="production">Monthly production</Label>
                      <Input
                        id="production"
                        inputMode="numeric"
                        value={selectedDraft.monthlyProduction}
                        onChange={(event) => patchDraft({ monthlyProduction: event.target.value })}
                        placeholder="20000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="legs">Legs</Label>
                      <Input
                        id="legs"
                        inputMode="numeric"
                        value={selectedDraft.legs}
                        onChange={(event) => patchDraft({ legs: event.target.value })}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="what-happened">What happened</Label>
                    <Textarea
                      id="what-happened"
                      value={selectedDraft.sourceNotes}
                      onChange={(event) => patchDraft({ sourceNotes: event.target.value })}
                      placeholder="Showed, missed, asked for callback, strong closer, needs licensing, already writing business..."
                      className="min-h-[88px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="next-step">Next step</Label>
                    <Textarea
                      id="next-step"
                      value={selectedDraft.nextStep}
                      onChange={(event) => patchDraft({ nextStep: event.target.value })}
                      placeholder="Who owns the next touch, by when, and what needs to happen?"
                      className="min-h-[88px]"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-sky-400" />
                      <h3 className="font-bold">Transcription</h3>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => copyText(selectedDraft.transcription || "", "Transcript")}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      Copy
                    </Button>
                  </div>
                  <Textarea
                    value={selectedDraft.transcription}
                    onChange={(event) => patchDraft({ transcription: event.target.value })}
                    placeholder="Drop the transcript here after the call."
                    className="min-h-[220px]"
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-cyan-400" />
                    <h3 className="font-bold">Call Timeline</h3>
                  </div>
                  <div className="space-y-2">
                    {selectedCandidate.events.map((event) => (
                      <div key={event.id} className="rounded-md border bg-background/60 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{event.title}</p>
                            <p className="text-xs text-muted-foreground">{formatEventWindow(event)} · {minutesBetween(event.startAt, event.endAt)} min</p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px]">{kindLabel(event.kind)}</Badge>
                        </div>
                        {(event.conflict || event.alias || event.instagramHandle) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {event.conflict && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-300">Conflict</Badge>}
                            {event.alias && <Badge variant="outline" className="text-[10px]">Alias: {event.alias}</Badge>}
                            {event.instagramHandle && <Badge variant="outline" className="border-pink-500/30 bg-pink-500/10 text-[10px] text-pink-300">@{event.instagramHandle}</Badge>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-emerald-400" />
                    <h3 className="font-bold">Leader Notes</h3>
                  </div>
                  <Textarea
                    value={selectedDraft.leaderNotes}
                    onChange={(event) => patchDraft({ leaderNotes: event.target.value })}
                    placeholder="Fit, attitude, follow-through, licensing risk, production standard, leader read..."
                    className="min-h-[180px]"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Copy className="h-4 w-4 text-violet-400" />
                    <h3 className="font-bold">AI Brief</h3>
                  </div>
                  <Textarea value={promptPack} readOnly className="min-h-[180px] text-xs" />
                  <Button variant="outline" className="w-full" onClick={() => copyText(promptPack, "AI brief")}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy candidate brief
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "amber",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  hint: string;
  tone?: "amber" | "sky" | "cyan" | "violet" | "emerald" | "rose";
}) {
  const tones = {
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/25",
    sky: "text-sky-400 bg-sky-500/10 border-sky-500/25",
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/25",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/25",
  };

  return (
    <div className={cn("rounded-md border bg-card p-4", tones[tone])}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0" />
      </div>
    </div>
  );
}

function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon: React.ElementType;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", checked ? "text-emerald-400" : "text-muted-foreground")} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
