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
    tint: "border-slate-500/35 bg-slate-500/10 text-slate-600 dark:text-slate-300",
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

// All 50 US states, full names and common phrasings.
const STATE_ALIASES: Record<string, string> = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA",
  colorado:"CO", connecticut:"CT", delaware:"DE", florida:"FL", georgia:"GA",
  hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA", kansas:"KS",
  kentucky:"KY", louisiana:"LA", maine:"ME", maryland:"MD", massachusetts:"MA",
  michigan:"MI", minnesota:"MN", mississippi:"MS", missouri:"MO", montana:"MT",
  nebraska:"NE", nevada:"NV", "new hampshire":"NH", "new jersey":"NJ",
  "new mexico":"NM", "new york":"NY", "north carolina":"NC", "north dakota":"ND",
  ohio:"OH", oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI",
  "south carolina":"SC", "south dakota":"SD", tennessee:"TN", texas:"TX",
  utah:"UT", vermont:"VT", virginia:"VA", washington:"WA", "west virginia":"WV",
  wisconsin:"WI", wyoming:"WY",
};

const ALL_STATE_ABBR =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

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

/**
 * Local transcript parser. Extracts caller info from a freeform note or
 * voice transcript and auto-fills the form. No LLM needed; pure regex +
 * keyword scoring tuned for Apex's typical inbound call vocabulary.
 *
 * Filled fields override only when the form slot is empty (won't clobber
 * something Sam already typed). Always rewrites `transcript`.
 */
function applyTranscriptHints(
  transcript: string,
  current: Omit<InboundLead, "id" | "created_at" | "updated_at" | "source" | "saved_to_supabase">,
) {
  const text = transcript.toLowerCase();
  const next = { ...current, transcript };

  // EMAIL
  const email = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email && !next.email) next.email = email.toLowerCase();

  // PHONE — 10-digit US, tolerant of separators
  const phone = transcript.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  if (phone && !next.phone) next.phone = formatPhone(phone);

  // NAME — multiple intro patterns
  const namePatterns = [
    /(?:my\s+name\s+is|name\s+is|this\s+is|client\s+is|caller\s+is|i'?m|it'?s)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/,
    /(?:calling\s+for|for)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/,
  ];
  for (const pat of namePatterns) {
    const m = transcript.match(pat);
    if (m) {
      if (!next.client_first_name) next.client_first_name = m[1] || "";
      if (!next.client_last_name && m[2]) next.client_last_name = m[2];
      if (m[1]) break;
    }
  }

  // STATE — full names first (more reliable)
  for (const [name, abbr] of Object.entries(STATE_ALIASES)) {
    if (!next.state && text.includes(name)) { next.state = abbr; break; }
  }
  // Then 2-letter abbreviations (all 50)
  if (!next.state) {
    const stateAbbr = transcript.match(new RegExp(`\\b(${ALL_STATE_ABBR})\\b`));
    if (stateAbbr) next.state = stateAbbr[1];
  }

  // CITY — "in <City>" pattern, plus city-comma-state
  if (!next.city) {
    const cityMatch =
      transcript.match(/(?:in|from|live\s+in|based\s+in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:,|\s|\.|$)/) ||
      transcript.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(?:[A-Z]{2}|\w+)/);
    if (cityMatch?.[1] && cityMatch[1].length < 30) next.city = cityMatch[1];
  }

  // BUDGET — both monthly and lump-sum
  if (!next.budget) {
    const monthly = transcript.match(/\$?\b(\d{2,4})\b\s*(?:dollars|bucks)?\s*(?:a\s+month|monthly|per\s+month|\/mo|\/month)/i);
    const lumpSum = transcript.match(/(?:budget|spend|afford|paying)\s+(?:up\s+to\s+|around\s+|about\s+)?\$?(\d{2,5})/i);
    if (monthly) next.budget = `$${monthly[1]}/mo`;
    else if (lumpSum) next.budget = `$${lumpSum[1]}`;
  }

  // PROBLEM TYPE — scoring across multiple keywords for each category
  if (!next.problem_type) {
    const scores: Record<string, number> = {};
    const cat = (k: string, n = 1) => { scores[k] = (scores[k] || 0) + n; };
    if (/\b(mortgage|home\s*loan|house\s*payment)\b/.test(text)) cat("Mortgage protection", 2);
    if (/\b(final\s*expense|burial|funeral|cremation|cover\s+my\s+funeral)\b/.test(text)) cat("Final expense", 2);
    if (/\b(retirement|iul|index(ed)?\s*universal|401\s*k|roth|ira|annuity)\b/.test(text)) cat("Retirement / IUL", 2);
    if (/\b(child|children|kid|kids|grandkid|grandchild)\b/.test(text)) cat("Child coverage", 1);
    if (/\b(business|llc|s-?corp|company|partner)\b/.test(text)) cat("Business protection", 1);
    if (/\b(policy|coverage|insur\w+)\b/.test(text)) cat("Life insurance review", 1);
    if (/\b(debt|credit\s*card|loan|owe)\b/.test(text)) cat("Debt protection", 1);
    if (/\b(existing|already\s+have|current\s+policy|review\s+my\s+policy|cancel)\b/.test(text)) cat("Existing policy issue", 1);
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) next.problem_type = top[0];
  }

  // CURRENT COVERAGE
  if (!next.current_coverage) {
    if (/\b(no\s+coverage|no\s+insurance|don'?t\s+have\s+(?:any\s+)?(?:coverage|insurance|policy)|never\s+had\s+(?:coverage|insurance))\b/.test(text)) {
      next.current_coverage = "No current coverage";
    } else if (/\b(already\s+have|existing\s+policy|got\s+a\s+policy|currently\s+covered|with\s+\w+(?:\s+insurance|\s+life))\b/.test(text)) {
      next.current_coverage = "Has existing coverage";
    } else if (/\b(group\s+(?:life|coverage)|through\s+work|employer\s+plan|company\s+plan)\b/.test(text)) {
      next.current_coverage = "Group/employer plan only";
    }
  }

  // HOUSEHOLD — marital + kids
  if (!next.household) {
    const bits: string[] = [];
    if (/\b(married|wife|husband|spouse)\b/.test(text)) bits.push("married");
    else if (/\b(single|divorced|widow(?:ed|er)?)\b/.test(text)) bits.push(text.match(/\b(single|divorced|widow(?:ed|er)?)\b/)![1]);
    const kidMatch = text.match(/\b(\d+|one|two|three|four|five)\s+(?:kid|kids|child|children|grandkid)/);
    if (kidMatch) bits.push(`${kidMatch[1]} ${kidMatch[1] === "1" || kidMatch[1] === "one" ? "kid" : "kids"}`);
    if (bits.length) next.household = bits.join(", ");
  }

  // NEXT ACTION — "call back <day>", "follow up <time>"
  if (!next.next_action_at) {
    const followup = transcript.match(/(?:call\s+(?:me\s+)?back|follow(?:\s+up)?|reach\s+out)\s+(?:on\s+|by\s+|next\s+)?(\w+(?:\s+at\s+[\d:]+\s*(?:am|pm)?)?)/i);
    if (followup?.[1]) next.next_action_at = followup[1].slice(0, 60);
  }

  // URGENCY — graded
  if (/\b(urgent|asap|right\s+away|today|tonight|emergency|immediately)\b/.test(text)) next.urgency = "hot";
  else if (/\b(this\s+week|soon|few\s+days|by\s+(?:monday|tuesday|wednesday|thursday|friday)|in\s+the\s+next\s+(?:couple|few)\s+days)\b/.test(text)) next.urgency = "warm";
  else if (next.urgency === undefined as unknown as string) next.urgency = "normal";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number | null>(null);

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

  const startListening = async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice dictation is not available in this browser.");
      return;
    }

    // v16 Wave A: start audio recording in parallel with transcript dictation.
    // Sam: "Save the audio recording. That'd be ideal."
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(1000); // emit chunks every 1s so we don't lose data on crash
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
    } catch (err) {
      // Mic permission denied — keep going with transcript only

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
    mediaRecorderRef.current?.stop?.();
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    setListening(false);
  };

  /**
   * Returns the recorded audio Blob (webm/mp4) or null if no recording was made.
   * Used by saveLead to upload the audio after persisting the lead row.
   */
  const harvestAudio = (): { blob: Blob; durationSec: number } | null => {
    const chunks = audioChunksRef.current;
    if (chunks.length === 0) return null;
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    const durationSec = recordingStartRef.current
      ? Math.round((Date.now() - recordingStartRef.current) / 1000)
      : 0;
    audioChunksRef.current = [];
    recordingStartRef.current = null;
    return { blob, durationSec };
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

      // v16 Wave A: upload audio recording if one was captured
      const audio = harvestAudio();
      if (audio && audio.blob.size > 0) {
        const ext = audio.blob.type.includes("mp4") ? "mp4" : "webm";
        const path = `inbound_leads/${saved.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await (supabase as any).storage
          .from("call-recordings")
          .upload(path, audio.blob, { contentType: audio.blob.type, upsert: false });
        if (!upErr) {
          const { data: signed } = await (supabase as any).storage
            .from("call-recordings")
            .createSignedUrl(path, 60 * 60 * 24 * 365); // 1-year signed URL
          await (supabase as any)
            .from("inbound_leads")
            .update({
              recording_url: signed?.signedUrl ?? path,
              recording_duration_sec: audio.durationSec,
              recording_started_at: new Date(Date.now() - audio.durationSec * 1000).toISOString(),
            })
            .eq("id", saved.id);
          toast.success(`Lead saved + audio (${audio.durationSec}s) attached.`);
        } else {
          toast.success("Lead saved. Audio upload failed — try the mic again next call.");
        }
      } else {
        toast.success("Inbound lead saved.");
      }
      mergeLeads([saved]);
    } catch (error) {

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

      {/* v9 audit fix 2026-06-10: replaced 6-col kanban with single-column list.
          Sam said "very old style ugly, very clunky compared to AgentLink".
          New layout: one list, stage = chip on each row, urgency = dot,
          newest first. Stage column-by-column kanban removed entirely. */}
      {filteredLeads.length === 0 ? (
        <GlassCard className="p-10">
          <EmptyState
            icon={<PhoneCall className="h-6 w-6" />}
            title="No inbound calls yet"
            description="When a call comes in, hit New Client. The transcript box auto-fills name, phone, state, problem, urgency, household, and follow-up time."
          />
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="divide-y divide-border/30">
            {filteredLeads.map((lead) => {
              const meta = STAGE_META[lead.stage];
              const StageIcon = meta.icon;
              const urgencyDot =
                lead.urgency === "hot"
                  ? "bg-rose-400"
                  : lead.urgency === "warm"
                    ? "bg-amber-400"
                    : "bg-slate-500";
              return (
                <div
                  key={lead.id}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  {/* Urgency dot */}
                  <span
                    title={lead.urgency}
                    className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", urgencyDot)}
                  />

                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-14 font-semibold">{leadName(lead)}</p>
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="text-12 text-muted-foreground hover:text-primary">
                          {lead.phone}
                        </a>
                      )}
                    </div>
                    <p className="truncate text-12 text-muted-foreground">
                      {[
                        lead.problem_type || "No problem type",
                        [lead.city, lead.state].filter(Boolean).join(", "),
                        lead.budget,
                        lead.household,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  {/* Stage chip */}
                  <div className="hidden sm:flex shrink-0">
                    <Select value={lead.stage} onValueChange={(value) => updateStage(lead, value as InboundStage)}>
                      <SelectTrigger className="h-8 w-[130px] text-12">
                        <div className="flex items-center gap-2">
                          <StageIcon className="h-3 w-3" />
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {STAGE_ORDER.map((nextStage) => (
                          <SelectItem key={nextStage} value={nextStage}>
                            {STAGE_META[nextStage].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Time + delete */}
                  <span className="hidden md:inline text-12 text-muted-foreground shrink-0 w-20 text-right">
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400"
                    onClick={() => deleteLead(lead)}
                    aria-label="Delete lead"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      <Dialog open={newClientOpen} onOpenChange={(open) => { setNewClientOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-[#1e293b] bg-white dark:bg-[#050b16]">
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
              {/* v13 mid-call key-details panel — always visible during the call
                  so Sam can see the extracted bullets as he talks. Mirrors the
                  form fields but in a scannable read-only summary. */}
              <CallSnapshot form={form} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name">
                  <div className="flex gap-1">
                    <Input value={form.client_first_name} onChange={(event) => updateForm("client_first_name", event.target.value)} placeholder="Client first name" />
                    <TpsLookup form={form} mode="name" />
                  </div>
                </Field>
                <Field label="Last name">
                  <Input value={form.client_last_name} onChange={(event) => updateForm("client_last_name", event.target.value)} placeholder="Client last name" />
                </Field>
                <Field label="Phone">
                  <div className="flex gap-1">
                    <Input value={form.phone} onChange={(event) => updateForm("phone", formatPhone(event.target.value))} placeholder="(555) 123-4567" />
                    <TpsLookup form={form} mode="phone" />
                  </div>
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

/**
 * TpsLookup — opens TruePeopleSearch in a new tab with phone or name.
 * Sam: "double points if you can build in a link to truepeoplesearch."
 * Phone lookup beats name lookup when both available — fewer false matches.
 */
function TpsLookup({ form, mode }: { form: typeof EMPTY_FORM; mode: "phone" | "name" }) {
  const phone = form.phone.replace(/\D/g, "");
  const fullName = [form.client_first_name, form.client_last_name].filter(Boolean).join(" ").trim();
  const stateZip = form.state ? `&citystatezip=${encodeURIComponent(form.state)}` : "";

  const url =
    mode === "phone" && phone.length >= 10
      ? `https://www.truepeoplesearch.com/results?phoneno=${phone}`
      : mode === "name" && fullName
      ? `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(fullName)}${stateZip}`
      : null;

  const disabled = !url;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
      title={disabled ? `Enter ${mode} first` : `Look up on TruePeopleSearch`}
      className="shrink-0"
    >
      <Search className="h-4 w-4" />
    </Button>
  );
}

/**
 * CallSnapshot — always-visible bullet summary of the extracted caller info.
 * Sam: "live mid call, start to list out in bullet points clearly in my
 * face, the important details from the call itself. So I can look at easy."
 * Reads directly from form state — every transcript-parsed field appears
 * here the moment it's extracted. Empty fields are skipped (no clutter).
 */
function CallSnapshot({ form }: { form: typeof EMPTY_FORM }) {
  const bullets: Array<{ label: string; value: string }> = [];
  const name = [form.client_first_name, form.client_last_name].filter(Boolean).join(" ");
  if (name) bullets.push({ label: "Name", value: name });
  if (form.phone) bullets.push({ label: "Phone", value: form.phone });
  if (form.email) bullets.push({ label: "Email", value: form.email });
  if (form.city || form.state) bullets.push({ label: "Location", value: [form.city, form.state].filter(Boolean).join(", ") });
  if (form.problem_type) bullets.push({ label: "Need", value: form.problem_type });
  if (form.current_coverage) bullets.push({ label: "Has now", value: form.current_coverage });
  if (form.desired_solution) bullets.push({ label: "Wants", value: form.desired_solution });
  if (form.budget) bullets.push({ label: "Budget", value: form.budget });
  if (form.household) bullets.push({ label: "Household", value: form.household });
  if (form.urgency && form.urgency !== "normal") bullets.push({ label: "Urgency", value: form.urgency.toUpperCase() });
  if (form.next_action_at) bullets.push({ label: "Next action", value: form.next_action_at });

  if (bullets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        Start the call — bullets appear here as info comes in (voice transcript auto-fills the form).
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-2">
        Call snapshot · {bullets.length} {bullets.length === 1 ? "detail" : "details"} captured
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {bullets.map((b) => (
          <li key={b.label} className="text-xs flex gap-1.5">
            <span className="text-muted-foreground shrink-0">{b.label}:</span>
            <span className="font-medium truncate">{b.value}</span>
          </li>
        ))}
      </ul>
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
