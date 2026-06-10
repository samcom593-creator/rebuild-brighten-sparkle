import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Mail,
  MapPin,
  Mic,
  MicOff,
  PhoneCall,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InboundStage = "new" | "diagnosing" | "quoted" | "follow_up" | "won" | "lost";
type Urgency = "hot" | "warm" | "normal";

interface InboundLead {
  id: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  problem_type: string;
  urgency: Urgency;
  current_coverage: string;
  desired_solution: string;
  budget: string;
  household: string;
  notes: string;
  transcript: string;
  stage: InboundStage;
  next_action_at: string;
  source: string;
  created_at: string;
  updated_at: string;
  saved_to_supabase?: boolean;
}

const STORAGE_KEY = "apex:inbound-leads:v1";

const STAGE_META: Record<InboundStage, { label: string; tint: string; dot: string; icon: typeof PhoneCall }> = {
  new: {
    label: "New Call",
    tint: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
    dot: "bg-cyan-400",
    icon: PhoneCall,
  },
  diagnosing: {
    label: "Diagnosing",
    tint: "border-violet-500/35 bg-violet-500/10 text-violet-300",
    dot: "bg-violet-400",
    icon: ClipboardList,
  },
  quoted: {
    label: "Quoted",
    tint: "border-amber-500/35 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
    icon: DollarSign,
  },
  follow_up: {
    label: "Follow-up",
    tint: "border-blue-500/35 bg-blue-500/10 text-blue-300",
    dot: "bg-blue-400",
    icon: CalendarClock,
  },
  won: {
    label: "Solved",
    tint: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
    icon: CheckCircle2,
  },
  lost: {
    label: "Closed Out",
    tint: "border-slate-500/35 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-400",
    icon: ShieldCheck,
  },
};

const STAGE_ORDER: InboundStage[] = ["new", "diagnosing", "quoted", "follow_up", "won", "lost"];

const PROBLEM_OPTIONS = [
  "Final expense",
  "Mortgage protection",
  "Life insurance review",
  "Retirement / IUL",
  "Child coverage",
  "Debt protection",
  "Existing policy issue",
  "Business protection",
  "Other",
];

const EMPTY_FORM: Omit<InboundLead, "id" | "created_at" | "updated_at" | "source" | "saved_to_supabase"> = {
  client_first_name: "",
  client_last_name: "",
  phone: "",
  email: "",
  state: "",
  city: "",
  problem_type: "",
  urgency: "normal",
  current_coverage: "",
  desired_solution: "",
  budget: "",
  household: "",
  notes: "",
  transcript: "",
  stage: "new",
  next_action_at: "",
};

const STATE_ALIASES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  florida: "FL",
  georgia: "GA",
  illinois: "IL",
  michigan: "MI",
  nevada: "NV",
  "new york": "NY",
  "north carolina": "NC",
  ohio: "OH",
  oregon: "OR",
  pennsylvania: "PA",
  texas: "TX",
  utah: "UT",
  virginia: "VA",
  washington: "WA",
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function loadLocalLeads(): InboundLead[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalLeads(leads: InboundLead[]) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads.slice(0, 300)));
  } catch {
    // Some browser/privacy contexts block localStorage. The in-memory board still works.
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function leadName(lead: Pick<InboundLead, "client_first_name" | "client_last_name">): string {
  return [lead.client_first_name, lead.client_last_name].filter(Boolean).join(" ") || "Unnamed caller";
}

function applyTranscriptHints(
  transcript: string,
  current: Omit<InboundLead, "id" | "created_at" | "updated_at" | "source" | "saved_to_supabase">,
) {
  const text = transcript.toLowerCase();
  const next = { ...current, transcript };

  const email = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email && !next.email) next.email = email.toLowerCase();

  const phone = transcript.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  if (phone && !next.phone) next.phone = formatPhone(phone);

  const nameMatch =
    transcript.match(/(?:my name is|name is|this is|client is|caller is)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
  if (nameMatch) {
    if (!next.client_first_name) next.client_first_name = nameMatch[1] || "";
    if (!next.client_last_name) next.client_last_name = nameMatch[2] || "";
  }

  for (const [name, abbr] of Object.entries(STATE_ALIASES)) {
    if (!next.state && text.includes(name)) next.state = abbr;
  }
  const stateAbbr = transcript.match(/\b(AL|AK|AZ|AR|CA|CO|FL|GA|IL|MI|NV|NY|NC|OH|OR|PA|TX|UT|VA|WA)\b/);
  if (stateAbbr && !next.state) next.state = stateAbbr[1];

  const budget = transcript.match(/\$?\b(\d{2,4})(?:\s*(?:dollars|bucks))?\s*(?:a month|monthly|per month)?/i)?.[1];
  if (budget && !next.budget) next.budget = `$${budget}/mo`;

  if (!next.problem_type) {
    if (text.includes("mortgage")) next.problem_type = "Mortgage protection";
    else if (text.includes("final expense") || text.includes("burial")) next.problem_type = "Final expense";
    else if (text.includes("retirement") || text.includes("iul")) next.problem_type = "Retirement / IUL";
    else if (text.includes("policy") || text.includes("coverage")) next.problem_type = "Life insurance review";
    else if (text.includes("child") || text.includes("kid")) next.problem_type = "Child coverage";
    else if (text.includes("business")) next.problem_type = "Business protection";
  }

  if (!next.current_coverage) {
    if (text.includes("no coverage") || text.includes("do not have coverage") || text.includes("don't have coverage")) {
      next.current_coverage = "No current coverage";
    } else if (text.includes("already have") || text.includes("existing policy")) {
      next.current_coverage = "Has existing coverage";
    }
  }

  if (text.includes("urgent") || text.includes("as soon as possible") || text.includes("today")) next.urgency = "hot";
  else if (text.includes("this week") || text.includes("soon")) next.urgency = "warm";

  return next;
}

export default function InboundLeads() {
  usePageTitle("Inbound Leads · APEX");
  const { user } = useAuth();
  const [leads, setLeads] = useState<InboundLead[]>(() => loadLocalLeads());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<InboundStage | "__all__">("__all__");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const mergeLeads = useCallback((incoming: InboundLead[]) => {
    setLeads((prev) => {
      const byId = new Map<string, InboundLead>();
      for (const lead of [...incoming, ...prev]) byId.set(lead.id, lead);
      const merged = Array.from(byId.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      saveLocalLeads(merged);
      return merged;
    });
  }, []);

  const loadRemote = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("inbound_leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.warn("[inbound-leads] remote table unavailable", error);
        return;
      }
      mergeLeads(((data ?? []) as InboundLead[]).map((lead) => ({ ...lead, saved_to_supabase: true })));
    } finally {
      setLoading(false);
    }
  }, [mergeLeads, user?.id]);

  useEffect(() => {
    loadRemote();
  }, [loadRemote]);

  const stats = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter((lead) => lead.urgency === "hot" && !["won", "lost"].includes(lead.stage)).length;
    const followUps = leads.filter((lead) => lead.stage === "follow_up").length;
    const solved = leads.filter((lead) => lead.stage === "won").length;
    return { total, hot, followUps, solved };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (stageFilter !== "__all__" && lead.stage !== stageFilter) return false;
      if (!q) return true;
      return [
        leadName(lead),
        lead.phone,
        lead.email,
        lead.problem_type,
        lead.state,
        lead.notes,
        lead.transcript,
      ].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [leads, search, stageFilter]);

  const columns = useMemo(() => {
    const grouped: Record<InboundStage, InboundLead[]> = {
      new: [],
      diagnosing: [],
      quoted: [],
      follow_up: [],
      won: [],
      lost: [],
    };
    for (const lead of filteredLeads) grouped[lead.stage || "new"].push(lead);
    return grouped;
  }, [filteredLeads]);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice dictation is not available in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      let transcript = form.transcript ? `${form.transcript} ` : "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setForm((prev) => applyTranscriptHints(transcript.trim(), prev));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      toast.error("Voice capture stopped. You can keep typing manually.");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stopListening = () => {
    recognitionRef.current?.stop?.();
    setListening(false);
  };

  const resetForm = () => {
    stopListening();
    setForm({ ...EMPTY_FORM });
  };

  const saveLead = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.phone.trim() && !form.email.trim()) {
      toast.error("Add at least a phone number or email before saving.");
      return;
    }
    if (!form.problem_type.trim()) {
      toast.error("Pick the problem type so this lead lands in the right lane.");
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const draft: InboundLead = {
      ...form,
      id: createId(),
      phone: formatPhone(form.phone),
      source: "manual_inbound_call",
      created_at: now,
      updated_at: now,
      saved_to_supabase: false,
    };

    try {
      const { data, error } = await (supabase as any)
        .from("inbound_leads")
        .insert({
          id: draft.id,
          client_first_name: draft.client_first_name,
          client_last_name: draft.client_last_name,
          phone: draft.phone,
          email: draft.email,
          state: draft.state,
          city: draft.city,
          problem_type: draft.problem_type,
          urgency: draft.urgency,
          current_coverage: draft.current_coverage,
          desired_solution: draft.desired_solution,
          budget: draft.budget,
          household: draft.household,
          notes: draft.notes,
          transcript: draft.transcript,
          stage: draft.stage,
          next_action_at: draft.next_action_at || null,
          source: draft.source,
        })
        .select("*")
        .maybeSingle();

      if (error) throw error;
      const saved = { ...(data ?? draft), saved_to_supabase: true } as InboundLead;
      mergeLeads([saved]);
      toast.success("Inbound lead saved.");
    } catch (error) {
      console.warn("[inbound-leads] local save only", error);
      mergeLeads([draft]);
      toast.warning("Saved locally. Deploy the inbound_leads migration to sync it across devices.");
    } finally {
      setSaving(false);
      setNewClientOpen(false);
      resetForm();
    }
  };

  const updateStage = async (lead: InboundLead, stage: InboundStage) => {
    const updated = { ...lead, stage, updated_at: new Date().toISOString() };
    setLeads((prev) => {
      const next = prev.map((row) => (row.id === lead.id ? updated : row));
      saveLocalLeads(next);
      return next;
    });
    try {
      await (supabase as any).from("inbound_leads").update({ stage }).eq("id", lead.id);
    } catch {
      // Local state is still the immediate source of truth for tomorrow's intake.
    }
  };

  const deleteLead = async (lead: InboundLead) => {
    const next = leads.filter((row) => row.id !== lead.id);
    setLeads(next);
    saveLocalLeads(next);
    try {
      await (supabase as any).from("inbound_leads").delete().eq("id", lead.id);
    } catch {
      // Ignore unavailable remote table.
    }
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Client Intake"
        eyebrowIcon={<PhoneCall className="h-3 w-3" />}
        title="Inbound Leads"
        subtitle="Fast call capture for people calling live with different problems. Log the situation, identify the solution lane, and push the client through the follow-up board."
        accent="emerald"
        actions={
          <Button className="gap-2" onClick={() => setNewClientOpen(true)}>
            <Plus className="h-4 w-4" />
            New Client
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={PhoneCall} label="Inbound clients" value={stats.total} sub={loading ? "Syncing..." : "Saved intake records"} />
        <Metric icon={Zap} label="Hot right now" value={stats.hot} sub="Urgent or same-day need" tone="text-amber-300" />
        <Metric icon={CalendarClock} label="Follow-ups" value={stats.followUps} sub="Needs next touch" tone="text-blue-300" />
        <Metric icon={ShieldCheck} label="Solved" value={stats.solved} sub="Moved to won/solution" tone="text-emerald-300" />
      </div>

      <GlassCard className="p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, problem, notes, transcript"
              className="pl-9"
            />
          </div>
          <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as InboundStage | "__all__")}>
            <SelectTrigger className="md:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All stages</SelectItem>
              {STAGE_ORDER.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_META[stage].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      <div className="grid gap-3 xl:grid-cols-6">
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          const Icon = meta.icon;
          const rows = columns[stage];
          return (
            <GlassCard key={stage} className="min-h-[240px] p-3 xl:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                  <h2 className="text-sm font-bold truncate">{meta.label}</h2>
                </div>
                <Badge variant="outline" className={cn("text-[10px]", meta.tint)}>
                  {rows.length}
                </Badge>
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  icon={<Icon className="h-5 w-5" />}
                  title="No clients"
                  description="New calls will stack here as you work them."
                  className="py-8"
                />
              ) : (
                <div className="space-y-2">
                  {rows.map((lead, index) => (
                    <motion.div
                      key={lead.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * 0.02, 0.15) }}
                      className="rounded-lg border border-border/50 bg-background/45 p-3 hover:border-primary/35 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{leadName(lead)}</p>
                          <p className="text-xs text-muted-foreground truncate">{lead.problem_type || "No problem type"}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] shrink-0",
                            lead.urgency === "hot"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : lead.urgency === "warm"
                                ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                                : "border-slate-500/40 bg-slate-500/10 text-slate-300",
                          )}
                        >
                          {lead.urgency}
                        </Badge>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {lead.phone && (
                          <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 hover:text-primary">
                            <PhoneCall className="h-3 w-3" />
                            {lead.phone}
                          </a>
                        )}
                        {lead.email && (
                          <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-primary truncate">
                            <Mail className="h-3 w-3" />
                            {lead.email}
                          </a>
                        )}
                        {(lead.city || lead.state) && (
                          <p className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3" />
                            {[lead.city, lead.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>

                      {lead.notes && (
                        <p className="mt-3 line-clamp-3 rounded-md bg-white/[0.03] p-2 text-xs text-foreground/80">
                          {lead.notes}
                        </p>
                      )}

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                        </span>
                        <div className="flex items-center gap-1">
                          <Select value={lead.stage} onValueChange={(value) => updateStage(lead, value as InboundStage)}>
                            <SelectTrigger className="h-7 w-[112px] text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STAGE_ORDER.map((nextStage) => (
                                <SelectItem key={nextStage} value={nextStage}>
                                  {STAGE_META[nextStage].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteLead(lead)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {!lead.saved_to_supabase && (
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-300">
                          <AlertCircle className="h-3 w-3" />
                          Local save
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>

      <Dialog open={newClientOpen} onOpenChange={(open) => { setNewClientOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-[#1e293b] bg-[#050b16]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              New inbound client
            </DialogTitle>
            <DialogDescription>
              Capture the caller while they are live, then move them through the client solution board.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveLead} className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name">
                  <Input value={form.client_first_name} onChange={(event) => updateForm("client_first_name", event.target.value)} placeholder="Client first name" />
                </Field>
                <Field label="Last name">
                  <Input value={form.client_last_name} onChange={(event) => updateForm("client_last_name", event.target.value)} placeholder="Client last name" />
                </Field>
                <Field label="Phone">
                  <Input value={form.phone} onChange={(event) => updateForm("phone", formatPhone(event.target.value))} placeholder="(555) 123-4567" />
                </Field>
                <Field label="Email">
                  <Input value={form.email} onChange={(event) => updateForm("email", event.target.value)} placeholder="client@email.com" />
                </Field>
                <Field label="City">
                  <Input value={form.city} onChange={(event) => updateForm("city", event.target.value)} placeholder="Phoenix" />
                </Field>
                <Field label="State">
                  <Input value={form.state} onChange={(event) => updateForm("state", event.target.value.toUpperCase().slice(0, 2))} placeholder="AZ" />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Problem type">
                  <Select value={form.problem_type} onValueChange={(value) => updateForm("problem_type", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose lane" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROBLEM_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Urgency">
                  <Select value={form.urgency} onValueChange={(value) => updateForm("urgency", value as Urgency)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hot">Hot · solve now</SelectItem>
                      <SelectItem value="warm">Warm · this week</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Stage">
                  <Select value={form.stage} onValueChange={(value) => updateForm("stage", value as InboundStage)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_ORDER.map((stage) => (
                        <SelectItem key={stage} value={stage}>{STAGE_META[stage].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Current coverage">
                  <Input value={form.current_coverage} onChange={(event) => updateForm("current_coverage", event.target.value)} placeholder="None, term policy, group life..." />
                </Field>
                <Field label="Monthly budget">
                  <Input value={form.budget} onChange={(event) => updateForm("budget", event.target.value)} placeholder="$75/mo" />
                </Field>
                <Field label="Household">
                  <Input value={form.household} onChange={(event) => updateForm("household", event.target.value)} placeholder="Spouse, kids, mortgage, income..." />
                </Field>
                <Field label="Next action">
                  <Input type="datetime-local" value={form.next_action_at} onChange={(event) => updateForm("next_action_at", event.target.value)} />
                </Field>
              </div>

              <Field label="Desired solution">
                <Textarea value={form.desired_solution} onChange={(event) => updateForm("desired_solution", event.target.value)} placeholder="What outcome are they looking for?" className="min-h-[86px]" />
              </Field>

              <Field label="Notes">
                <Textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} placeholder="Decision makers, objections, health notes, callback promise, carrier fit..." className="min-h-[120px]" />
              </Field>
            </div>

            <div className="space-y-4">
              <GlassCard className="p-4" variant="strong">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">Voice assist</p>
                    <p className="text-xs text-muted-foreground">
                      Tap the mic during a call. It will capture transcript text and auto-fill obvious fields.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={listening ? "destructive" : "outline"}
                    className="gap-2 shrink-0"
                    onClick={listening ? stopListening : startListening}
                  >
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {listening ? "Stop" : "Mic"}
                  </Button>
                </div>
                <Textarea
                  value={form.transcript}
                  onChange={(event) => setForm((prev) => applyTranscriptHints(event.target.value, prev))}
                  placeholder="Transcript lands here. You can also paste call notes and the parser will fill what it can."
                  className="mt-4 min-h-[260px]"
                />
              </GlassCard>

              <GlassCard className="p-4" variant="subtle">
                <p className="text-sm font-bold mb-3">Call path</p>
                <div className="space-y-3 text-sm">
                  {[
                    "Identify problem and urgency",
                    "Confirm state, budget, household, current coverage",
                    "Pick solution lane",
                    "Set next action before hanging up",
                  ].map((item, index) => (
                    <div key={item} className="flex items-center gap-3 text-muted-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                      {index < 3 && <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />}
                    </div>
                  ))}
                </div>
              </GlassCard>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setNewClientOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="gap-2" disabled={saving}>
                  {saving ? <Save className="h-4 w-4 animate-pulse" /> : <Save className="h-4 w-4" />}
                  Save inbound lead
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone = "text-primary",
}: {
  icon: typeof PhoneCall;
  label: string;
  value: number;
  sub: string;
  tone?: string;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          <p className={cn("mt-1 text-3xl font-bold tabular-nums", tone)}>{value.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
        <Icon className={cn("h-7 w-7 opacity-75", tone)} />
      </div>
    </GlassCard>
  );
}
