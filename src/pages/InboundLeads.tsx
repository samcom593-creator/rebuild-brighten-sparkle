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
const DRAFT_KEY = "apex:inbound-leads:active-draft:v1";

// v25 hot-fix advantages for live calls:
//   - Auto-save form draft to localStorage on every change (survive reload)
//   - Restore draft on mount (don't lose mid-call work)
//   - Quick fact chips append to notes ("Married", "Has kids", etc)
//   - Live call duration timer
//   - Age inference from "I'm 56" type voice clues
const QUICK_FACTS = [
  "Married", "Has kids", "Owns home", "Mortgage payment",
  "Recent health event", "Pre-existing condition", "Smoker",
  "Already has policy", "Beneficiary set", "Wants no exam",
  "Needs IUL", "Sole income earner", "Veteran", "Self-employed",
] as const;

function loadDraft(): typeof EMPTY_FORM | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // sanity check — must have the EMPTY_FORM shape keys
    if (typeof parsed === "object" && parsed && "client_first_name" in parsed) return parsed;
    return null;
  } catch { return null; }
}

function saveDraft(form: typeof EMPTY_FORM) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    // Only persist if there's at least one populated field — empty drafts
    // get a clear (so a saved+reset cycle doesn't leak the prior draft)
    const hasContent = Object.values(form).some((v) => typeof v === "string" ? v.trim().length > 0 : false);
    if (hasContent) {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } else {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  } catch { /* private mode etc */ }
}

function clearDraft() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
}

function appendNote(notes: string, fact: string): string {
  // Idempotent: if fact already in notes, remove it (toggle off)
  const existing = notes.split(/[·\n]/).map((s) => s.trim()).filter(Boolean);
  if (existing.includes(fact)) {
    return existing.filter((s) => s !== fact).join(" · ");
  }
  return existing.length === 0 ? fact : `${existing.join(" · ")} · ${fact}`;
}

function fmtCallTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// v25 SWITCH CENTER SCRIPT · Sam's live call playbook (provided 2026-06-10)
// Shown in the New Client dialog so Sam sees the next prompt + has
// one-tap-to-notes cheat-sheet rebuttals for the 7 common situations.
const SWITCH_CENTER_SCRIPT: Array<{ step: string; prompt: string }> = [
  { step: "Open",          prompt: "This is Samuel with the policy adjustment center · who I have the pleasure of speaking with today?" },
  { step: "Product",       prompt: "Is it a whole life policy or term?" },
  { step: "Reason",        prompt: "How can I assist you today?" },
  { step: "Pull profile",  prompt: "Okay perfect · let me pull up your profile · can you confirm the spelling of your first and last name?" },
  { step: "DOB",           prompt: "And then perfect · what's your DOB?" },
  { step: "Monthly",       prompt: "Approximately how much were they charging you a month?" },
  { step: "Address",       prompt: "And the address on file?" },
];

const SWITCH_CENTER_REBUTTALS: Array<{ trigger: string; response: string }> = [
  { trigger: "Missed payment",
    response: "Yes I see that and we sent you over a lapse notice in the mail · good news is we can get this updated for you and I see a note here that you were eligible for the preferred option which should drop down the payment · I'll have the billing department explain that to you." },
  { trigger: "Is this {Carrier}?",
    response: "This is the switch center to help you avoid long wait times. (NOW GO BACK TO THE QUESTIONS)" },
  { trigger: "Policy packet missing",
    response: "Okay · I do see here that for beneficiary there's nothing here, we do need to get you one so we don't have to do a lost policy statement · but also I see that you were marked as standard health not preferred but on my end it shows you're eligible · let's get all this fixed. Let me transfer you over." },
  { trigger: "Cancellation",
    response: "Okay and what was the reason for the cancellation · well that makes sense you have been overpaying · you were supposed to be in the preferred option · let's reduce that payment so you can keep the cash value." },
  { trigger: "Change address",
    response: "Okay perfect · I see here that we do need to update this because we've been sending letters in the mail · have you not received them? You were supposed to be in the preferred option and it should've saved you some money · I'm going to have the correct department fix the address and put you on the preferred option. One moment let me transfer you." },
  { trigger: "Change banking",
    response: "Yes I see here that it looks like you're not on automatic draft · we're going to switch it to automatic billing and it should drop down your payment as well · but give me one moment let me transfer you to the billing department." },
  { trigger: "Change beneficiary",
    response: "Yes let me get you to the right department but before I do that I see a note that we've been sending you letters in the mail that you were supposed to be in the preferred option. Did you receive those letters? Well let me get this transferred out to the right department to put you in the preferred option and change the beneficiary as well as we get you a new policy packet in the mail so you see the change." },
];

// v25 area-code → state hint table (top 200 NANP area codes).
// Used to suggest a state when Sam types the phone number and the
// state slot is still empty. Compact map — not authoritative, just a
// fast hint so he doesn't have to type the state if it matches.
const AREA_CODE_STATE: Record<string, string> = {
  "201":"NJ","202":"DC","203":"CT","205":"AL","206":"WA","207":"ME","208":"ID","209":"CA","210":"TX","212":"NY","213":"CA","214":"TX","215":"PA","216":"OH","217":"IL","218":"MN","219":"IN",
  "224":"IL","225":"LA","228":"MS","229":"GA","231":"MI","234":"OH","239":"FL","240":"MD","248":"MI","251":"AL","252":"NC","253":"WA","254":"TX","256":"AL","260":"IN","262":"WI","267":"PA","269":"MI","270":"KY","272":"PA","276":"VA","281":"TX",
  "301":"MD","302":"DE","303":"CO","304":"WV","305":"FL","307":"WY","308":"NE","309":"IL","310":"CA","312":"IL","313":"MI","314":"MO","315":"NY","316":"KS","317":"IN","318":"LA","319":"IA","320":"MN","321":"FL","323":"CA","325":"TX","330":"OH","331":"IL","334":"AL","336":"NC","337":"LA","339":"MA","341":"CA","346":"TX","347":"NY","351":"MA","352":"FL","360":"WA","361":"TX","364":"KY","380":"OH","385":"UT","386":"FL",
  "401":"RI","402":"NE","404":"GA","405":"OK","406":"MT","407":"FL","408":"CA","409":"TX","410":"MD","412":"PA","413":"MA","414":"WI","415":"CA","417":"MO","419":"OH","423":"TN","424":"CA","425":"WA","430":"TX","432":"TX","434":"VA","435":"UT","440":"OH","442":"CA","443":"MD","458":"OR","463":"IN","469":"TX","470":"GA","475":"CT","478":"GA","479":"AR","480":"AZ","484":"PA",
  "501":"AR","502":"KY","503":"OR","504":"LA","505":"NM","507":"MN","508":"MA","509":"WA","510":"CA","512":"TX","513":"OH","515":"IA","516":"NY","517":"MI","518":"NY","520":"AZ","530":"CA","531":"NE","534":"WI","539":"OK","540":"VA","541":"OR","551":"NJ","557":"MO","559":"CA","561":"FL","562":"CA","563":"IA","564":"WA","567":"OH","570":"PA","571":"VA","573":"MO","574":"IN","575":"NM","580":"OK","585":"NY","586":"MI","601":"MS","602":"AZ","603":"NH","605":"SD","606":"KY","607":"NY","608":"WI","609":"NJ","610":"PA","612":"MN","614":"OH","615":"TN","616":"MI","617":"MA","618":"IL","619":"CA","620":"KS","623":"AZ","626":"CA","628":"CA","629":"TN","630":"IL","631":"NY","636":"MO","640":"NJ","641":"IA","646":"NY","650":"CA","651":"MN","657":"CA","660":"MO","661":"CA","662":"MS","667":"MD","669":"CA","678":"GA","681":"WV","682":"TX","689":"FL",
  "701":"ND","702":"NV","703":"VA","704":"NC","706":"GA","707":"CA","708":"IL","712":"IA","713":"TX","714":"CA","715":"WI","716":"NY","717":"PA","718":"NY","719":"CO","720":"CO","724":"PA","725":"NV","727":"FL","731":"TN","732":"NJ","734":"MI","737":"TX","740":"OH","743":"NC","747":"CA","754":"FL","757":"VA","760":"CA","762":"GA","763":"MN","765":"IN","769":"MS","770":"GA","772":"FL","773":"IL","774":"MA","775":"NV","779":"IL","781":"MA","785":"KS","786":"FL",
  "801":"UT","802":"VT","803":"SC","804":"VA","805":"CA","806":"TX","808":"HI","810":"MI","812":"IN","813":"FL","814":"PA","815":"IL","816":"MO","817":"TX","818":"CA","828":"NC","830":"TX","831":"CA","843":"SC","845":"NY","847":"IL","848":"NJ","850":"FL","854":"SC","856":"NJ","857":"MA","858":"CA","859":"KY","860":"CT","862":"NJ","863":"FL","864":"SC","865":"TN","870":"AR","872":"IL","878":"PA","901":"TN","903":"TX","904":"FL","906":"MI","907":"AK","908":"NJ","909":"CA","910":"NC","912":"GA","913":"KS","914":"NY","915":"TX","916":"CA","917":"NY","918":"OK","919":"NC","920":"WI","925":"CA","928":"AZ","929":"NY","930":"IN","931":"TN","936":"TX","937":"OH","938":"AL","940":"TX","941":"FL","947":"MI","949":"CA","951":"CA","952":"MN","954":"FL","956":"TX","959":"CT","970":"CO","971":"OR","972":"TX","973":"NJ","978":"MA","979":"TX","980":"NC","984":"NC","985":"LA","989":"MI",
};

function inferStateFromPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  // Handle leading 1 (NANP country code)
  const area = digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4)
             : digits.length === 10 ? digits.slice(0, 3)
             : digits.length >= 3 ? digits.slice(0, 3) : null;
  return area ? AREA_CODE_STATE[area] ?? null : null;
}

// v24 palette restraint: kill the 6-color rainbow (cyan/violet/amber/blue/
// emerald/slate). Stage chips read MONO via shared neutral tint; the dot
// is the only color carrier. 4 dot colors: slate (in-progress) / amber
// (waiting on Sam) / emerald (closed-won) / rose (closed-lost).
const STAGE_META: Record<InboundStage, { label: string; tint: string; dot: string; icon: typeof PhoneCall }> = {
  new:        { label: "New Call",   tint: "border-border bg-muted text-foreground",   dot: "bg-slate-400",   icon: PhoneCall },
  diagnosing: { label: "Diagnosing", tint: "border-border bg-muted text-foreground",   dot: "bg-slate-500",   icon: ClipboardList },
  quoted:     { label: "Quoted",     tint: "border-border bg-muted text-foreground",   dot: "bg-amber-500",   icon: DollarSign },
  follow_up:  { label: "Follow-up",  tint: "border-border bg-muted text-foreground",   dot: "bg-amber-400",   icon: CalendarClock },
  won:        { label: "Solved",     tint: "border-border bg-muted text-foreground",   dot: "bg-emerald-500", icon: CheckCircle2 },
  lost:       { label: "Closed Out", tint: "border-border bg-muted text-foreground",   dot: "bg-rose-400",    icon: ShieldCheck },
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
  // v25 hot-fix: restore draft from localStorage on mount so a page
  // reload mid-call doesn't lose Sam's typed/transcribed data.
  const [form, setForm] = useState(() => loadDraft() ?? { ...EMPTY_FORM });
  const [listening, setListening] = useState(false);
  const [callElapsed, setCallElapsed] = useState(0); // live timer (sec)
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const draftRestored = !!loadDraft();

  // v25 hot-fix: auto-save draft to localStorage on every form change so
  // a tab reload/crash doesn't lose live work mid-call.
  useEffect(() => {
    const t = setTimeout(() => saveDraft(form), 400); // debounce 400ms
    return () => clearTimeout(t);
  }, [form]);

  // v25 hot-fix: live call timer · ticks while mic is recording
  useEffect(() => {
    if (!listening || !recordingStartRef.current) {
      setCallElapsed(0);
      return;
    }
    const tick = () => {
      const startedAt = recordingStartRef.current;
      if (!startedAt) return;
      setCallElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [listening]);

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

  // v25 GOOGLE VOICE INSTANT FILL
  // When the New Client dialog opens, try to read the clipboard. If the
  // clipboard contains a US phone number (Sam copies it from Google Voice
  // when the call rings — Cmd+C on the caller ID), pre-fill the phone
  // field, infer state from area code, and open TruePeopleSearch in a
  // background tab automatically. Zero manual typing for the most common
  // workflow.
  const pullFromClipboard = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      // Match 10-digit US phone in any common format (with or without country code)
      const m = text.match(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
      if (!m) return;
      const fullPhone = `(${m[1]}) ${m[2]}-${m[3]}`;
      const inferred = inferStateFromPhone(fullPhone);
      setForm((prev) => ({
        ...prev,
        phone: prev.phone.trim() ? prev.phone : fullPhone,
        state: prev.state.trim() ? prev.state : (inferred ?? prev.state),
      }));
      toast.success(`📋 Pulled ${fullPhone} from clipboard${inferred ? ` · ${inferred}` : ""}`);
      // Auto-open TPS in background tab so by the time Sam looks, results are loaded
      const digits = fullPhone.replace(/\D/g, "");
      window.open(`https://www.truepeoplesearch.com/results?phoneno=${digits}`, "_blank", "noopener,noreferrer");
    } catch {
      // permission denied, private mode, etc — silent
    }
  }, []);

  // Trigger clipboard pull whenever the New Client dialog opens
  useEffect(() => {
    if (!newClientOpen) return;
    // Tiny delay so the dialog has time to grant focus first
    const t = setTimeout(() => { void pullFromClipboard(); }, 150);
    return () => clearTimeout(t);
  }, [newClientOpen, pullFromClipboard]);

  // v25 GLOBAL HOTKEY: Cmd+Shift+N (or Ctrl+Shift+N) opens New Client +
  // pulls clipboard in one shot. Sam's GV rings → Cmd+C the number →
  // Cmd+Shift+N → form is filled + TPS tab opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewClientOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    // v25 hot-fix: wipe the autosave draft so a future page reload
    // doesn't restore stale data after a clean save/cancel.
    clearDraft();
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

    // v25 BUG FIX: stop mic + harvest audio IMMEDIATELY so the recording
    // doesn't keep capturing during the network round-trip + Sam can
    // start the next call without waiting on upload to finish.
    recognitionRef.current?.stop?.();
    mediaRecorderRef.current?.stop?.();
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    setListening(false);
    const audio = harvestAudio();

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
      toast.success(audio && audio.blob.size > 0
        ? `Lead saved · audio (${audio.durationSec}s) uploading in background.`
        : "Inbound lead saved.");

      // v25 BUG FIX: audio upload is FIRE-AND-FORGET so Sam can take
      // the next call immediately. Was blocking 1-4s on the round-trip.
      if (audio && audio.blob.size > 0) {
        void (async () => {
          try {
            const ext = audio.blob.type.includes("mp4") ? "mp4" : "webm";
            const path = `inbound_leads/${saved.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await (supabase as any).storage
              .from("call-recordings")
              .upload(path, audio.blob, { contentType: audio.blob.type, upsert: false });
            if (upErr) {
              toast.warning(`Audio upload failed: ${upErr.message?.slice(0, 60) ?? "unknown"}`);
              return;
            }
            const { data: signed } = await (supabase as any).storage
              .from("call-recordings")
              .createSignedUrl(path, 60 * 60 * 24 * 365);
            await (supabase as any)
              .from("inbound_leads")
              .update({
                recording_url: signed?.signedUrl ?? path,
                recording_duration_sec: audio.durationSec,
                recording_started_at: new Date(Date.now() - audio.durationSec * 1000).toISOString(),
              })
              .eq("id", saved.id);
            toast.success(`Audio attached to ${leadName(saved)}`);
          } catch (e: any) {
            toast.warning(`Audio upload error: ${e?.message?.slice(0, 60) ?? "unknown"}`);
          }
        })();
      }
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
        actions={
          <div className="flex items-center gap-2">
            {/* v25 hot-fix: draft restored banner — Sam sees instantly if
                a page reload restored prior work without him touching anything */}
            {draftRestored && !newClientOpen && (
              <Badge variant="outline" className="text-11 border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                Draft restored — open New Client to resume
              </Badge>
            )}
            <Button className="gap-2" onClick={() => setNewClientOpen(true)}>
              <Plus className="h-4 w-4" />
              New Client
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={PhoneCall} label="Inbound clients" value={stats.total} sub={loading ? "Syncing..." : "Saved intake records"} />
        {/* v24 audit fix: dropped colored tone on KPI values. Icon at
            opacity-60 carries any state hint; values stay text-foreground. */}
        <Metric icon={Zap} label="Hot right now" value={stats.hot} sub="Urgent or same-day need" />
        <Metric icon={CalendarClock} label="Follow-ups" value={stats.followUps} sub="Needs next touch" />
        <Metric icon={ShieldCheck} label="Solved" value={stats.solved} sub="Moved to won/solution" />
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
            {/* v25 Google Voice instant-fill banner · runs auto on open · button is the manual fallback */}
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 px-3 py-2">
              <p className="text-12 text-amber-700 dark:text-amber-300">
                <span className="font-semibold">📋 Google Voice tip:</span>{" "}
                Cmd+C the caller number from GV, then{" "}
                <kbd className="rounded border border-amber-500/40 bg-amber-100 dark:bg-amber-900/30 px-1 font-mono text-11">Cmd+Shift+N</kbd>{" "}
                opens this dialog with phone + state pre-filled and TPS already loaded.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => void pullFromClipboard()}>
                Paste from clipboard
              </Button>
            </div>
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
                    {/* v25 advantage: autoFocus so the moment the New Client
                        dialog opens, Sam can start typing immediately —
                        no extra click to focus the field. */}
                    <Input autoFocus value={form.client_first_name} onChange={(event) => updateForm("client_first_name", event.target.value)} placeholder="Client first name" />
                    <TpsLookup form={form} mode="name" />
                  </div>
                </Field>
                <Field label="Last name">
                  <Input value={form.client_last_name} onChange={(event) => updateForm("client_last_name", event.target.value)} placeholder="Client last name" />
                </Field>
                <Field label="Phone">
                  <div className="flex gap-1">
                    <Input
                      value={form.phone}
                      onChange={(event) => {
                        const formatted = formatPhone(event.target.value);
                        // v25 advantage: area-code → state autofill if state slot empty
                        const inferred = inferStateFromPhone(formatted);
                        setForm((prev) => ({
                          ...prev,
                          phone: formatted,
                          // only fill if user hasn't already set state (don't clobber)
                          state: prev.state.trim() ? prev.state : (inferred ?? prev.state),
                        }));
                      }}
                      placeholder="(555) 123-4567"
                    />
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
                {/* v25 hot-fix quick-fact chips · one tap appends to notes
                    (or removes if already there). Saves 15-20 sec typing
                    on common boolean facts mid-call. */}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {QUICK_FACTS.map((fact) => {
                    const active = form.notes.toLowerCase().includes(fact.toLowerCase());
                    return (
                      <button
                        key={fact}
                        type="button"
                        onClick={() => updateForm("notes", appendNote(form.notes, fact))}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-11 font-medium transition-base",
                          active
                            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                            : "border-border bg-muted text-muted-foreground hover:bg-slate-200 dark:hover:bg-slate-700"
                        )}
                      >
                        {active ? "✓ " : ""}{fact}
                      </button>
                    );
                  })}
                </div>
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
                  <div className="flex items-center gap-2 shrink-0">
                    {/* v25 live call timer · visible only while mic recording */}
                    {listening && (
                      <span className="flex items-center gap-1.5 text-12 font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                        {fmtCallTimer(callElapsed)}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant={listening ? "destructive" : "outline"}
                      className="gap-2"
                      onClick={listening ? stopListening : startListening}
                    >
                      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {listening ? "Stop" : "Mic"}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={form.transcript}
                  onChange={(event) => setForm((prev) => applyTranscriptHints(event.target.value, prev))}
                  placeholder="Transcript lands here. You can also paste call notes and the parser will fill what it can."
                  className="mt-4 min-h-[260px]"
                />
              </GlassCard>

              {/* v25 SWITCH CENTER SCRIPT — Sam's exact opening flow,
                  visible mid-call. Each prompt is a tap-to-copy button
                  in case Sam wants to log what he asked verbatim. */}
              <GlassCard className="p-4" variant="subtle">
                <p className="text-sm font-bold mb-3 flex items-center justify-between">
                  <span>Switch Center · script</span>
                  <span className="text-11 text-muted-foreground font-normal">tap to copy</span>
                </p>
                <ol className="space-y-2 text-13">
                  {SWITCH_CENTER_SCRIPT.map((step, idx) => (
                    <li key={step.step} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-11 font-bold text-primary tabular-nums">
                        {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(step.prompt).then(
                            () => toast.success(`Copied "${step.step}"`),
                            () => {}
                          );
                        }}
                        className="text-left text-foreground/90 hover:text-primary transition-base"
                      >
                        <span className="font-semibold">{step.step}:</span> {step.prompt}
                      </button>
                    </li>
                  ))}
                </ol>
              </GlassCard>

              {/* v25 SWITCH CENTER REBUTTAL CHEAT SHEET — 7 common situations
                  each one tap to append the full rebuttal to the Notes field
                  so Sam captures the exact framing he used. */}
              <GlassCard className="p-4" variant="subtle">
                <p className="text-sm font-bold mb-3 flex items-center justify-between">
                  <span>Cheat sheet · tap to add rebuttal to notes</span>
                </p>
                <div className="space-y-1.5">
                  {SWITCH_CENTER_REBUTTALS.map((cs) => (
                    <button
                      key={cs.trigger}
                      type="button"
                      onClick={() => {
                        updateForm("notes", appendNote(form.notes, `[${cs.trigger}] ${cs.response}`));
                        toast.success(`Added: ${cs.trigger}`);
                      }}
                      className="w-full text-left rounded-md border border-border/60 px-2.5 py-2 hover:border-primary/40 hover:bg-primary/[0.04] transition-base"
                    >
                      <span className="text-12 font-semibold text-foreground">{cs.trigger}</span>
                      <span className="block text-11 text-muted-foreground line-clamp-2 mt-0.5">{cs.response}</span>
                    </button>
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
    {/* v24 audit fix: CallSnapshot panel was 5th green inside the dialog
        (border-emerald-500/40 bg-emerald-500/5). Mono now · emerald only
        on the small count badge inside. */}
    <div className="rounded-lg border border-border bg-muted/40 p-3">
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
